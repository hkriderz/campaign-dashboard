"""
Confidence scoring rules for district classification.

Scores are intentionally simple and deterministic. The matcher owns evidence
collection; this module centralizes the numeric policy so future tuning is easy.
"""

from __future__ import annotations

from typing import Literal

MatchMethod = Literal[
    "exact_cache",
    "zip_overlap",
    "street_cache",
    "rooftop_geocode",
    "interpolated_geocode",
    "recovered_geocode",
    "pdi_cache",
    "neighborhood_inference",
    "near_boundary_inference",
    "ambiguous",
    "failed",
]

EXACT_CACHE_CONFIDENCE = 0.995
ROOFTOP_GEOCODE_CONFIDENCE = 0.99
FAILED_CONFIDENCE = 0.0
AMBIGUOUS_CONFIDENCE = 0.5

ZIP_OVERLAP_THRESHOLD = 0.95
STREET_CACHE_MIN_CONFIDENCE = 0.92
STREET_CACHE_MAX_CONFIDENCE = 0.96
INTERPOLATED_MIN_CONFIDENCE = 0.85
INTERPOLATED_MAX_CONFIDENCE = 0.93


def clamp(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    return max(min_value, min(max_value, value))


def confidence_for_exact_cache(stored_confidence: float | None = None) -> float:
    if stored_confidence is None or stored_confidence <= 0:
        return EXACT_CACHE_CONFIDENCE
    return clamp(min(EXACT_CACHE_CONFIDENCE, stored_confidence))


def confidence_for_zip_overlap(overlap_probability: float) -> float:
    return clamp(overlap_probability)


def confidence_for_street_cache(sample_count: int = 1, stored_confidence: float | None = None) -> float:
    if stored_confidence is not None and stored_confidence > 0:
        return clamp(stored_confidence, STREET_CACHE_MIN_CONFIDENCE, STREET_CACHE_MAX_CONFIDENCE)

    # More repeated examples on the same street should move the score toward
    # the top of the street-cache range, but never equal rooftop certainty.
    sample_bonus = min(max(sample_count - 1, 0), 4) * 0.01
    return clamp(0.92 + sample_bonus, STREET_CACHE_MIN_CONFIDENCE, STREET_CACHE_MAX_CONFIDENCE)


def confidence_for_geocode_quality(quality: str | None) -> tuple[MatchMethod, float]:
    normalized = (quality or "").strip().lower()

    if normalized in {"rooftop", "parcel", "pointaddress", "point_address", "exact"}:
        return "rooftop_geocode", ROOFTOP_GEOCODE_CONFIDENCE

    if normalized in {"interpolated", "range_interpolated", "street", "street_centerline"}:
        return "interpolated_geocode", 0.9

    if normalized in {"zip", "zip_centroid", "city", "city_centroid"}:
        return "interpolated_geocode", INTERPOLATED_MIN_CONFIDENCE

    return "interpolated_geocode", INTERPOLATED_MIN_CONFIDENCE


def confidence_for_interpolated(base_score: float | None = None) -> float:
    if base_score is None:
        return 0.9
    return clamp(base_score, INTERPOLATED_MIN_CONFIDENCE, INTERPOLATED_MAX_CONFIDENCE)


def confidence_for_ambiguous(candidate_count: int = 0) -> float:
    if candidate_count <= 1:
        return AMBIGUOUS_CONFIDENCE
    return clamp(0.65 - min(candidate_count, 5) * 0.05, 0.4, 0.65)


def confidence_for_failed() -> float:
    return FAILED_CONFIDENCE
