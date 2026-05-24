"""
Lightweight Census Geocoder integration.

Uses the Census batch endpoint for throughput, pandas for CSV row workflows, and
an in-process cache for repeated addresses within a job. Persistent caching is
handled by matcher.py after polygon verification.
"""

from __future__ import annotations

import csv
import io
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import pandas as pd
import requests

from normalize import ColumnMapping, NormalizedAddress, normalize_dataframe_addresses, normalize_row_address


CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
CENSUS_BATCH_SIZE = 1000


@dataclass(frozen=True)
class GeocodeResult:
    lat: float
    lon: float
    quality: str
    source: str = "census"
    raw: dict[str, Any] = field(default_factory=dict)


def geocode_cache_key(address: NormalizedAddress) -> str:
    return "|".join([address.normalized_address, address.zip])


def census_quality(match_type: str | None) -> str:
    """
    Convert Census match type into the engine's quality vocabulary.

    Census batch results are usually TIGER/range based, so even exact Census
    matches are treated as interpolated rather than true rooftop points.
    """
    normalized = (match_type or "").strip().lower()
    if normalized in {"exact", "non_exact", "non-exact", "tie"}:
        return "interpolated"
    return "interpolated"


class CensusGeocoder:
    """Batch-first Census geocoder with retries and lightweight job-local cache."""

    def __init__(
        self,
        *,
        timeout_seconds: int = 15,
        batch_size: int = CENSUS_BATCH_SIZE,
        max_retries: int = 0,
        retry_sleep_seconds: float = 1.0,
        session: requests.Session | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.batch_size = min(batch_size, CENSUS_BATCH_SIZE)
        self.max_retries = max_retries
        self.retry_sleep_seconds = retry_sleep_seconds
        self.session = session or requests.Session()
        self._cache: dict[str, GeocodeResult | None] = {}

    def geocode_one(self, address: NormalizedAddress) -> GeocodeResult | None:
        return self.geocode_many([address])[0]

    def geocode_row(
        self,
        row: dict[str, Any],
        columns: ColumnMapping = ColumnMapping(),
    ) -> GeocodeResult | None:
        return self.geocode_one(normalize_row_address(row, columns))

    def geocode_many(self, addresses: Iterable[NormalizedAddress]) -> list[GeocodeResult | None]:
        address_list = list(addresses)
        results: list[GeocodeResult | None] = [None] * len(address_list)
        pending: list[tuple[int, NormalizedAddress]] = []

        for index, address in enumerate(address_list):
            key = geocode_cache_key(address)
            if key in self._cache:
                results[index] = self._cache[key]
            else:
                pending.append((index, address))

        if not pending:
            return results

        for start in range(0, len(pending), self.batch_size):
            batch = pending[start : start + self.batch_size]
            batch_results = self._geocode_batch([address for _, address in batch])
            for (original_index, address), result in zip(batch, batch_results):
                results[original_index] = result
                self._cache[geocode_cache_key(address)] = result

        return results

    def geocode_dataframe(
        self,
        df: pd.DataFrame,
        columns: ColumnMapping = ColumnMapping(),
    ) -> pd.DataFrame:
        """Return a copy of a DataFrame with normalized and geocode columns."""
        out = normalize_dataframe_addresses(df, columns)
        addresses = [normalize_row_address(row, columns) for row in df.to_dict("records")]
        results = self.geocode_many(addresses)

        out["_geocode_lat"] = [result.lat if result else None for result in results]
        out["_geocode_lon"] = [result.lon if result else None for result in results]
        out["_geocode_quality"] = [result.quality if result else None for result in results]
        out["_geocode_source"] = [result.source if result else None for result in results]
        return out

    def _geocode_batch(self, addresses: list[NormalizedAddress]) -> list[GeocodeResult | None]:
        results = self._post_batch(addresses)
        failed_indexes = [i for i, result in enumerate(results) if result is None]

        for attempt in range(self.max_retries):
            if not failed_indexes:
                break

            retry_addresses = [addresses[i] for i in failed_indexes]
            if attempt > 0 and self.retry_sleep_seconds > 0:
                time.sleep(self.retry_sleep_seconds)

            retry_results = self._post_batch(retry_addresses)
            next_failed: list[int] = []
            for retry_index, original_index in enumerate(failed_indexes):
                retry_result = retry_results[retry_index]
                if retry_result is None:
                    next_failed.append(original_index)
                else:
                    results[original_index] = retry_result
            failed_indexes = next_failed

        return results

    def _post_batch(self, addresses: list[NormalizedAddress]) -> list[GeocodeResult | None]:
        payload = build_census_payload(addresses)

        try:
            response = self.session.post(
                CENSUS_BATCH_URL,
                data={"benchmark": "Public_AR_Current"},
                files={"addressFile": ("addresses.csv", payload, "text/csv")},
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except requests.RequestException:
            return [None] * len(addresses)

        return parse_census_batch_response(response.text, len(addresses))


def build_census_payload(addresses: list[NormalizedAddress]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    for index, address in enumerate(addresses):
        writer.writerow([index, address.address, address.city, address.state, address.zip])
    return buffer.getvalue()


def parse_census_batch_response(text: str, expected_count: int) -> list[GeocodeResult | None]:
    results: list[GeocodeResult | None] = [None] * expected_count

    for row in csv.reader(text.splitlines()):
        if len(row) < 6:
            continue

        try:
            index = int(row[0].strip())
            match_status = row[2].strip()
            match_type = row[3].strip() if len(row) > 3 else ""
            matched_address = row[4].strip() if len(row) > 4 else ""
            coords = row[5].strip()
            if index < 0 or index >= expected_count:
                continue
            if match_status != "Match" or not coords:
                continue

            lon_text, lat_text = coords.split(",", 1)
            results[index] = GeocodeResult(
                lat=float(lat_text),
                lon=float(lon_text),
                quality=census_quality(match_type),
                raw={
                    "match_status": match_status,
                    "match_type": match_type,
                    "matched_address": matched_address,
                },
            )
        except (ValueError, IndexError):
            continue

    return results
