"""
Reusable district classification pipeline.

Match order:
1. exact address cache
2. ZIP overlap >= 95%
3. street cache
4. geocode
5. polygon verification
"""

from __future__ import annotations

from difflib import SequenceMatcher
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

import db
from confidence import (
    ZIP_OVERLAP_THRESHOLD,
    MatchMethod,
    confidence_for_ambiguous,
    confidence_for_exact_cache,
    confidence_for_failed,
    confidence_for_geocode_quality,
    confidence_for_interpolated,
    confidence_for_street_cache,
    confidence_for_zip_overlap,
)
from geometry import DistrictLayer, PointDistrictMatch
from inference import infer_neighborhood_district
from normalize import ColumnMapping, NormalizedAddress, clean_text, get_row_value, normalize_row_address
from recovery import RecoveryCandidate, make_normalized_address, recovery_candidates_for_row

NEAR_BOUNDARY_REVIEW_METERS = 250.0
NEAR_BOUNDARY_INFERENCE_METERS = 60.0
FUZZY_STREET_CACHE_RATIO = 0.88
FUZZY_STREET_CACHE_MIN_LENGTH = 5
FUZZY_STREET_CACHE_AMBIGUITY_GAP = 0.03
PDI_ID_COLUMNS = ("PDI ID", "PDI_ID", "pdi_id", "pdiId", "PDI Id", "pdi id")


@dataclass(frozen=True)
class GeocodeResult:
    lat: float
    lon: float
    quality: str
    source: str = "geocoder"
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MatchResult:
    district: str | None
    confidence: float
    match_method: MatchMethod
    normalized_address: str
    zip: str
    district_layer: str
    lat: float | None = None
    lon: float | None = None
    geocode_quality: str | None = None
    needs_review: bool = False
    review_reason: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)


Geocoder = Callable[[NormalizedAddress], GeocodeResult | None]


class DistrictMatcher:
    """Classify CSV rows against one district layer using SQLite-backed caches."""

    def __init__(
        self,
        *,
        conn: sqlite3.Connection,
        district_layer: DistrictLayer,
        geocoder: Geocoder | None = None,
        columns: ColumnMapping = ColumnMapping(),
        zip_overlap_threshold: float = ZIP_OVERLAP_THRESHOLD,
    ) -> None:
        self.conn = conn
        self.district_layer = district_layer
        self.geocoder = geocoder
        self.columns = columns
        self.zip_overlap_threshold = zip_overlap_threshold
        self._pdi_match_cache: dict[str, dict[str, Any] | None] = {}

    def classify_row(self, row: Mapping[str, Any]) -> MatchResult:
        normalized = normalize_row_address(row, self.columns)

        if not normalized.address:
            pdi = self._match_pdi_cache(row, normalized)
            if pdi:
                return pdi

            inferred = self._match_neighborhood_inference(row, normalized)
            if inferred:
                return inferred
            return self._failed(
                normalized,
                "missing_address_or_zip",
                {"reason": "Address is missing after normalization."},
            )

        if normalized.zip:
            exact = self._match_exact_cache(normalized)
            if exact:
                return exact

            zip_match = self._match_zip_overlap(normalized)
            if zip_match:
                return zip_match

            street = self._match_street_cache(normalized)
            if street:
                return street

        return self._match_geocode_and_polygon(
            normalized,
            row=row,
            recovery_method="missing_zip_geocode" if not normalized.zip else None,
            recovery_confidence=0.82 if not normalized.zip else None,
            recovery_reason="recovery_missing_zip" if not normalized.zip else None,
            recovery_note="Census matched the address without a ZIP code." if not normalized.zip else None,
        )

    def geocode_candidate_for_row(self, row: Mapping[str, Any]) -> NormalizedAddress | None:
        """
        Return the normalized address only when local caches cannot classify it.

        The processor uses this to batch geocode true misses before row-by-row
        processing, avoiding one Census request per uncached row.
        """
        normalized = normalize_row_address(row, self.columns)
        if not normalized.address:
            return None
        if not normalized.zip:
            return normalized

        exact = db.get_exact_address(
            self.conn,
            normalized.normalized_address,
            normalized.zip,
            self.district_layer.layer_id,
        )
        if exact and exact["district"]:
            return None

        overlaps = db.get_zip_overlaps(self.conn, normalized.zip, self.district_layer.layer_id)
        if overlaps and float(overlaps[0]["overlap_probability"]) >= self.zip_overlap_threshold:
            return None

        if normalized.normalized_street:
            street = db.get_street_cache(
                self.conn,
                zip_code=normalized.zip,
                normalized_street=normalized.normalized_street,
                district_layer=self.district_layer.layer_id,
            )
            if street:
                status = str(street["status"] or "")
                if status != "split" and (street["district"] or status in {"failed", "geocode_failed", "outside_target"}):
                    return None

        return normalized

    def classify_rows(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        job_id: str | None = None,
        file_id: str | None = None,
        commit_every: int = 500,
    ) -> list[MatchResult]:
        """Classify rows and optionally persist match records."""
        results: list[MatchResult] = []

        for index, row in enumerate(rows, start=1):
            result = self.classify_row(row)
            results.append(result)

            if job_id:
                db.record_match(
                    self.conn,
                    job_id=job_id,
                    file_id=file_id,
                    row_number=index,
                    normalized_address=result.normalized_address,
                    zip_code=result.zip,
                    district_layer=result.district_layer,
                    district=result.district,
                    confidence=result.confidence,
                    match_method=result.match_method,
                    lat=result.lat,
                    lon=result.lon,
                    geocode_quality=result.geocode_quality,
                    needs_review=result.needs_review,
                    review_reason=result.review_reason,
                    raw_row=dict(row),
                    evidence=result.evidence,
                )

                if index % commit_every == 0:
                    self.conn.commit()

        if job_id:
            self.conn.commit()

        return results

    def _match_exact_cache(self, normalized: NormalizedAddress) -> MatchResult | None:
        hit = db.get_exact_address(
            self.conn,
            normalized.normalized_address,
            normalized.zip,
            self.district_layer.layer_id,
        )
        if not hit or not hit["district"]:
            return None

        db.mark_exact_address_hit(
            self.conn,
            normalized.normalized_address,
            normalized.zip,
            self.district_layer.layer_id,
        )

        return MatchResult(
            district=hit["district"],
            confidence=confidence_for_exact_cache(hit["confidence"]),
            match_method="exact_cache",
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            lat=hit["lat"],
            lon=hit["lon"],
            geocode_quality=hit["geocode_quality"],
            evidence={"cache": "exact_address_cache"},
        )

    def _match_zip_overlap(self, normalized: NormalizedAddress) -> MatchResult | None:
        overlaps = db.get_zip_overlaps(self.conn, normalized.zip, self.district_layer.layer_id)
        if not overlaps:
            return None

        top = overlaps[0]
        probability = float(top["overlap_probability"])
        if probability < self.zip_overlap_threshold:
            return None

        return MatchResult(
            district=top["district"],
            confidence=confidence_for_zip_overlap(probability),
            match_method="zip_overlap",
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            evidence={
                "zip": normalized.zip,
                "overlap_probability": probability,
                "overlap_basis": top["overlap_basis"],
            },
        )

    def _match_street_cache(self, normalized: NormalizedAddress) -> MatchResult | None:
        if not normalized.normalized_street:
            return None

        hit = db.get_street_cache(
            self.conn,
            zip_code=normalized.zip,
            normalized_street=normalized.normalized_street,
            district_layer=self.district_layer.layer_id,
        )
        if not hit:
            return None

        status = str(hit["status"] or "")
        if status == "split":
            return None
        if status in {"failed", "geocode_failed", "outside_target"}:
            return self._failed(
                normalized,
                f"street_cache_{status}",
                {"cache": "street_cache", "status": status},
            )
        if not hit["district"]:
            return None

        return MatchResult(
            district=hit["district"],
            confidence=confidence_for_street_cache(hit["sample_count"], hit["confidence"]),
            match_method="street_cache",
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            evidence={
                "cache": "street_cache",
                "normalized_street": normalized.normalized_street,
                "sample_count": hit["sample_count"],
            },
        )

    def _match_geocode_and_polygon(
        self,
        normalized: NormalizedAddress,
        *,
        row: Mapping[str, Any] | None = None,
        recovery_method: str | None = None,
        recovery_confidence: float | None = None,
        recovery_reason: str | None = None,
        recovery_note: str | None = None,
    ) -> MatchResult:
        failed_geocode = db.get_failed_geocode(self.conn, normalized.normalized_address, normalized.zip)
        if failed_geocode and not self.geocoder:
            return self._failed(
                normalized,
                "known_failed_geocode",
                {"cache": "failed_geocodes", "reason": failed_geocode["reason"]},
            )

        if not self.geocoder:
            pdi = self._match_pdi_cache(row, normalized)
            if pdi:
                return pdi

            return self._failed(
                normalized,
                "geocoder_unavailable",
                {"reason": "No geocoder callable was provided."},
            )

        geocode = self.geocoder(normalized)
        if not geocode:
            recovered = self._match_recovery_candidates(normalized, row)
            if recovered:
                return recovered

            pdi = self._match_pdi_cache(row, normalized)
            if pdi:
                return pdi

            inferred = self._match_neighborhood_inference(row, normalized)
            if inferred:
                return inferred

            db.record_failed_geocode(
                self.conn,
                normalized_address=normalized.normalized_address,
                zip_code=normalized.zip,
                reason="no_geocode_result",
            )
            return self._failed(
                normalized,
                "no_geocode_result",
                {"reason": "Geocoder returned no coordinates."},
            )

        polygon_match = self.district_layer.match_point(geocode.lat, geocode.lon)
        if not polygon_match:
            db.record_failed_geocode(
                self.conn,
                normalized_address=normalized.normalized_address,
                zip_code=normalized.zip,
                reason="outside_district_layer",
            )
            return self._outside_layer_result(
                normalized,
                geocode,
                evidence={"source": geocode.source},
            )

        db.delete_failed_geocode(self.conn, normalized.normalized_address, normalized.zip)

        method, confidence = self._geocode_method_and_confidence(
            geocode.quality,
            recovery_confidence=recovery_confidence,
        )

        if confidence >= 0.85:
            self._write_successful_geocode_caches(normalized, geocode, polygon_match, confidence)

        return MatchResult(
            district=polygon_match.district,
            confidence=confidence,
            match_method=method,
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            lat=geocode.lat,
            lon=geocode.lon,
            geocode_quality=geocode.quality,
            needs_review=confidence < 0.85,
            review_reason=recovery_reason if confidence < 0.85 else None,
            evidence={
                "polygon_verified": True,
                "source": geocode.source,
                "geocode": geocode.raw,
                "recovery_method": recovery_method,
                "recovery_note": recovery_note,
            },
        )

    def _match_recovery_candidates(
        self,
        normalized: NormalizedAddress,
        row: Mapping[str, Any] | None,
    ) -> MatchResult | None:
        if not row or not self.geocoder:
            return None

        best_match: tuple[RecoveryCandidate, GeocodeResult, PointDistrictMatch] | None = None
        best_outside: tuple[RecoveryCandidate, GeocodeResult] | None = None

        for candidate in self._recovery_candidates(row, normalized):
            cache_match = self._match_recovery_candidate_cache(candidate, normalized)
            if cache_match:
                return cache_match

            geocode = self.geocoder(candidate.address)
            if not geocode:
                continue

            polygon_match = self.district_layer.match_point(geocode.lat, geocode.lon)
            if not polygon_match:
                if best_outside is None or candidate.confidence > best_outside[0].confidence:
                    best_outside = (candidate, geocode)
                continue

            if best_match is None or candidate.confidence > best_match[0].confidence:
                best_match = (candidate, geocode, polygon_match)

        if best_match:
            candidate, geocode, polygon_match = best_match
            if candidate.confidence >= 0.85:
                self._write_successful_geocode_caches(candidate.address, geocode, polygon_match, candidate.confidence)

            return MatchResult(
                district=polygon_match.district,
                confidence=candidate.confidence,
                match_method="recovered_geocode",
                normalized_address=candidate.address.normalized_address,
                zip=candidate.address.zip,
                district_layer=self.district_layer.layer_id,
                lat=geocode.lat,
                lon=geocode.lon,
                geocode_quality=geocode.quality,
                needs_review=candidate.confidence < 0.85,
                review_reason=candidate.review_reason if candidate.confidence < 0.85 else None,
                evidence={
                    "polygon_verified": True,
                    "source": geocode.source,
                    "geocode": geocode.raw,
                    "recovery_method": candidate.method,
                    "recovery_note": candidate.note,
                    "original_normalized_address": normalized.normalized_address,
                },
            )

        if best_outside:
            candidate, geocode = best_outside
            return self._outside_layer_result(
                candidate.address,
                geocode,
                evidence={
                    "recovery_method": candidate.method,
                    "recovery_note": candidate.note,
                    "original_normalized_address": normalized.normalized_address,
                },
            )

        return None

    def _recovery_candidates(
        self,
        row: Mapping[str, Any],
        normalized: NormalizedAddress,
    ) -> list[RecoveryCandidate]:
        candidates = recovery_candidates_for_row(row, self.columns, normalized)
        candidates.extend(self._fuzzy_street_cache_candidates(row, normalized))

        seen: set[str] = set()
        unique_candidates: list[RecoveryCandidate] = []
        for candidate in candidates:
            key = f"{candidate.address.normalized_address}|{candidate.method}"
            if key in seen:
                continue
            seen.add(key)
            unique_candidates.append(candidate)
        return unique_candidates

    def _match_recovery_candidate_cache(
        self,
        candidate: RecoveryCandidate,
        original: NormalizedAddress,
    ) -> MatchResult | None:
        if not candidate.address.zip:
            return None

        hit = db.get_exact_address(
            self.conn,
            candidate.address.normalized_address,
            candidate.address.zip,
            self.district_layer.layer_id,
        )
        if not hit or not hit["district"]:
            return None

        db.mark_exact_address_hit(
            self.conn,
            candidate.address.normalized_address,
            candidate.address.zip,
            self.district_layer.layer_id,
        )
        confidence = min(candidate.confidence, confidence_for_exact_cache(hit["confidence"]))

        return MatchResult(
            district=hit["district"],
            confidence=confidence,
            match_method="recovered_geocode",
            normalized_address=candidate.address.normalized_address,
            zip=candidate.address.zip,
            district_layer=self.district_layer.layer_id,
            lat=hit["lat"],
            lon=hit["lon"],
            geocode_quality=hit["geocode_quality"],
            needs_review=confidence < 0.85,
            review_reason=candidate.review_reason if confidence < 0.85 else None,
            evidence={
                "cache": "exact_address_cache",
                "polygon_verified": True,
                "recovery_method": candidate.method,
                "recovery_note": candidate.note,
                "original_normalized_address": original.normalized_address,
            },
        )

    def _fuzzy_street_cache_candidates(
        self,
        row: Mapping[str, Any],
        normalized: NormalizedAddress,
    ) -> list[RecoveryCandidate]:
        if (
            not normalized.zip
            or len(normalized.zip) != 5
            or len(normalized.normalized_street) < FUZZY_STREET_CACHE_MIN_LENGTH
        ):
            return []

        street_number = clean_text(get_row_value(row, self.columns.street_number))
        if not street_number:
            return []

        scored: list[tuple[float, sqlite3.Row]] = []
        for hit in db.list_matched_streets_for_zip(
            self.conn,
            zip_code=normalized.zip,
            district_layer=self.district_layer.layer_id,
        ):
            cached_street = str(hit["normalized_street"] or "")
            if not cached_street or cached_street == normalized.normalized_street:
                continue
            ratio = SequenceMatcher(None, normalized.normalized_street, cached_street).ratio()
            if ratio >= FUZZY_STREET_CACHE_RATIO:
                scored.append((ratio, hit))

        if not scored:
            return []

        scored.sort(
            key=lambda item: (item[0], item[1]["sample_count"] or 0, item[1]["confidence"] or 0),
            reverse=True,
        )
        top_ratio, top_hit = scored[0]
        if len(scored) > 1 and top_ratio - scored[1][0] < FUZZY_STREET_CACHE_AMBIGUITY_GAP:
            return []

        city = get_row_value(row, self.columns.city)
        state = get_row_value(row, self.columns.state)
        apartment = clean_text(get_row_value(row, self.columns.apartment))
        cached_street = str(top_hit["normalized_street"])
        parts = [street_number, cached_street]
        if apartment:
            parts.extend(["Apt", apartment])

        confidence = 0.84 if top_ratio >= 0.93 else 0.80
        return [
            RecoveryCandidate(
                address=make_normalized_address(" ".join(parts), city, state, normalized.zip),
                method="fuzzy_street_cache_geocode",
                confidence=confidence,
                review_reason="recovery_fuzzy_street_cache",
                note=(
                    f"Rebuilt street from same-ZIP street cache match "
                    f"'{cached_street}' ({top_ratio:.2f} similarity)."
                ),
            )
        ]

    def _match_pdi_cache(
        self,
        row: Mapping[str, Any] | None,
        normalized: NormalizedAddress,
    ) -> MatchResult | None:
        if not row:
            return None

        pdi_id = self._pdi_id_for_row(row)
        if not pdi_id:
            return None

        if pdi_id not in self._pdi_match_cache:
            self._pdi_match_cache[pdi_id] = db.get_unique_pdi_district_match(
                self.conn,
                pdi_id,
                self.district_layer.layer_id,
                min_confidence=0.85,
            )
        hit = self._pdi_match_cache[pdi_id]
        if not hit:
            return None

        source_confidence = float(hit["confidence"] or 0)
        confidence = min(0.98, max(0.95, source_confidence))
        return MatchResult(
            district=hit["district"],
            confidence=confidence,
            match_method="pdi_cache",
            normalized_address=normalized.normalized_address or str(hit["normalized_address"] or ""),
            zip=normalized.zip or str(hit["zip"] or ""),
            district_layer=self.district_layer.layer_id,
            lat=hit["lat"],
            lon=hit["lon"],
            geocode_quality=hit["geocode_quality"],
            evidence={
                "cache": "matches_pdi_id",
                "pdi_id": pdi_id,
                "source_match_id": hit["source_match_id"],
                "source_match_method": hit["match_method"],
                "source_confidence": source_confidence,
                "sample_count": hit["sample_count"],
                "source_normalized_address": hit["normalized_address"],
            },
        )

    def _pdi_id_for_row(self, row: Mapping[str, Any]) -> str:
        expected = {clean_text(column).lower().replace("_", " ") for column in PDI_ID_COLUMNS}
        for key, value in row.items():
            normalized_key = clean_text(key).lower().replace("_", " ")
            if normalized_key in expected:
                pdi_id = db.normalize_pdi_id(value)
                if pdi_id:
                    return pdi_id
        return ""

    def _match_neighborhood_inference(
        self,
        row: Mapping[str, Any] | None,
        normalized: NormalizedAddress,
    ) -> MatchResult | None:
        if not row:
            return None

        inference = infer_neighborhood_district(row, self.columns, self.district_layer.layer_id)
        if not inference:
            return None

        return MatchResult(
            district=inference.district,
            confidence=inference.confidence,
            match_method="neighborhood_inference",
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            needs_review=True,
            review_reason=f"neighborhood_inference_{inference.status}",
            evidence={
                "inference_method": "neighborhood_inference",
                "inference_basis": inference.neighborhood,
                "inference_status": inference.status,
                "analysis_note": inference.note,
            },
        )

    def _outside_layer_result(
        self,
        normalized: NormalizedAddress,
        geocode: GeocodeResult,
        *,
        evidence: dict[str, Any] | None = None,
    ) -> MatchResult:
        nearest = self.district_layer.nearest_district_for_point(geocode.lat, geocode.lon)
        merged_evidence: dict[str, Any] = {
            **(evidence or {}),
            "lat": geocode.lat,
            "lon": geocode.lon,
            "geocode_quality": geocode.quality,
            "source": geocode.source,
            "outside_layer": True,
        }
        if nearest:
            merged_evidence.update(
                {
                    "nearest_district": nearest.district,
                    "nearest_district_label": nearest.label,
                    "nearest_distance_meters": round(nearest.distance_meters, 1),
                }
            )
            if nearest.distance_meters <= NEAR_BOUNDARY_INFERENCE_METERS:
                confidence = self._near_boundary_confidence(nearest.distance_meters)
                return MatchResult(
                    district=nearest.district,
                    confidence=confidence,
                    match_method="near_boundary_inference",
                    normalized_address=normalized.normalized_address,
                    zip=normalized.zip,
                    district_layer=self.district_layer.layer_id,
                    lat=geocode.lat,
                    lon=geocode.lon,
                    geocode_quality=geocode.quality,
                    needs_review=True,
                    review_reason="near_boundary_inference",
                    evidence={
                        **merged_evidence,
                        "inference_method": "near_boundary_inference",
                        "inference_basis": f"{nearest.label} within {round(nearest.distance_meters, 1)} meters",
                        "analysis_note": "Geocoded just outside the polygon; nearest district is close enough for inferred review.",
                    },
                )
            if nearest.distance_meters <= NEAR_BOUNDARY_REVIEW_METERS:
                confidence = self._near_boundary_confidence(nearest.distance_meters)
                return MatchResult(
                    district=nearest.district,
                    confidence=confidence,
                    match_method="ambiguous",
                    normalized_address=normalized.normalized_address,
                    zip=normalized.zip,
                    district_layer=self.district_layer.layer_id,
                    lat=geocode.lat,
                    lon=geocode.lon,
                    geocode_quality=geocode.quality,
                    needs_review=True,
                    review_reason="near_boundary_outside_layer",
                    evidence={
                        **merged_evidence,
                        "analysis_note": "Geocoded outside the polygon, but close enough to a district boundary for manual review.",
                    },
                )

        return self._failed(
            normalized,
            "outside_district_layer",
            merged_evidence,
            lat=geocode.lat,
            lon=geocode.lon,
            geocode_quality=geocode.quality,
        )

    def _near_boundary_confidence(self, distance_meters: float) -> float:
        if distance_meters <= 50:
            return 0.80
        if distance_meters <= 100:
            return 0.75
        return 0.68

    def _geocode_method_and_confidence(
        self,
        quality: str | None,
        *,
        recovery_confidence: float | None = None,
    ) -> tuple[MatchMethod, float]:
        method, confidence = confidence_for_geocode_quality(quality)
        if method == "interpolated_geocode":
            confidence = confidence_for_interpolated(confidence)
        if recovery_confidence is not None:
            return "recovered_geocode", min(confidence, recovery_confidence)
        return method, confidence

    def _write_successful_geocode_caches(
        self,
        normalized: NormalizedAddress,
        geocode: GeocodeResult,
        polygon_match: PointDistrictMatch,
        confidence: float,
    ) -> None:
        db.upsert_exact_address(
            self.conn,
            normalized_address=normalized.normalized_address,
            zip_code=normalized.zip,
            district_layer=self.district_layer.layer_id,
            district=polygon_match.district,
            confidence=confidence,
            lat=geocode.lat,
            lon=geocode.lon,
            geocode_quality=geocode.quality,
            source=geocode.source,
            evidence={"polygon_verified": True},
        )

        if normalized.normalized_street:
            db.upsert_street_cache(
                self.conn,
                zip_code=normalized.zip,
                normalized_street=normalized.normalized_street,
                district_layer=self.district_layer.layer_id,
                status="matched",
                district=polygon_match.district,
                confidence=confidence_for_street_cache(),
            )

    def _failed(
        self,
        normalized: NormalizedAddress,
        reason: str,
        evidence: dict[str, Any],
        *,
        lat: float | None = None,
        lon: float | None = None,
        geocode_quality: str | None = None,
    ) -> MatchResult:
        return MatchResult(
            district=None,
            confidence=confidence_for_failed(),
            match_method="failed",
            normalized_address=normalized.normalized_address,
            zip=normalized.zip,
            district_layer=self.district_layer.layer_id,
            lat=lat,
            lon=lon,
            geocode_quality=geocode_quality,
            needs_review=True,
            review_reason=reason,
            evidence=evidence,
        )


def ambiguous_result(
    *,
    normalized_address: str,
    zip_code: str,
    district_layer: str,
    reason: str,
    candidates: list[dict[str, Any]] | None = None,
) -> MatchResult:
    """Create a standard ambiguous result for future multi-candidate flows."""
    return MatchResult(
        district=None,
        confidence=confidence_for_ambiguous(len(candidates or [])),
        match_method="ambiguous",
        normalized_address=normalized_address,
        zip=zip_code,
        district_layer=district_layer,
        needs_review=True,
        review_reason=reason,
        evidence={"candidates": candidates or []},
    )
