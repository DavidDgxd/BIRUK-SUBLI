import sys
import types
import unittest

# main.py loads the CLIP sentence-transformer while importing. Stub the heavy
# model modules so this test only exercises the pure truncation helper.
sys.modules.setdefault(
    "sentence_transformers",
    types.SimpleNamespace(SentenceTransformer=lambda *args, **kwargs: None),
)
sys.modules.setdefault(
    "transformers",
    types.SimpleNamespace(
        BlipForConditionalGeneration=object,
        BlipProcessor=types.SimpleNamespace(from_pretrained=lambda *a, **k: None),
    ),
)

import main  # noqa: E402


class FakeOutput:
    """Mimics the tensor shape main.py reads: output[0].tolist()."""

    def __init__(self, ids):
        self._ids = list(ids)

    def __getitem__(self, index):
        return self

    def tolist(self):
        return list(self._ids)


class FakeTokenizer:
    def __init__(self, eos_token_id=2, token_map=None):
        self.eos_token_id = eos_token_id
        self.all_special_ids = []
        self._token_map = token_map or {}

    def convert_ids_to_tokens(self, token_id):
        return self._token_map.get(token_id, "word")


class CaptionWasTruncatedTests(unittest.TestCase):
    def test_last_token_is_a_subword_fragment(self):
        output = FakeOutput([10, 11, 12])
        tokenizer = FakeTokenizer(token_map={12: "##frag"})
        self.assertTrue(main._caption_was_truncated(output, tokenizer))

    def test_no_eos_and_token_limit_reached(self):
        ids = list(range(main.CAPTION_MAX_NEW_TOKENS))
        output = FakeOutput(ids)
        tokenizer = FakeTokenizer(eos_token_id=9999)
        self.assertTrue(main._caption_was_truncated(output, tokenizer))

    def test_eos_token_present(self):
        output = FakeOutput([10, 11, 2])
        tokenizer = FakeTokenizer(eos_token_id=2)
        self.assertFalse(main._caption_was_truncated(output, tokenizer))

    def test_empty_output(self):
        output = FakeOutput([])
        self.assertFalse(main._caption_was_truncated(output, FakeTokenizer()))

    def test_short_caption_without_eos(self):
        output = FakeOutput([10, 11])
        tokenizer = FakeTokenizer(eos_token_id=9999)
        self.assertFalse(main._caption_was_truncated(output, tokenizer))


if __name__ == "__main__":
    unittest.main()
