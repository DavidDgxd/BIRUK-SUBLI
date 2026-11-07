import unittest

from glossary import expand_query


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


if __name__ == "__main__":
    unittest.main()
