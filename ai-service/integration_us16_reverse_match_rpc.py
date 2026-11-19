"""US-16 reverse-match RPC integration and access-control suite.

Runs only through the explicit integration pattern, deliberately outside the
default unit discovery:

    python -m unittest discover -s ai-service -p 'integration_*.py'

The `integration_` prefix is what keeps this file out of
`python -m unittest discover -s ai-service -p 'test_*.py'`, so the ordinary
unit run never needs the database stack.

The suite talks to the local Supabase CLI stack (`supabase start`) through
local PostgREST: service_role seeds the fixtures, a locally minted
authenticated JWT exercises the staff path, and the anon key proves the access
model. The migrations in this repo build on `ai-service/supabase/schema.sql`
rather than creating the base tables, so a fresh stack must load that file and
then apply the migration; a plain `supabase db reset` applies only
`supabase/migrations/` and fails on a fresh database with
``type "vector" does not exist``. For example:

    supabase start
    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \\
        -f ai-service/supabase/schema.sql \\
        -f supabase/migrations/20261119120000_us16_reverse_match_intake.sql

The suite skips cleanly when the stack is not reachable, and the parity test's
database half additionally skips when no `psql` client can read `pg_proc`
(set `PSQL_BIN` to point at one).

Requirement coverage (traceable to docs/requirements and the spec):
  [REQ-001 -> FR-003]  match returns only open reports at or above the 0.55
                       floor with ordering, limit, and the eight-column
                       projection; missing, embedding-less, and
                       terminal-status items match empty without an error
  [REQ-002 -> FR-001]  submit_staff_custody returns ref_code and item_id
  [REQ-003 -> FR-006]  dismissals persist idempotently; unknown ids fail on
                       the foreign key and write nothing
  [REQ-004 -> FR-008, NFR-001, BR-002, UR-004]
                       anon is refused for match and dismiss while anon
                       intake still executes, and the old vector-parameter
                       signature is gone
  [REQ-005 -> FR-010]  matching leaves the item status unchanged and writes
                       nothing but the dismissal insert
  [REQ-006 -> FR-001, FR-003, FR-006, FR-008]
                       the migration's functions, signatures, bodies, and
                       grants match the canonical schema.sql
  [FR-007]             a dismissed pair is absent on re-match but stays
                       eligible for another item
  clamp bounds (supabase/migrations/20261119120000_us16_reverse_match_intake.sql:68-75)
                       default count 5, explicit counts clamped to 1..25,
                       a null threshold falling back to the 0.55 floor

Standard library only: no dependency outside Python itself is required.
"""

import base64
import hashlib
import hmac
import json
import math
import os
import re
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_SQL = os.path.join(REPO_ROOT, "ai-service", "supabase", "schema.sql")
MIGRATION_SQL = os.path.join(
    REPO_ROOT, "supabase", "migrations", "20261119120000_us16_reverse_match_intake.sql"
)
FUNCTIONS = (
    "match_lost_reports",
    "dismiss_lost_report_match",
    "submit_staff_custody",
)

DEFAULT_REST_URL = "http://127.0.0.1:54321/rest/v1"
DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

ROW_COLUMNS = {
    "lost_report_id",
    "ref_code",
    "description",
    "image_url",
    "area_route",
    "date_lost",
    "contact_info",
    "similarity",
}

_HALF = math.sqrt(0.5)

# Every fixture row carries one of these markers so each test starts from the
# same tables: a failed run cannot leave a lost report behind for the next
# test's match to find. `US16T-` prefixes the seeded office ids and the lost
# report description starts with `US16-FIXTURE-`.
FIXTURE_OFFICE_PREFIX = "US16T-"
FIXTURE_REPORT_PREFIX = "US16-FIXTURE-"


def _vec512(components):
    """A 512-dimension vector with the given (index, value) pairs set."""
    vector = [0.0] * 512
    for index, value in components:
        vector[index] = value
    return vector


# Cosine similarity against SAME: 1.0, against HALF: ~0.707, against
# ORTHOGONAL: 0.0. All but ORTHOGONAL clear the 0.55 floor.
SAME = _vec512(((0, 1.0),))
HALF = _vec512(((0, _HALF), (1, _HALF)))
ORTHOGONAL = _vec512(((1, 1.0),))


def _normalize(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _function_block(path, name):
    """The verbatim `create or replace function public.<name>` block."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    start = text.lower().find(f"create or replace function public.{name}".lower())
    if start < 0:
        raise AssertionError(f"{name} not found in {path}")
    dollar_start = text.find("$$", start)
    dollar_end = text.find("$$;", dollar_start + 2)
    if dollar_start < 0 or dollar_end < 0:
        raise AssertionError(f"unterminated function body for {name} in {path}")
    return text[start : dollar_end + 3]


def _function_body(path, name):
    """Only the text between the `$$` delimiters of the block."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    start = text.lower().find(f"create or replace function public.{name}".lower())
    dollar_start = text.find("$$", start)
    dollar_end = text.find("$$;", dollar_start + 2)
    return text[dollar_start + 2 : dollar_end]


class StackConfig:
    """Local stack coordinates: PostgREST URL, keys, secret, database URL."""

    def __init__(self, rest_url, anon_key, service_key, jwt_secret, db_url):
        self.rest_url = rest_url
        self.anon_key = anon_key
        self.service_key = service_key
        self.jwt_secret = jwt_secret
        self.db_url = db_url


def _from_process_env():
    """Local stack coordinates from the environment, or None if incomplete."""
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("ANON_KEY")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SERVICE_ROLE_KEY"
    )
    secret = os.environ.get("SUPABASE_JWT_SECRET") or os.environ.get("JWT_SECRET")
    if not (anon and service and secret):
        return None
    return StackConfig(
        os.environ.get("SUPABASE_LOCAL_REST_URL", DEFAULT_REST_URL),
        anon,
        service,
        secret,
        os.environ.get("SUPABASE_DB_URL", DEFAULT_DB_URL),
    )


def _from_supabase_status():
    """Local stack coordinates from `supabase status -o env`, or None."""
    try:
        result = subprocess.run(
            ["supabase", "status", "-o", "env"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    values = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip().upper()] = value.strip()
    anon = values.get("SUPABASE_ANON_KEY") or values.get("ANON_KEY")
    service = values.get("SUPABASE_SERVICE_ROLE_KEY") or values.get(
        "SERVICE_ROLE_KEY"
    )
    secret = values.get("SUPABASE_JWT_SECRET") or values.get("JWT_SECRET")
    if not (anon and service and secret):
        return None
    return StackConfig(
        values.get("SUPABASE_REST_URL", DEFAULT_REST_URL).rstrip("/rest/v1")
        + "/rest/v1"
        if values.get("SUPABASE_REST_URL")
        else DEFAULT_REST_URL,
        anon,
        service,
        secret,
        values.get("SUPABASE_DB_URL", DEFAULT_DB_URL),
    )


CONFIG = None


def setUpModule():
    """Skip the whole module cleanly when the local stack is not running."""
    global CONFIG
    CONFIG = _from_process_env() or _from_supabase_status()
    if CONFIG is None:
        raise unittest.SkipTest(
            "local Supabase stack not reachable: run `supabase start`, load "
            "ai-service/supabase/schema.sql, then apply "
            "supabase/migrations/20261119120000_us16_reverse_match_intake.sql; "
            "or export SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and "
            "SUPABASE_JWT_SECRET"
        )


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _authenticated_key():
    """An HS256 JWT for the authenticated role, signed with the local secret."""
    issued_at = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "role": "authenticated",
        "sub": str(uuid.uuid4()),
        "iat": issued_at,
        "exp": issued_at + 3600,
        "iss": "supabase-demo",
    }
    signing_input = (
        _b64url(json.dumps(header).encode())
        + "."
        + _b64url(json.dumps(payload).encode())
    )
    signature = hmac.new(
        CONFIG.jwt_secret.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64url(signature)}"


def _request(method, path, key, payload=None, headers=None, timeout=20):
    request = urllib.request.Request(
        f"{CONFIG.rest_url}/{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "apikey": key,
            "authorization": f"Bearer {key}",
            "content-type": "application/json",
        },
        method=method,
    )
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode()
    except urllib.error.HTTPError as error:
        body = error.read().decode()
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"message": body[:200]}
        return error.code, parsed
    parsed = json.loads(body) if body.strip() else None
    return response.status, parsed


def _rpc(name, payload, key):
    return _request("POST", f"rpc/{name}", key, payload)


def _insert(table, payload):
    """Insert one row as service_role and return the created row."""
    status, created = _request(
        "POST", table, CONFIG.service_key, payload, {"prefer": "return=representation"}
    )
    if status != 201 or not created:
        raise AssertionError(
            f"seed insert into {table} failed: status {status}, body {created}"
        )
    return created[0] if isinstance(created, list) else created


def _select(table, query):
    status, rows = _request("GET", f"{table}?{query}", CONFIG.service_key)
    if status != 200 or not isinstance(rows, list):
        raise AssertionError(f"select from {table} failed: status {status}")
    return rows


def _delete(table, query):
    """Delete fixture rows as service_role; PostgREST answers 204."""
    status, body = _request(
        "DELETE",
        f"{table}?{query}",
        CONFIG.service_key,
        headers={"prefer": "return=minimal"},
    )
    if status not in (200, 204):
        raise AssertionError(
            f"delete from {table} failed: status {status}, body {body}"
        )


def _cleanup_fixtures():
    """Remove every row this suite may have created.

    Items and offices are scoped by the fixture office prefix; lost reports by
    their description marker. Dismissed matches disappear with their item
    (ON DELETE CASCADE). Running this in setUp as well as cleanup makes the
    suite re-runnable after a crash without touching unrelated local data.
    """
    _delete("items", f"holding_office_id=like.{FIXTURE_OFFICE_PREFIX}*")
    _delete("lost_reports", f"description=like.{FIXTURE_REPORT_PREFIX}*")
    _delete("offices", f"id=like.{FIXTURE_OFFICE_PREFIX}*")


def _seed_office():
    suffix = uuid.uuid4().hex[:8]
    return _insert(
        "offices",
        {
            "id": f"{FIXTURE_OFFICE_PREFIX}{suffix}",
            "name": f"US-16 test office {suffix}",
            "address": "Integration test counter",
            "counter_hours": "Mon-Fri 08:00-17:00",
            "status": "active",
        },
    )["id"]


def _seed_item(office_id, embedding, status="held"):
    return _insert(
        "items",
        {
            "title": "Black folding umbrella",
            "description": "Wooden handle, slight scratch on the shaft",
            "category": "General",
            "status": status,
            "holding_office_id": office_id,
            "logging_office_id": office_id,
            "storage_location": "Locker 1, Bin A",
            "embedding": json.dumps(embedding) if embedding is not None else None,
        },
    )


def _seed_lost_report(embedding, status="open", contact="0917 000 0000"):
    return _insert(
        "lost_reports",
        {
            "description": (
                f"{FIXTURE_REPORT_PREFIX}black folding umbrella with a "
                "wooden handle"
            ),
            "area_route": "Session Road",
            "date_lost": "2026-09-28",
            "contact_info": contact,
            "embedding": json.dumps(embedding),
            "status": status,
        },
    )


def _dismissed_count(item_id, lost_report_id):
    rows = _select(
        "dismissed_matches",
        f"item_id=eq.{item_id}&lost_report_id=eq.{lost_report_id}&select=id",
    )
    return len(rows)


def _psql(sql):
    """Run one SQL query through psql; returns the split rows."""
    binary = os.environ.get("PSQL_BIN", "psql")
    result = subprocess.run(
        [binary, CONFIG.db_url, "-tA", "-F", "\x1f", "-c", sql],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"psql failed: {result.stderr.strip()}")
    return [line.split("\x1f") for line in result.stdout.splitlines() if line.strip()]


# pg_get_function_identity_arguments renders the stored types, not the source
# aliases: `float` becomes `double precision`, `int` becomes `integer`, and a
# vector typmod is dropped on function arguments (`vector(512)` -> `vector`).
EXPECTED_IDENTITY = {
    "match_lost_reports": (
        "item_id uuid, match_threshold double precision, match_count integer"
    ),
    "dismiss_lost_report_match": "p_item_id uuid, p_lost_report_id uuid",
    "submit_staff_custody": (
        "p_office_id text, p_title text, p_description text, "
        "p_storage_location text, p_image_url text, p_category text, "
        "p_embedding vector, p_date_received date, p_cash_amount numeric, "
        "p_finder_name text, p_finder_contact text, p_found_report_id uuid, "
        "p_ai_caption text, p_text_embedding vector, "
        "p_image_embedding vector"
    ),
}

EXPECTED_RESULT = {
    "match_lost_reports": (
        "TABLE(lost_report_id uuid, ref_code text, description text, "
        "image_url text, area_route text, date_lost date, contact_info text, "
        "similarity double precision)"
    ),
    "dismiss_lost_report_match": "void",
    "submit_staff_custody": "TABLE(ref_code text, item_id uuid)",
}

# The access model the spec fixed: match and dismiss are authenticated-only;
# the TEMPORARY anon grant on submit_staff_custody is the kept pre-existing
# dev-mock design (see the task plan and DECISIONS.md).
EXPECTED_PRIVILEGES = {
    "match_lost_reports": (True, False),
    "dismiss_lost_report_match": (True, False),
    "submit_staff_custody": (True, True),
}


class ReverseMatchRpcTests(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        _cleanup_fixtures()
        self.addCleanup(_cleanup_fixtures)
        self.office_id = _seed_office()
        self.auth_key = _authenticated_key()
        self.anon_key = CONFIG.anon_key
        self.service_key = CONFIG.service_key

    # [REQ-001 -> FR-003, BR-001]
    def test_match_returns_open_reports_above_floor_ordered(self):
        item = _seed_item(self.office_id, SAME)
        top = _seed_lost_report(SAME, contact="0917 000 0001")
        mid = _seed_lost_report(HALF, contact="0917 000 0002")
        _seed_lost_report(ORTHOGONAL)
        _seed_lost_report(SAME, status="resolved")

        status, rows = _rpc("match_lost_reports", {"item_id": item["id"]}, self.auth_key)

        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 2)
        self.assertEqual({column for column in rows[0]}, ROW_COLUMNS)
        self.assertEqual(rows[0]["ref_code"], top["ref_code"])
        self.assertEqual(rows[0]["contact_info"], "0917 000 0001")
        self.assertEqual(rows[1]["ref_code"], mid["ref_code"])
        self.assertGreater(float(rows[0]["similarity"]), float(rows[1]["similarity"]))
        self.assertGreater(float(rows[1]["similarity"]), 0.55)
        self.assertEqual(rows[0]["area_route"], "Session Road")
        self.assertEqual(rows[0]["date_lost"], "2026-09-28")

    # [REQ-001 -> FR-003]
    def test_ineligible_items_match_empty_without_error(self):
        missing = _rpc(
            "match_lost_reports", {"item_id": str(uuid.uuid4())}, self.auth_key
        )
        self.assertEqual(missing[0], 200)
        self.assertEqual(missing[1], [])

        embedding_less = _seed_item(self.office_id, None)
        null_vector = _rpc(
            "match_lost_reports", {"item_id": embedding_less["id"]}, self.auth_key
        )
        self.assertEqual(null_vector[0], 200)
        self.assertEqual(null_vector[1], [])

        released = _seed_item(self.office_id, SAME, status="released")
        terminal = _rpc(
            "match_lost_reports", {"item_id": released["id"]}, self.auth_key
        )
        self.assertEqual(terminal[0], 200)
        self.assertEqual(terminal[1], [])

    # [REQ-002 -> FR-001]
    def test_custody_submit_returns_ref_code_and_item_id(self):
        _seed_lost_report(SAME)
        status, rows = _rpc(
            "submit_staff_custody",
            {
                "p_office_id": self.office_id,
                "p_title": "Black folding umbrella",
                "p_description": "Wooden handle, small scratch",
                "p_storage_location": "Locker 2, Bin B",
                "p_image_url": "https://example.test/umbrella.webp",
                "p_category": "General",
                "p_embedding": json.dumps(SAME),
            },
            self.auth_key,
        )

        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"ref_code", "item_id"})
        self.assertTrue(rows[0]["ref_code"])
        self.assertTrue(rows[0]["item_id"])

        items = _select(
            "items", f"id=eq.{rows[0]['item_id']}&select=id,status,ref_code"
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "held")
        self.assertEqual(items[0]["ref_code"], rows[0]["ref_code"])

    # [REQ-003 -> FR-006, UR-002, NFR-005]
    def test_dismiss_is_idempotent_and_one_concurrent_duplicate_yields_one_row(self):
        item = _seed_item(self.office_id, SAME)
        report = _seed_lost_report(SAME)

        first = _rpc(
            "dismiss_lost_report_match",
            {"p_item_id": item["id"], "p_lost_report_id": report["id"]},
            self.auth_key,
        )
        second = _rpc(
            "dismiss_lost_report_match",
            {"p_item_id": item["id"], "p_lost_report_id": report["id"]},
            self.auth_key,
        )
        self.assertEqual(first[0], 204)
        self.assertEqual(second[0], 204)
        self.assertEqual(_dismissed_count(item["id"], report["id"]), 1)

        concurrent_item = _seed_item(self.office_id, SAME)
        barrier = threading.Barrier(2)
        results = []

        def dismiss_concurrently():
            barrier.wait()
            results.append(
                _rpc(
                    "dismiss_lost_report_match",
                    {
                        "p_item_id": concurrent_item["id"],
                        "p_lost_report_id": report["id"],
                    },
                    self.auth_key,
                )[0]
            )

        threads = [
            threading.Thread(target=dismiss_concurrently) for _ in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(sorted(results), [204, 204])
        self.assertEqual(
            _dismissed_count(concurrent_item["id"], report["id"]), 1
        )

    # [REQ-003 -> FR-006]
    def test_unknown_id_dismissal_fails_on_foreign_key_writing_nothing(self):
        item_id = str(uuid.uuid4())
        report_id = str(uuid.uuid4())

        status, body = _rpc(
            "dismiss_lost_report_match",
            {"p_item_id": item_id, "p_lost_report_id": report_id},
            self.auth_key,
        )

        self.assertEqual(status, 409)
        self.assertEqual(body.get("code"), "23503")
        self.assertEqual(_dismissed_count(item_id, report_id), 0)

    # [FR-007]
    def test_dismissed_pair_absent_on_rematch_but_eligible_for_another_item(self):
        dismisser = _seed_item(self.office_id, SAME)
        other = _seed_item(self.office_id, SAME)
        report = _seed_lost_report(SAME)

        dismissed = _rpc(
            "dismiss_lost_report_match",
            {"p_item_id": dismisser["id"], "p_lost_report_id": report["id"]},
            self.auth_key,
        )
        self.assertEqual(dismissed[0], 204)

        after_dismiss = _rpc(
            "match_lost_reports", {"item_id": dismisser["id"]}, self.auth_key
        )
        self.assertEqual(after_dismiss[0], 200)
        self.assertEqual(after_dismiss[1], [])

        for_other = _rpc(
            "match_lost_reports", {"item_id": other["id"]}, self.auth_key
        )
        self.assertEqual(for_other[0], 200)
        self.assertEqual(
            [row["ref_code"] for row in for_other[1]], [report["ref_code"]]
        )

    # [REQ-004 -> FR-008, NFR-001, BR-002, UR-004]
    def test_anon_refused_for_match_and_dismiss_but_intake_still_executes(self):
        item = _seed_item(self.office_id, SAME)
        report = _seed_lost_report(SAME)

        # PostgREST maps an anonymous permission-denied to 401; 403 is used
        # when an authenticated role lacks the privilege.
        match_status, _ = _rpc(
            "match_lost_reports", {"item_id": item["id"]}, self.anon_key
        )
        self.assertEqual(match_status, 401)

        dismiss_status, _ = _rpc(
            "dismiss_lost_report_match",
            {"p_item_id": item["id"], "p_lost_report_id": report["id"]},
            self.anon_key,
        )
        self.assertEqual(dismiss_status, 401)
        self.assertEqual(_dismissed_count(item["id"], report["id"]), 0)

        submit_status, rows = _rpc(
            "submit_staff_custody",
            {
                "p_office_id": self.office_id,
                "p_title": "Anon can still log intake",
                "p_description": "The TEMPORARY dev grant is the approved design",
                "p_storage_location": "Locker 5",
                "p_image_url": "https://example.test/anon.webp",
                "p_embedding": json.dumps(SAME),
            },
            self.anon_key,
        )
        self.assertEqual(submit_status, 200)
        self.assertEqual(set(rows[0]), {"ref_code", "item_id"})

    # [REQ-004 -> FR-008, BR-002]
    def test_old_vector_signature_is_gone(self):
        item = _seed_item(self.office_id, SAME)

        status, body = _rpc(
            "match_lost_reports",
            {
                "item_id_input": item["id"],
                "item_embedding": json.dumps(SAME),
                "match_threshold": 0.2,
                "match_count": 5,
            },
            self.auth_key,
        )
        self.assertEqual(status, 404)
        self.assertEqual(body.get("code"), "PGRST202")

        new_signature, rows = _rpc(
            "match_lost_reports", {"item_id": item["id"]}, self.auth_key
        )
        self.assertEqual(new_signature, 200)
        self.assertIsInstance(rows, list)

    # Clamp bounds, supabase/migrations/20261119120000_us16_reverse_match_intake.sql:68-75
    def test_match_count_and_threshold_clamps(self):
        item = _seed_item(self.office_id, SAME)
        _seed_lost_report(SAME)
        for _ in range(30):
            _seed_lost_report(HALF, contact=None)

        default_count = _rpc(
            "match_lost_reports", {"item_id": item["id"]}, self.auth_key
        )
        self.assertEqual(len(default_count[1]), 5)

        oversized = _rpc(
            "match_lost_reports",
            {"item_id": item["id"], "match_count": 100},
            self.auth_key,
        )
        self.assertEqual(len(oversized[1]), 25)

        zero = _rpc(
            "match_lost_reports",
            {"item_id": item["id"], "match_count": 0},
            self.auth_key,
        )
        self.assertEqual(len(zero[1]), 1)

        null_count = _rpc(
            "match_lost_reports",
            {"item_id": item["id"], "match_count": None},
            self.auth_key,
        )
        self.assertEqual(len(null_count[1]), 5)

        null_threshold = _rpc(
            "match_lost_reports",
            {"item_id": item["id"], "match_threshold": None},
            self.auth_key,
        )
        self.assertEqual(len(null_threshold[1]), 5)

        raised_bar = _rpc(
            "match_lost_reports",
            {"item_id": item["id"], "match_threshold": 0.99},
            self.auth_key,
        )
        self.assertEqual(len(raised_bar[1]), 1)
        self.assertGreater(float(raised_bar[1][0]["similarity"]), 0.99)

    # [REQ-005 -> FR-010, BR-002]
    def test_match_leaves_item_status_unchanged_and_writes_nothing(self):
        item = _seed_item(self.office_id, SAME)
        _seed_lost_report(SAME)

        before = _select("items", f"id=eq.{item['id']}&select=status")[0]["status"]
        status, rows = _rpc(
            "match_lost_reports", {"item_id": item["id"]}, self.auth_key
        )
        after = _select("items", f"id=eq.{item['id']}&select=status")[0]["status"]

        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        self.assertEqual(before, "held")
        self.assertEqual(after, "held")
        self.assertEqual(len(_select("dismissed_matches", "select=id")), 0)

    # [REQ-006 -> FR-001, FR-003, FR-006, FR-008]
    def test_schema_parity_matches_canonical_sql(self):
        # File level: the migration's three blocks are identical to the
        # canonical schema's, so a reset database and schema.sql agree.
        for name in FUNCTIONS:
            migration = _normalize(_function_block(MIGRATION_SQL, name))
            canonical = _normalize(_function_block(SCHEMA_SQL, name))
            self.assertEqual(
                migration,
                canonical,
                f"{name}: the migration and ai-service/supabase/schema.sql drift",
            )

        # Database level: what the applied migration installed matches the
        # canonical definitions, body text included. prosrc is base64-encoded
        # in the query because psql's aligned/unaligned output splits a
        # multi-line function body into extra rows (the old parser then read
        # body lines as function names).
        try:
            rows = _psql(
                "SELECT proname, pg_get_function_identity_arguments(oid), "
                "pg_get_function_result(oid), prosecdef, "
                "coalesce(array_to_string(proconfig, ','), ''), "
                "translate(encode(convert_to(prosrc, 'UTF8'), 'base64'), "
                "chr(10), '') "
                "FROM pg_proc "
                "WHERE pronamespace = 'public'::regnamespace "
                "AND proname IN ('match_lost_reports', "
                "'dismiss_lost_report_match', 'submit_staff_custody')"
            )
        except (AssertionError, OSError, subprocess.SubprocessError) as error:
            self.skipTest(
                f"cannot read pg_proc from the local stack ({error}); "
                "set PSQL_BIN if psql lives elsewhere"
            )

        installed = {row[0]: row for row in rows}
        self.assertEqual(set(installed), set(FUNCTIONS))
        for name in FUNCTIONS:
            _, identity, result, security_definer, config, body = installed[name]
            body = base64.b64decode(body).decode("utf-8")
            self.assertEqual(
                _normalize(identity), _normalize(EXPECTED_IDENTITY[name])
            )
            self.assertEqual(_normalize(result), _normalize(EXPECTED_RESULT[name]))
            self.assertEqual(security_definer, "t")
            self.assertEqual(
                _normalize(config).replace(", ", ","),
                "search_path=public,pg_temp",
            )
            self.assertEqual(
                _normalize(body), _normalize(_function_body(SCHEMA_SQL, name))
            )

        privileges = _psql(
            "SELECT proname, has_function_privilege('authenticated', p.oid, "
            "'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE') "
            "FROM pg_proc p "
            "WHERE p.pronamespace = 'public'::regnamespace "
            "AND p.proname IN ('match_lost_reports', "
            "'dismiss_lost_report_match', 'submit_staff_custody')"
        )
        for name, authenticated_ok, anon_ok in privileges:
            expected_authenticated, expected_anon = EXPECTED_PRIVILEGES[name]
            self.assertEqual(authenticated_ok == "t", expected_authenticated)
            self.assertEqual(anon_ok == "t", expected_anon)


if __name__ == "__main__":
    unittest.main()
