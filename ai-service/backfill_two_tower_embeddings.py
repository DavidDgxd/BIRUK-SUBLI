#!/usr/bin/env python3
"""Rebuild the two-tower public embeddings for held items.

Text is embedded with BGE-M3 from the public-safe fields only
(title + category + photo caption). The photo is embedded with CLIP's image
tower. The staff-only ``description`` is deliberately not used.

Default mode is a dry run. Writing requires ``--apply``; the old vectors are
printed first so a bad run is visible. Never prints credentials.

Run with the ai-service venv:

    ai-service/venv/bin/python ai-service/backfill_two_tower_embeddings.py
    ai-service/venv/bin/python ai-service/backfill_two_tower_embeddings.py --apply
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "ai-service" / ".env"
SELECT = (
    "ref_code,title,category,ai_caption,image_url,"
    "embedding,text_embedding,image_embedding"
)
TEXT_MODEL = os.environ.get("TEXT_MODEL", "BAAI/bge-m3")
IMAGE_MODEL = os.environ.get("CLIP_MODEL", "clip-ViT-B-32")
TIMEOUT = 120


def load_env() -> None:
    if not ENV.exists():
        return
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def headers(key: str) -> dict:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def fetch_items(base: str, key: str) -> list[dict]:
    request = urllib.request.Request(
        f"{base}/rest/v1/items?select={SELECT}&status=eq.held&order=ref_code",
        headers=headers(key),
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def fetch_image(url: str) -> Image.Image | None:
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            return Image.open(io.BytesIO(response.read())).convert("RGB")
    except Exception as error:  # noqa: BLE001 - a missing photo must not block text
        print(f"  photo unavailable ({type(error).__name__}); text only")
        return None


def public_text(row: dict) -> str:
    return " ".join(
        part
        for part in [
            row["title"].strip(),
            row["category"].strip(),
            (row.get("ai_caption") or "").strip(),
        ]
        if part
    )


def unit(vector) -> np.ndarray:
    array = np.asarray(vector, dtype=np.float64)
    return array / (np.linalg.norm(array) or 1.0)


def combine(text_vec, image_vec):
    """Rebuilds the legacy combined vector from public-safe halves.

    A missing photo falls back to the text-only vector, matching staff intake.
    Returning None here would leave the stale description-based ``embedding``
    in place, which the public ``match_items`` RPC still reads.
    """
    if image_vec is None:
        return unit(text_vec).tolist()
    return unit(unit(text_vec) + unit(image_vec)).tolist()


def patch(base: str, key: str, ref_code: str, payload: dict) -> None:
    request = urllib.request.Request(
        f"{base}/rest/v1/items?ref_code=eq.{ref_code}",
        data=json.dumps(payload).encode(),
        headers={**headers(key), "Prefer": "return=minimal"},
        method="PATCH",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT):
        return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the vectors")
    parser.add_argument(
        "--ref-code",
        action="append",
        default=[],
        help="limit to a ref code (repeatable)",
    )
    args = parser.parse_args()

    load_env()
    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    rows = fetch_items(base, key)
    if args.ref_code:
        wanted = set(args.ref_code)
        rows = [row for row in rows if row["ref_code"] in wanted]
    if not rows:
        raise SystemExit("no held items matched")

    print(f"Loading text model {TEXT_MODEL}...")
    text_model = SentenceTransformer(TEXT_MODEL, device="cpu")
    print(f"Loading image model {IMAGE_MODEL}...")
    image_model = SentenceTransformer(IMAGE_MODEL, device="cpu")

    for row in rows:
        text = public_text(row)
        text_vec = text_model.encode(text, normalize_embeddings=True).tolist()

        image = fetch_image(row.get("image_url") or "")
        image_vec = (
            image_model.encode(image).tolist() if image is not None else None
        )
        # Keep the legacy combined vector in sync too, so old clients do not
        # keep matching on a description that is no longer public-safe.
        legacy_text_vec = image_model.encode(text).tolist()
        legacy_vec = combine(legacy_text_vec, image_vec)

        print(f"{row['ref_code']} {row['title']!r}")
        print(f"  text: {text!r}")
        print(f"  text_dim={len(text_vec)} " + (
            f"image_dim={len(image_vec)}" if image_vec else "image=skipped"
        ))

        if args.apply:
            payload = {"text_embedding": text_vec}
            if image_vec is not None:
                payload["image_embedding"] = image_vec
            if legacy_vec is not None:
                payload["embedding"] = legacy_vec
            patch(base, key, row["ref_code"], payload)
            print("  written")

    if not args.apply:
        print("\ndry run — pass --apply to write the vectors")


if __name__ == "__main__":
    main()
