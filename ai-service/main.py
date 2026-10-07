import io
import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from PIL import Image
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client



app = FastAPI(title="Biruk Subli CLIP Service")

# Allow requests from React dev server (localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://vwegcexuyznfsbgzurxa.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZWdjZXh1eXpuZnNiZ3p1cnhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDc1NzAwMiwiZXhwIjoyMTA2MzMzMDAyfQ.W0HmwsnBOv35_wB-2xUUbaRShxP_kwWVVvKEQbYsFEk")

# Initialize the Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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


# US-01: Provision and Office Login
# Pydantic schema for the request
class CreateOfficeRequest(BaseModel):
    office_name: str
    email: EmailStr
    password: str

# US-1: Central Admin Provisioning Endpoint
@app.post("/admin/create-office")
def create_office(data: CreateOfficeRequest):
    try:
        # 1. Create account in Supabase Auth
        auth_user = supabase.auth.admin.create_user({
            "email": data.email,
            "password": data.password,
            "email_confirm": True,
            "user_metadata": {
                "role": "office",
                "office_name": data.office_name
            }
        })

        # 2. Add record to 'offices' table
        office_record = supabase.table("offices").insert({
            "user_id": auth_user.user.id,
            "office_name": data.office_name,
            "email": data.email
        }).execute()

        return {
            "status": "success",
            "message": f"Account for '{data.office_name}' created successfully!",
            "data": office_record.data
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))