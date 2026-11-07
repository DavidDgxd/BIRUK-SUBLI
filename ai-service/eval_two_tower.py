#!/usr/bin/env python3
"""Read-only evaluation for the two-tower public search.

Fetches held items through PostgREST, embeds each labelled query with the small
English retrieval tower (plus the glossary expansion), and calls
match_items_two_tower exactly like the web client. Reports Recall@1, Recall@5,
MRR and the false-confident count for the "none" queries. Never writes and
never prints secrets.

Run with the ai-service venv:

    ai-service/venv/bin/python ai-service/eval_two_tower.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glossary import expand_query  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "ai-service" / ".env"
TEXT_MODEL = os.environ.get("TEXT_MODEL", "BAAI/bge-small-en-v1.5")
TIMEOUT = 120

# Hand labels over the held inventory. "" means the query should not produce a
# confident result. Re-run whenever the inventory changes.
LABELS = {
    "wallet": ["BS-0109", "BS-0130", "BS-0131"],
    "pitaka": ["BS-0109", "BS-0130", "BS-0131"],
    "ring": ["BS-0149"],
    "singsing": ["BS-0149"],
    "backpack": ["BS-0129", "BS-0141"],
    "fan": ["BS-0108", "BS-0137", "BS-0138"],
    "bentilador": ["BS-0108", "BS-0137", "BS-0138"],
    "mask": ["BS-0143"],
    "keyboard": ["BS-0145"],
    "telepono": ["BS-0140"],
    "bote": ["BS-0134"],
    "kamiseta": ["BS-0148"],
    "charger": ["BS-0135"],
    "bottle": ["BS-0134"],
    "headphones": ["BS-0110", "BS-0155"],
    "umbrella": [],
    "keys": [],
    "watch": [],
    "sunglasses": [],
    "laptop": [],
    "earbuds": [],
    "sapatos": [],
    "susi": [],
    "relo": [],
    "salamin": [],
    "payong": [],
}

BEST_FLOOR = 0.72
POSSIBLE_FLOOR = 0.55
LEXICAL_CONFIDENCE = 0.5
TEXT_STRONG_FLOOR = 0.75


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


def rpc(base: str, key: str, payload: dict) -> list[dict]:
    request = urllib.request.Request(
        f"{base}/rest/v1/rpc/match_items_two_tower",
        data=json.dumps(payload).encode(),
        headers=headers(key),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def is_confident(row: dict) -> bool:
    if row["score"] < BEST_FLOOR:
        return False
    if row["lexical_score"] >= LEXICAL_CONFIDENCE:
        return True
    return row["text_similarity"] >= TEXT_STRONG_FLOOR


def main() -> None:
    load_env()
    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    print(f"Loading text model {TEXT_MODEL}...")
    model = SentenceTransformer(TEXT_MODEL, device="cpu")

    hits_at_1 = hits_at_5 = 0
    reciprocal = 0.0
    false_confident = 0
    negative_count = 0

    for query, expected in LABELS.items():
        expanded, additions = expand_query(query)
        vector = model.encode(expanded, normalize_embeddings=True).tolist()
        rows = rpc(
            base,
            key,
            {
                "query_text_embedding": vector,
                "query_text": expanded,
                "match_threshold": 0.30,
                "match_count": 10,
            },
        )
        ranked = [row for row in rows if row["score"] >= POSSIBLE_FLOOR]
        refs = [row["ref_code"] for row in ranked]
        top = ranked[0] if ranked else None

        if expected:
            if refs and refs[0] in expected:
                hits_at_1 += 1
            if any(ref in expected for ref in refs[:5]):
                hits_at_5 += 1
            for position, ref in enumerate(refs[:5], start=1):
                if ref in expected:
                    reciprocal += 1 / position
                    break
        else:
            negative_count += 1
            if any(is_confident(row) for row in ranked):
                false_confident += 1

        preview = " | ".join(
            f"{row['ref_code']}:{row['score']:.2f}(l{row['lexical_score']:.1f})"
            for row in ranked[:3]
        )
        print(f"{query:14s} +{additions} -> {preview or '(none)'}")

    positives = sum(1 for expected in LABELS.values() if expected)
    print("\n=== SUMMARY ===")
    print(f"positives: {positives}")
    print(f"Recall@1: {hits_at_1 / positives:.3f}")
    print(f"Recall@5: {hits_at_5 / positives:.3f}")
    print(f"MRR:      {reciprocal / positives:.3f}")
    print(f"false-confident negatives: {false_confident}/{negative_count}")


if __name__ == "__main__":
    main()
