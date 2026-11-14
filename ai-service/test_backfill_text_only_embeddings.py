import json
import math
import os
import unittest
from pathlib import Path
from unittest import mock

import backfill_text_only_embeddings as backfill

TEMP = Path(os.environ.get("TEMP", "/tmp"))
UNIT = [1 / math.sqrt(backfill.DIM)] * backfill.DIM


def vector(value: float = 9.2) -> list[float]:
    return [value] * backfill.DIM


def row(ref_code: str) -> dict:
    return {
        "ref_code": ref_code,
        "title": "Strawberry",
        "status": "held",
        "category": "Other",
        "ai_caption": None,
        "image_url": "https://example.test/photo.webp",
        "embedding": vector(),
    }


class VectorMathTests(unittest.TestCase):
    def test_parse_normalize_combine_and_cosine(self):
        self.assertEqual(backfill.parse_vector("[1, 2, 3]"), [1.0, 2.0, 3.0])
        self.assertAlmostEqual(backfill.norm(backfill.unit(vector())), 1.0)
        self.assertEqual(backfill.combine([3.0, 0.0], None), [1.0, 0.0])
        combined = backfill.combine([3.0, 0.0], [0.0, 4.0])
        self.assertAlmostEqual(backfill.norm(combined), 1.0)
        self.assertAlmostEqual(combined[0], math.sqrt(0.5))
        self.assertAlmostEqual(backfill.cosine(vector(), vector()), 1.0)
        item = {**row("BS-0139"), "description": "staff only"}
        self.assertEqual(backfill.public_text(item), "Strawberry Other")


class SafetyTests(unittest.TestCase):
    def test_backup_paths(self):
        with self.assertRaises(SystemExit):
            backfill.ensure_outside_repo(backfill.ROOT / "backup.json")
        target = TEMP / "biruk-test-backup.json"
        self.assertEqual(backfill.ensure_outside_repo(target), target.resolve())

    def test_apply_without_ref_code_or_yes_is_refused(self):
        with mock.patch.object(backfill, "patch_item") as patch:
            self.assertEqual(backfill.main(["--apply", "--yes"]), 2)
            self.assertEqual(backfill.main(["--apply", "--ref-code", "BS-0139"]), 2)
        patch.assert_not_called()


class MainTests(unittest.TestCase):
    def setUp(self):
        self.config = ("https://example.test", "key", "http://ai.test")
        self.rows = [row("BS-0139"), row("BS-0132")]

    def _patches(self, **overrides):
        values = {
            "config": mock.Mock(return_value=self.config),
            "check_ai_service": mock.Mock(),
            "fetch_items": mock.Mock(return_value=self.rows),
            "build_new_vector": mock.Mock(return_value=(UNIT, "text", True)),
            "patch_item": mock.Mock(),
            "write_backup": mock.Mock(return_value=TEMP / "backup.json"),
        }
        values.update(overrides)
        for name, value in values.items():
            patch = mock.patch.object(backfill, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        return values

    def test_dry_run_writes_nothing_and_detects_text_only_rows(self):
        values = self._patches()
        self.assertEqual(backfill.main(["--ref-code", "BS-0139"]), 0)
        expected = (self.config[0], self.config[1], ["BS-0139"])
        values["fetch_items"].assert_called_once_with(*expected)
        values["patch_item"].assert_not_called()
        values["write_backup"].assert_not_called()

        self.rows = [row("BS-0139")]
        values = self._patches()
        self.assertEqual(backfill.main([]), 0)
        values["build_new_vector"].assert_called_once()
        values["write_backup"].assert_not_called()

    def test_apply_backs_up_before_patching(self):
        values = self._patches()
        order = mock.Mock()
        order.attach_mock(values["write_backup"], "write_backup")
        order.attach_mock(values["patch_item"], "patch_item")
        args = ["--apply", "--ref-code", "BS-0139", "--ref-code", "BS-0132", "--yes"]
        self.assertEqual(backfill.main(args), 0)
        self.assertEqual(
            [call[0] for call in order.mock_calls],
            ["write_backup", "patch_item", "patch_item"],
        )
        for call in values["patch_item"].call_args_list:
            self.assertAlmostEqual(backfill.norm(call.args[3]), 1.0)

    def test_rebuild_failure_writes_nothing(self):
        values = self._patches(
            **{"build_new_vector": mock.Mock(side_effect=ValueError("bad"))}
        )
        self.assertEqual(backfill.main(["--apply", "--ref-code", "BS-0139", "--yes"]), 1)
        values["write_backup"].assert_not_called()
        values["patch_item"].assert_not_called()

    def test_ref_code_filter_is_forwarded(self):
        values = self._patches()
        backfill.main(["--ref-code", "BS-0139", "--ref-code", "BS-0132"])
        expected = (self.config[0], self.config[1], ["BS-0139", "BS-0132"])
        values["fetch_items"].assert_called_once_with(*expected)


class BackupTests(unittest.TestCase):
    def test_backup_contains_the_old_and_new_vectors(self):
        saved = backfill.write_backup(
            TEMP / "biruk-backup-roundtrip.json", [row("BS-0139")], {"BS-0139": UNIT}
        )
        item = json.loads(saved.read_text(encoding="utf-8"))["items"][0]
        self.assertEqual(item["ref_code"], "BS-0139")
        self.assertEqual(len(item["old_embedding"]), backfill.DIM)
        self.assertAlmostEqual(backfill.norm(item["new_embedding"]), 1.0)


if __name__ == "__main__":
    unittest.main()
