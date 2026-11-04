"""Filipino-to-English translation for typed search queries (US-22).

This module is a seam on purpose: the translation provider is expected to
change (the team may move captioning and translation onto one external API).
Callers use only translate_to_english(). Swapping the backend means rewriting
one provider function and setting TRANSLATE_PROVIDER, not editing callers.

When does a query count as Filipino? No language detector is used. Instead
the query is always translated, and the output is kept only when it differs
materially from the input. opus-mt-tl-en passes English through almost
unchanged ("black wallet" -> "Black wallet"), but it also garbles some English
("eyeglasses" -> "hyeglasts", "Nike shoes size 9" -> "Nikes cpaper 9"). So a
plain "did it change" test is not enough. A translation is kept when either:

  * the normalised input and output share little text (similarity below
    SIMILARITY_CEILING). Real Filipino queries measured 0.00-0.31, garbled
    English 0.58-0.97; or
  * the input contains a Tagalog function word ("na", "ng", "sa", ...). This
    catches mixed queries such as "black wallet na may ID" (0.76), whose
    English nouns survive translation.

This adds no dependency, and its null result agrees with the guard that
SearchResults.jsx already applies before showing "Also searching for ...".

Everything above translate_to_english() is pure logic, so the unit tests
import this module without torch or transformers. Those are imported only
inside the local provider's lazy loader.
"""

import os
import re
from difflib import SequenceMatcher
from threading import Lock

TRANSLATE_PROVIDER = os.environ.get("TRANSLATE_PROVIDER", "local")
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL", "Helsinki-NLP/opus-mt-tl-en")
# Long enough for the 1000-character descriptions the report flows send.
TRANSLATE_MAX_NEW_TOKENS = 256

SIMILARITY_CEILING = 0.5

# Common Tagalog words that rarely appear in English item descriptions. "may"
# is left out on purpose because it is also an English word.
_FILIPINO_MARKERS = frozenset(
    {
        "ang",
        "ng",
        "nang",
        "mga",
        "na",
        "sa",
        "ko",
        "aking",
        "yung",
        "kulay",
        "nawala",
        "nawawala",
        "naiwan",
        "nahulog",
    }
)

_NON_WORD = re.compile(r"[^\w\s]|_")


def normalise(text):
    """Casefolds, strips punctuation, and collapses whitespace for comparison."""
    return " ".join(_NON_WORD.sub(" ", (text or "").casefold()).split())


def is_material_translation(original, translated):
    """True when `translated` is a real translation of `original`, not an echo."""
    source = normalise(original)
    target = normalise(translated)
    if not source or not target or source == target:
        return False
    if _FILIPINO_MARKERS.intersection(source.split()):
        return True
    return SequenceMatcher(None, source, target).ratio() < SIMILARITY_CEILING


def translate_to_english(text):
    """Returns the English translation of a Filipino query, or None.

    None means the query is not Filipino (or is blank), so the caller should
    use the original text. Provider failures raise; the caller decides how to
    fall back.
    """
    source = (text or "").strip()
    if not source:
        return None
    translated = (_provider_translate(source) or "").strip()
    return translated if is_material_translation(source, translated) else None


def _provider_translate(text):
    """Dispatches to the configured backend. Each returns raw translated text."""
    if TRANSLATE_PROVIDER == "local":
        return _translate_local(text)
    if TRANSLATE_PROVIDER == "api":
        # Future hosted provider (shared with captioning): implement here only.
        raise NotImplementedError("TRANSLATE_PROVIDER=api is not implemented yet.")
    raise ValueError(f"Unknown TRANSLATE_PROVIDER {TRANSLATE_PROVIDER!r}.")


# --- local provider -----------------------------------------------------------

_translate_tokenizer = None
_translate_model = None
_translate_lock = Lock()


def load_translation_model():
    """Loads the translation model once, on the first translated query."""
    global _translate_tokenizer, _translate_model

    with _translate_lock:
        if _translate_model is None:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            print(f"Loading translation model {TRANSLATE_MODEL}...")
            _translate_tokenizer = AutoTokenizer.from_pretrained(TRANSLATE_MODEL)
            _translate_model = AutoModelForSeq2SeqLM.from_pretrained(TRANSLATE_MODEL)
            _translate_model.eval()
            print("Translation model loaded successfully.")

    return _translate_tokenizer, _translate_model


def _translate_local(text):
    import torch

    tokenizer, translate_model = load_translation_model()
    inputs = tokenizer([text], return_tensors="pt", truncation=True)
    with torch.inference_mode():
        output = translate_model.generate(
            **inputs, max_new_tokens=TRANSLATE_MAX_NEW_TOKENS
        )
    return tokenizer.decode(output[0], skip_special_tokens=True)
