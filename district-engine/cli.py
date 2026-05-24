"""
CLI entrypoint for the lightweight district classification engine.

This is intentionally small: Next.js launches it with child_process, then reads
newline-delimited EVENT JSON from stdout to update the UI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import db
from geocoder import CensusGeocoder
from geometry import load_default_layer
from normalize import ColumnMapping
from processor import (
    CsvDistrictProcessor,
    ProcessorConfig,
    create_target_selection,
    scan_csv_for_mapping,
    write_scan_result_for_ui,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "district-classifier" / "district-engine.sqlite"

LAYER_MAP = {
    "la-city-council": "la-city-council",
    "ca-state-assembly": "ca-state-assembly",
}


def emit_event(payload: dict[str, Any]) -> None:
    print(f"EVENT {json.dumps(payload, sort_keys=True)}", flush=True)


def parse_json_arg(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    return json.loads(raw)


def build_column_mapping(raw: dict[str, Any]) -> ColumnMapping:
    return ColumnMapping(
        address=str(raw.get("address") or raw.get("addressCol") or "Address"),
        city=str(raw.get("city") or raw.get("cityCol") or "City"),
        state=str(raw.get("state") or raw.get("stateCol") or "State"),
        zip=str(raw.get("zip") or raw.get("zipCol") or "Zip"),
        street_number=str(raw.get("street_number") or raw.get("streetNumCol") or "Street #"),
        street_name=str(raw.get("street_name") or raw.get("streetNameCol") or "Street Name"),
        apartment=str(raw.get("apartment") or raw.get("aptCol") or "Apt #"),
    )


def handle_scan(args: argparse.Namespace) -> int:
    scan = scan_csv_for_mapping(args.input)
    print(json.dumps(write_scan_result_for_ui(scan), sort_keys=True))
    return 0


def handle_process(args: argparse.Namespace) -> int:
    db_path = Path(args.db or DEFAULT_DB_PATH)
    db.init_db(db_path)
    conn = db.connect(db_path)
    try:
        job = db.get_job(conn, args.job_id)
        if not job:
            db.create_job(
                conn,
                args.job_id,
                status="queued",
                output_dir=args.output_dir,
                metadata={"source": "nextjs"},
            )
            conn.commit()

        layer_ids = [value.strip() for value in args.layers.split(",") if value.strip()]
        layers = [load_default_layer(LAYER_MAP[layer_id]) for layer_id in layer_ids if layer_id in LAYER_MAP]
        if not layers:
            raise ValueError("Select at least one supported district layer.")

        columns = build_column_mapping(parse_json_arg(args.columns_json, {}))
        target_selection = create_target_selection(parse_json_arg(args.targets_json, {}))
        config = ProcessorConfig(
            input_csv=Path(args.input),
            output_dir=Path(args.output_dir),
            job_id=args.job_id,
            file_id=args.file_id,
            columns=columns,
            chunk_size=args.chunk_size,
            review_confidence_threshold=args.review_confidence,
            target_selection=target_selection,
        )

        geocoder = CensusGeocoder(batch_size=args.geocode_batch_size, max_retries=args.geocode_retries)
        processor = CsvDistrictProcessor(
            conn=conn,
            config=config,
            layers=layers,
            geocoder=geocoder,
            progress_callback=emit_event,
        )
        summary = processor.process()
        emit_event(
            {
                "type": "done",
                "status": "completed",
                "processedRows": summary.processed_rows,
                "exports": [
                    {"bucket": record.bucket, "fileName": record.path.name, "rowCount": record.row_count}
                    for record in summary.export_records
                ],
            }
        )
        return 0
    except Exception as exc:
        emit_event({"type": "error", "status": "failed", "error": str(exc)})
        return 1
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="District classification engine")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Scan CSV headers and first row")
    scan.add_argument("--input", required=True)
    scan.set_defaults(func=handle_scan)

    process = sub.add_parser("process", help="Process a district-classifier job")
    process.add_argument("--job-id", required=True)
    process.add_argument("--file-id")
    process.add_argument("--input", required=True)
    process.add_argument("--output-dir", required=True)
    process.add_argument("--db", default=str(DEFAULT_DB_PATH))
    process.add_argument("--layers", default="la-city-council")
    process.add_argument("--columns-json", default="{}")
    process.add_argument("--targets-json", default="{}")
    process.add_argument("--chunk-size", type=int, default=1000)
    process.add_argument("--review-confidence", type=float, default=0.85)
    process.add_argument("--geocode-batch-size", type=int, default=1000)
    process.add_argument("--geocode-retries", type=int, default=2)
    process.set_defaults(func=handle_process)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
