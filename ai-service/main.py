from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from PIL import Image
import io
import os

app = FastAPI(title="Biruk Subli CLIP Service")

# CLIP ViT-B-32 encodes text and images into the same 512-dim space. The
# dimension is a hard contract with web/src/lib/aiService.js (EMBEDDING_DIM) and
# with items.embedding in the database, so it is asserted before every response.
EMBEDDING_DIM = 512
MODEL_NAME = os.environ.get("CLIP_MODEL", "clip-ViT-B-32")

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


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "dim": EMBEDDING_DIM}


@app.post("/embed/text")
async def embed_text(text: str = Form(...)):
    """Encodes a typed search query into a 512-dim vector.

    Accepts free-form natural language — English or Filipino, a phrase or a
    sentence. The caller does not need to know the item categories or tags.
    """
    cleaned = clean_query_text(text)
    try:
        vector = encode(cleaned)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Could not embed that description: {error}",
        ) from error
    return {"vector": vector, "dim": EMBEDDING_DIM}


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
