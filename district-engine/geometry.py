"""
Lightweight Shapely-only district geometry engine.

Responsibilities:
- load district polygons from GeoJSON
- build an STRtree spatial index
- match latitude/longitude points to districts
- support multiple district layers without GeoPandas
"""

from __future__ import annotations

import json
import numbers
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree


REPO_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_DISTRICT_LAYERS = {
    "la-city-council": {
        "path": REPO_ROOT / "geodata" / "la-city-council.geojson",
        "district_field": "District",
        "label_prefix": "cd",
    },
    "ca-state-assembly": {
        "path": REPO_ROOT / "geodata" / "ca-state-assembly.geojson",
        "district_field": "DISTRICT",
        "label_prefix": "ad",
    },
}


@dataclass(frozen=True)
class DistrictFeature:
    """One district polygon feature loaded from GeoJSON."""

    layer_id: str
    district: str
    geometry: BaseGeometry
    properties: dict[str, Any]


@dataclass(frozen=True)
class PointDistrictMatch:
    """Point-in-polygon result for one district layer."""

    layer_id: str
    district: str
    label: str
    lat: float
    lon: float
    properties: dict[str, Any]


@dataclass(frozen=True)
class NearestDistrictCandidate:
    """Nearest district boundary for a point outside a polygon layer."""

    layer_id: str
    district: str
    label: str
    distance_meters: float
    lat: float
    lon: float
    properties: dict[str, Any]


def district_sort_key(value: str) -> tuple[int, int | str]:
    """Sort numeric district labels numerically, then everything else by text."""
    text = str(value).strip()
    if text.isdigit():
        return (0, int(text))
    return (1, text)


def normalize_district_value(value: Any) -> str:
    """Normalize district property values for deterministic storage/comparison."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _property_value(properties: dict[str, Any], field: str) -> Any:
    """Fetch a GeoJSON property, allowing case-insensitive fallback."""
    if field in properties:
        return properties[field]
    field_lower = field.lower()
    for key, value in properties.items():
        if key.lower() == field_lower:
            return value
    return None


def _clean_geometry(geometry: BaseGeometry) -> BaseGeometry:
    """Return a valid polygonal geometry where Shapely can repair it cheaply."""
    if geometry.is_empty:
        return geometry
    if geometry.is_valid:
        return geometry
    return geometry.buffer(0)


class DistrictLayer:
    """Indexed polygon layer for fast district matching."""

    def __init__(
        self,
        *,
        layer_id: str,
        source_path: str | Path,
        district_field: str,
        label_prefix: str = "",
        features: Iterable[DistrictFeature],
    ) -> None:
        self.layer_id = layer_id
        self.source_path = str(source_path)
        self.district_field = district_field
        self.label_prefix = label_prefix
        self.features = tuple(sorted(features, key=lambda f: district_sort_key(f.district)))
        self.geometries = tuple(feature.geometry for feature in self.features)
        self._tree = STRtree(self.geometries)
        self._geometry_id_to_index = {id(geometry): i for i, geometry in enumerate(self.geometries)}

    @property
    def district_count(self) -> int:
        return len(self.features)

    @property
    def bounds(self) -> tuple[float, float, float, float] | None:
        if not self.geometries:
            return None
        minx = min(geometry.bounds[0] for geometry in self.geometries)
        miny = min(geometry.bounds[1] for geometry in self.geometries)
        maxx = max(geometry.bounds[2] for geometry in self.geometries)
        maxy = max(geometry.bounds[3] for geometry in self.geometries)
        return (minx, miny, maxx, maxy)

    def label_for_district(self, district: str) -> str:
        return f"{self.label_prefix}{district}" if self.label_prefix else district

    def _candidate_indexes(self, query_result: Iterable[Any]) -> list[int]:
        indexes: list[int] = []
        for item in query_result:
            if isinstance(item, numbers.Integral):
                indexes.append(int(item))
            else:
                index = self._geometry_id_to_index.get(id(item))
                if index is not None:
                    indexes.append(index)
        return indexes

    def candidate_features_for_geometry(self, geometry: BaseGeometry) -> list[DistrictFeature]:
        """Return districts whose bounding boxes intersect the provided geometry."""
        indexes = self._candidate_indexes(self._tree.query(geometry))
        return [self.features[index] for index in indexes]

    def match_point(self, lat: float, lon: float) -> PointDistrictMatch | None:
        """
        Match a point to one district.

        Uses `covers` instead of `contains` so addresses exactly on a polygon
        boundary still resolve deterministically.
        """
        point = Point(lon, lat)
        candidates = self.candidate_features_for_geometry(point)
        matches = [feature for feature in candidates if feature.geometry.covers(point)]
        if not matches:
            return None

        feature = sorted(matches, key=lambda f: district_sort_key(f.district))[0]
        return PointDistrictMatch(
            layer_id=self.layer_id,
            district=feature.district,
            label=self.label_for_district(feature.district),
            lat=lat,
            lon=lon,
            properties=feature.properties,
        )

    def nearest_district_for_point(self, lat: float, lon: float) -> NearestDistrictCandidate | None:
        """Return the closest district boundary for a point outside this layer."""
        if not self.features:
            return None

        point = Point(lon, lat)
        feature = min(
            self.features,
            key=lambda candidate: (point.distance(candidate.geometry), district_sort_key(candidate.district)),
        )
        distance_degrees = point.distance(feature.geometry)
        # Good enough for boundary triage around LA; final assignment still needs review.
        distance_meters = distance_degrees * 111_320
        return NearestDistrictCandidate(
            layer_id=self.layer_id,
            district=feature.district,
            label=self.label_for_district(feature.district),
            distance_meters=distance_meters,
            lat=lat,
            lon=lon,
            properties=feature.properties,
        )


@lru_cache(maxsize=16)
def load_district_layer(
    geojson_path: str | Path,
    district_field: str,
    layer_id: str | None = None,
    label_prefix: str = "",
    target_districts: tuple[str, ...] | None = None,
) -> DistrictLayer:
    """Load and cache a district layer from GeoJSON."""
    path = Path(geojson_path).resolve()
    resolved_layer_id = layer_id or path.stem
    targets = {normalize_district_value(value) for value in target_districts or ()}

    with path.open(encoding="utf-8") as file:
        geojson = json.load(file)

    features: list[DistrictFeature] = []
    for raw_feature in geojson.get("features", []):
        properties = dict(raw_feature.get("properties") or {})
        raw_district = _property_value(properties, district_field)
        if raw_district is None or str(raw_district).strip() == "":
            continue

        district = normalize_district_value(raw_district)
        if targets and district not in targets:
            continue

        geometry = _clean_geometry(shape(raw_feature.get("geometry")))
        if geometry.is_empty:
            continue

        features.append(
            DistrictFeature(
                layer_id=resolved_layer_id,
                district=district,
                geometry=geometry,
                properties=properties,
            )
        )

    if not features:
        raise ValueError(
            f"No district features found in {path} using field '{district_field}'."
        )

    return DistrictLayer(
        layer_id=resolved_layer_id,
        source_path=path,
        district_field=district_field,
        label_prefix=label_prefix,
        features=features,
    )


def load_default_layer(layer_id: str) -> DistrictLayer:
    """Load one of the built-in district layers."""
    config = DEFAULT_DISTRICT_LAYERS[layer_id]
    return load_district_layer(
        config["path"],
        config["district_field"],
        layer_id=layer_id,
        label_prefix=config["label_prefix"],
    )


def match_point_across_layers(
    lat: float,
    lon: float,
    layers: Iterable[DistrictLayer],
) -> dict[str, PointDistrictMatch | None]:
    """Match one point against multiple district layers."""
    return {layer.layer_id: layer.match_point(lat, lon) for layer in layers}
