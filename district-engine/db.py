"""
SQLite persistence helpers for the lightweight district classification engine.

This module intentionally uses only Python's sqlite3 standard library. It is
designed for CLI-based processing jobs launched from Next.js, with SQLite as the
durable cache and job-state store.
"""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DEFAULT_DB_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "district-classifier"
    / "district-engine-v2.sqlite"
)
SQLITE_TIMEOUT_SECONDS = 60
SQLITE_BUSY_TIMEOUT_MS = SQLITE_TIMEOUT_SECONDS * 1000
PDI_ID_KEYS = ("PDI ID", "PDI_ID", "pdi_id", "pdiId", "PDI Id", "pdi id")
INVALID_PDI_IDS = {
    "",
    "-",
    "N/A",
    "NA",
    "NONE",
    "NULL",
    "NOT FOUND",
    "NOTFOUND",
    "NEW REGISTRATION",
    "NEWREGISTRATION",
    "STUDENT",
}


def utc_now() -> str:
    """Return an ISO-8601 UTC timestamp with seconds precision."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def json_dumps(value: Any) -> str:
    """Serialize structured evidence deterministically for reproducible rows."""
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"))


def normalize_pdi_id(value: Any) -> str:
    """Normalize voter IDs while filtering placeholders from hand-entered sheets."""
    cleaned = re.sub(r"\s+", "", str(value or "").strip().upper())
    if cleaned in INVALID_PDI_IDS:
        return ""
    return cleaned


def connect(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open a SQLite connection configured for predictable row access."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=SQLITE_TIMEOUT_SECONDS)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # The engine runs as a single Python writer launched by Next.js. DELETE
    # journaling avoids stale WAL/SHM file locks on Windows dev machines.
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    return conn


@contextmanager
def transaction(db_path: str | Path = DEFAULT_DB_PATH) -> Iterator[sqlite3.Connection]:
    """Open a connection and commit or roll back as a single unit of work."""
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | Path = DEFAULT_DB_PATH) -> None:
    """Create all district-engine tables and indexes if they do not exist."""
    with transaction(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                total_rows INTEGER,
                processed_rows INTEGER NOT NULL DEFAULT 0,
                input_file_id TEXT,
                output_dir TEXT,
                error_message TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                kind TEXT NOT NULL,
                original_name TEXT NOT NULL,
                path TEXT NOT NULL,
                row_count INTEGER,
                checksum TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                file_id TEXT,
                row_number INTEGER NOT NULL,
                normalized_address TEXT NOT NULL,
                zip TEXT,
                district_layer TEXT NOT NULL,
                district TEXT,
                confidence REAL NOT NULL DEFAULT 0,
                match_method TEXT NOT NULL,
                lat REAL,
                lon REAL,
                geocode_quality TEXT,
                needs_review INTEGER NOT NULL DEFAULT 0,
                review_reason TEXT,
                raw_row_json TEXT NOT NULL DEFAULT '{}',
                evidence_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS exact_address_cache (
                normalized_address TEXT NOT NULL,
                zip TEXT NOT NULL,
                district_layer TEXT NOT NULL,
                district TEXT,
                confidence REAL NOT NULL DEFAULT 0,
                lat REAL,
                lon REAL,
                geocode_quality TEXT,
                source TEXT,
                evidence_json TEXT NOT NULL DEFAULT '{}',
                hit_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (normalized_address, zip, district_layer)
            );

            CREATE TABLE IF NOT EXISTS street_cache (
                zip TEXT NOT NULL,
                normalized_street TEXT NOT NULL,
                district_layer TEXT NOT NULL,
                district TEXT,
                status TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0,
                sample_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (zip, normalized_street, district_layer)
            );

            CREATE TABLE IF NOT EXISTS zip_overlap_cache (
                zip TEXT NOT NULL,
                district_layer TEXT NOT NULL,
                district TEXT NOT NULL,
                overlap_probability REAL NOT NULL,
                overlap_basis TEXT NOT NULL DEFAULT 'area',
                confidence REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (zip, district_layer, district)
            );

            CREATE TABLE IF NOT EXISTS failed_geocodes (
                normalized_address TEXT NOT NULL,
                zip TEXT NOT NULL,
                reason TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 1,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (normalized_address, zip)
            );

            CREATE INDEX IF NOT EXISTS idx_jobs_status_created
                ON jobs(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_files_job_kind
                ON files(job_id, kind);
            CREATE INDEX IF NOT EXISTS idx_matches_job_row
                ON matches(job_id, row_number);
            CREATE INDEX IF NOT EXISTS idx_matches_address_zip
                ON matches(normalized_address, zip);
            CREATE INDEX IF NOT EXISTS idx_matches_district
                ON matches(district_layer, district);
            CREATE INDEX IF NOT EXISTS idx_matches_review
                ON matches(job_id, needs_review);
            CREATE INDEX IF NOT EXISTS idx_exact_address_zip
                ON exact_address_cache(zip, district_layer);
            CREATE INDEX IF NOT EXISTS idx_street_cache_status
                ON street_cache(district_layer, status);
            CREATE INDEX IF NOT EXISTS idx_zip_overlap_lookup
                ON zip_overlap_cache(zip, district_layer, overlap_probability DESC);
            CREATE INDEX IF NOT EXISTS idx_failed_geocodes_updated
                ON failed_geocodes(updated_at);
            """
        )


def create_job(
    conn: sqlite3.Connection,
    job_id: str,
    *,
    status: str = "queued",
    input_file_id: str | None = None,
    output_dir: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO jobs (
            id, status, input_file_id, output_dir, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (job_id, status, input_file_id, output_dir, json_dumps(metadata), now, now),
    )


def update_job_status(
    conn: sqlite3.Connection,
    job_id: str,
    status: str,
    *,
    progress: int | None = None,
    processed_rows: int | None = None,
    total_rows: int | None = None,
    error_message: str | None = None,
) -> None:
    now = utc_now()
    fields = ["status = ?", "updated_at = ?"]
    values: list[Any] = [status, now]

    if progress is not None:
        fields.append("progress = ?")
        values.append(progress)
    if processed_rows is not None:
        fields.append("processed_rows = ?")
        values.append(processed_rows)
    if total_rows is not None:
        fields.append("total_rows = ?")
        values.append(total_rows)
    if error_message is not None:
        fields.append("error_message = ?")
        values.append(error_message)
    if status == "processing":
        fields.append("started_at = COALESCE(started_at, ?)")
        values.append(now)
    if status in {"completed", "failed"}:
        fields.append("completed_at = ?")
        values.append(now)

    values.append(job_id)
    conn.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?", values)


def get_job(conn: sqlite3.Connection, job_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def add_file(
    conn: sqlite3.Connection,
    file_id: str,
    *,
    kind: str,
    original_name: str,
    path: str,
    job_id: str | None = None,
    row_count: int | None = None,
    checksum: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO files (
            id, job_id, kind, original_name, path, row_count, checksum, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (file_id, job_id, kind, original_name, path, row_count, checksum, utc_now()),
    )


def get_file(conn: sqlite3.Connection, file_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()


def record_match(
    conn: sqlite3.Connection,
    *,
    job_id: str,
    row_number: int,
    normalized_address: str,
    district_layer: str,
    match_method: str,
    confidence: float,
    zip_code: str | None = None,
    district: str | int | None = None,
    file_id: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    geocode_quality: str | None = None,
    needs_review: bool = False,
    review_reason: str | None = None,
    raw_row: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
) -> int:
    now = utc_now()
    cursor = conn.execute(
        """
        INSERT INTO matches (
            job_id, file_id, row_number, normalized_address, zip, district_layer,
            district, confidence, match_method, lat, lon, geocode_quality,
            needs_review, review_reason, raw_row_json, evidence_json,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            file_id,
            row_number,
            normalized_address,
            zip_code,
            district_layer,
            None if district is None else str(district),
            confidence,
            match_method,
            lat,
            lon,
            geocode_quality,
            1 if needs_review else 0,
            review_reason,
            json_dumps(raw_row),
            json_dumps(evidence),
            now,
            now,
        ),
    )
    return int(cursor.lastrowid)


def list_matches_for_job(conn: sqlite3.Connection, job_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM matches WHERE job_id = ? ORDER BY row_number, id",
        (job_id,),
    ).fetchall()


def list_review_matches(conn: sqlite3.Connection, job_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM matches
        WHERE job_id = ? AND needs_review = 1
        ORDER BY confidence ASC, row_number ASC
        """,
        (job_id,),
    ).fetchall()


def _pdi_id_from_raw_row(raw_row_json: str) -> str:
    try:
        raw_row = json.loads(raw_row_json or "{}")
    except json.JSONDecodeError:
        return ""
    if not isinstance(raw_row, dict):
        return ""

    expected = {re.sub(r"[\W_]+", "", key).lower() for key in PDI_ID_KEYS}
    for key in PDI_ID_KEYS:
        pdi_id = normalize_pdi_id(raw_row.get(key))
        if pdi_id:
            return pdi_id
    for key, value in raw_row.items():
        if re.sub(r"[\W_]+", "", str(key)).lower() in expected:
            pdi_id = normalize_pdi_id(value)
            if pdi_id:
                return pdi_id
    return ""


def get_unique_pdi_district_match(
    conn: sqlite3.Connection,
    pdi_id: str,
    district_layer: str,
    *,
    min_confidence: float = 0.85,
) -> dict[str, Any] | None:
    """
    Return a prior high-confidence district for a PDI ID only when unambiguous.

    This avoids live PDI API access while still reusing earlier polygon-verified
    results for the same voter ID. Conflicting historical districts are ignored
    and left for normal geocoding/review.
    """
    normalized_pdi_id = normalize_pdi_id(pdi_id)
    if not normalized_pdi_id:
        return None

    rows = conn.execute(
        """
        SELECT district, confidence, match_method, normalized_address, zip,
               lat, lon, geocode_quality, raw_row_json, id
        FROM matches
        WHERE district_layer = ?
          AND district IS NOT NULL
          AND confidence >= ?
          AND match_method != 'failed'
        ORDER BY confidence DESC, id DESC
        """,
        (district_layer, min_confidence),
    ).fetchall()

    matched_rows = [row for row in rows if _pdi_id_from_raw_row(row["raw_row_json"]) == normalized_pdi_id]
    if not matched_rows:
        return None

    districts = {str(row["district"]) for row in matched_rows if row["district"] is not None}
    if len(districts) != 1:
        return None

    best = matched_rows[0]
    return {
        "district": str(best["district"]),
        "confidence": float(best["confidence"] or 0),
        "match_method": best["match_method"],
        "normalized_address": best["normalized_address"],
        "zip": best["zip"],
        "lat": best["lat"],
        "lon": best["lon"],
        "geocode_quality": best["geocode_quality"],
        "sample_count": len(matched_rows),
        "source_match_id": best["id"],
    }


def get_exact_address(
    conn: sqlite3.Connection,
    normalized_address: str,
    zip_code: str,
    district_layer: str,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM exact_address_cache
        WHERE normalized_address = ? AND zip = ? AND district_layer = ?
        """,
        (normalized_address, zip_code, district_layer),
    ).fetchone()


def upsert_exact_address(
    conn: sqlite3.Connection,
    *,
    normalized_address: str,
    zip_code: str,
    district_layer: str,
    district: str | int | None,
    confidence: float,
    lat: float | None,
    lon: float | None,
    geocode_quality: str | None,
    source: str | None = None,
    evidence: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO exact_address_cache (
            normalized_address, zip, district_layer, district, confidence,
            lat, lon, geocode_quality, source, evidence_json,
            hit_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(normalized_address, zip, district_layer) DO UPDATE SET
            district = excluded.district,
            confidence = excluded.confidence,
            lat = excluded.lat,
            lon = excluded.lon,
            geocode_quality = excluded.geocode_quality,
            source = excluded.source,
            evidence_json = excluded.evidence_json,
            updated_at = excluded.updated_at
        """,
        (
            normalized_address,
            zip_code,
            district_layer,
            None if district is None else str(district),
            confidence,
            lat,
            lon,
            geocode_quality,
            source,
            json_dumps(evidence),
            now,
            now,
        ),
    )


def mark_exact_address_hit(
    conn: sqlite3.Connection,
    normalized_address: str,
    zip_code: str,
    district_layer: str,
) -> None:
    conn.execute(
        """
        UPDATE exact_address_cache
        SET hit_count = hit_count + 1, updated_at = ?
        WHERE normalized_address = ? AND zip = ? AND district_layer = ?
        """,
        (utc_now(), normalized_address, zip_code, district_layer),
    )


def get_street_cache(
    conn: sqlite3.Connection,
    *,
    zip_code: str,
    normalized_street: str,
    district_layer: str,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM street_cache
        WHERE zip = ? AND normalized_street = ? AND district_layer = ?
        """,
        (zip_code, normalized_street, district_layer),
    ).fetchone()


def list_matched_streets_for_zip(
    conn: sqlite3.Connection,
    *,
    zip_code: str,
    district_layer: str,
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM street_cache
        WHERE zip = ?
          AND district_layer = ?
          AND status = 'matched'
          AND district IS NOT NULL
        ORDER BY sample_count DESC, confidence DESC
        """,
        (zip_code, district_layer),
    ).fetchall()


def upsert_street_cache(
    conn: sqlite3.Connection,
    *,
    zip_code: str,
    normalized_street: str,
    district_layer: str,
    status: str,
    district: str | int | None = None,
    confidence: float = 0,
    sample_count: int = 1,
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO street_cache (
            zip, normalized_street, district_layer, district, status,
            confidence, sample_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(zip, normalized_street, district_layer) DO UPDATE SET
            district = excluded.district,
            status = excluded.status,
            confidence = excluded.confidence,
            sample_count = street_cache.sample_count + excluded.sample_count,
            updated_at = excluded.updated_at
        """,
        (
            zip_code,
            normalized_street,
            district_layer,
            None if district is None else str(district),
            status,
            confidence,
            sample_count,
            now,
            now,
        ),
    )


def get_zip_overlaps(
    conn: sqlite3.Connection,
    zip_code: str,
    district_layer: str,
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM zip_overlap_cache
        WHERE zip = ? AND district_layer = ?
        ORDER BY overlap_probability DESC
        """,
        (zip_code, district_layer),
    ).fetchall()


def upsert_zip_overlap(
    conn: sqlite3.Connection,
    *,
    zip_code: str,
    district_layer: str,
    district: str | int,
    overlap_probability: float,
    overlap_basis: str = "area",
    confidence: float = 0,
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO zip_overlap_cache (
            zip, district_layer, district, overlap_probability,
            overlap_basis, confidence, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(zip, district_layer, district) DO UPDATE SET
            overlap_probability = excluded.overlap_probability,
            overlap_basis = excluded.overlap_basis,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        """,
        (
            zip_code,
            district_layer,
            str(district),
            overlap_probability,
            overlap_basis,
            confidence,
            now,
            now,
        ),
    )


def get_failed_geocode(
    conn: sqlite3.Connection,
    normalized_address: str,
    zip_code: str,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM failed_geocodes
        WHERE normalized_address = ? AND zip = ?
        """,
        (normalized_address, zip_code),
    ).fetchone()


def record_failed_geocode(
    conn: sqlite3.Connection,
    *,
    normalized_address: str,
    zip_code: str,
    reason: str,
    last_error: str | None = None,
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO failed_geocodes (
            normalized_address, zip, reason, attempts, last_error, created_at, updated_at
        )
        VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(normalized_address, zip) DO UPDATE SET
            reason = excluded.reason,
            attempts = failed_geocodes.attempts + 1,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        """,
        (normalized_address, zip_code, reason, last_error, now, now),
    )


def delete_failed_geocode(
    conn: sqlite3.Connection,
    normalized_address: str,
    zip_code: str,
) -> None:
    conn.execute(
        "DELETE FROM failed_geocodes WHERE normalized_address = ? AND zip = ?",
        (normalized_address, zip_code),
    )
