import contextlib
import io
import json
import math
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import backfill_text_only_embeddings as b

UNIT = [1 / math.sqrt(b.DIM)] * b.DIM
def vector(value: float = 9.2) -> list[float]:
    return [value] * b.DIM
def row(ref_code: str) -> dict:
    return {"ref_code": ref_code, "title": "Strawberry", "status": "held", "category": "Other",
            "ai_caption": None, "image_url": "https://example.test/photo.webp", "embedding": vector()}
def run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = b.main(argv)
    return code, out.getvalue(), err.getvalue()
class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return io.BytesIO(json.dumps(self.payload).encode())
    def __exit__(self, *exc):
        return False
def patched(case, **overrides):
    values = {
        "config": mock.Mock(return_value=("https://example.test", "key", "http://ai.test")),
        "check_ai_service": mock.Mock(),
        "fetch_items": mock.Mock(return_value=[row("BS-0139")]),
        "build_new_vector": mock.Mock(return_value=(UNIT, "text", True)),
        "patch_item": mock.Mock(return_value=1),
        "write_backup": mock.Mock(return_value=Path("backup.json")),
    }
    values.update(overrides)
    for name, value in values.items():
        patch = mock.patch.object(b, name, value)
        patch.start()
        case.addCleanup(patch.stop)
    return values

class VectorTests(unittest.TestCase):
    def test_vector_math_and_public_text(self):
        self.assertEqual(b.parse_vector("[1, 2, 3]"), [1.0, 2.0, 3.0])
        self.assertAlmostEqual(b.norm(b.unit(vector())), 1.0)
        combined = b.combine([3.0, 0.0], [0.0, 4.0])
        self.assertAlmostEqual(combined[0], math.sqrt(0.5))
        self.assertAlmostEqual(b.cosine(vector(), vector()), 1.0)
        self.assertEqual(b.public_text({**row("BS-0139"), "description": "x"}), "Strawberry Other")
    def test_backup_roundtrip_and_path_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "backup.json"
            self.assertEqual(b.ensure_outside_repo(target), target.resolve())
            saved = b.write_backup(target, [row("BS-0139")], {"BS-0139": UNIT})
            item = json.loads(saved.read_text(encoding="utf-8"))["items"][0]
            self.assertEqual(item["ref_code"], "BS-0139")
            self.assertEqual(len(item["old_embedding"]), b.DIM)
        with self.assertRaises(SystemExit):
            b.ensure_outside_repo(b.ROOT / "backup.json")
    def test_apply_without_ref_code_or_yes_is_refused(self):
        with mock.patch.object(b, "patch_item") as patch:
            self.assertEqual(run(["--apply", "--yes"])[0], 2)
            self.assertEqual(run(["--apply", "--ref-code", "BS-0139"])[0], 2)
        patch.assert_not_called()

class FetchTests(unittest.TestCase):
    def test_fetch_pages_and_forwards_ref_codes(self):
        pages = [FakeResponse([row("A"), row("B")]), FakeResponse([row("C")])]
        with mock.patch.object(b, "PAGE_SIZE", 2), mock.patch.object(
            b.urllib.request, "urlopen", side_effect=pages
        ) as open_:
            rows = b.fetch_items("https://example.test", "key", ["A", "C"])
        self.assertEqual([item["ref_code"] for item in rows], ["A", "B", "C"])
        self.assertEqual(open_.call_count, 2)
        urls = [call.args[0].full_url for call in open_.call_args_list]
        self.assertIn("ref_code=in.(A%2CC)", urls[0])
        self.assertIn("offset=0", urls[0])
        self.assertIn("offset=2", urls[1])

class BuildVectorTests(unittest.TestCase):
    def test_text_is_truncated_to_1000_chars_and_expanded(self):
        with mock.patch.object(b, "post_form", return_value={"vector": vector()}) as post:
            _, text, had_photo = b.build_new_vector("http://ai.test", {"title": "x" * 1500})
        self.assertEqual(len(text), b.MAX_EMBED_TEXT_LENGTH)
        self.assertFalse(had_photo)
        post.assert_called_once_with(
            "http://ai.test/embed/text", {"text": "x" * 1000, "expand": "true"}
        )
    def test_photo_failure_fails_row_unless_text_only_is_allowed(self):
        with mock.patch.object(b, "post_form", return_value={"vector": vector()}), \
                mock.patch.object(b.urllib.request, "urlopen",
                                   side_effect=urllib.error.URLError("down")):
            with self.assertRaises(RuntimeError):
                b.build_new_vector("http://ai.test", row("BS-0139"))
            with contextlib.redirect_stdout(io.StringIO()):
                _, _, had_photo = b.build_new_vector(
                    "http://ai.test", row("BS-0139"), allow_text_only=True
                )
        self.assertFalse(had_photo)

class MainTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row("BS-0139")]
        self.values = patched(self)
    def test_dry_run_writes_nothing_and_forwards_ref_codes(self):
        self.values["fetch_items"].return_value = [row("BS-0139"), row("BS-0132")]
        code, _, _ = run(["--ref-code", "BS-0139", "--ref-code", "BS-0132"])
        self.assertEqual(code, 0)
        self.values["fetch_items"].assert_called_once_with(
            "https://example.test", "key", ["BS-0139", "BS-0132"]
        )
        self.values["patch_item"].assert_not_called()
        self.values["write_backup"].assert_not_called()
    def test_apply_backs_up_before_patching(self):
        order = mock.Mock()
        order.attach_mock(self.values["write_backup"], "write_backup")
        order.attach_mock(self.values["patch_item"], "patch_item")
        code, _, _ = run(["--apply", "--ref-code", "BS-0139", "--yes"])
        self.assertEqual(code, 0)
        self.assertEqual([call[0] for call in order.mock_calls],
                         ["write_backup", "patch_item"])
    def test_timeout_and_json_errors_fail_the_row_without_crashing(self):
        for error in (TimeoutError("slow"), json.JSONDecodeError("bad", "{", 0)):
            with self.subTest(error=type(error).__name__):
                values = patched(self, build_new_vector=mock.Mock(side_effect=error))
                code, _, err = run(["--apply", "--ref-code", "BS-0139", "--yes"])
                self.assertEqual(code, 1)
                self.assertIn("FAILED", err)
                values["patch_item"].assert_not_called()
    def test_missing_ref_code_and_zero_row_patch_are_reported(self):
        self.values["fetch_items"].return_value = []
        code, _, err = run(["--ref-code", "NOPE"])
        self.assertEqual(code, 1)
        self.assertIn("no rows matched ref code(s): NOPE", err)
        self.values["patch_item"].return_value = 0
        self.values["fetch_items"].return_value = self.rows
        code, _, err = run(["--apply", "--ref-code", "BS-0139", "--yes"])
        self.assertEqual(code, 1)
        self.assertIn("write affected 0 rows", err)

if __name__ == "__main__":
    unittest.main()
