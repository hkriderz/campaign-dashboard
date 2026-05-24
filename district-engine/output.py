"""
Streaming CSV export helpers for district classification jobs.

Rows are written as they are processed, so large uploads do not need to be held
in memory. Export buckets are intentionally simple:
- matched_<label>.csv for selected target districts
- other_districts.csv for rows matched outside selected districts
- outside_layer.csv for geocoded rows outside a selected polygon layer
- inferred_districts.csv for non-polygon inference rows
- geocode_failed.csv for failed geocoding/classification
- manual_review.csv for low-confidence or ambiguous rows
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from matcher import MatchResult


DEFAULT_REVIEW_CONFIDENCE_THRESHOLD = 0.85
SPECIAL_EXPORTS = {
    "inferred_districts": "inferred_districts.csv",
    "other_districts": "other_districts.csv",
    "outside_layer": "outside_layer.csv",
    "outside_target": "outside_target.csv",
    "geocode_failed": "geocode_failed.csv",
    "manual_review": "manual_review.csv",
}


@dataclass(frozen=True)
class ExportRecord:
    bucket: str
    path: Path
    row_count: int


def safe_bucket_label(label: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "_" for ch in str(label).strip())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned or "unknown"


def result_label(result: MatchResult, label_prefix: str = "") -> str | None:
    if not result.district:
        return None
    return f"{label_prefix}{result.district}" if label_prefix else result.district


def export_bucket_for_result(
    result: MatchResult,
    *,
    district_label: str | None,
    selected_labels: set[str],
    targeted_mode: bool = False,
    review_confidence_threshold: float = DEFAULT_REVIEW_CONFIDENCE_THRESHOLD,
) -> str:
    if result.match_method in {"neighborhood_inference", "near_boundary_inference"}:
        return "inferred_districts"
    if result.review_reason == "outside_district_layer":
        return "outside_layer"
    if result.match_method == "failed" or not result.district:
        return "geocode_failed"
    if result.needs_review or result.match_method == "ambiguous":
        return "manual_review"
    if result.confidence < review_confidence_threshold:
        return "manual_review"
    if selected_labels and district_label not in selected_labels:
        return "other_districts" if targeted_mode else "outside_target"
    if targeted_mode and not selected_labels:
        return "other_districts"
    return f"matched_{safe_bucket_label(district_label or result.district)}"


class CsvOutputWriter:
    """Manage multiple streaming CSV export files for one processing job."""

    def __init__(
        self,
        output_dir: str | Path,
        *,
        input_fieldnames: Iterable[str],
        append_existing: bool = False,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.input_fieldnames = list(input_fieldnames)
        self.append_existing = append_existing
        self.fieldnames = self._build_fieldnames()
        self._files: dict[str, Any] = {}
        self._writers: dict[str, csv.DictWriter] = {}
        self._counts: dict[str, int] = {}

    def write(
        self,
        bucket: str,
        row: dict[str, Any],
        result: MatchResult,
        *,
        district_label: str | None = None,
    ) -> None:
        writer = self._writer_for_bucket(bucket)
        out_row = dict(row)
        out_row.update(
            {
                "_district": result.district or "",
                "_district_label": district_label or "",
                "_district_layer": result.district_layer,
                "_confidence": f"{result.confidence:.3f}",
                "_match_method": result.match_method,
                "_lat": "" if result.lat is None else result.lat,
                "_lon": "" if result.lon is None else result.lon,
                "_geocode_quality": result.geocode_quality or "",
                "_needs_review": "1" if result.needs_review else "0",
                "_review_reason": result.review_reason or "",
                "_normalized_address": result.normalized_address,
                "_zip": result.zip,
                "_nearest_district": result.evidence.get("nearest_district", ""),
                "_nearest_district_label": result.evidence.get("nearest_district_label", ""),
                "_nearest_distance_meters": result.evidence.get("nearest_distance_meters", ""),
                "_inference_method": result.evidence.get("inference_method", ""),
                "_inference_basis": result.evidence.get("inference_basis", ""),
                "_inference_status": result.evidence.get("inference_status", ""),
                "_analysis_note": result.evidence.get("analysis_note", ""),
            }
        )
        writer.writerow(out_row)
        self._counts[bucket] = self._counts.get(bucket, 0) + 1

    def close(self) -> None:
        for handle in self._files.values():
            handle.close()
        self._files.clear()
        self._writers.clear()

    def exports(self) -> list[ExportRecord]:
        records: list[ExportRecord] = []
        for bucket, count in sorted(self._counts.items()):
            records.append(
                ExportRecord(
                    bucket=bucket,
                    path=self._path_for_bucket(bucket),
                    row_count=count,
                )
            )
        return records

    def _build_fieldnames(self) -> list[str]:
        extra = [
            "_district",
            "_district_label",
            "_district_layer",
            "_confidence",
            "_match_method",
            "_lat",
            "_lon",
            "_geocode_quality",
            "_needs_review",
            "_review_reason",
            "_normalized_address",
            "_zip",
            "_nearest_district",
            "_nearest_district_label",
            "_nearest_distance_meters",
            "_inference_method",
            "_inference_basis",
            "_inference_status",
            "_analysis_note",
        ]
        fieldnames = list(self.input_fieldnames)
        for fieldname in extra:
            if fieldname not in fieldnames:
                fieldnames.append(fieldname)
        return fieldnames

    def _path_for_bucket(self, bucket: str) -> Path:
        file_name = SPECIAL_EXPORTS.get(bucket, f"{safe_bucket_label(bucket)}.csv")
        return self.output_dir / file_name

    def _writer_for_bucket(self, bucket: str) -> csv.DictWriter:
        if bucket in self._writers:
            return self._writers[bucket]

        path = self._path_for_bucket(bucket)
        write_header = not (self.append_existing and path.exists())
        handle = path.open("a" if self.append_existing else "w", newline="", encoding="utf-8")
        writer = csv.DictWriter(handle, fieldnames=self.fieldnames, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        self._files[bucket] = handle
        self._writers[bucket] = writer
        return writer
