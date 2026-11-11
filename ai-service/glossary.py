"""Bilingual query expansion for public search.

Search used to translate a Filipino query to English with a language gate and
opus-mt (US-22). That stack had two failure modes: a word missing from the gate
silently searched the raw Filipino text, and a mistranslation replaced the
query with unrelated English ("payong" -> "advice"). This module takes the
safer route: every known Filipino token appends its English synonyms to the
query, and the original word is always kept.

The difference matters in both directions:

* English queries are never rewritten. A token that is not in the glossary is
  left exactly as typed, so the "charger -> RATION" class of bug cannot happen.
* A missing glossary word only means no expansion - the search still falls
  back to the vector score, which is how the query behaved before US-22.

The expansion is intentionally additive and small. It covers the nouns,
colours and descriptors a lost-and-found counter actually sees; it is not a
general translator. A hosted provider can still be added later for free-form
Filipino sentences, but it is not on the critical path.

Run the unit tests without torch/transformers: this module has no model.
"""

import json
import logging
import os
import re
import threading
import time
import urllib.request
from pathlib import Path

# Grouped by kind so the list stays reviewable. Each value is a tuple of the
# English words that should join the query; the Filipino token is not removed.
_GLOSSARY = {
    # Wallets, bags and what people carry.
    "pitaka": ("wallet", "purse"),
    "bayong": ("bag", "basket"),
    "supot": ("bag", "plastic bag"),
    "maleta": ("suitcase", "luggage"),
    "lalagyan": ("case", "container", "pouch"),
    "sinturon": ("belt",),
    "panyo": ("handkerchief",),
    # Phones, electronics and accessories.
    "telepono": ("phone", "cellphone", "iphone"),
    "selpon": ("phone", "cellphone", "iphone"),
    "bentilador": ("fan", "electric fan"),
    "kuryente": ("power", "electric"),
    "relo": ("watch", "wristwatch"),
    "telebisyon": ("television", "tv"),
    "kompyuter": ("computer", "laptop"),
    # Weather and outdoor items.
    "payong": ("umbrella",),
    "sombrero": ("hat", "cap"),
    # Jewellery.
    "singsing": ("ring",),
    "hikaw": ("earring", "earrings"),
    "pulseras": ("bracelet",),
    "kuwintas": ("necklace",),
    "kwintas": ("necklace",),
    "rosaryo": ("rosary",),
    "ginto": ("gold", "golden"),
    "pilak": ("silver",),
    # Clothing and footwear.
    "kamiseta": ("shirt", "t-shirt"),
    "pantalon": ("pants", "trousers"),
    "palda": ("skirt",),
    "damit": ("clothes", "clothing"),
    "dyaket": ("jacket",),
    "sapatos": ("shoes", "shoe", "sneakers"),
    "tsinelas": ("slippers", "sandals"),
    "medyas": ("socks",),
    "sumbrero": ("hat", "cap"),
    "guwantes": ("gloves",),
    "uniporme": ("uniform",),
    # Bags, school and office items.
    "aklat": ("book",),
    "libro": ("book",),
    "kuwaderno": ("notebook",),
    "kwaderno": ("notebook",),
    "bolpen": ("pen",),
    "lapis": ("pencil",),
    "papel": ("paper",),
    "sulat": ("letter", "note"),
    # Food, drink and containers.
    "bote": ("bottle",),
    "tubig": ("water",),
    "tubigan": ("water bottle",),
    "baso": ("glass", "cup"),
    "plato": ("plate", "dish"),
    "kutsara": ("spoon",),
    "tinidor": ("fork",),
    "kutsilyo": ("knife",),
    "kaldero": ("pot",),
    "kawali": ("pan", "frying pan"),
    "baunan": ("lunch box", "container"),
    # House and personal items.
    "plantsa": ("iron",),
    "walis": ("broom",),
    "basahan": ("rag", "cloth"),
    "tuwalya": ("towel",),
    "bimpo": ("towel", "washcloth"),
    "kumot": ("blanket",),
    "unan": ("pillow",),
    "suklay": ("comb",),
    "salamin": ("glasses", "eyeglasses", "mirror"),
    "susi": ("keys",),
    "pera": ("money", "cash"),
    "barya": ("coins", "change"),
    "laruan": ("toy",),
    "manika": ("doll",),
    "bola": ("ball",),
    # Colours.
    "itim": ("black",),
    "puti": ("white",),
    "pula": ("red",),
    "asul": ("blue",),
    "bughaw": ("blue",),
    "berde": ("green",),
    "luntian": ("green",),
    "dilaw": ("yellow",),
    "kahel": ("orange",),
    "kayumanggi": ("brown",),
    "lila": ("purple",),
    "rosas": ("pink",),
    # Size and condition.
    "malaki": ("large", "big"),
    "maliit": ("small", "little"),
    "mahaba": ("long",),
    "maikli": ("short",),
    "bago": ("new",),
    "luma": ("old",),
    "sira": ("broken", "damaged"),
    "basag": ("cracked", "broken"),
    # Places people mention in a lost-item report.
    "kotse": ("car",),
    "sasakyan": ("vehicle", "car"),
    "bahay": ("house",),
    "simbahan": ("church",),
    "palengke": ("market",),
    "paaralan": ("school",),
    "eskwela": ("school",),
    "eskwelahan": ("school",),
    "ospital": ("hospital",),
    "parke": ("park",),
}

# Linker forms: "pulang" is pula + ng, "bagong" is bago + ng. The -g suffix
# follows an n ("luntiang" is luntian + g). The stem must be long enough that
# "sing", "sang" and "nag" cannot match.
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)

# The table is optional, but it is authoritative whenever it can be read:
# disabling or deleting a row must stop the term from expanding, so the
# built-in glossary is only a fallback for an unreachable or unconfigured
# database. The table is refreshed at most once a minute.
SYNONYMS_CACHE_SECONDS = 60
SYNONYMS_TIMEOUT_SECONDS = 3
_logger = logging.getLogger(__name__)
_db_synonyms = None
_db_cached_at = 0.0
_db_loaded = False
_db_warned = False
_SYNONYMS_LOCK = threading.Lock()


def _load_env_file() -> None:
    path = Path(__file__).with_name(".env")
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _warn_once(message: str) -> None:
    global _db_warned
    if _db_warned:
        return
    _logger.warning(message)
    _db_warned = True


def _fetch_db_synonyms():
    """Reads the live vocabulary, or returns None when it is unavailable.

    The table is authoritative when it answers: disabled and deleted rows must
    suppress a term instead of falling back to the built-in list. None means
    the caller should keep the built-ins until the next refresh.
    """
    if os.environ.get("SEARCH_SYNONYMS_DISABLED") == "1":
        return None

    _load_env_file()
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    # An anon key is enough: search_synonyms_vocabulary() is a read-only
    # SECURITY DEFINER function, so the service never needs the service role.
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not base or not key:
        _warn_once(
            "Search synonyms are not configured; set SUPABASE_URL and "
            "SUPABASE_ANON_KEY. Using the built-in glossary."
        )
        return None

    request = urllib.request.Request(
        f"{base}/rest/v1/rpc/search_synonyms_vocabulary",
        data=b"{}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=SYNONYMS_TIMEOUT_SECONDS
        ) as response:
            rows = json.load(response)
    except Exception as error:  # noqa: BLE001 - any outage uses the built-in list
        _warn_once(
            "Synonym table unavailable, using the built-in glossary: "
            f"{error!r}"
        )
        return None

    result = {}
    for row in rows:
        term = str(row.get("term") or "").strip().casefold()
        synonyms = row.get("synonyms")
        if not term or not isinstance(synonyms, list):
            continue
        cleaned = tuple(
            dict.fromkeys(
                str(synonym).strip().casefold()
                for synonym in synonyms
                if str(synonym).strip()
            )
        )
        if cleaned:
            result[term] = cleaned
    return result


def _effective_glossary() -> dict:
    global _db_synonyms, _db_cached_at, _db_loaded

    now = time.monotonic()
    if not _db_loaded or now - _db_cached_at > SYNONYMS_CACHE_SECONDS:
        with _SYNONYMS_LOCK:
            now = time.monotonic()
            if not _db_loaded or now - _db_cached_at > SYNONYMS_CACHE_SECONDS:
                _db_synonyms = _fetch_db_synonyms()
                _db_loaded = True
                # Cache failures too, so an outage adds at most one timeout per
                # minute instead of one per search.
                _db_cached_at = now

    if _db_synonyms is not None:
        return dict(_db_synonyms)
    return dict(_GLOSSARY)


def warm_synonyms() -> None:
    """Loads the vocabulary once at startup so search never waits for it."""
    _effective_glossary()


def _tokens(text):
    return [token for token in _NON_WORD.split((text or "").casefold()) if token]


def _stems(token, glossary):
    """Yields the token and any linker-stripped stem in the glossary."""
    yield token
    if len(token) > 4 and token.endswith("ng"):
        stem = token[:-2]
        if stem in glossary:
            yield stem
    if (
        len(token) > 3
        and token.endswith("g")
        and token[-2] == "n"
    ):
        stem = token[:-1]
        if stem in glossary:
            yield stem


def expand_query(text):
    """Returns ``(expanded_text, additions)`` for a typed search query.

    The original query is always the prefix of ``expanded_text``. ``additions``
    is the English vocabulary that was appended, in the order it was found, and
    is what the results page can show to the user. An empty list means the
    query was already understandable, so the caller can embed it unchanged.
    """
    original = (text or "").strip()
    tokens = _tokens(original)
    if not tokens:
        return original, []

    glossary = _effective_glossary()
    present = set(tokens)
    additions = []
    for token in tokens:
        for stem in _stems(token, glossary):
            synonyms = glossary.get(stem) or ()
            for synonym in synonyms:
                if synonym in present or synonym in additions:
                    continue
                additions.append(synonym)

    if not additions:
        return original, []
    return f"{original} {' '.join(additions)}", additions
