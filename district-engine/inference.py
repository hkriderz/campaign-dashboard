"""
Neighborhood-based district inference.

This module is intentionally conservative: inference is not polygon
verification. It creates auditable candidate districts for review/export when
geocoding cannot place a row.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from normalize import ColumnMapping, clean_text, get_row_value


@dataclass(frozen=True)
class NeighborhoodInference:
    district: str
    confidence: float
    neighborhood: str
    status: str
    note: str


@dataclass(frozen=True)
class NeighborhoodRule:
    district: str
    confidence: float
    status: str
    aliases: tuple[str, ...]
    note: str


LA_CITY_COUNCIL_NEIGHBORHOODS: tuple[NeighborhoodRule, ...] = (
    NeighborhoodRule("11", 0.86, "strong", ("venice",), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("mar vista",), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("del rey",), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("playa vista",), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("playa del rey", "playa del ray", "playa del reyy"), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("westchester",), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("11", 0.86, "strong", ("pacific palisades", "palisades"), "Neighborhood is strongly associated with CD11."),
    NeighborhoodRule("15", 0.84, "strong", ("san pedro", "wilmington", "harbor city", "harbor gateway"), "Harbor-area neighborhood inference."),
    NeighborhoodRule("12", 0.82, "strong", ("chatsworth", "porter ranch", "northridge", "granada hills"), "Northwest Valley neighborhood inference."),
    NeighborhoodRule("7", 0.82, "strong", ("pacoima", "sylmar", "sunland", "tujunga", "shadow hills"), "Northeast Valley neighborhood inference."),
    NeighborhoodRule("3", 0.82, "strong", ("canoga park", "winnetka", "reseda", "tarzana", "woodland hills"), "West Valley neighborhood inference."),
    NeighborhoodRule("2", 0.80, "strong", ("north hollywood", "valley village", "valley glen", "studio city"), "East Valley neighborhood inference."),
    NeighborhoodRule("13", 0.78, "review", ("hollywood", "silver lake", "echo park", "atwater village", "east hollywood"), "Central LA neighborhood; review because boundaries can be nuanced."),
    NeighborhoodRule("14", 0.78, "review", ("downtown", "downtown la", "boyle heights", "eagle rock", "el sereno"), "East/Central LA neighborhood; review because boundaries can be nuanced."),
    NeighborhoodRule("10", 0.72, "ambiguous", ("koreatown", "mid city", "mid-city", "west adams"), "Neighborhood may cross or sit near district boundaries."),
    NeighborhoodRule("8", 0.78, "review", ("crenshaw", "leimert park", "hyde park", "baldwin hills"), "South LA neighborhood inference; review recommended."),
    NeighborhoodRule("5", 0.78, "review", ("westwood", "bel air", "beverly crest", "palms", "cheviot hills"), "Westside neighborhood inference; review recommended."),
    NeighborhoodRule("1", 0.76, "review", ("chinatown", "pico union", "pico-union", "lincoln heights", "cypress park"), "Neighborhood inference; review recommended."),
)

NEIGHBORHOOD_RULES_BY_LAYER = {
    "la-city-council": LA_CITY_COUNCIL_NEIGHBORHOODS,
}


def normalize_lookup_text(value: Any) -> str:
    text = clean_text(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s/-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def alias_matches(text: str, alias: str) -> bool:
    normalized_alias = normalize_lookup_text(alias)
    if not text or not normalized_alias:
        return False
    if text == normalized_alias:
        return True
    return bool(re.search(rf"(^|\s){re.escape(normalized_alias)}(\s|$)", text))


def infer_neighborhood_district(
    row: Mapping[str, Any],
    columns: ColumnMapping,
    layer_id: str,
) -> NeighborhoodInference | None:
    rules = NEIGHBORHOOD_RULES_BY_LAYER.get(layer_id)
    if not rules:
        return None

    city_text = normalize_lookup_text(get_row_value(row, columns.city))
    if not city_text or city_text in {"los angeles", "la", "city"}:
        return None

    for rule in rules:
        for alias in rule.aliases:
            if alias_matches(city_text, alias):
                return NeighborhoodInference(
                    district=rule.district,
                    confidence=rule.confidence,
                    neighborhood=alias,
                    status=rule.status,
                    note=rule.note,
                )

    return None
