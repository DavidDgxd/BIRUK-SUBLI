"""Post-processing for model-generated photo captions.

BLIP can stop mid-word when it hits the token limit and can fall into repetition
loops on unfamiliar photos. The helpers here keep the suggestion readable, or
drop it entirely when nothing useful is left.
"""

import re
from collections import Counter

CAPTION_MAX_CHARS = 200
CAPTION_MIN_WORDS = 2
CAPTION_MAX_REPEAT_WINDOW = 6
_DEGENERATE_WORD_SHARE = 0.6

# A caption cut after one of these is incomplete even if every word is spelled
# out. Returning no suggestion is safer than showing a broken phrase.
_TRAILING_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "from",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "to",
    "vs",
    "was",
    "with",
}

_CLAUSE_MARKS = ".!?,;:"
_SENTENCE_MARKS = ".!?"

# Captions feed public search, so identifiers read off a photographed card must
# not survive: 4+ digit runs (card, ID, phone numbers) and 6+ character tokens
# mixing letters and digits (reference and serial codes). Short model numbers
# such as "iphone 11" are kept.
_NUMBER_RUN = re.compile(r"\b\d{4,}\b")
_MIXED_CODE = re.compile(
    r"\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}\b"
)


def _strip_identifiers(text):
    """Remove card/ID numbers and long reference codes from a caption."""
    text = _NUMBER_RUN.sub("", text)
    text = _MIXED_CODE.sub("", text)
    return " ".join(text.split())


def _word_key(token):
    """Lowercase letters and digits only, for comparing repeated words."""
    return "".join(character for character in token.lower() if character.isalnum())


def _collapse_word_repeats(token):
    """Collapse a word made from a repeated suffix: watermelonmelon -> watermelon."""
    for unit_length in range(3, len(token) // 2 + 1):
        unit = token[-unit_length:]
        if not any(character.isalpha() for character in unit):
            continue

        end = len(token)
        repeats = 0
        while (
            end >= unit_length
            and token[end - unit_length : end].lower() == unit.lower()
        ):
            repeats += 1
            end -= unit_length

        if repeats >= 2:
            return token[:end] + token[end : end + unit_length]

    return token


def _collapse_repeated_phrases(tokens):
    """Collapse consecutive repeated words or phrases: a a / nokia z2 vs nokia z2 vs."""
    result = []
    index = 0

    while index < len(tokens):
        collapsed = False
        max_window = min(
            CAPTION_MAX_REPEAT_WINDOW,
            (len(tokens) - index) // 2,
        )

        for window in range(max_window, 0, -1):
            block = [_word_key(token) for token in tokens[index : index + window]]
            if not all(block):
                continue

            next_index = index + window
            repeats = 1
            while next_index + window <= len(tokens):
                following = [
                    _word_key(token)
                    for token in tokens[next_index : next_index + window]
                ]
                if following != block:
                    break
                repeats += 1
                next_index += window

            if repeats >= 2:
                result.extend(tokens[index : index + window])
                index = next_index
                collapsed = True
                break

        if not collapsed:
            result.append(tokens[index])
            index += 1

    return result


def _truncate_at_boundary(text, max_chars):
    """Cap text without splitting a word, preferring a complete sentence."""
    if len(text) <= max_chars:
        return text

    prefix = text[:max_chars]
    sentence_end = max(prefix.rfind(mark) for mark in _SENTENCE_MARKS)
    if sentence_end >= max_chars * 0.5:
        return prefix[: sentence_end + 1].rstrip()

    window = text[: max_chars + 1]
    boundary = window.rfind(" ")
    if boundary <= 0:
        return ""

    return window[:boundary].rstrip(" ,;:-")


def _is_degenerate(words):
    if len(words) < CAPTION_MIN_WORDS:
        return True

    most_common = Counter(words).most_common(1)[0][1]
    return most_common / len(words) >= _DEGENERATE_WORD_SHARE


def _drop_incomplete_tail(text):
    """Remove a word that was cut off when generation hit its token limit."""
    clause_end = max(text.rfind(mark) for mark in _CLAUSE_MARKS)
    if clause_end > 0:
        return text[: clause_end + 1]

    tokens = text.split()
    return " ".join(tokens[:-1]) if len(tokens) > 1 else ""


def clean_caption(raw, *, incomplete_tail=False, max_chars=CAPTION_MAX_CHARS):
    """Return a usable caption, or None when the model produced nothing useful."""
    text = " ".join(str(raw or "").split())
    if not text:
        return None

    if incomplete_tail:
        text = _drop_incomplete_tail(text).strip()
        if not text:
            return None

    text = _strip_identifiers(text)
    if not text:
        return None

    tokens = [_collapse_word_repeats(token) for token in text.split()]
    text = " ".join(_collapse_repeated_phrases(tokens))
    text = _truncate_at_boundary(text, max_chars)

    # Tidy the spacing BLIP sometimes leaves around punctuation and apostrophes.
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s*'\s*", "'", text)
    text = text.strip(" \t\r\n,;:-")

    if not text:
        return None

    words = [word for word in (_word_key(token) for token in text.split()) if word]
    if _is_degenerate(words):
        return None
    if _word_key(text.split()[-1]) in _TRAILING_STOPWORDS:
        return None

    return text
