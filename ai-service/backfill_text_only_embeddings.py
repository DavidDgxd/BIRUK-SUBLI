#!/usr/bin/env python
"""Rebuild the legacy combined CLIP vector for text-only hub items.
Before PR #81, text-only found-report items had a norm near 9.2 and acted as a
text-to-text hub under ``match_items``. This rebuilds them from public-safe text
and photo, backing up old vectors outside the repo before writing. Default is a
SELECT-only dry run; writing needs ``--apply``, ``--ref-code`` and ``--yes``.
Run with the venv interpreter on any OS, e.g.
``ai-service/venv/Scripts/python.exe ai-service/backfill_text_only_embeddings.py``
or, with the venv active: ``python ai-service/backfill_text_only_embeddings.py``.
"""
import argparse
import json
import math
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "ai-service" / ".env"
FIELDS = "ref_code,title,status,category,ai_caption,image_url,embedding"
DIM = 512
TIMEOUT = 120
HUB_NORM = 1.5
MAX_EMBED_TEXT_LENGTH = 1000
PAGE_SIZE = 1000
def load_env() -> None:
    if not ENV.exists():
        return
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

def config() -> tuple[str, str, str]:
    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    ai_url = (os.getenv("AI_SERVICE_URL") or "http://localhost:8000").rstrip("/")
    if not base or not key:
        raise SystemExit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    return base, key, ai_url

def headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}

def _json(url: str, data=None, request_headers=None, method=None, timeout=TIMEOUT):
    request = urllib.request.Request(url, data=data, headers=request_headers or {}, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)

def parse_vector(value) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, str):
        return [float(item) for item in json.loads(value)]
    return [float(item) for item in value]

def norm(vector: list[float] | None) -> float | None:
    return math.sqrt(sum(item * item for item in vector)) if vector else None

def unit(vector: list[float]) -> list[float]:
    length = norm(vector) or 1.0
    return [item / length for item in vector]

def combine(text_vector: list[float], image_vector: list[float] | None) -> list[float]:
    if image_vector is None:
        return unit(text_vector)
    return unit([a + b for a, b in zip(unit(text_vector), unit(image_vector))])

def cosine(left: list[float] | None, right: list[float] | None) -> float | None:
    if left is None or right is None:
        return None
    left_norm, right_norm = norm(left), norm(right)
    if not left_norm or not right_norm:
        return None
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)

def public_text(row: dict) -> str:
    parts = [row.get("title"), row.get("category"), row.get("ai_caption")]
    return " ".join(part.strip() for part in parts if part and part.strip())

def fetch_items(base: str, key: str, ref_codes: list[str]) -> list[dict]:
    """Page through PostgREST so a full hub scan is not capped at ~1000 rows."""
    filters = f"items?select={FIELDS}&embedding=not.is.null&order=ref_code"
    if ref_codes:
        filters += f"&ref_code=in.({urllib.parse.quote(','.join(ref_codes))})"
    rows: list[dict] = []
    offset = 0
    while True:
        query = f"{filters}&limit={PAGE_SIZE}&offset={offset}"
        page = _json(f"{base}/rest/v1/{query}", request_headers=headers(key))
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE

def post_form(url: str, fields: dict[str, str]) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    return _json(url, data, {"Content-Type": "application/x-www-form-urlencoded"}, "POST")

def post_image(url: str, image_bytes: bytes) -> dict:
    boundary = "----biruk-backfill-boundary"
    head = f"--{boundary}\r\nContent-Disposition: form-data; " \
        'name="file"; filename="photo.webp"\r\nContent-Type: image/webp\r\n\r\n'
    body = head.encode() + image_bytes + f"\r\n--{boundary}--\r\n".encode()
    content_type = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    return _json(url, body, content_type, "POST")

def check_ai_service(ai_url: str) -> None:
    try:
        _json(f"{ai_url}/health", timeout=5)
    except Exception as error:  # noqa: BLE001 - any failure means unusable
        raise SystemExit(
            f"AI service not reachable at {ai_url} ({error}). "
            "Start it with: uvicorn main:app --port 8000"
        ) from error

def build_new_vector(ai_url: str, row: dict, allow_text_only: bool = False) -> tuple[list[float], str, bool]:
    text = public_text(row)[:MAX_EMBED_TEXT_LENGTH]
    text_vector = post_form(f"{ai_url}/embed/text", {"text": text, "expand": "true"})["vector"]
    image_vector = None
    image_url = (row.get("image_url") or "").strip()
    if image_url:
        try:
            with urllib.request.urlopen(image_url, timeout=TIMEOUT) as response:
                image_vector = post_image(f"{ai_url}/embed/image", response.read())["vector"]
        except Exception as error:  # noqa: BLE001 - only opt-in fallback
            if not allow_text_only:
                raise RuntimeError(
                    f"photo unavailable ({type(error).__name__}: {error})"
                ) from error
            print(f"  photo unavailable ({type(error).__name__}); text only")
    vector = combine(parse_vector(text_vector) or [], parse_vector(image_vector))
    if len(vector) != DIM:
        raise ValueError(f"expected a {DIM}-dim vector, got {len(vector)}")
    return vector, text, image_vector is not None

def ensure_outside_repo(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        raise SystemExit(f"refusing to write the backup inside the repository: {resolved}")
    return resolved

def default_backup_path() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path(tempfile.gettempdir()) / "biruk-embedding-backups" / f"text-only-{stamp}.json"

def write_backup(path: Path, rows: list[dict], vectors: dict[str, list[float]]) -> Path:
    target = ensure_outside_repo(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    items = [
        {"ref_code": row["ref_code"], "title": row.get("title"),
         "old_embedding": parse_vector(row.get("embedding")),
         "new_embedding": vectors[row["ref_code"]]}
        for row in rows if row["ref_code"] in vectors
    ]
    payload = {"created_at": datetime.now(timezone.utc).isoformat(),
               "source": "backfill_text_only_embeddings.py", "items": items}
    target.write_text(json.dumps(payload), encoding="utf-8")
    return target

def patch_item(base: str, key: str, ref_code: str, vector: list[float]) -> int:
    url = f"{base}/rest/v1/items?ref_code=eq.{urllib.parse.quote(ref_code)}"
    write_headers = {**headers(key), "Content-Type": "application/json",
                     "Prefer": "return=representation"}
    updated = _json(url, json.dumps({"embedding": vector}).encode(), write_headers, "PATCH")
    return len(updated) if isinstance(updated, list) else int(bool(updated))

def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild legacy combined embeddings.",
        epilog="Run with the venv interpreter, e.g. "
        "ai-service/venv/Scripts/python.exe ai-service/backfill_text_only_embeddings.py",
    )
    parser.add_argument("--apply", action="store_true", help="write the new vectors")
    parser.add_argument("--ref-code", action="append", default=[], help="ref code (repeatable)")
    parser.add_argument("--yes", action="store_true", help="confirm the write")
    parser.add_argument("--backup", type=Path, help="backup path outside the repo")
    parser.add_argument("--allow-text-only", action="store_true",
                        help="fall back to text when an item photo cannot be embedded")
    return parser.parse_args(argv)

def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.apply and not args.ref_code:
        print("error: --apply requires at least one --ref-code", file=sys.stderr)
        return 2
    if args.apply and not args.yes:
        print("error: --apply requires --yes", file=sys.stderr)
        return 2
    backup_path = ensure_outside_repo(args.backup or default_backup_path())
    load_env()
    base, key, ai_url = config()
    check_ai_service(ai_url)
    rows = fetch_items(base, key, args.ref_code)
    failures = 0
    missing = sorted(set(args.ref_code) - {row["ref_code"] for row in rows})
    if missing:
        failures += 1
        print(f"no rows matched ref code(s): {', '.join(missing)}", file=sys.stderr)
    if not rows:
        print("no matching items with an embedding")
        return 1 if failures else 0
    if not args.ref_code:
        rows = [row for row in rows
                if (norm(parse_vector(row.get("embedding"))) or 0) > HUB_NORM]
        if not rows:
            print("no text-only rows found (every embedding is already normalized)")
            return 1 if failures else 0
    rebuilt: dict[str, list[float]] = {}
    print(f"{'ref_code':10} {'status':10} {'old_norm':>8} {'new_norm':>8} {'cos':>7}")
    for row in rows:
        old_vector = parse_vector(row.get("embedding"))
        try:
            new_vector, _, had_photo = build_new_vector(ai_url, row, args.allow_text_only)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError,
                ValueError, KeyError) as error:
            failures += 1
            print(f"{row['ref_code']:10} FAILED: {error}", file=sys.stderr)
            continue
        rebuilt[row["ref_code"]] = new_vector
        similarity = cosine(old_vector, new_vector)
        shown = f"{similarity:7.4f}" if similarity is not None else "    n/a"
        print(f"{row['ref_code']:10} {row.get('status', ''):10} "
              f"{(norm(old_vector) or 0):8.4f} {norm(new_vector):8.4f} {shown}"
              f"{'' if had_photo else '  (text only)'}")
    if not args.apply:
        print("\ndry run - pass --apply, --ref-code and --yes to write")
        return 1 if failures else 0
    saved = write_backup(backup_path, rows, rebuilt)
    print(f"\nbackup written outside the repo: {saved}")
    for row in rows:
        if row["ref_code"] not in rebuilt:
            continue
        try:
            updated = patch_item(base, key, row["ref_code"], rebuilt[row["ref_code"]])
            if updated == 0:
                failures += 1
                print(f"{row['ref_code']}: write affected 0 rows", file=sys.stderr)
            else:
                print(f"{row['ref_code']}: written")
        except Exception as error:  # noqa: BLE001 - report and continue
            failures += 1
            print(f"{row['ref_code']}: write failed ({error})", file=sys.stderr)
    return 1 if failures else 0
if __name__ == "__main__":
    raise SystemExit(main())
