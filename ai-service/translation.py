"""Filipino-to-English translation for typed search queries (US-22).

This module is a seam on purpose: the translation provider is expected to
change (the team may move captioning and translation onto one external API).
Callers use only translate_to_english(). Swapping the backend means rewriting
one provider function and setting TRANSLATE_PROVIDER, not editing callers.

When does a query count as Filipino? The decision is made on the INPUT,
before any model runs: a query is Filipino when it contains a word from
_FILIPINO_WORDS, a curated list of Tagalog function words and lost-and-found
vocabulary. English queries never reach the model.

Signals judged on the model's OUTPUT were measured and rejected (PR #79
review). opus-mt-tl-en turns some English into unrelated text ("ring" ->
"It is also", "charger" -> "RATION"), so "the output changed a lot" cannot
tell those apart from real translations ("pitaka" -> "wallet"). Its beam
score overlaps too (English "wallet" -0.06, Filipino "kuwintas" -0.84).
langdetect (2.5 MB) missed most one-word Filipino queries and tagged "ring"
and "bag" as Tagalog; lingua (291 MB) is too heavy for this service.

The list errs towards precision. A false positive rewrites an English query
into the wrong words, while a miss only falls back to embedding the query as
typed, which is how search behaved before this story. Words that are also
English or a name ("may", "at", "pan", "polo", "lapis", "sombrero", "tabi",
"kay", "abo") are left out.

Everything above translate_to_english() is pure logic, so the unit tests
import this module without torch or transformers. Those are imported only
inside the local provider's lazy loader.
"""

import os
import re
from threading import Lock

TRANSLATE_PROVIDER = os.environ.get("TRANSLATE_PROVIDER", "local")
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL", "Helsinki-NLP/opus-mt-tl-en")
# Long enough for the 1000-character descriptions the report flows send.
TRANSLATE_MAX_NEW_TOKENS = 256

# Grouped by kind for review; a list literal would put each word on its own line.
_FILIPINO_WORDS = frozenset(
    """
    ang ng nang mga na sa si ni ko ako aking akin kong niya yung iyong
    ito iyan wala meron mayroon kulay loob ilalim ibabaw
    nawala nawawala naiwan nahulog nakita napulot iniwan hinahanap nawalan
    itim puti pula asul bughaw berde luntian dilaw kahel kayumanggi lila
    rosas ginto pilak malaki maliit bago luma mahaba maikli
    pitaka sapatos tsinelas medyas damit pantalon palda kamiseta dyaket
    sumbrero payong salamin relo singsing hikaw pulseras kuwintas kwintas
    rosaryo susi pera barya lalagyan tubigan baunan aklat libro kuwaderno
    kwaderno bolpen panyo bimpo tuwalya kumot unan maleta bayong supot kahon
    laruan manika guwantes sinturon suklay katad balat tela bakal
    kotse sasakyan bahay simbahan palengke paaralan eskwelahan
    """.split()  # noqa: SIM905
)

_NON_WORD = re.compile(r"[^\w\s]|_")
_VOWELS = "aeiou"


def normalise(text):
    """Casefolds, strips punctuation, and collapses whitespace for comparison."""
    return " ".join(_NON_WORD.sub(" ", (text or "").casefold()).split())


def _is_filipino_word(word):
    if word in _FILIPINO_WORDS:
        return True
    # Linker suffixes: "pulang" is pula + ng, "bagong" is bago + ng. The stem
    # must be 3+ letters, or "sing", "sang", "sag" and "nag" would match.
    if word.endswith("ng") and _is_linker_stem(word[:-2]):
        return True
    return word.endswith("g") and word[-2:-1] in _VOWELS and _is_linker_stem(word[:-1])


def _is_linker_stem(stem):
    return len(stem) >= 3 and stem in _FILIPINO_WORDS


def looks_filipino(text):
    """True when the query contains at least one known Tagalog word."""
    return any(_is_filipino_word(word) for word in normalise(text).split())


def is_material_translation(original, translated):
    """True when `translated` is a real translation of a Filipino `original`."""
    source = normalise(original)
    target = normalise(translated)
    return bool(source and target and source != target and looks_filipino(source))


def translate_to_english(text):
    """Returns the English translation of a Filipino query, or None.

    None means the query is not Filipino (or is blank), so the caller should
    use the original text; the provider is not called in that case. Provider
    failures raise; the caller decides how to fall back.
    """
    source = (text or "").strip()
    if not looks_filipino(source):
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
