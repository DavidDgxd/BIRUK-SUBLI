"""Checks for the US-33 lost-report closure guarantees.

The CI `schema` job has no Postgres, so these tests assert on the SQL that
ships: the privilege model, the error parity, and the non-open preservation
rules cannot be weakened without failing here. Run with:

    python3 -m unittest discover -s supabase/tests -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLOSE_KEY_SQL = ROOT / "supabase" / "migrations" / "20261115120000_lost_report_close_key.sql"
STAFF_SQL = ROOT / "supabase" / "migrations" / "20261115120100_lost_report_staff_closure.sql"
FLOOR_SQL = ROOT / "supabase" / "migrations" / "20261127120000_reverse_match_floor_closed_guard.sql"
SCHEMA_SQL = ROOT / "ai-service" / "supabase" / "schema.sql"


def read(path):
    """Comment-free, lowercase, whitespace-collapsed SQL for token checks."""
    raw = path.read_text(encoding="utf-8")
    body = "\n".join(re.sub(r"--.*", "", line) for line in raw.splitlines())
    return re.sub(r"\s+", " ", body).strip().lower()


def header(sql, name):
    start = sql.index(f"function public.{name}")
    return sql[start : sql.index("as $$", start)]


def body(sql, name):
    start = sql.index(f"function public.{name}")
    opening = sql.index("$$", start) + 2
    return sql[opening : sql.index("$$", opening)].strip()


DEFINITION = re.compile(r"create (?:or replace )?function public\.(\w+)")


def last_body(sql, name):
    # A function re-created by a later migration ships with its last body, so
    # the mirror must read the last definition. Grant and revoke lines also name
    # the function, so match the definition form only.
    starts = [m.end() for m in DEFINITION.finditer(sql) if m.group(1) == name]
    start = starts[-1]
    opening = sql.index("$$", start) + 2
    return sql[opening : sql.index("$$", opening)].strip()


MIGRATION_CLOSE_KEY = read(CLOSE_KEY_SQL)
MIGRATION_STAFF = read(STAFF_SQL)
MIGRATION_FLOOR = read(FLOOR_SQL)
SCHEMA = read(SCHEMA_SQL)
SHIPPED_SQL = (MIGRATION_CLOSE_KEY, MIGRATION_STAFF, SCHEMA)
FUNCTIONS = (
    "close_lost_report_by_key",
    "staff_lookup_lost_report",
    "staff_close_lost_report",
    "match_lost_reports",
)


class CloseKeyStorage(unittest.TestCase):
    def test_key_is_mandatory_and_64_lowercase_hex(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            self.assertIn("check (close_key ~ '^[0-9a-f]{64}$')", sql)

    def test_generator_produces_64_hex_characters(self):
        generated = (
            "replace(gen_random_uuid()::text, '-', '') "
            "|| replace(gen_random_uuid()::text, '-', '')"
        )
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            self.assertIn(generated, sql)

    def test_existing_rows_are_backfilled_before_not_null(self):
        self.assertIn(
            "update public.lost_reports set close_key = "
            "replace(gen_random_uuid()::text, '-', '') "
            "|| replace(gen_random_uuid()::text, '-', '') "
            "where close_key is null",
            MIGRATION_CLOSE_KEY,
        )
        self.assertLess(
            MIGRATION_CLOSE_KEY.index("where close_key is null"),
            MIGRATION_CLOSE_KEY.index("close_key set not null"),
        )

    def test_key_is_unique(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            self.assertIn(
                "create unique index if not exists lost_reports_close_key_idx "
                "on public.lost_reports (close_key)",
                sql,
            )

    def test_closure_status_and_audit_values_are_constrained(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            self.assertIn(
                "status in ('open', 'resolved', 'closed_by_user', 'closed')", sql
            )
            self.assertIn(
                "closed_by is null or closed_by in ('self', 'staff')", sql
            )


class ReadPrivileges(unittest.TestCase):
    """close_key and contact_info must not be reachable through PostgREST."""

    def test_no_anon_or_authenticated_select_on_lost_reports(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            for role in ("anon", "authenticated", "public"):
                self.assertIn(
                    f"revoke select on public.lost_reports from {role}", sql
                )
                self.assertNotIn(
                    f"grant select on public.lost_reports to {role}", sql
                )
            self.assertIn(
                "grant select on public.lost_reports to service_role", sql
            )


class PublicCloseRpc(unittest.TestCase):
    def test_every_miss_raises_one_identical_p0002(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            fn = body(sql, "close_lost_report_by_key")
            self.assertEqual(
                fn.count("raise exception '%', c_not_found using errcode = 'p0002'"),
                2,
                "blank input and an unmatched row must share one message",
            )
            self.assertEqual(fn.count("errcode = 'p0002'"), 2)
            self.assertIn(
                "c_not_found constant text := "
                "'report not found or invalid close link.'",
                fn,
            )

    def test_ref_and_key_are_matched_in_one_predicate(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            fn = body(sql, "close_lost_report_by_key")
            self.assertIn(
                "where lr.ref_code = v_ref_code and lr.close_key = v_close_key",
                fn,
            )
            self.assertNotIn(
                "select lr.id, lr.status, lr.closed_at into v_id, v_status, "
                "v_closed_at from public.lost_reports lr where lr.ref_code = "
                "v_ref_code for update",
                fn,
                "a ref-only lookup would make a wrong key distinguishable",
            )

    def test_only_open_reports_are_updated(self):
        for sql in (MIGRATION_CLOSE_KEY, SCHEMA):
            fn = body(sql, "close_lost_report_by_key")
            self.assertIn(
                "if v_status <> 'open' then return query select v_ref_code, "
                "v_status, v_closed_at",
                fn,
            )
            self.assertIn("where id = v_id and status = 'open'", fn)
            self.assertIn(
                "set status = 'closed', closed_at = timezone('utc'::text, "
                "now()), closed_by = 'self'",
                fn,
            )


class StaffCloseRpc(unittest.TestCase):
    def test_staff_calls_require_an_active_office_or_admin(self):
        for sql in (MIGRATION_STAFF, SCHEMA):
            for name in ("staff_lookup_lost_report", "staff_close_lost_report"):
                fn = body(sql, name)
                self.assertIn("errcode = '42501'", fn)
                self.assertIn("o.auth_user_id = auth.uid()", fn)
                self.assertIn("o.status = 'active'", fn)

    def test_lookup_never_projects_pii_or_the_secret(self):
        for sql in (MIGRATION_STAFF, SCHEMA):
            signature = header(sql, "staff_lookup_lost_report")
            fn = body(sql, "staff_lookup_lost_report")
            for leaked in ("contact_info", "created_at", "close_key"):
                self.assertNotIn(leaked, signature)
                self.assertNotIn(leaked, fn)

    def test_staff_close_requires_a_ref_and_preserves_non_open_rows(self):
        for sql in (MIGRATION_STAFF, SCHEMA):
            fn = body(sql, "staff_close_lost_report")
            self.assertIn("errcode = '22023'", fn)
            self.assertIn(
                "if v_status <> 'open' then return query select v_ref_code, "
                "v_status, v_closed_at",
                fn,
            )
            self.assertIn("where id = v_id and status = 'open'", fn)
            self.assertIn("closed_by = 'staff'", fn)
            self.assertNotIn("close_key", fn)


class MatchingExclusion(unittest.TestCase):
    def test_closed_reports_are_never_candidates(self):
        for sql in (MIGRATION_STAFF, MIGRATION_FLOOR, SCHEMA):
            fn = body(sql, "match_lost_reports")
            self.assertIn("lr.status = 'open'", fn)
            self.assertIn("lr.closed_at is null", fn)

    def test_existing_safety_floor_and_custody_guard_are_kept(self):
        for sql in (MIGRATION_FLOOR, SCHEMA):
            signature = header(sql, "match_lost_reports")
            fn = body(sql, "match_lost_reports")
            self.assertIn("security definer", signature)
            self.assertIn("item_id uuid", signature)
            self.assertIn("match_threshold float default 0.68", signature)
            self.assertIn(
                "items.status not in ('released', 'resolved', 'transferred', "
                "'disposed')",
                fn,
            )
            self.assertIn(
                ">= greatest(coalesce(match_threshold, 0.68), 0.68)", fn
            )
            self.assertIn("from public.items", fn)


class SchemaMirror(unittest.TestCase):
    def test_ai_service_schema_matches_the_migrations(self):
        migrations = MIGRATION_CLOSE_KEY + " " + MIGRATION_STAFF + " " + MIGRATION_FLOOR
        for name in FUNCTIONS:
            self.assertEqual(
                last_body(migrations, name),
                last_body(SCHEMA, name),
                f"{name} drifted between the migrations and schema.sql",
            )


if __name__ == "__main__":
    unittest.main()
