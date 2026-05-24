"""
Second-pass address recovery helpers for failed geocodes.

These transformations intentionally produce candidates, not source-of-truth
addresses. The matcher still requires Census geocoding and polygon verification
before assigning a district.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from normalize import (
    ColumnMapping,
    NormalizedAddress,
    UNIT_PATTERN,
    clean_text,
    get_row_value,
    normalize_address_line,
    normalize_city,
    normalize_full_address,
    normalize_state,
    normalize_street,
    normalize_zip,
)


@dataclass(frozen=True)
class RecoveryCandidate:
    address: NormalizedAddress
    method: str
    confidence: float
    review_reason: str
    note: str


STREET_SUFFIX_VARIANTS = ("Ave", "St", "Blvd", "Dr", "Way")
STREET_SUFFIX_PATTERN = re.compile(
    r"\b(ave|avenue|st|street|dr|drive|blvd|boulevard|rd|road|way|pl|place|ct|court|ter|terrace|ln|lane|cir|circle)$",
    re.IGNORECASE,
)

STREET_CORRECTIONS = {
    r"\balin\b": "allin",
    r"\bconnd\b": "102nd",
    r"\bheraford\b": "hereford",
    r"\bprovedence\b": "providence",
    r"\bsawtalle\b": "sawtelle",
    r"\bterrance\b": "terrace",
}

ZIP_GATED_STREET_CORRECTIONS = {
    "*": (
        (r"\baveune\b", "avenue"),
        (r"\bpi\b", "pl"),
        (r"\bmacarther\b", "macarthur"),
        (r"\bmacaurthor\b", "macarthur"),
        (r"\bmercered\b", "merced"),
        (r"\bgrammery\b", "gramercy"),
    ),
    "90025": (
        (r"\blowa\b", "iowa"),
        (r"\bbelat\b", "beloit"),
    ),
    "90045": (
        (r"\bce\s+tyera\b", "la tijera"),
        (r"\blum\b", "lmu"),
    ),
}


def make_normalized_address(address: str, city: str, state: str, zip_code: str) -> NormalizedAddress:
    fixed_address = normalize_address_line(address)
    fixed_city = normalize_city(city)
    fixed_state = normalize_state(state)
    fixed_zip = normalize_zip(zip_code)
    return NormalizedAddress(
        address=fixed_address,
        city=fixed_city,
        state=fixed_state,
        zip=fixed_zip,
        normalized_address=normalize_full_address(fixed_address, fixed_city, fixed_state, fixed_zip),
        normalized_street=normalize_street(fixed_address),
    )


def strip_unit(address: str) -> str:
    return re.sub(r"\s+", " ", UNIT_PATTERN.sub("", address)).strip()


def normalize_fractional_house_number(address: str) -> str:
    fixed = clean_text(address)
    fixed = re.sub(r"^(\d+)\s*½\b", r"\1 1/2", fixed)
    fixed = re.sub(r"^(\d+)½\b", r"\1 1/2", fixed)
    fixed = re.sub(r"^(\d+)-1/2\b", r"\1 1/2", fixed, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", fixed).strip()


def has_street_suffix(street_name: str) -> bool:
    return bool(STREET_SUFFIX_PATTERN.search(clean_text(street_name)))


def valid_recovery_zip(zip_code: str) -> bool:
    return bool(re.fullmatch(r"\d{5}", normalize_zip(zip_code)))


def ordinal_suffix(number: int) -> str:
    if 10 <= number % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")


def corrected_ordinal_street_name(street_name: str) -> str | None:
    cleaned = clean_text(street_name).lower()
    match = re.fullmatch(r"(\d{1,3})(?:st|nd|rd|th)?", cleaned)
    if not match:
        return None

    number = int(match.group(1))
    if number <= 0:
        return None
    return f"{number}{ordinal_suffix(number)}"


def corrected_street_names(street_name: str, zip_code: str = "") -> list[str]:
    fixed_values: list[str] = []
    cleaned = clean_text(street_name).lower()

    def add_fixed(value: str) -> None:
        fixed = re.sub(r"\s+", " ", value).strip()
        if fixed and fixed != cleaned and fixed not in fixed_values:
            fixed_values.append(fixed)

    for pattern, replacement in STREET_CORRECTIONS.items():
        if re.search(pattern, cleaned, flags=re.IGNORECASE):
            fixed = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
            add_fixed(fixed)

    if valid_recovery_zip(zip_code):
        for pattern, replacement in ZIP_GATED_STREET_CORRECTIONS.get("*", ()):
            if re.search(pattern, cleaned, flags=re.IGNORECASE):
                add_fixed(re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE))
        for pattern, replacement in ZIP_GATED_STREET_CORRECTIONS.get(normalize_zip(zip_code), ()):
            if re.search(pattern, cleaned, flags=re.IGNORECASE):
                add_fixed(re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE))

        ordinal = corrected_ordinal_street_name(cleaned)
        if ordinal:
            add_fixed(ordinal)

    return fixed_values


def recovery_candidates_for_row(
    row: Mapping[str, Any],
    columns: ColumnMapping,
    normalized: NormalizedAddress,
) -> list[RecoveryCandidate]:
    candidates: list[RecoveryCandidate] = []
    seen: set[tuple[str, str, str, str, str]] = set()

    city = get_row_value(row, columns.city)
    state = get_row_value(row, columns.state)
    zip_code = get_row_value(row, columns.zip)
    street_number = clean_text(get_row_value(row, columns.street_number))
    street_name = clean_text(get_row_value(row, columns.street_name))
    apartment = clean_text(get_row_value(row, columns.apartment))

    def add(address: str, method: str, confidence: float, review_reason: str, note: str) -> None:
        candidate = make_normalized_address(address, city, state, zip_code)
        if not candidate.address:
            return
        key = (candidate.normalized_address, candidate.city, candidate.state, candidate.zip, method)
        if key in seen or candidate.normalized_address == normalized.normalized_address:
            return
        seen.add(key)
        candidates.append(
            RecoveryCandidate(
                address=candidate,
                method=method,
                confidence=confidence,
                review_reason=review_reason,
                note=note,
            )
        )

    if normalized.address and not normalized.zip:
        add(
            normalized.address,
            "missing_zip_geocode",
            0.82,
            "recovery_missing_zip",
            "Census matched the address without a ZIP code.",
        )

    no_unit = strip_unit(normalized.address)
    if no_unit and no_unit != normalized.address:
        add(
            no_unit,
            "unit_removed_geocode",
            0.88 if normalized.zip else 0.82,
            "recovery_unit_removed",
            "Removed apartment/unit text before geocoding.",
        )

    fractional = normalize_fractional_house_number(normalized.address)
    if fractional and fractional != normalized.address:
        add(
            fractional,
            "fractional_house_number_geocode",
            0.86,
            "recovery_fractional_house_number",
            "Converted fractional house number to Census-friendly 1/2 notation.",
        )
        no_unit_fractional = strip_unit(fractional)
        if no_unit_fractional and no_unit_fractional != fractional:
            add(
                no_unit_fractional,
                "fractional_no_unit_geocode",
                0.86,
                "recovery_fractional_house_number",
                "Converted fractional house number and removed unit text.",
            )

    for corrected_street in corrected_street_names(street_name, zip_code):
        parts = [street_number, corrected_street]
        if apartment:
            parts.extend(["Apt", apartment])
        add(
            " ".join(part for part in parts if part),
            "street_typo_correction_geocode",
            0.80,
            "recovery_street_typo_correction",
            "Applied a known street typo correction before geocoding.",
        )
        if valid_recovery_zip(zip_code) and not has_street_suffix(corrected_street) and len(corrected_street) >= 3:
            for suffix in STREET_SUFFIX_VARIANTS:
                parts = [street_number, corrected_street, suffix]
                if apartment:
                    parts.extend(["Apt", apartment])
                add(
                    " ".join(part for part in parts if part),
                    "street_typo_suffix_completion_geocode",
                    0.84,
                    "recovery_street_typo_suffix_completion",
                    "Applied a ZIP-gated street correction and tested a street suffix before geocoding.",
                )

    if (
        valid_recovery_zip(zip_code)
        and street_number
        and re.fullmatch(r"ave(?:nue)?", clean_text(street_name), flags=re.IGNORECASE)
        and re.fullmatch(r"\d{1,3}", apartment)
    ):
        add(
            " ".join(part for part in [street_number, "Avenue", apartment] if part),
            "numbered_avenue_completion_geocode",
            0.86,
            "recovery_numbered_avenue_completion",
            "Moved a numeric apartment value into an Avenue street name before geocoding.",
        )

    if street_number and street_name and not has_street_suffix(street_name) and len(street_name) >= 3:
        for suffix in STREET_SUFFIX_VARIANTS:
            parts = [street_number, street_name, suffix]
            if apartment:
                parts.extend(["Apt", apartment])
            add(
                " ".join(part for part in parts if part),
                "street_suffix_variant_geocode",
                0.68,
                "recovery_street_suffix_variant",
                "Tested a street suffix variant before geocoding.",
            )

    return candidates
