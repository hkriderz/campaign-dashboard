#!/usr/bin/env python3
"""
sort-signups.py — Sort sign-up sheet addresses into polygon-based districts.

Three-tier lookup (fastest first):
  1. Zip code entirely within one district → immediate result
  2. (zip, street name) in the runtime-built street cache → immediate result
  3. Batch geocode via Census Geocoder → point-in-polygon, updates caches

The street cache grows automatically as you process sheets, so repeated runs
on new data get faster over time.

Usage:
  # Step 1 (one-time): build the zip lookup table
  python sort-signups.py --build-zip-lookup

    # Step 2: sort one or more CSVs
    python sort-signups.py signups.csv --address-col "Street Address" --zip-col "Zip Code"
    python sort-signups.py signups-a.csv signups-b.csv --address-col "Street Address" --zip-col "Zip Code"

  # Override output prefix (default: same directory as input)
  python sort-signups.py signups.csv --out results/sorted

Column name defaults: "Address", "City", "Zip"
Outputs: <prefix>-<label><district>.csv ..., <prefix>-outside-target.csv,
<prefix>-geocode-failed.csv. Multi-layer preset runs emit one outside-target
file and one geocode-failed file shared across the run. Multi-input batch runs
can combine all inputs into one shared set of output files when --out is given.
"""

import argparse
from collections import Counter
import csv
import json
import re
import sys
from pathlib import Path

import requests
from shapely.geometry import Point, shape
from shapely.ops import unary_union

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
CACHE_DIR = REPO_ROOT / "data" / "district-sort-cache"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
STATUS_GEOCODE_FAILED = "geocode_failed"
STATUS_OUTSIDE_TARGET = "outside_target"
PRESET_CONFIGS = {
    "la-city-council": {
        "geojson": str(REPO_ROOT / "geodata" / "la-city-council.geojson"),
        "district_field": "District",
        "district_label_prefix": "cd",
        "target_district": None,
    },
    "ca-state-assembly-67": {
        "geojson": str(REPO_ROOT / "geodata" / "ca-state-assembly.geojson"),
        "district_field": "DISTRICT",
        "district_label_prefix": "ad",
        "target_district": 67,
    },
}

CITY_ALIASES = {
    "venice": "Los Angeles",
    "venice beach": "Los Angeles",
    "playa": "Los Angeles",
    "playa del ray": "Los Angeles",
    "playa del rey": "Los Angeles",
    "playa del reyy": "Los Angeles",
    "playa vista": "Los Angeles",
    "westchester": "Los Angeles",
    "green": "Los Angeles",
    "california": "Los Angeles",
    "marina": "Marina Del Rey",
    "mdr": "Marina Del Rey",
    "mdr/venice": "Marina Del Rey",
    "marina de ray": "Marina Del Rey",
    "marina de rey": "Marina Del Rey",
    "marina del ray": "Marina Del Rey",
    "marina del rey": "Marina Del Rey",
    "marina del reyy": "Marina Del Rey",
    "marina del rayy": "Marina Del Rey",
}

ADDRESS_TYPO_REPLACEMENTS = {
    r"\bcaliforna\b": "california",
    r"\bindlana\b": "indiana",
    r"\bduddly\b": "dudley",
    r"\beasteon\b": "eastern",
    r"\bprovedence\b": "providence",
    r"\bpromenade wy\b": "pacific promenade",
    r"\bculuer\b": "culver",
    r"\bplaya del ray\b": "playa del rey",
    r"\bplaya del reyy\b": "playa del rey",
    r"\bmarina del ray\b": "marina del rey",
    r"\bmarina de ray\b": "marina del rey",
}

STREET_SUFFIX_HINTS = {
    "flower": "flower ave",
    "rose": "rose ave",
    "indiana": "indiana ave",
    "california": "california ave",
    "sunset": "sunset ave",
    "wave crest": "wave crest ave",
    "horizon": "horizon ave",
    "brooks": "brooks ave",
    "clara": "clara ave",
    "fountain": "fountain ave",
    "juan": "juan ave",
    "venezia": "venezia ave",
}

# Census Geocoder batch endpoint (no API key required)
CENSUS_BATCH_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
)
CENSUS_BATCH_SIZE = 1000  # max per request

# Census TIGER web service — zip code tabulation areas
ZCTA_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "tigerWMS_Current/MapServer/2/query"
)


# ---------------------------------------------------------------------------
# District geometry helpers
# ---------------------------------------------------------------------------

def normalize_district_value(value):
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+", text):
        return int(text)
    return text


def district_sort_key(value):
    if isinstance(value, int):
        return (0, value)
    return (1, str(value))


def get_cache_paths(args):
    geojson_stem = Path(args.geojson).stem.lower()
    district_field = str(args.district_field).lower()
    target = normalize_district_value(args.target_district) if args.target_district is not None else "all"
    slug = re.sub(r"[^a-z0-9]+", "-", f"{geojson_stem}-{district_field}-{args.district_label_prefix}-{target}").strip("-")
    return {
        "zip_lookup": CACHE_DIR / f"zip-lookup-{slug}.json",
        "street_cache": CACHE_DIR / f"street-cache-{slug}.json",
        "geocode_cache": CACHE_DIR / f"geocode-cache-{slug}.json",
    }


def get_output_tag(args):
    if args.target_district is not None:
        return f"{args.district_label_prefix}{args.target_district}"
    return args.district_label_prefix


def build_run_args_list(args):
    if not args.preset:
        args.target_district = (
            normalize_district_value(args.target_district)
            if args.target_district is not None
            else None
        )
        args.run_name = get_output_tag(args)
        return [args]

    run_args_list = []
    for preset_name in args.preset:
        preset = PRESET_CONFIGS[preset_name]
        run_values = vars(args).copy()
        run_values.update(preset)
        run_values["target_district"] = (
            normalize_district_value(run_values["target_district"])
            if run_values["target_district"] is not None
            else None
        )
        run_values["run_name"] = preset_name
        run_args_list.append(argparse.Namespace(**run_values))
    return run_args_list


def write_csv(path, fieldnames, rows_):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows_)
    print(f"  {path}  ({len(rows_)} rows)")


def merge_fieldnames(existing, incoming):
    for fieldname in incoming:
        if fieldname not in existing:
            existing.append(fieldname)


def load_district_shapes(geojson_path, district_field, target_district=None):
    """Return {district_value: shapely_polygon} for the requested district layer."""
    with open(geojson_path, encoding="utf-8") as f:
        gj = json.load(f)
    shapes = {}
    for feat in gj["features"]:
        if district_field not in feat["properties"]:
            continue
        d = normalize_district_value(feat["properties"][district_field])
        if target_district is not None and d != target_district:
            continue
        shapes[d] = shape(feat["geometry"])
    if not shapes:
        sys.exit(f"ERROR: no districts found in {geojson_path} for field '{district_field}'")
    return shapes


def district_for_point(lat, lon, district_shapes):
    """Return district int if point is inside a district polygon, else None."""
    pt = Point(lon, lat)
    for d, poly in sorted(district_shapes.items(), key=lambda item: district_sort_key(item[0])):
        if poly.contains(pt):
            return d
    return None


# ---------------------------------------------------------------------------
# Zip lookup builder
# ---------------------------------------------------------------------------

def build_zip_lookup(district_shapes):
    """
    Query Census TIGER for all ZCTAs that intersect the bounding box of
    the district envelope, then classify each as a district number, "split",
    or "other".
    """
    combined = unary_union(list(district_shapes.values()))
    minx, miny, maxx, maxy = combined.bounds

    print("Fetching zip code (ZCTA) boundaries from Census TIGER...")
    # TIGER may page results; fetch up to 2000 (more than enough for metro LA)
    resp = requests.get(ZCTA_URL, params={
        "geometry": f"{minx},{miny},{maxx},{maxy}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "ZCTA5,GEOID,NAME",
        "returnGeometry": "true",
        "f": "geojson",
        "inSR": "4326",
        "outSR": "4326",
        "resultRecordCount": 2000,
    }, timeout=60)
    resp.raise_for_status()
    zcta_gj = resp.json()
    features = zcta_gj.get("features", [])
    print(f"  Received {len(features)} ZCTAs to classify.")

    lookup = {}
    for feat in features:
        props = feat["properties"]
        zcta = str(
            props.get("ZCTA5")
            or props.get("GEOID")
            or props.get("NAME")
            or ""
        ).strip()
        if not zcta:
            continue
        zcta_shape = shape(feat["geometry"])

        containing = [district for district, poly in district_shapes.items() if poly.contains(zcta_shape)]
        touching = [district for district, poly in district_shapes.items() if poly.intersects(zcta_shape)]

        if len(containing) == 1 and len(touching) == 1:
            lookup[zcta] = containing[0]
        elif touching:
            lookup[zcta] = "split"
        else:
            lookup[zcta] = "other"

    return lookup


# ---------------------------------------------------------------------------
# Census Geocoder batch
# ---------------------------------------------------------------------------

def geocode_batch(address_tuples):
    """
    address_tuples: list of (street, city, state, zip) strings.
    Returns: list of (lat, lon) or None, same length as input.
    """
    lines = []
    for i, (street, city, state, zip_) in enumerate(address_tuples):
        # Quote fields containing commas
        lines.append(f'{i},"{street}","{city}","{state}","{zip_}"')
    payload = "\n".join(lines)

    resp = requests.post(
        CENSUS_BATCH_URL,
        data={"benchmark": "Public_AR_Current"},
        files={"addressFile": ("addresses.csv", payload, "text/csv")},
        timeout=120,
    )
    resp.raise_for_status()

    results = [None] * len(address_tuples)
    for row in csv.reader(resp.text.splitlines()):
        if len(row) < 3:
            continue
        try:
            idx = int(row[0].strip())
            match_status = row[2].strip()
            if match_status == "Match" and len(row) >= 6 and row[5].strip():
                lon_str, lat_str = row[5].strip().split(",")
                results[idx] = (float(lat_str), float(lon_str))
        except (ValueError, IndexError):
            pass  # leave as None

    return results


# ---------------------------------------------------------------------------
# Address normalization
# ---------------------------------------------------------------------------

def normalize_street(raw_address):
    """
    Strip the leading house number and lowercase — used as the cache key.
    e.g. "1234 W Main St Apt 2" → "w main st"
    """
    s = raw_address.strip().lower()
    s = re.sub(r"^\d+\s*", "", s)   # strip leading number
    # Remove apt/unit suffixes so cache hits across same building addresses.
    s = re.sub(r"\b(apt|apartment|unit|ste|suite|#)\s*\w+\b", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def zip5(raw):
    """Return zero-padded 5-digit zip string, or empty string if invalid."""
    z = re.sub(r"\D", "", str(raw))[:5]
    return z.zfill(5) if len(z) == 5 else z


def canon_col(name):
    """Canonical column key for flexible matching."""
    return re.sub(r"[^a-z0-9]", "", str(name).strip().lower())


def resolve_column(fieldnames, preferred, aliases=None):
    """Resolve a column name case-insensitively with optional aliases."""
    aliases = aliases or []
    requested = [preferred] + aliases
    by_canon = {canon_col(f): f for f in fieldnames}
    for cand in requested:
        if cand in fieldnames:
            return cand
        c = canon_col(cand)
        if c in by_canon:
            return by_canon[c]
    return None


def build_full_address(row, address_col, street_num_col, street_name_col, apt_col):
    """Build a usable street address from either single or split columns."""
    direct = str(row.get(address_col, "")).strip() if address_col else ""
    if direct:
        return direct

    street_num = str(row.get(street_num_col, "")).strip() if street_num_col else ""
    street_name = str(row.get(street_name_col, "")).strip() if street_name_col else ""
    apt = str(row.get(apt_col, "")).strip() if apt_col else ""
    if street_num or street_name:
        parts = [p for p in [street_num, street_name] if p]
        addr = " ".join(parts)
        if apt:
            addr = f"{addr} Apt {apt}"
        return addr.strip()
    return ""


def status_for_district(district, label_prefix):
    if district is None:
        return STATUS_OUTSIDE_TARGET
    return f"matched_{label_prefix}{district}"


def is_matched_status(status, label_prefix):
    return isinstance(status, str) and status.startswith(f"matched_{label_prefix}")


def district_from_status(status, label_prefix):
    prefix = f"matched_{label_prefix}"
    if not is_matched_status(status, label_prefix):
        return None
    try:
        return normalize_district_value(status.replace(prefix, "", 1))
    except ValueError:
        return None


def output_suffix_for_status(status, label_prefix):
    district = district_from_status(status, label_prefix)
    if district is not None:
        return f"{label_prefix}{district}"
    return status.replace("_", "-")


def district_label_for_status(status, label_prefix):
    district = district_from_status(status, label_prefix)
    if district is not None:
        return f"{label_prefix.upper()}{district}"
    return status


def classify_latlon(latlon, district_shapes, label_prefix):
    if not latlon:
        return STATUS_GEOCODE_FAILED
    district = district_for_point(latlon[0], latlon[1], district_shapes)
    return status_for_district(district, label_prefix)


def normalize_city_for_retry(raw_city):
    city = str(raw_city or "").replace("\xa0", " ").strip()
    city = re.sub(r"\s+", " ", city)
    key = city.lower()
    if key in CITY_ALIASES:
        return CITY_ALIASES[key]
    return city.title() if city else "Los Angeles"


def normalize_address_for_retry(raw_address):
    address = str(raw_address or "").replace("\xa0", " ").strip().lower()
    address = re.sub(r"\s+", " ", address)
    for pattern, replacement in ADDRESS_TYPO_REPLACEMENTS.items():
        address = re.sub(pattern, replacement, address)

    for base_name, full_name in STREET_SUFFIX_HINTS.items():
        address = re.sub(
            rf"^(\d+(?:\s+1/2)?)\s+{re.escape(base_name)}$",
            rf"\1 {full_name}",
            address,
        )
        address = re.sub(
            rf"^(\d+(?:\s+1/2)?)\s+{re.escape(base_name)}\s+(apt\s+.+)$",
            rf"\1 {full_name} \2",
            address,
        )

    return address.title()


def geocode_cache_key(address, city, zip_):
    return f"{address}|{city}|{zip_}"


def get_cached_geocode(geocode_cache, address, city, zip_):
    raw_key = geocode_cache_key(address, city, zip_)
    if raw_key in geocode_cache and geocode_cache[raw_key]:
        return geocode_cache[raw_key]
    legacy = geocode_cache.get(address)
    if legacy:
        return legacy
    return None


def store_geocode_result(geocode_cache, address, raw_city, normalized_city, zip_, latlon):
    geocode_cache[geocode_cache_key(address, raw_city, zip_)] = latlon
    if normalized_city and normalized_city != raw_city:
        geocode_cache[geocode_cache_key(address, normalized_city, zip_)] = latlon
    geocode_cache[address] = latlon


# ---------------------------------------------------------------------------
# Street cache helper
# ---------------------------------------------------------------------------

def update_street_cache(cache, key, district):
    """
    Add (zip|street) → district to cache.
    If we later see the same street resolve to a different district,
    mark it as "split" so we never shortcut it again.
    """
    if district == STATUS_GEOCODE_FAILED:
        return
    if key not in cache:
        cache[key] = district
    elif cache[key] != district:
        cache[key] = "split"


# ---------------------------------------------------------------------------
# Main sort logic
# ---------------------------------------------------------------------------

def sort_file(args, district_shapes, cache_paths, write_outputs=True, write_non_match_outputs=True):
    if not cache_paths["zip_lookup"].exists():
        sys.exit(
            "Zip lookup not found. Run with --build-zip-lookup first."
        )

    with open(cache_paths["zip_lookup"]) as f:
        zip_lookup = json.load(f)
        zip_lookup = {
            k: normalize_district_value(v) if isinstance(v, (int, float, str)) and str(v) not in ("split", "other") else v
            for k, v in zip_lookup.items()
        }

    street_cache = {}
    if cache_paths["street_cache"].exists():
        with open(cache_paths["street_cache"]) as f:
            street_cache = json.load(f)

    geocode_cache = {}
    if cache_paths["geocode_cache"].exists():
        with open(cache_paths["geocode_cache"]) as f:
            geocode_cache = json.load(f)

    # --- Read input ---
    with open(args.input, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    address_col = resolve_column(fieldnames, args.address_col, ["Street Address", "Address"])
    city_col = resolve_column(fieldnames, args.city_col, ["City", "city"])
    zip_col = resolve_column(fieldnames, args.zip_col, ["ZIP", "Zip", "Postal Code"])

    street_num_col = resolve_column(fieldnames, args.street_num_col, ["Street #", "Street Number"])
    street_name_col = resolve_column(fieldnames, args.street_name_col, ["Street Name", "Street"])
    apt_col = resolve_column(fieldnames, args.apt_col, ["Apt #", "Apartment", "Unit"])

    if not zip_col:
        sys.exit(
            f"Could not find zip column '{args.zip_col}'. Available columns: {fieldnames}"
        )
    if not address_col and not (street_num_col and street_name_col):
        sys.exit(
            "Could not find a usable address column. Provide --address-col or "
            "--street-num-col + --street-name-col."
        )

    print(f"Read {len(rows)} rows from {args.input}")
    print(
        "Using columns: "
        f"address={address_col or '<split>'}, "
        f"street_num={street_num_col}, street_name={street_name_col}, apt={apt_col}, "
        f"city={city_col}, zip={zip_col}"
    )

    # status per row: matched_cd{n}, outside_target, geocode_failed
    assigned = [None] * len(rows)
    pending_geocode = []  # list of row indices needing geocoding

    # --- Tier 1 & 2 ---
    for i, row in enumerate(rows):
        z = zip5(row.get(zip_col, ""))
        address = build_full_address(row, address_col, street_num_col, street_name_col, apt_col)
        raw_city = str(row.get(city_col, "Los Angeles")).replace("\xa0", " ").strip() if city_col else "Los Angeles"
        raw_city = raw_city or "Los Angeles"
        street_key = normalize_street(address)
        cache_key = f"{z}|{street_key}"

        zip_class = zip_lookup.get(z, "other")

        if isinstance(zip_class, int):
            assigned[i] = status_for_district(zip_class, args.district_label_prefix)    # Tier 1: zip is definitive
        elif isinstance(zip_class, str) and zip_class not in ("split", "other"):
            assigned[i] = status_for_district(normalize_district_value(zip_class), args.district_label_prefix)
        elif zip_class == "split":
            sc = street_cache.get(cache_key)
            if sc in (STATUS_GEOCODE_FAILED, STATUS_OUTSIDE_TARGET) or is_matched_status(sc, args.district_label_prefix):
                assigned[i] = sc                            # Tier 2: street cache hit
            elif sc == "split":
                pending_geocode.append(i)                   # street itself splits — geocode
            else:
                cached = get_cached_geocode(geocode_cache, address, raw_city, z)
                if cached:
                    status = classify_latlon(cached, district_shapes, args.district_label_prefix)
                    assigned[i] = status
                    update_street_cache(street_cache, cache_key, status)
                else:
                    pending_geocode.append(i)               # Tier 3: needs geocoding
        else:
            assigned[i] = STATUS_OUTSIDE_TARGET

    # --- Tier 3: batch geocode ---
    if pending_geocode:
        print(
            f"Geocoding {len(pending_geocode)} addresses via Census Geocoder"
            f" (in batches of {CENSUS_BATCH_SIZE})..."
        )
        for batch_start in range(0, len(pending_geocode), CENSUS_BATCH_SIZE):
            batch_indices = pending_geocode[batch_start:batch_start + CENSUS_BATCH_SIZE]
            payload = []
            raw_inputs = []
            for ri in batch_indices:
                row = rows[ri]
                address = build_full_address(row, address_col, street_num_col, street_name_col, apt_col)
                city = str(row.get(city_col, "Los Angeles")).replace("\xa0", " ").strip() if city_col else "Los Angeles"
                city = city or "Los Angeles"
                z = zip5(row.get(zip_col, ""))
                payload.append((address, city, "CA", z))
                raw_inputs.append((address, city, z))

            geo_results = geocode_batch(payload)

            retry_positions = [j for j, latlon in enumerate(geo_results) if not latlon]
            if retry_positions:
                retry_payload = []
                retry_inputs = []
                for j in retry_positions:
                    address, raw_city, z = raw_inputs[j]
                    retry_address = normalize_address_for_retry(address)
                    retry_city = normalize_city_for_retry(raw_city)
                    retry_payload.append((retry_address, retry_city, "CA", z))
                    retry_inputs.append((retry_address, retry_city, z))

                retry_results = geocode_batch(retry_payload)
                print(f"  Retried {len(retry_positions)} failed rows with normalized inputs")
                for retry_idx, original_j in enumerate(retry_positions):
                    if retry_results[retry_idx]:
                        geo_results[original_j] = retry_results[retry_idx]
                        raw_address, raw_city, z = raw_inputs[original_j]
                        retry_address, retry_city, _ = retry_inputs[retry_idx]
                        store_geocode_result(
                            geocode_cache,
                            raw_address,
                            raw_city,
                            retry_city,
                            z,
                            retry_results[retry_idx],
                        )

            for j, ri in enumerate(batch_indices):
                row = rows[ri]
                address = build_full_address(row, address_col, street_num_col, street_name_col, apt_col)
                raw_city = str(row.get(city_col, "Los Angeles")).replace("\xa0", " ").strip() if city_col else "Los Angeles"
                raw_city = raw_city or "Los Angeles"
                z = zip5(row.get(zip_col, ""))
                cache_key = f"{z}|{normalize_street(address)}"

                latlon = geo_results[j]
                retry_city = normalize_city_for_retry(raw_city)
                store_geocode_result(geocode_cache, address, raw_city, retry_city, z, latlon)
                status = classify_latlon(latlon, district_shapes, args.district_label_prefix)
                assigned[ri] = status
                update_street_cache(street_cache, cache_key, status)

            print(f"  Geocoded batch {batch_start + 1}–{batch_start + len(batch_indices)}")

    # --- Save caches ---
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_paths["street_cache"], "w") as f:
        json.dump(street_cache, f, indent=2)
    with open(cache_paths["geocode_cache"], "w") as f:
        json.dump(geocode_cache, f, indent=2)
    print(
        f"Caches updated — {len(street_cache)} street entries, "
        f"{len(geocode_cache)} geocode entries."
    )

    # --- Bucket rows ---
    district_outputs = {district: [] for district in sorted(district_shapes, key=district_sort_key)}
    out_outside_target = []
    out_geocode_failed = []
    for i, row in enumerate(rows):
        status = assigned[i] or STATUS_GEOCODE_FAILED
        out_row = dict(row)
        out_row["_match_status"] = status
        out_row["_district_label"] = district_label_for_status(status, args.district_label_prefix)

        district = district_from_status(status, args.district_label_prefix)
        if district is not None:
            district_outputs[district].append(out_row)
        elif status == STATUS_OUTSIDE_TARGET:
            out_outside_target.append(out_row)
        else:
            out_geocode_failed.append(out_row)

    # --- Write output CSVs ---
    out_fieldnames = list(fieldnames)
    if "_district_label" not in out_fieldnames:
        out_fieldnames.append("_district_label")
    if "_match_status" not in out_fieldnames:
        out_fieldnames.append("_match_status")
    base = args.out or str(Path(args.input).with_suffix(""))
    output_tag = get_output_tag(args)

    if write_outputs:
        print("Output:")
        for district in sorted(district_outputs, key=district_sort_key):
            write_csv(f"{base}-{args.district_label_prefix}{district}.csv", out_fieldnames, district_outputs[district])
        if write_non_match_outputs:
            write_csv(f"{base}-{output_tag}-outside-target.csv", out_fieldnames, out_outside_target)
            write_csv(f"{base}-{output_tag}-geocode-failed.csv", out_fieldnames, out_geocode_failed)

    # Summary
    counts = Counter((status or STATUS_GEOCODE_FAILED) for status in assigned)
    matched_parts = []
    for district in sorted(district_shapes, key=district_sort_key):
        label = f"matched_{args.district_label_prefix}{district}"
        matched_parts.append(f"{counts[label]} {label}")
    matched_parts.append(f"{counts[STATUS_OUTSIDE_TARGET]} outside_target")
    matched_parts.append(f"{counts[STATUS_GEOCODE_FAILED]} geocode_failed")
    print("\nSummary: " + " | ".join(matched_parts))

    # Report which zips appeared as "split" — useful for tuning
    split_zips_seen = set()
    for i in range(len(rows)):
        z = zip5(rows[i].get(zip_col, ""))
        if zip_lookup.get(z) == "split":
            split_zips_seen.add(z)
    if split_zips_seen:
        print(f"Split zips encountered: {sorted(split_zips_seen)}")

    return {
        "fieldnames": out_fieldnames,
        "rows": rows,
        "assigned": [status or STATUS_GEOCODE_FAILED for status in assigned],
        "district_outputs": district_outputs,
        "outside_target": out_outside_target,
        "geocode_failed": out_geocode_failed,
    }


def process_input_file(base_args, run_args_list, input_path, write_outputs=True):
    combine_non_matches = len(run_args_list) > 1 and not base_args.build_zip_lookup
    combined_outside_target = []
    combined_geocode_failed = []
    combined_fieldnames = None
    combined_statuses = None
    combined_rows = None
    run_names = []
    matched_outputs = {}
    matched_output_order = []

    for run_args_template in run_args_list:
        run_args = argparse.Namespace(**vars(run_args_template).copy())
        run_args.input = input_path

        cache_paths = get_cache_paths(run_args)
        district_shapes = load_district_shapes(run_args.geojson, run_args.district_field, run_args.target_district)

        print(f"\n=== {run_args.run_name} ===")

        result = sort_file(
            run_args,
            district_shapes,
            cache_paths,
            write_outputs=write_outputs,
            write_non_match_outputs=not combine_non_matches,
        )

        for district in sorted(result["district_outputs"], key=district_sort_key):
            bucket_name = f"{run_args.district_label_prefix}{district}"
            if bucket_name not in matched_outputs:
                matched_outputs[bucket_name] = []
                matched_output_order.append(bucket_name)
            matched_outputs[bucket_name].extend(result["district_outputs"][district])

        if combine_non_matches:
            if combined_fieldnames is None:
                combined_fieldnames = list(result["fieldnames"])
                if "_district_runs" not in combined_fieldnames:
                    combined_fieldnames.append("_district_runs")
                if "_combined_match_status" not in combined_fieldnames:
                    combined_fieldnames.append("_combined_match_status")
                combined_rows = result["rows"]
                combined_statuses = [[] for _ in result["assigned"]]

            run_names.append(run_args.run_name)
            for i, status in enumerate(result["assigned"]):
                combined_statuses[i].append(status)

    if combine_non_matches:
        base = base_args.out or str(Path(input_path).with_suffix(""))
        for i, statuses in enumerate(combined_statuses):
            if any(status.startswith("matched_") for status in statuses):
                continue

            combined_row = dict(combined_rows[i])
            combined_row["_district_runs"] = ",".join(run_names)
            if any(status == STATUS_GEOCODE_FAILED for status in statuses):
                combined_row["_combined_match_status"] = STATUS_GEOCODE_FAILED
                combined_geocode_failed.append(combined_row)
            else:
                combined_row["_combined_match_status"] = STATUS_OUTSIDE_TARGET
                combined_outside_target.append(combined_row)

        print("\nCombined non-match output:")
        write_csv(
            f"{base}-outside-target.csv",
            combined_fieldnames,
            combined_outside_target,
        )
        write_csv(
            f"{base}-geocode-failed.csv",
            combined_fieldnames,
            combined_geocode_failed,
        )

    if not combine_non_matches:
        combined_fieldnames = list(result["fieldnames"])
        combined_outside_target = list(result["outside_target"])
        combined_geocode_failed = list(result["geocode_failed"])

    return {
        "matched_outputs": matched_outputs,
        "matched_output_order": matched_output_order,
        "matched_fieldnames": list(result["fieldnames"]),
        "outside_target": combined_outside_target,
        "geocode_failed": combined_geocode_failed,
        "bad_fieldnames": combined_fieldnames,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sort sign-up sheet addresses into polygon-based districts."
    )
    parser.add_argument(
        "input", nargs="*",
        help="Input CSV file path(s)"
    )
    parser.add_argument(
        "--out",
        help="Output file prefix (default: input filename without extension)"
    )
    parser.add_argument(
        "--address-col", default="Address",
        help="Column name for street address (default: 'Address')"
    )
    parser.add_argument(
        "--city-col", default="City",
        help="Column name for city (default: 'City')"
    )
    parser.add_argument(
        "--zip-col", default="Zip",
        help="Column name for zip code (default: 'Zip')"
    )
    parser.add_argument(
        "--street-num-col", default="Street #",
        help="Column name for street number in split-address sheets (default: 'Street #')"
    )
    parser.add_argument(
        "--street-name-col", default="Street Name",
        help="Column name for street name in split-address sheets (default: 'Street Name')"
    )
    parser.add_argument(
        "--apt-col", default="Apt #",
        help="Column name for apartment/unit in split-address sheets (default: 'Apt #')"
    )
    parser.add_argument(
        "--build-zip-lookup", action="store_true",
        help="(Re)build the zip-code lookup table and exit"
    )
    parser.add_argument(
        "--geojson", default=str(REPO_ROOT / "geodata" / "la-city-council.geojson"),
        help="GeoJSON polygon layer to use for district matching"
    )
    parser.add_argument(
        "--district-field", default="district",
        help="Feature property name that stores the district id/value"
    )
    parser.add_argument(
        "--district-label-prefix", default="cd",
        help="Output/status label prefix, e.g. 'cd' or 'ad'"
    )
    parser.add_argument(
        "--target-district",
        help="Optional single district to target, e.g. 67"
    )
    parser.add_argument(
        "--preset",
        action="append",
        choices=sorted(PRESET_CONFIGS),
        help="Repeatable preset for running multiple district layers in one invocation"
    )
    args = parser.parse_args()
    run_args_list = build_run_args_list(args)
    batch_mode = len(args.input) > 1 and not args.build_zip_lookup

    if not args.build_zip_lookup and not args.input:
        parser.error("Provide one or more input CSV files, or use --build-zip-lookup")

    if batch_mode and not args.out:
        parser.error("--out is required when providing multiple input CSVs")

    for run_args in run_args_list:
        if run_args.build_zip_lookup:
            cache_paths = get_cache_paths(run_args)
            district_shapes = load_district_shapes(run_args.geojson, run_args.district_field, run_args.target_district)

            print(f"\n=== {run_args.run_name} ===")

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            lookup = build_zip_lookup(district_shapes)
            with open(cache_paths["zip_lookup"], "w") as f:
                json.dump(lookup, f, indent=2)

            single_district_counts = Counter(v for v in lookup.values() if isinstance(v, int))
            split_zips = sorted(z for z, v in lookup.items() if v == "split")
            other_zips = sorted(z for z, v in lookup.items() if v == "other")

            print(f"\nWrote {len(lookup)} zip entries to {cache_paths['zip_lookup']}")
            for district in sorted(district_shapes, key=district_sort_key):
                print(f"{run_args.district_label_prefix.upper()}{district}-only ({single_district_counts[district]}): {single_district_counts[district]}")
            print(f"Split     ({len(split_zips)}):  {split_zips}")
            print(f"Other     ({len(other_zips)}):  {other_zips}")
        if run_args.build_zip_lookup:
            continue

    if batch_mode:
        aggregated_outputs = {}
        aggregated_output_order = []
        matched_fieldnames = []
        bad_fieldnames = []
        aggregated_outside_target = []
        aggregated_geocode_failed = []

        for input_path in args.input:
            print(f"\n### Input: {input_path}")
            result = process_input_file(args, run_args_list, input_path, write_outputs=False)

            merge_fieldnames(matched_fieldnames, result["matched_fieldnames"])
            merge_fieldnames(bad_fieldnames, result["bad_fieldnames"])
            if "_source_file" not in matched_fieldnames:
                matched_fieldnames.append("_source_file")
            if "_source_file" not in bad_fieldnames:
                bad_fieldnames.append("_source_file")

            for bucket_name in result["matched_output_order"]:
                if bucket_name not in aggregated_outputs:
                    aggregated_outputs[bucket_name] = []
                    aggregated_output_order.append(bucket_name)
                for row in result["matched_outputs"][bucket_name]:
                    combined_row = dict(row)
                    combined_row["_source_file"] = input_path
                    aggregated_outputs[bucket_name].append(combined_row)

            for row in result["outside_target"]:
                combined_row = dict(row)
                combined_row["_source_file"] = input_path
                aggregated_outside_target.append(combined_row)

            for row in result["geocode_failed"]:
                combined_row = dict(row)
                combined_row["_source_file"] = input_path
                aggregated_geocode_failed.append(combined_row)

        print("\nBatch output:")
        for bucket_name in aggregated_output_order:
            write_csv(f"{args.out}-{bucket_name}.csv", matched_fieldnames, aggregated_outputs[bucket_name])
        write_csv(f"{args.out}-outside-target.csv", bad_fieldnames, aggregated_outside_target)
        write_csv(f"{args.out}-geocode-failed.csv", bad_fieldnames, aggregated_geocode_failed)
        return

    for input_path in args.input:
        print(f"\n### Input: {input_path}")
        process_input_file(args, run_args_list, input_path)


if __name__ == "__main__":
    main()
