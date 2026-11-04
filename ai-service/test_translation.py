import importlib
import os
import unittest
from unittest import mock

import translation
from translation import is_material_translation, normalise, translate_to_english


class EchoTests(unittest.TestCase):
    def test_identical_output_is_not_a_translation(self):
        self.assertFalse(is_material_translation("black wallet", "black wallet"))

    def test_case_and_punctuation_differences_alone_are_not_a_translation(self):
        self.assertFalse(is_material_translation("black wallet", "Black wallet."))
        self.assertFalse(is_material_translation("ID", "I.D"))

    def test_whitespace_differences_alone_are_not_a_translation(self):
        self.assertFalse(is_material_translation("black   wallet ", "black wallet"))

    def test_garbled_english_is_not_a_translation(self):
        # Real opus-mt-tl-en outputs for English queries.
        self.assertFalse(is_material_translation("eyeglasses", "hyeglasts"))
        self.assertFalse(is_material_translation("Nike shoes size 9", "Nikes cpaper 9"))
        self.assertFalse(
            is_material_translation(
                "iPhone 13 with cracked screen", "iPhone 13 wath cracked screen"
            )
        )


class FilipinoTests(unittest.TestCase):
    def test_filipino_queries_are_translations(self):
        self.assertTrue(is_material_translation("itim na pitaka", "Black purse"))
        self.assertTrue(is_material_translation("susi ng kotse", "car key"))
        self.assertTrue(is_material_translation("salamin", "mirror"))

    def test_mixed_query_with_a_tagalog_function_word_is_a_translation(self):
        self.assertTrue(
            is_material_translation("black wallet na may ID", "black wallet with ID")
        )


class BlankInputTests(unittest.TestCase):
    def test_empty_and_whitespace_normalise_to_nothing(self):
        self.assertEqual(normalise(""), "")
        self.assertEqual(normalise("   \t\n"), "")
        self.assertEqual(normalise(None), "")

    def test_blank_input_is_never_a_translation(self):
        self.assertFalse(is_material_translation("", "black wallet"))
        self.assertFalse(is_material_translation("   ", "black wallet"))
        self.assertFalse(is_material_translation("itim na pitaka", "  "))

    def test_blank_input_skips_the_provider(self):
        with mock.patch.object(translation, "_provider_translate") as provider:
            self.assertIsNone(translate_to_english(""))
            self.assertIsNone(translate_to_english("   "))
        provider.assert_not_called()


class EntryPointTests(unittest.TestCase):
    def test_returns_translation_only_when_it_is_material(self):
        with mock.patch.object(
            translation, "_provider_translate", return_value=" Black purse "
        ):
            self.assertEqual(translate_to_english("itim na pitaka"), "Black purse")
        with mock.patch.object(
            translation, "_provider_translate", return_value="Black wallet."
        ):
            self.assertIsNone(translate_to_english("black wallet"))


class ProviderTests(unittest.TestCase):
    def tearDown(self):
        importlib.reload(translation)

    def _reload_with_provider(self, provider):
        with mock.patch.dict(os.environ, {"TRANSLATE_PROVIDER": provider}):
            return importlib.reload(translation)

    def test_api_provider_stub_raises_not_implemented(self):
        module = self._reload_with_provider("api")
        with self.assertRaises(NotImplementedError):
            module.translate_to_english("itim na pitaka")

    def test_unknown_provider_is_rejected(self):
        module = self._reload_with_provider("nope")
        with self.assertRaises(ValueError):
            module.translate_to_english("itim na pitaka")

    def test_importing_does_not_load_a_model(self):
        module = self._reload_with_provider("local")
        self.assertIsNone(module._translate_model)


if __name__ == "__main__":
    unittest.main()
