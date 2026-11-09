import sys
import types
import unittest
from unittest import mock

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
    def __init__(self):
        self.encoded = []

    def encode(self, payload):
        self.encoded.append(payload)
        return FakeVector(main.EMBEDDING_DIM)


class EmbedTextExpansionTests(unittest.TestCase):
    def setUp(self):
        self.model = FakeModel()
        model_patch = mock.patch.object(main, "model", self.model)
        model_patch.start()
        self.addCleanup(model_patch.stop)
        self.client = TestClient(main.app)

    def test_a_filipino_query_appends_english_synonyms(self):
        response = self.client.post(
            "/embed/text", data={"text": "itim na pitaka"}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dim"], 512)
        self.assertEqual(len(body["vector"]), 512)
        self.assertIn("black", body["additions"])
        self.assertIn("wallet", body["additions"])
        self.assertIn("purse", body["additions"])
        self.assertTrue(body["expanded_text"].startswith("itim na pitaka"))
        self.assertEqual(self.model.encoded, [body["expanded_text"]])

    def test_english_is_never_rewritten(self):
        response = self.client.post(
            "/embed/text", data={"text": "sunglasses"}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["expanded_text"], "sunglasses")
        self.assertEqual(body["additions"], [])
        self.assertEqual(self.model.encoded, ["sunglasses"])

    def test_english_queries_are_left_alone(self):
        response = self.client.post("/embed/text", data={"text": "black wallet"})

        body = response.json()
        self.assertEqual(body["expanded_text"], "black wallet")
        self.assertEqual(body["additions"], [])

    def test_a_missing_glossary_word_falls_back_to_the_typed_query(self):
        response = self.client.post(
            "/embed/text", data={"text": "handler ng pinto"}
        )

        body = response.json()
        self.assertEqual(body["expanded_text"], "handler ng pinto")
        self.assertEqual(body["additions"], [])
        self.assertEqual(self.model.encoded, ["handler ng pinto"])

    def test_expand_false_embeds_the_words_as_typed(self):
        response = self.client.post(
            "/embed/text",
            data={"text": "itim na pitaka", "expand": "false"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["expanded_text"], "itim na pitaka")
        self.assertEqual(body["additions"], [])
        self.assertEqual(self.model.encoded, ["itim na pitaka"])

    def test_a_blank_query_is_rejected(self):
        response = self.client.post("/embed/text", data={"text": "   "})

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
