from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from PIL import Image
import io

app = FastAPI(title="Biruk Subli CLIP Service")

# Allow requests from React dev server (localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading CLIP ViT-B-32 model...")
model = SentenceTransformer("clip-ViT-B-32", device="cpu")
print("Model loaded successfully.")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/embed/text")
async def embed_text(text: str = Form(...)):
    """Encodes a typed search query into a 512-dim vector"""
    vector = model.encode(text).tolist()
    return {"vector": vector}

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    """Encodes an uploaded photo query or intake photo into a 512-dim vector"""
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    vector = model.encode(image).tolist()
    return {"vector": vector}
