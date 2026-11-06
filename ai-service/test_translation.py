import importlib
import os
import unittest
from unittest import mock

import translation
from translation import (
    is_material_translation,
    looks_filipino,
    normalise,
    translate_to_english,
)

# Regression table from the PR #79 review. Each English query was rewritten
# into unrelated text by opus-mt-tl-en; each Filipino one was missed by the
# old similarity gate. Model outputs are real ones from that review.
ENGLISH_QUERIES = [
    "ring",
    "lost ring",
    "charger",
    "tumbler",
    "eyeglasses",
    "Nike shoes size 9",
    "iPhone 13 with cracked screen",
    "umbrella left in jeep",
    "black wallet",
    "bag",
    "shoes",
    # English words that look like Tagalog stems plus a linker.
    "sing",
    "sang",
    "nag",
    "sag",
    # English words and names deliberately left off the list.
    "May 3 at SM",
    "tabi socks",
    "polo shirt",
    "Kay's wallet",
]

FILIPINO_TRANSLATIONS = [
    ("sapatos", "shoes"),
    ("tsinelas", "slippers"),
    ("singsing", "ring"),
    ("pantalon", "pants"),
    ("rosaryo", "rosaries"),
    ("pitaka", "wallet"),
    ("itim na pitaka", "Black purse"),
    ("susi ng kotse", "car key"),
    ("pulang payong", "red umbrella"),
    ("cellphone na may itim na case", "Black - case mobile phone"),
    ("black wallet na may ID", "black wallet with ID"),
    # Second review on #79: missed by the first version of the list.
    ("bote", "bottle"),
    ("bentilador", "fan"),
    ("telepono", "phone"),
    ("kutsara", "spoon"),
    ("plantsa", "iron"),
]

# Documented trade-off: short words that are both Tagalog and English or a
# name. These ARE sent to the model; the test pins the behaviour so a change
# to it is deliberate.
ACCEPTED_COLLISIONS = ["Bago City", "Si unit", "KO punch", "Plato"]


class LanguageGateTests(unittest.TestCase):
    def test_english_queries_are_not_filipino(self):
        for query in ENGLISH_QUERIES:
            with self.subTest(query=query):
                self.assertFalse(looks_filipino(query))

    def test_english_queries_never_reach_the_provider(self):
        with mock.patch.object(translation, "_provider_translate") as provider:
            for query in ENGLISH_QUERIES:
                with self.subTest(query=query):
                    self.assertIsNone(translate_to_english(query))
        provider.assert_not_called()

    def test_filipino_queries_are_translated(self):
        for query, output in FILIPINO_TRANSLATIONS:
            with (
                self.subTest(query=query),
                mock.patch.object(
                    translation, "_provider_translate", return_value=output
                ),
            ):
                self.assertEqual(translate_to_english(query), output)

    def test_accepted_collisions_are_treated_as_filipino(self):
        for query in ACCEPTED_COLLISIONS:
            with self.subTest(query=query):
                self.assertTrue(looks_filipino(query))

    def test_linker_suffixes_are_recognised(self):
        self.assertTrue(looks_filipino("bagong sapatos"))
        self.assertTrue(looks_filipino("malaking bag"))


class EchoTests(unittest.TestCase):
    def test_identical_output_is_not_a_translation(self):
        self.assertFalse(is_material_translation("itim", "itim"))

    def test_case_and_punctuation_differences_alone_are_not_a_translation(self):
        self.assertFalse(is_material_translation("Itim na bag", "itim na bag."))

    def test_whitespace_differences_alone_are_not_a_translation(self):
        self.assertFalse(is_material_translation("itim  na bag ", "itim na bag"))

    def test_an_echo_from_the_provider_returns_none(self):
        with mock.patch.object(
            translation, "_provider_translate", return_value="Itim na bag."
        ):
            self.assertIsNone(translate_to_english("itim na bag"))


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
