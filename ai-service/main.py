from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from transformers import BlipForConditionalGeneration, BlipProcessor
from PIL import Image
from threading import Lock
import io
import os
import torch

from caption_cleanup import clean_caption
from translation import translate_to_english, translate_to_filipino

app = FastAPI(title="Biruk Subli CLIP Service")

# CLIP ViT-B-32 encodes text and images into the same 512-dim space. The
# dimension is a hard contract with web/src/lib/aiService.js (EMBEDDING_DIM) and
# with items.embedding in the database, so it is asserted before every response.
EMBEDDING_DIM = 512
MODEL_NAME = os.environ.get("CLIP_MODEL", "clip-ViT-B-32")

# BLIP writes a short natural-language description of a photo. It is loaded on
# the first caption request rather than at startup so the search service does
# not pay for a second model until the staff intake page actually needs it.
CAPTION_MODEL = os.environ.get("CAPTION_MODEL", "Salesforce/blip-image-captioning-base")
# Beam search plus n-gram blocking stops BLIP's repetition loops on unfamiliar
# photos. The token range keeps captions short without making the model stop
# before it has named the object.
CAPTION_MAX_NEW_TOKENS = 32
CAPTION_MIN_NEW_TOKENS = 8
CAPTION_NUM_BEAMS = 4
CAPTION_NO_REPEAT_NGRAM_SIZE = 2
CAPTION_REPETITION_PENALTY = 1.2
CAPTION_LENGTH_PENALTY = 1.2

# Longest text accepted for embedding. The public search box allows 200
# characters, but the report and staff-intake flows caption a photo with several
# fields joined together (title + category + description), which runs longer.
# This is the ceiling that keeps a typed query bounded.
MAX_TEXT_LENGTH = 1000

# Allow any origin: the dev server is reached from localhost and from phones on
# the LAN (http://192.168.x.x:5173), each of which is a distinct origin.
# allow_credentials must stay off — a wildcard origin combined with credentials
# is rejected by browsers, and these embedding calls carry no cookies anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"Loading CLIP {MODEL_NAME} model...")
model = SentenceTransformer(MODEL_NAME, device="cpu")
print("Model loaded successfully.")

_caption_processor = None
_caption_model = None
_caption_lock = Lock()


def load_caption_model():
    """Loads BLIP once, on the first caption request."""
    global _caption_processor, _caption_model

    with _caption_lock:
        if _caption_model is None:
            print(f"Loading caption model {CAPTION_MODEL}...")
            _caption_processor = BlipProcessor.from_pretrained(CAPTION_MODEL)
            _caption_model = BlipForConditionalGeneration.from_pretrained(
                CAPTION_MODEL
            )
            _caption_model.eval()
            print("Caption model loaded successfully.")

    return _caption_processor, _caption_model


def _caption_was_truncated(output, tokenizer):
    """True when generation stopped on the token limit, possibly mid-word."""
    token_ids = output[0].tolist()
    special_ids = set(tokenizer.all_special_ids or [])
    tokens = [
        tokenizer.convert_ids_to_tokens(token_id)
        for token_id in token_ids
        if token_id not in special_ids
    ]
    if not tokens:
        return False

    if tokens[-1].startswith("##"):
        return True

    return (
        tokenizer.eos_token_id not in token_ids
        and len(tokens) >= CAPTION_MAX_NEW_TOKENS
    )


def generate_caption(image):
    """Returns a short, editable description for a PIL image."""
    processor, caption_model = load_caption_model()
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        output = caption_model.generate(
            **inputs,
            max_new_tokens=CAPTION_MAX_NEW_TOKENS,
            min_new_tokens=CAPTION_MIN_NEW_TOKENS,
            num_beams=CAPTION_NUM_BEAMS,
            no_repeat_ngram_size=CAPTION_NO_REPEAT_NGRAM_SIZE,
            repetition_penalty=CAPTION_REPETITION_PENALTY,
            length_penalty=CAPTION_LENGTH_PENALTY,
        )
    text = processor.decode(output[0], skip_special_tokens=True).strip()
    caption = clean_caption(
        text,
        incomplete_tail=_caption_was_truncated(output, processor.tokenizer),
    )
    if caption is None:
        raise ValueError("The caption model returned no usable description.")
    return caption


def encode(payload):
    """Encodes text or a PIL image and returns a plain 512-number list."""
    vector = model.encode(payload).tolist()
    if len(vector) != EMBEDDING_DIM:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{MODEL_NAME} produced a {len(vector)}-dim vector, "
                f"expected {EMBEDDING_DIM}."
            ),
        )
    return vector


def clean_query_text(raw: str) -> str:
    """Validates and normalises a typed query before it is embedded.

    A blank description still encodes to *some* vector, but it carries no
    meaning: every item would score near it and the user would be shown
    arbitrary matches. Reject it instead so the bug surfaces where it starts.
    """
    text = raw.strip()
    if not text:
        raise HTTPException(
            status_code=422,
            detail="Describe the item you are looking for in a few words.",
        )
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Description is too long. Keep it under {MAX_TEXT_LENGTH} characters.",
        )
    return text


def translate_query(text: str):
    """Returns the English translation of a Filipino query, or None.

    A translation outage must never break search, so any provider failure is
    logged and the original query is embedded instead.
    """
    try:
        return translate_to_english(text)
    except Exception as error:  # noqa: BLE001 - any outage falls back to the original
        print(f"Translation unavailable, embedding the original query: {error!r}")
        return None


def translate_caption(caption: str):
    try:
        return translate_to_filipino(caption)
    except Exception as error:  # noqa: BLE001 - keep the English caption
        print(f"Caption translation unavailable: {error!r}")
        return None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "dim": EMBEDDING_DIM,
        "caption_model": CAPTION_MODEL,
    }


@app.post("/embed/text")
def embed_text(text: str = Form(...), translate: bool = Form(True)):
    """Encodes a typed search query into a 512-dim vector.

    Accepts free-form natural language — English or Filipino, a phrase or a
    sentence. The caller does not need to know the item categories or tags.
    A Filipino query is translated to English first (US-22) so it lands in the
    same CLIP space as an English one; translated_text is null otherwise.
    translate=false embeds the words exactly as typed (US-23).

    A plain def, not async: FastAPI then runs it in its threadpool, so loading
    the translation model and running CLIP do not block the event loop.
    """
    cleaned = clean_query_text(text)
    translated = translate_query(cleaned) if translate else None
    try:
        vector = encode(translated or cleaned)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Could not embed that description: {error}",
        ) from error
    return {"vector": vector, "dim": EMBEDDING_DIM, "translated_text": translated}


@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    """Encodes an uploaded photo query or intake photo into a 512-dim vector"""
    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        vector = encode(image)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=f"Could not read that photo: {error}",
        ) from error
    return {"vector": vector, "dim": EMBEDDING_DIM}


@app.post("/caption/image")
@app.post("/caption")
async def caption_image(file: UploadFile = File(...)):
    """Suggests a short description for an uploaded intake photo (US-5).

    The caption is a starting point only: the staffer confirms or edits it
    before the custody record is filed. A model failure must not block intake,
    so it is reported as 503 and the web form falls back to manual entry.
    """
    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=f"Could not read that photo: {error}",
        ) from error

    try:
        caption = generate_caption(image)
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Could not describe that photo: {error}",
        ) from error

    return {"caption": caption, "caption_tl": translate_caption(caption), "model": CAPTION_MODEL}
