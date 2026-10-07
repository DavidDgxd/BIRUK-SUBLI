import io
import os
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from PIL import Image
from sentence_transformers import SentenceTransformer

app = FastAPI(
    title="Biruk Subli AI Inference Engine",
    description="Stateless CLIP text and image embedding worker",
    version="1.0.0"
)

# Enable CORS for local web client communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load CLIP Model (SentenceTransformers implementation of ViT-B/32)
# Environment variable check without hardcoded credential fallbacks
MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "clip-ViT-B-32")
try:
    model = SentenceTransformer(MODEL_NAME)
except Exception as err:
    raise RuntimeError(f"Failed to load CLIP model '{MODEL_NAME}': {str(err)}")


class TextEmbeddingRequest(BaseModel):
    text: str


class EmbeddingResponse(BaseModel):
    embedding: list[float]
    dimension: int


@app.get("/", include_in_schema=False)
def root():
    """Redirect root traffic directly to interactive Swagger API docs."""
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["Health"])
def health_check():
    """Health check endpoint to confirm AI service status."""
    return {
        "status": "online",
        "service": "ai-service",
        "model": MODEL_NAME
    }


@app.post("/embed/text", response_model=EmbeddingResponse, tags=["Embeddings"])
def embed_text(payload: TextEmbeddingRequest):
    """Generates a 512-dimensional vector embedding for text descriptions."""
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text input cannot be empty.")

    try:
        vector = model.encode(payload.text).tolist()
        return EmbeddingResponse(
            embedding=vector,
            dimension=len(vector)
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Text embedding generation failed: {str(err)}")


@app.post("/embed/image", response_model=EmbeddingResponse, tags=["Embeddings"])
async def embed_image(file: UploadFile = File(...)):
    """Generates a 512-dimensional vector embedding for uploaded item photos."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File uploaded must be a valid image.")

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        vector = model.encode(image).tolist()
        return EmbeddingResponse(
            embedding=vector,
            dimension=len(vector)
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Image processing failed: {str(err)}")