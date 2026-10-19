import unittest

from matcher import MatchResult
from output import export_bucket_for_result


def matched(district: str, layer: str = "la-city-council") -> MatchResult:
    return MatchResult(
        district=district,
        confidence=0.99,
        match_method="polygon",
        normalized_address="1 Main St",
        zip="90012",
        district_layer=layer,
    )


class ExportBucketTests(unittest.TestCase):
    def test_empty_selection_groups_every_district_in_the_layer(self) -> None:
        cd1 = export_bucket_for_result(
            matched("1"),
            district_label="cd1",
            selected_labels=set(),
            layer_id="la-city-council",
        )
        cd14 = export_bucket_for_result(
            matched("14"),
            district_label="cd14",
            selected_labels=set(),
            layer_id="la-city-council",
        )
        self.assertEqual(cd1, "matched_all_la_city_council")
        self.assertEqual(cd14, cd1)

    def test_selected_districts_stay_in_separate_files(self) -> None:
        selected = export_bucket_for_result(
            matched("1"),
            district_label="cd1",
            selected_labels={"cd1", "cd4"},
            layer_id="la-city-council",
            targeted_mode=True,
        )
        other = export_bucket_for_result(
            matched("5"),
            district_label="cd5",
            selected_labels={"cd1", "cd4"},
            layer_id="la-city-council",
            targeted_mode=True,
        )
        self.assertEqual(selected, "matched_cd1")
        self.assertEqual(other, "other_districts")


if __name__ == "__main__":
    unittest.main()
