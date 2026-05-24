"""
Deterministic address normalization for district classification.

The goal is not to be a perfect postal parser. It is to make hand-typed campaign
CSV rows consistent enough for cache keys, Census geocoding, and street-level
fallbacks while keeping dependencies light.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

import pandas as pd


PLACEHOLDER_VALUES = {"", "-", "--", "n/a", "na", "none", "null", "unknown"}

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
    "la": "Los Angeles",
    "los angles": "Los Angeles",
    "los angeles ca": "Los Angeles",
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

UNIT_PATTERN = re.compile(
    r"\b(?:apt|apartment|unit|ste|suite|space|spc|#)\s*[\w-]+.*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ColumnMapping:
    address: str = "Address"
    city: str = "City"
    state: str = "State"
    zip: str = "Zip"
    street_number: str = "Street #"
    street_name: str = "Street Name"
    apartment: str = "Apt #"


@dataclass(frozen=True)
class NormalizedAddress:
    address: str
    city: str
    state: str
    zip: str
    normalized_address: str
    normalized_street: str

    def census_tuple(self) -> tuple[str, str, str, str]:
        return (self.address, self.city, self.state, self.zip)


def get_row_value(row: Mapping[str, Any], column: str) -> Any:
    """
    Read a CSV value using tolerant header matching.

    Uploaded CSVs often contain invisible or trailing header whitespace, for
    example "Street # " instead of "Street #". Exact matching is tried first,
    then a normalized header comparison so saved mappings still work.
    """
    if not column:
        return ""
    if column in row:
        return row.get(column)

    expected = clean_text(column).lower()
    expected_compact = re.sub(r"\W+", "", expected)
    for key, value in row.items():
        actual = clean_text(key).lower()
        if actual == expected or re.sub(r"\W+", "", actual) == expected_compact:
            return value
    return ""


def clean_text(value: Any) -> str:
    text = str(value or "").replace("\xa0", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return "" if text.lower() in PLACEHOLDER_VALUES else text


def normalize_zip(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))[:5]
    return digits.zfill(5) if len(digits) == 5 else digits


def normalize_state(value: Any, default: str = "CA") -> str:
    state = clean_text(value).upper()
    if not state:
        return default
    if state in {"CALIFORNIA", "CA."}:
        return "CA"
    return state[:2]


def normalize_city(value: Any, default: str = "Los Angeles") -> str:
    city = clean_text(value)
    if not city:
        return default
    key = city.lower()
    if key in CITY_ALIASES:
        return CITY_ALIASES[key]
    return city.title()


def cleanup_address_typos(address: str) -> str:
    cleaned = clean_text(address).lower()
    for pattern, replacement in ADDRESS_TYPO_REPLACEMENTS.items():
        cleaned = re.sub(pattern, replacement, cleaned)
    return cleaned


def apply_street_suffix_hints(address: str) -> str:
    fixed = address
    for base_name, full_name in STREET_SUFFIX_HINTS.items():
        fixed = re.sub(
            rf"^(\d+(?:\s+1/2)?)\s+{re.escape(base_name)}$",
            rf"\1 {full_name}",
            fixed,
        )
        fixed = re.sub(
            rf"^(\d+(?:\s+1/2)?)\s+{re.escape(base_name)}\s+((?:apt|unit|#)\s+.+)$",
            rf"\1 {full_name} \2",
            fixed,
        )
    return fixed


def normalize_address_line(value: Any) -> str:
    address = cleanup_address_typos(clean_text(value))
    address = apply_street_suffix_hints(address)
    address = re.sub(r"\s+", " ", address).strip()
    return address.title()


def build_address_from_row(
    row: Mapping[str, Any],
    columns: ColumnMapping = ColumnMapping(),
) -> str:
    direct = clean_text(get_row_value(row, columns.address))
    if direct:
        return normalize_address_line(direct)

    street_number = clean_text(get_row_value(row, columns.street_number))
    street_name = clean_text(get_row_value(row, columns.street_name))
    apartment = clean_text(get_row_value(row, columns.apartment))
    address = " ".join(part for part in [street_number, street_name] if part)
    if apartment:
        address = f"{address} Apt {apartment}"
    return normalize_address_line(address)


def normalize_street(raw_address: str) -> str:
    street = clean_text(raw_address).lower()
    street = re.sub(r"^\d+[a-z]?\s+", "", street)
    street = UNIT_PATTERN.sub("", street)
    street = re.sub(r"[^\w\s]", " ", street)
    street = re.sub(r"\s+", " ", street)
    return street.strip()


def normalize_full_address(address: str, city: str, state: str, zip_code: str) -> str:
    parts = [address, city, state, zip_code]
    normalized = " ".join(clean_text(part).lower() for part in parts if clean_text(part))
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def normalize_row_address(
    row: Mapping[str, Any],
    columns: ColumnMapping = ColumnMapping(),
) -> NormalizedAddress:
    address = build_address_from_row(row, columns)
    city = normalize_city(get_row_value(row, columns.city))
    state = normalize_state(get_row_value(row, columns.state))
    zip_code = normalize_zip(get_row_value(row, columns.zip))

    return NormalizedAddress(
        address=address,
        city=city,
        state=state,
        zip=zip_code,
        normalized_address=normalize_full_address(address, city, state, zip_code),
        normalized_street=normalize_street(address),
    )


def normalize_dataframe_addresses(
    df: pd.DataFrame,
    columns: ColumnMapping = ColumnMapping(),
) -> pd.DataFrame:
    """Return a copy of a DataFrame with deterministic normalized address columns."""
    out = df.copy()
    normalized = [normalize_row_address(row, columns) for row in out.to_dict("records")]

    out["_address"] = [row.address for row in normalized]
    out["_city"] = [row.city for row in normalized]
    out["_state"] = [row.state for row in normalized]
    out["_zip"] = [row.zip for row in normalized]
    out["_normalized_address"] = [row.normalized_address for row in normalized]
    out["_normalized_street"] = [row.normalized_street for row in normalized]
    return out
