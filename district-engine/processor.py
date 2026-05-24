"""
Chunked CSV processing for district classification jobs.

This module is the bridge between uploaded CSV files and the reusable matcher.
It supports:
- header scanning for Next.js column-mapping menus
- chunked pandas processing for 100k+ row files
- SQLite progress updates and resumable processing
- district target filtering
- streaming CSV exports
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

import pandas as pd

import db
from geocoder import CensusGeocoder
from geometry import DistrictLayer, load_default_layer
from matcher import DistrictMatcher, MatchResult
from normalize import ColumnMapping, normalize_row_address
from output import CsvOutputWriter, ExportRecord, export_bucket_for_result
from recovery import recovery_candidates_for_row


DEFAULT_CHUNK_SIZE = 250
DEFAULT_REVIEW_CONFIDENCE_THRESHOLD = 0.85
WRITE_COMMIT_INTERVAL = 50
PROGRESS_UPDATE_INTERVAL = 100
RECOVERY_PRELOAD_LIMIT_PER_ROW = 4

COLUMN_ALIASES = {
    "address": ["address", "street address", "home address", "residence address", "addr"],
    "city": ["city", "residence city"],
    "state": ["state", "st"],
    "zip": ["zip", "zip code", "zipcode", "postal code"],
    "street_number": ["street #", "street number", "house number", "street num"],
    "street_name": ["street name", "street"],
    "apartment": ["apt #", "apt", "apartment", "unit", "unit #"],
}

DISTRICT_MENU_TYPES = {
    "congressional": "Congressional District",
    "state_senate": "State Senate District",
    "assembly": "Assembly District",
    "city_council": "City Council District",
    "county_supervisor": "County Supervisor District",
}


@dataclass(frozen=True)
class CsvScanResult:
    columns: list[str]
    first_row: dict[str, Any]
    suggested_mapping: dict[str, str]


@dataclass(frozen=True)
class DistrictTargetSelection:
    """
    Selected target districts by layer id.

    Example:
      {"la-city-council": {"cd1", "cd11"}, "ca-state-assembly": {"ad67"}}
    """

    selected_labels_by_layer: dict[str, set[str]] = field(default_factory=dict)

    def selected_for_layer(self, layer_id: str) -> set[str]:
        return self.selected_labels_by_layer.get(layer_id, set())

    def has_any_selection(self) -> bool:
        return any(labels for labels in self.selected_labels_by_layer.values())


@dataclass(frozen=True)
class ProcessorConfig:
    input_csv: Path
    output_dir: Path
    job_id: str
    file_id: str | None = None
    columns: ColumnMapping = ColumnMapping()
    chunk_size: int = DEFAULT_CHUNK_SIZE
    review_confidence_threshold: float = DEFAULT_REVIEW_CONFIDENCE_THRESHOLD
    target_selection: DistrictTargetSelection = field(default_factory=DistrictTargetSelection)


@dataclass(frozen=True)
class ProcessingSummary:
    processed_rows: int
    export_records: list[ExportRecord]


ProgressCallback = Callable[[dict[str, Any]], None]


def canonical_column_name(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def suggest_column_mapping(columns: Iterable[str]) -> dict[str, str]:
    by_canonical = {canonical_column_name(column): column for column in columns}
    suggestions: dict[str, str] = {}

    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            match = by_canonical.get(canonical_column_name(alias))
            if match:
                suggestions[target] = match
                break

    return suggestions


def scan_csv_for_mapping(csv_path: str | Path) -> CsvScanResult:
    """Read CSV headers and first row for a column-mapping UI."""
    path = Path(csv_path)
    df = pd.read_csv(path, nrows=1, dtype=str, keep_default_na=False)
    records = df.to_dict("records")
    return CsvScanResult(
        columns=list(df.columns),
        first_row=records[0] if records else {},
        suggested_mapping=suggest_column_mapping(df.columns),
    )


def count_csv_rows(csv_path: str | Path) -> int:
    """Count parsed CSV rows without loading the full file into memory."""
    return sum(
        len(chunk)
        for chunk in pd.read_csv(
            Path(csv_path),
            chunksize=DEFAULT_CHUNK_SIZE,
            dtype=str,
            keep_default_na=False,
        )
    )


def layer_label_for_result(layer: DistrictLayer, result: MatchResult) -> str | None:
    if not result.district:
        return None
    return layer.label_for_district(result.district)


class CsvDistrictProcessor:
    """Process one uploaded CSV through one or more district matchers."""

    def __init__(
        self,
        *,
        conn,
        config: ProcessorConfig,
        layers: Iterable[DistrictLayer] | None = None,
        geocoder: CensusGeocoder | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> None:
        self.conn = conn
        self.config = config
        self.layers = list(layers or default_processing_layers())
        self.geocoder = geocoder or CensusGeocoder(batch_size=config.chunk_size)
        self.progress_callback = progress_callback
        self.matchers = [
            DistrictMatcher(
                conn=conn,
                district_layer=layer,
                geocoder=self.geocoder.geocode_one,
                columns=config.columns,
            )
            for layer in self.layers
        ]

    def process(self) -> ProcessingSummary:
        input_path = Path(self.config.input_csv)
        output_dir = Path(self.config.output_dir)
        total_rows = count_csv_rows(input_path)
        starting_row = self._processed_rows_from_job()
        processed_rows = starting_row

        db.update_job_status(
            self.conn,
            self.config.job_id,
            "processing",
            progress=_progress_percent(processed_rows, total_rows),
            processed_rows=processed_rows,
            total_rows=total_rows,
        )
        self.conn.commit()
        self._emit_progress(processed_rows, total_rows, "processing")

        writer: CsvOutputWriter | None = None
        try:
            for chunk_start, chunk in self._iter_chunks(input_path):
                if writer is None:
                    writer = CsvOutputWriter(
                        output_dir,
                        input_fieldnames=chunk.columns,
                        append_existing=starting_row > 0,
                    )

                records = chunk.to_dict("records")
                self._preload_geocode_misses(records)
                for offset, row in enumerate(records):
                    row_number = chunk_start + offset + 1
                    if row_number <= starting_row:
                        continue

                    self._process_row(writer, row, row_number)
                    processed_rows = row_number
                    if processed_rows % WRITE_COMMIT_INTERVAL == 0:
                        self.conn.commit()
                    if processed_rows % PROGRESS_UPDATE_INTERVAL == 0:
                        db.update_job_status(
                            self.conn,
                            self.config.job_id,
                            "processing",
                            progress=_progress_percent(processed_rows, total_rows),
                            processed_rows=processed_rows,
                            total_rows=total_rows,
                        )
                        self.conn.commit()
                        self._emit_progress(processed_rows, total_rows, "processing")

                db.update_job_status(
                    self.conn,
                    self.config.job_id,
                    "processing",
                    progress=_progress_percent(processed_rows, total_rows),
                    processed_rows=processed_rows,
                    total_rows=total_rows,
                )
                self.conn.commit()
                self._emit_progress(processed_rows, total_rows, "processing")

            exports = writer.exports() if writer else []
            db.update_job_status(
                self.conn,
                self.config.job_id,
                "completed",
                progress=100,
                processed_rows=processed_rows,
                total_rows=total_rows,
            )
            self.conn.commit()
            self._emit_progress(processed_rows, total_rows, "completed", exports=exports)
            return ProcessingSummary(processed_rows=processed_rows, export_records=exports)
        except Exception as exc:
            db.update_job_status(
                self.conn,
                self.config.job_id,
                "failed",
                progress=_progress_percent(processed_rows, total_rows),
                processed_rows=processed_rows,
                total_rows=total_rows,
                error_message=str(exc),
            )
            self.conn.commit()
            self._emit_progress(processed_rows, total_rows, "failed", error=str(exc))
            raise
        finally:
            if writer:
                writer.close()

    def _process_row(self, writer: CsvOutputWriter, row: dict[str, Any], row_number: int) -> None:
        results = [matcher.classify_row(row) for matcher in self.matchers]
        if self.config.target_selection.has_any_selection():
            self._process_targeted_row(writer, row, row_number, results)
            return

        for layer, result in zip(self.layers, results):
            label = layer_label_for_result(layer, result)
            selected = self.config.target_selection.selected_for_layer(layer.layer_id)
            bucket = export_bucket_for_result(
                result,
                district_label=label,
                selected_labels=selected,
                targeted_mode=False,
                review_confidence_threshold=self.config.review_confidence_threshold,
            )
            self._write_and_record_result(writer, row, row_number, result, label, bucket)

    def _process_targeted_row(
        self,
        writer: CsvOutputWriter,
        row: dict[str, Any],
        row_number: int,
        results: list[MatchResult],
    ) -> None:
        entries: list[tuple[DistrictLayer, MatchResult, str | None, str]] = []
        for layer, result in zip(self.layers, results):
            label = layer_label_for_result(layer, result)
            selected = self.config.target_selection.selected_for_layer(layer.layer_id)
            bucket = export_bucket_for_result(
                result,
                district_label=label,
                selected_labels=selected,
                targeted_mode=True,
                review_confidence_threshold=self.config.review_confidence_threshold,
            )
            entries.append((layer, result, label, bucket))

        selected_entries = [entry for entry in entries if entry[3].startswith("matched_")]
        inferred_entries = [entry for entry in entries if entry[3] == "inferred_districts"]
        review_entries = [entry for entry in entries if entry[3] == "manual_review"]
        other_entries = [entry for entry in entries if entry[3] == "other_districts"]
        outside_layer_entries = [entry for entry in entries if entry[3] == "outside_layer"]
        failed_entries = [entry for entry in entries if entry[3] == "geocode_failed"]

        if selected_entries:
            written_entries = selected_entries
        elif inferred_entries:
            written_entries = [self._best_entry(inferred_entries)]
        elif review_entries:
            written_entries = [self._best_entry(review_entries)]
        elif other_entries:
            written_entries = [self._best_entry(other_entries)]
        elif outside_layer_entries:
            written_entries = [self._best_entry(outside_layer_entries)]
        else:
            written_entries = [self._best_entry(failed_entries)]

        written_entry_ids = {id(entry[1]) for entry in written_entries}
        for layer, result, label, bucket in entries:
            record_bucket = bucket if id(result) in written_entry_ids else "suppressed_targeted_duplicate"
            if id(result) in written_entry_ids:
                writer.write(bucket, row, result, district_label=label)
            self._record_result(row, row_number, result, label, record_bucket)

    def _best_entry(
        self,
        entries: list[tuple[DistrictLayer, MatchResult, str | None, str]],
    ) -> tuple[DistrictLayer, MatchResult, str | None, str]:
        return sorted(
            entries,
            key=lambda entry: (
                entry[1].district is not None,
                entry[1].confidence,
                entry[1].lat is not None and entry[1].lon is not None,
            ),
            reverse=True,
        )[0]

    def _write_and_record_result(
        self,
        writer: CsvOutputWriter,
        row: dict[str, Any],
        row_number: int,
        result: MatchResult,
        label: str | None,
        bucket: str,
    ) -> None:
        writer.write(bucket, row, result, district_label=label)
        self._record_result(row, row_number, result, label, bucket)

    def _record_result(
        self,
        row: dict[str, Any],
        row_number: int,
        result: MatchResult,
        label: str | None,
        bucket: str,
    ) -> None:
        db.record_match(
            self.conn,
            job_id=self.config.job_id,
            file_id=self.config.file_id,
            row_number=row_number,
            normalized_address=result.normalized_address,
            zip_code=result.zip,
            district_layer=result.district_layer,
            district=result.district,
            confidence=result.confidence,
            match_method=result.match_method,
            lat=result.lat,
            lon=result.lon,
            geocode_quality=result.geocode_quality,
            needs_review=result.needs_review or bucket == "manual_review",
            review_reason=result.review_reason,
            raw_row=row,
            evidence={
                **result.evidence,
                "export_bucket": bucket,
                "district_label": label,
            },
        )

    def _preload_geocode_misses(self, rows: list[dict[str, Any]]) -> None:
        """
        Batch geocode only rows that cannot be classified from local caches.

        This keeps Census calls batched without preloading every row in the CSV.
        """
        addresses = []
        for row in rows:
            normalized = normalize_row_address(row, self.config.columns)
            if not normalized.address:
                continue

            needs_geocode = any(matcher.geocode_candidate_for_row(row) is not None for matcher in self.matchers)
            if not needs_geocode:
                continue

            addresses.append(normalized)
            addresses.extend(
                candidate.address
                for candidate in recovery_candidates_for_row(row, self.config.columns, normalized)[
                    :RECOVERY_PRELOAD_LIMIT_PER_ROW
                ]
            )

        unique_by_key = {
            f"{address.normalized_address}|{address.zip}": address
            for address in addresses
            if address.normalized_address
        }
        if unique_by_key:
            self.geocoder.geocode_many(unique_by_key.values())

    def _iter_chunks(self, input_path: Path):
        row_offset = 0
        reader = pd.read_csv(
            input_path,
            chunksize=self.config.chunk_size,
            dtype=str,
            keep_default_na=False,
        )
        for chunk in reader:
            yield row_offset, chunk
            row_offset += len(chunk)

    def _processed_rows_from_job(self) -> int:
        job = db.get_job(self.conn, self.config.job_id)
        if not job:
            return 0
        try:
            return int(job["processed_rows"] or 0)
        except (TypeError, ValueError):
            return 0

    def _emit_progress(
        self,
        processed_rows: int,
        total_rows: int,
        status: str,
        *,
        exports: list[ExportRecord] | None = None,
        error: str | None = None,
    ) -> None:
        if not self.progress_callback:
            return
        payload: dict[str, Any] = {
            "type": "progress",
            "status": status,
            "processedRows": processed_rows,
            "totalRows": total_rows,
            "progress": _progress_percent(processed_rows, total_rows),
        }
        if exports is not None:
            payload["exports"] = [
                {"bucket": record.bucket, "fileName": record.path.name, "rowCount": record.row_count}
                for record in exports
            ]
        if error:
            payload["error"] = error
        self.progress_callback(payload)


def default_processing_layers() -> list[DistrictLayer]:
    """Load currently available district layers."""
    return [
        load_default_layer("la-city-council"),
        load_default_layer("ca-state-assembly"),
    ]


def create_target_selection(raw: Mapping[str, Iterable[str]] | None) -> DistrictTargetSelection:
    normalized: dict[str, set[str]] = {}
    for layer_id, labels in (raw or {}).items():
        normalized[layer_id] = {str(label).strip().lower() for label in labels if str(label).strip()}
    return DistrictTargetSelection(selected_labels_by_layer=normalized)


def write_scan_result_for_ui(scan: CsvScanResult) -> dict[str, Any]:
    """Return JSON-serializable data for a Next.js mapping menu."""
    return {
        "columns": scan.columns,
        "firstRow": scan.first_row,
        "suggestedMapping": scan.suggested_mapping,
        "districtMenus": DISTRICT_MENU_TYPES,
    }


def _progress_percent(processed_rows: int, total_rows: int) -> int:
    if total_rows <= 0:
        return 0
    return max(0, min(100, round((processed_rows / total_rows) * 100)))
