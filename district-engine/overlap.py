"""
ZIP/district polygon overlap helpers.

This module uses Shapely directly and reuses the STRtree-backed DistrictLayer
from geometry.py. It works with any polygon GeoJSON source, not just ZIPs, as
long as the source feature has an identifier property.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from geometry import DistrictFeature, DistrictLayer


@dataclass(frozen=True)
class SourcePolygon:
    """One source polygon to compare against a district layer."""

    source_id: str
    geometry: BaseGeometry
    properties: dict[str, Any]


@dataclass(frozen=True)
class PolygonOverlap:
    """Overlap result between one source polygon and one district."""

    source_id: str
    district_layer: str
    district: str
    overlap_probability: float
    overlap_area: float
    source_area: float
    overlap_basis: str

    def as_cache_row(self) -> dict[str, Any]:
        """Return fields compatible with zip_overlap_cache insertion."""
        return {
            "zip_code": self.source_id,
            "district_layer": self.district_layer,
            "district": self.district,
            "overlap_probability": self.overlap_probability,
            "overlap_basis": self.overlap_basis,
            "confidence": self.overlap_probability,
        }


def _property_value(properties: dict[str, Any], field: str) -> Any:
    if field in properties:
        return properties[field]
    field_lower = field.lower()
    for key, value in properties.items():
        if key.lower() == field_lower:
            return value
    return None


def _clean_geometry(geometry: BaseGeometry) -> BaseGeometry:
    if geometry.is_empty:
        return geometry
    if geometry.is_valid:
        return geometry
    return geometry.buffer(0)


def load_source_polygons(
    geojson_path: str | Path,
    id_field: str,
) -> list[SourcePolygon]:
    """Load generic source polygons from GeoJSON."""
    path = Path(geojson_path)
    with path.open(encoding="utf-8") as file:
        geojson = json.load(file)

    polygons: list[SourcePolygon] = []
    for raw_feature in geojson.get("features", []):
        properties = dict(raw_feature.get("properties") or {})
        raw_id = _property_value(properties, id_field)
        if raw_id is None or str(raw_id).strip() == "":
            continue

        geometry = _clean_geometry(shape(raw_feature.get("geometry")))
        if geometry.is_empty or geometry.area <= 0:
            continue

        polygons.append(
            SourcePolygon(
                source_id=str(raw_id).strip(),
                geometry=geometry,
                properties=properties,
            )
        )

    return polygons


def calculate_polygon_overlaps(
    source_polygon: SourcePolygon,
    district_layer: DistrictLayer,
    *,
    min_probability: float = 0,
    overlap_basis: str = "area",
) -> list[PolygonOverlap]:
    """
    Calculate district overlap probabilities for one source polygon.

    Probability is computed as intersection area divided by source polygon area.
    For highest accuracy, provide GeoJSON in a projected coordinate system. For
    local district/ZIP comparisons, WGS84 degree-area ratios are often sufficient
    as a lightweight heuristic.
    """
    source_area = source_polygon.geometry.area
    if source_area <= 0:
        return []

    overlaps: list[PolygonOverlap] = []
    candidates = district_layer.candidate_features_for_geometry(source_polygon.geometry)

    for district in candidates:
        overlap_area = _intersection_area(source_polygon.geometry, district)
        if overlap_area <= 0:
            continue

        probability = overlap_area / source_area
        if probability < min_probability:
            continue

        overlaps.append(
            PolygonOverlap(
                source_id=source_polygon.source_id,
                district_layer=district_layer.layer_id,
                district=district.district,
                overlap_probability=probability,
                overlap_area=overlap_area,
                source_area=source_area,
                overlap_basis=overlap_basis,
            )
        )

    overlaps.sort(key=lambda row: (-row.overlap_probability, row.district))
    return overlaps


def calculate_geojson_overlaps(
    source_geojson_path: str | Path,
    source_id_field: str,
    district_layer: DistrictLayer,
    *,
    min_probability: float = 0,
    overlap_basis: str = "area",
) -> list[PolygonOverlap]:
    """Calculate overlaps for every source polygon in a GeoJSON file."""
    results: list[PolygonOverlap] = []
    for source_polygon in load_source_polygons(source_geojson_path, source_id_field):
        results.extend(
            calculate_polygon_overlaps(
                source_polygon,
                district_layer,
                min_probability=min_probability,
                overlap_basis=overlap_basis,
            )
        )
    return results


def calculate_zip_overlaps(
    zip_geojson_path: str | Path,
    zip_field: str,
    district_layer: DistrictLayer,
    *,
    min_probability: float = 0,
) -> list[PolygonOverlap]:
    """Convenience wrapper for ZIP/ZCTA overlap analysis."""
    return calculate_geojson_overlaps(
        zip_geojson_path,
        zip_field,
        district_layer,
        min_probability=min_probability,
        overlap_basis="area",
    )


def dominant_overlap(overlaps: list[PolygonOverlap]) -> PolygonOverlap | None:
    """Return the highest-probability overlap for one source polygon."""
    if not overlaps:
        return None
    return sorted(overlaps, key=lambda row: (-row.overlap_probability, row.district))[0]


def _intersection_area(source_geometry: BaseGeometry, district: DistrictFeature) -> float:
    try:
        intersection = source_geometry.intersection(district.geometry)
    except Exception:
        repaired_source = _clean_geometry(source_geometry)
        repaired_district = _clean_geometry(district.geometry)
        intersection = repaired_source.intersection(repaired_district)
    return 0 if intersection.is_empty else float(intersection.area)
