import os
import sys
import types
import unittest
from unittest import mock

os.environ.setdefault("SEARCH_SYNONYMS_DISABLED", "1")

# main.py loads CLIP while importing. Stub the heavy model modules (as
# test_caption_truncation.py does) so no model is loaded.
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

from fastapi.testclient import TestClient

import main


class FakeVector:
    def __init__(self, size):
        self._size = size

    def tolist(self):
        return [0.0] * self._size


class FakeModel:
    def __init__(self, size):
        self.size = size
        self.encoded = []

    def encode(self, payload):
        self.encoded.append(payload)
        return FakeVector(self.size)


class EmbedTextExpansionTests(unittest.TestCase):
    def setUp(self):
        self.clip = FakeModel(main.CLIP_EMBEDDING_DIM)
        self.text = FakeModel(main.TEXT_EMBEDDING_DIM)
        clip_patch = mock.patch.object(main, "model", self.clip)
        clip_patch.start()
        self.addCleanup(clip_patch.stop)
        text_patch = mock.patch.object(main, "load_text_model", return_value=self.text)
        text_patch.start()
        self.addCleanup(text_patch.stop)
        self.client = TestClient(main.app)

    def test_legacy_text_endpoint_stays_at_512(self):
        response = self.client.post(
            "/embed/text", data={"text": "itim na pitaka"}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dim"], main.CLIP_EMBEDDING_DIM)
        self.assertEqual(len(body["vector"]), main.CLIP_EMBEDDING_DIM)
        self.assertIn("wallet", body["additions"])
        self.assertTrue(body["expanded_text"].startswith("itim na pitaka"))
        self.assertEqual(self.clip.encoded, [body["expanded_text"]])

    def test_query_endpoint_uses_the_multilingual_tower(self):
        response = self.client.post(
            "/embed/query", data={"text": "itim na pitaka"}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dim"], main.TEXT_EMBEDDING_DIM)
        self.assertEqual(len(body["vector"]), main.TEXT_EMBEDDING_DIM)
        self.assertIn("black", body["additions"])
        self.assertIn("wallet", body["additions"])
        self.assertIn("purse", body["additions"])
        self.assertTrue(body["expanded_text"].startswith("itim na pitaka"))
        self.assertEqual(self.text.encoded, [body["expanded_text"]])
        self.assertEqual(self.clip.encoded, [])

    def test_item_text_is_embedded_without_expansion(self):
        response = self.client.post(
            "/embed/item-text", data={"text": "Blue Wallet. Bags & Wallets."}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dim"], main.TEXT_EMBEDDING_DIM)
        self.assertEqual(len(body["vector"]), main.TEXT_EMBEDDING_DIM)
        self.assertNotIn("additions", body)
        self.assertEqual(
            self.text.encoded, ["Blue Wallet. Bags & Wallets."]
        )

    def test_english_queries_are_left_alone(self):
        response = self.client.post("/embed/query", data={"text": "black wallet"})

        body = response.json()
        self.assertEqual(body["expanded_text"], "black wallet")
        self.assertEqual(body["additions"], [])

    def test_a_missing_glossary_word_falls_back_to_the_typed_query(self):
        response = self.client.post(
            "/embed/query", data={"text": "handler ng pinto"}
        )

        body = response.json()
        self.assertEqual(body["expanded_text"], "handler ng pinto")
        self.assertEqual(body["additions"], [])
        self.assertEqual(self.text.encoded, ["handler ng pinto"])

    def test_expand_false_embeds_the_words_as_typed(self):
        response = self.client.post(
            "/embed/query",
            data={"text": "itim na pitaka", "expand": "false"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["expanded_text"], "itim na pitaka")
        self.assertEqual(body["additions"], [])
        self.assertEqual(self.text.encoded, ["itim na pitaka"])

    def test_a_blank_query_is_rejected(self):
        response = self.client.post("/embed/query", data={"text": "   "})

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
