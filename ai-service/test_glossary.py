import os
import unittest
from unittest import mock

os.environ.setdefault("SEARCH_SYNONYMS_DISABLED", "1")

import glossary  # noqa: E402
from glossary import expand_query  # noqa: E402


class ExpandQueryTests(unittest.TestCase):
    def test_filipino_nouns_gain_english_synonyms(self):
        expanded, additions = expand_query("pitaka")

        self.assertEqual(expanded, "pitaka wallet purse")
        self.assertEqual(additions, ["wallet", "purse"])

    def test_the_original_words_are_always_kept(self):
        expanded, _ = expand_query("itim na pitaka")

        self.assertTrue(expanded.startswith("itim na pitaka"))

    def test_english_queries_are_not_rewritten(self):
        expanded, additions = expand_query("sunglasses")

        self.assertEqual(expanded, "sunglasses")
        self.assertEqual(additions, [])

    def test_english_queries_are_left_alone(self):
        expanded, additions = expand_query("black wallet")

        self.assertEqual(expanded, "black wallet")
        self.assertEqual(additions, [])

    def test_linker_forms_are_recognised(self):
        expanded, additions = expand_query("pulang payong")

        self.assertTrue(expanded.startswith("pulang payong"))
        self.assertIn("red", additions)
        self.assertIn("umbrella", additions)

    def test_the_g_suffix_follows_n(self):
        _, additions = expand_query("luntiang bag")

        self.assertIn("green", additions)

    def test_duplicate_synonyms_are_added_once(self):
        _, additions = expand_query("pitaka at wallet")

        self.assertEqual(additions, ["purse"])

    def test_unknown_words_do_not_expand(self):
        expanded, additions = expand_query("handler ng pinto")

        self.assertEqual(expanded, "handler ng pinto")
        self.assertEqual(additions, [])

    def test_blank_input_stays_blank(self):
        self.assertEqual(expand_query("   "), ("", []))

    def test_a_mixed_query_expands_only_known_tokens(self):
        expanded, additions = expand_query("itim na pitaka na may ID")

        self.assertTrue(expanded.startswith("itim na pitaka na may ID"))
        self.assertIn("wallet", additions)
        self.assertIn("black", additions)
        self.assertNotIn("ID", additions)


class SynonymTableTests(unittest.TestCase):
    def setUp(self):
        self._reset_cache()
        self.addCleanup(self._reset_cache)

    @staticmethod
    def _reset_cache():
        glossary._db_synonyms = None
        glossary._db_cached_at = 0.0
        glossary._db_loaded = False

    def test_a_database_row_overrides_the_builtin_entry(self):
        with mock.patch.object(
            glossary,
            "_fetch_db_synonyms",
            return_value={"pitaka": ("billfold",)},
        ):
            _, additions = expand_query("pitaka")

        self.assertEqual(additions, ["billfold"])

    def test_a_readable_table_is_authoritative_even_when_empty(self):
        with mock.patch.object(
            glossary, "_fetch_db_synonyms", return_value={}
        ):
            _, additions = expand_query("pitaka")

        self.assertEqual(additions, [])

    def test_an_unreachable_table_keeps_the_builtin_entries(self):
        with mock.patch.object(
            glossary, "_fetch_db_synonyms", return_value=None
        ):
            _, additions = expand_query("pitaka")

        self.assertEqual(additions, ["wallet", "purse"])


if __name__ == "__main__":
    unittest.main()
