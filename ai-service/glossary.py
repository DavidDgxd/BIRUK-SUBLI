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

import re

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


def _tokens(text):
    return [token for token in _NON_WORD.split((text or "").casefold()) if token]


def _stems(token):
    """Yields the token and any linker-stripped stem that is in the glossary."""
    yield token
    if len(token) > 4 and token.endswith("ng"):
        stem = token[:-2]
        if stem in _GLOSSARY:
            yield stem
    if (
        len(token) > 3
        and token.endswith("g")
        and token[-2] == "n"
    ):
        stem = token[:-1]
        if stem in _GLOSSARY:
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

    present = set(tokens)
    additions = []
    for token in tokens:
        for stem in _stems(token):
            synonyms = _GLOSSARY.get(stem) or ()
            for synonym in synonyms:
                if synonym in present or synonym in additions:
                    continue
                additions.append(synonym)

    if not additions:
        return original, []
    return f"{original} {' '.join(additions)}", additions
