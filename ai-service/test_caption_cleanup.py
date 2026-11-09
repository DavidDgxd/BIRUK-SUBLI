import unittest

from caption_cleanup import CAPTION_MAX_CHARS, clean_caption


class MidWordCutTests(unittest.TestCase):
    def test_incomplete_tail_is_dropped_instead_of_returning_half_a_word(self):
        self.assertIsNone(clean_caption("a box of cus", incomplete_tail=True))

    def test_long_caption_is_cut_at_a_word_boundary(self):
        raw = "a green handbag sitting on top of a table with a notebook and " + (
            "pen " * 100
        )
        cleaned = clean_caption(raw, max_chars=60)

        self.assertIsNotNone(cleaned)
        self.assertLessEqual(len(cleaned), 60)
        self.assertTrue(
            all(word in raw.split() for word in cleaned.split()),
            f"cleaned caption split a word: {cleaned!r}",
        )

    def test_a_complete_sentence_is_preferred_over_a_mid_sentence_cut(self):
        raw = (
            "A black leather wallet with a torn lining and several cards inside. "
            + ("Extra details " * 50)
        )
        self.assertEqual(
            clean_caption(raw, max_chars=100),
            "A black leather wallet with a torn lining and several cards inside.",
        )


class RepetitionTests(unittest.TestCase):
    def test_repetition_loop_becomes_nothing_usable(self):
        raw = ("watermelon " * 20) + "watermelonmelonmelon"
        self.assertIsNone(clean_caption(raw))

    def test_repeated_words_are_collapsed(self):
        self.assertEqual(
            clean_caption("a bowl of sour sour cream"),
            "a bowl of sour cream",
        )

    def test_repeated_word_suffixes_are_collapsed(self):
        self.assertEqual(
            clean_caption("a watermelonmelonmelon on a table"),
            "a watermelon on a table",
        )

    def test_repeated_phrases_are_collapsed(self):
        self.assertEqual(
            clean_caption("umbrella rain umbrella rain umbrella rain"),
            "umbrella rain",
        )

    def test_a_single_word_repeated_across_most_tokens_is_rejected(self):
        self.assertIsNone(
            clean_caption("umbrella umbrella umbrella umbrella umbrella")
        )


class NormalCaptionTests(unittest.TestCase):
    def test_normal_captions_pass_through_unchanged(self):
        captions = [
            "a green handbag sitting on top of a table",
            "two water bottles sitting on top of a table",
            "a watermelon laying on the ground surrounded by leaves",
            "a brown leather wallet on a table.",
        ]

        for caption in captions:
            with self.subTest(caption=caption):
                self.assertEqual(clean_caption(caption), caption)

    def test_empty_and_too_short_results_are_rejected(self):
        self.assertIsNone(clean_caption(""))
        self.assertIsNone(clean_caption("   "))
        self.assertIsNone(clean_caption("wallet"))
        self.assertIsNone(clean_caption("a box of"))

    def test_spacing_around_punctuation_is_tidied(self):
        self.assertEqual(
            clean_caption("nokia ' s new flagship smartphones"),
            "nokia's new flagship smartphones",
        )

    def test_caption_never_exceeds_the_character_cap(self):
        raw = " ".join(f"item{index}" for index in range(200))
        cleaned = clean_caption(raw)

        self.assertIsNotNone(cleaned)
        self.assertLessEqual(len(cleaned), CAPTION_MAX_CHARS)


class IdentifierTests(unittest.TestCase):
    def test_card_numbers_are_removed(self):
        cleaned = clean_caption("a card with number 4111 1111 1111 1111")

        self.assertEqual(cleaned, "a card with number")
        self.assertNotRegex(cleaned, r"\d")

    def test_mixed_reference_codes_are_removed(self):
        self.assertEqual(
            clean_caption("a black id card ABC12345"),
            "a black id card",
        )

    def test_short_model_numbers_are_kept(self):
        caption = "the back of an iphone 11"

        self.assertEqual(clean_caption(caption), caption)

    def test_a_caption_that_is_only_a_number_is_rejected(self):
        self.assertIsNone(clean_caption("4111 1111 1111 1111"))


if __name__ == "__main__":
    unittest.main()
