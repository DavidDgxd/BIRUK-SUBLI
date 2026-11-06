import sys
import types
import unittest
from unittest import mock

# main.py loads the CLIP sentence-transformer while importing. Stub the heavy
# model modules (as test_caption_truncation.py does) so no model is loaded.
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


class EmbedTextTranslationTests(unittest.TestCase):
    def setUp(self):
        self.model = FakeModel()
        model_patch = mock.patch.object(main, "model", self.model)
        model_patch.start()
        self.addCleanup(model_patch.stop)
        self.client = TestClient(main.app)

    def _translate_returns(self, **kwargs):
        patch = mock.patch.object(main, "translate_to_english", **kwargs)
        self.addCleanup(patch.stop)
        return patch.start()

    def test_a_filipino_query_embeds_its_translation(self):
        self._translate_returns(return_value="black purse")

        response = self.client.post("/embed/text", data={"text": "itim na pitaka"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translated_text"], "black purse")
        self.assertEqual(self.model.encoded, ["black purse"])

    def test_a_provider_failure_falls_back_to_the_original_query(self):
        self._translate_returns(side_effect=RuntimeError("model unavailable"))

        response = self.client.post("/embed/text", data={"text": "itim na pitaka"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["translated_text"])
        self.assertEqual(len(body["vector"]), 512)
        self.assertEqual(self.model.encoded, ["itim na pitaka"])

    def test_translate_false_embeds_the_words_as_typed(self):
        translate = self._translate_returns(return_value="black purse")

        response = self.client.post(
            "/embed/text", data={"text": "itim na pitaka", "translate": "false"}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["translated_text"])
        self.assertEqual(len(body["vector"]), 512)
        self.assertEqual(body["dim"], 512)
        translate.assert_not_called()
        self.assertEqual(self.model.encoded, ["itim na pitaka"])


if __name__ == "__main__":
    unittest.main()
