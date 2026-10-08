#!/usr/bin/env python3
"""
Seed one found item into Supabase with a real CLIP embedding.

Put this file in ai-service/ and run it while the AI service is running.

Setup (once):
    pip install requests
    Create ai-service/.env with:
        SUPABASE_URL=https://vwegcexuyznfsbgzurxa.supabase.co
        SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZWdjZXh1eXpuZnNiZ3p1cnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NTcwMDIsImV4cCI6MjEwNjMzMzAwMn0.hOCakF0t5PbqUXr_L-wqDRkOwO4CH6c8LIlLXOE8Uhg    # Supabase > Project Settings > API > service_role
        AI_SERVICE_URL=http://localhost:8000    # optional, this is the default

    The service_role key bypasses RLS. Never put it in web/, never commit it.
    Add `ai-service/.env` and `.venv/` to your root .gitignore.

Usage:
    python seed_item.py --seed-offices          # first time only: creates 3 test offices
    python seed_item.py --title "Brown Leather Wallet" \
        --description "Brown leather bifold wallet with a green keychain"
    python seed_item.py --title "Blue Hydro Flask" --description "Blue insulated bottle" \
        --image bottle.jpg --office CITY_HALL_INFO

How the embedding is chosen:
    --image given  -> the photo's CLIP image embedding (what real counter intake will use)
    otherwise      -> the CLIP text embedding of "title. description"
"""
import argparse
import os
import sys
from pathlib import Path

import requests

TIMEOUT = 120  # the first embedding call can be slow while the model warms up

# Placeholder offices for local testing only. Replace the addresses and hours with
# the real counter details before this data is ever shown to the public.
TEST_OFFICES = [
    {"id": "BCPIO", "name": "Baguio City Public Information Office",
     "address": "City Hall, Baguio City (placeholder)", "counter_hours": "Mon-Fri, 8:00 AM - 5:00 PM (placeholder)"},
    {"id": "CITY_HALL_INFO", "name": "City Hall Information Desk",
     "address": "City Hall lobby, Baguio City (placeholder)", "counter_hours": "Mon-Fri, 8:00 AM - 5:00 PM (placeholder)"},
    {"id": "MARKET", "name": "Baguio Market Office",
     "address": "Public Market, Baguio City (placeholder)", "counter_hours": "Daily, 6:00 AM - 6:00 PM (placeholder)"},
]


def load_env_file(path: Path) -> None:
    """Minimal .env reader so no extra dependency is needed. Real env vars win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def check(response: requests.Response, what: str) -> None:
    if not response.ok:
        fail(f"{what} failed ({response.status_code}): {response.text[:500]}")


def embed_text(ai_url: str, text: str) -> list:
    r = requests.post(f"{ai_url}/embed/text", data={"text": text}, timeout=TIMEOUT)
    check(r, "text embedding")
    return r.json()["vector"]


def embed_image(ai_url: str, path: Path) -> list:
    with path.open("rb") as handle:
        r = requests.post(f"{ai_url}/embed/image", files={"file": (path.name, handle)}, timeout=TIMEOUT)
    check(r, "image embedding")
    return r.json()["vector"]


def main() -> None:
    load_env_file(Path(__file__).with_name(".env"))

    parser = argparse.ArgumentParser(description="Seed a found item with a CLIP embedding.")
    parser.add_argument("--title", help="Short item name, e.g. 'Brown Leather Wallet'")
    parser.add_argument("--description", help="One or two sentences describing the item")
    parser.add_argument("--office", default="BCPIO", help="holding/logging office id (default BCPIO)")
    parser.add_argument("--category", default="General", help="General, Cash or Document/ID (default General)")
    parser.add_argument("--image", type=Path, help="Local photo to embed (JPG/PNG/WebP)")
    parser.add_argument("--image-url", help="Public URL of the photo to show in results (optional)")
    parser.add_argument("--seed-offices", action="store_true", help="Insert the 3 placeholder test offices first")
    args = parser.parse_args()

    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    ai_url = (os.getenv("AI_SERVICE_URL") or "http://localhost:8000").rstrip("/")
    if not supabase_url or not service_key:
        fail("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the top of this file)")

    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}

    if args.seed_offices:
        r = requests.post(
            f"{supabase_url}/rest/v1/offices",
            headers={**headers, "Prefer": "resolution=ignore-duplicates,return=minimal"},
            json=TEST_OFFICES, timeout=TIMEOUT,
        )
        check(r, "seeding offices")
        print(f"offices ready: {', '.join(o['id'] for o in TEST_OFFICES)}")
        if not args.title:
            return

    if not args.title or not args.description:
        fail("--title and --description are required (or use --seed-offices on its own)")
    if args.category.lower() == "cash":
        fail("this script does not create cash items; they need finder details and a reward date")

    try:
        requests.get(f"{ai_url}/health", timeout=5).raise_for_status()
    except requests.RequestException:
        fail(f"AI service not reachable at {ai_url}. Start it with: uvicorn main:app --port 8000")

    if args.image:
        if not args.image.exists():
            fail(f"image not found: {args.image}")
        vector, source = embed_image(ai_url, args.image), "photo"
    else:
        vector, source = embed_text(ai_url, f"{args.title}. {args.description}"), "text"
    if len(vector) != 512:
        fail(f"expected a 512-number vector, got {len(vector)}")

    row = {
        "title": args.title,
        "description": args.description,
        "category": args.category,
        "holding_office_id": args.office,
        "logging_office_id": args.office,
        "image_url": args.image_url,
        "embedding": vector,
    }
    r = requests.post(f"{supabase_url}/rest/v1/items", headers={**headers, "Prefer": "return=representation"},
                      json=row, timeout=TIMEOUT)
    if r.status_code == 409 or "foreign key" in r.text.lower():
        fail(f"office '{args.office}' does not exist. Run with --seed-offices first.")
    check(r, "inserting the item")
    item = r.json()[0]
    print(f"inserted {item['ref_code']}  '{item['title']}'  at {args.office}  (embedding from {source})")

    # Sanity check: ask match_items for the item's own vector. It should rank itself first.
    r = requests.post(f"{supabase_url}/rest/v1/rpc/match_items", headers=headers,
                      json={"query_embedding": vector, "match_count": 3}, timeout=TIMEOUT)
    check(r, "match_items check")
    ids = [m["id"] for m in r.json()]
    if item["id"] in ids:
        similarity = next(m["similarity"] for m in r.json() if m["id"] == item["id"])
        print(f"match_items check passed (similarity {similarity:.3f})")
    else:
        print("warning: match_items did not return the new item. Check the function and its status filter.")

    print(f"\nTry searching the app for: {args.title.lower()}")


if __name__ == "__main__":
    main()
