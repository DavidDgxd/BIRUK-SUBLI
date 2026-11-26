"""Checks for the US-37 login-history guarantees.

The CI `schema` job has no Postgres, so these tests assert on the SQL that
ships: the privilege model, the coarse failure bucket, and the admin-only read
path cannot be weakened without failing here. Run with:

    python3 -m unittest discover -s supabase/tests -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_SQL = (
    ROOT / "supabase" / "migrations" / "20261126120000_us37_login_history.sql"
)
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


MIGRATION = read(MIGRATION_SQL)
SCHEMA = read(SCHEMA_SQL)
SHIPPED = (MIGRATION, SCHEMA)
FUNCTIONS = ("record_login_attempt", "admin_list_login_history")


class TableShape(unittest.TestCase):
    def test_table_carries_the_audit_columns_and_checks(self):
        for sql in SHIPPED:
            self.assertIn(
                "create table if not exists public.login_history", sql
            )
            self.assertIn(
                "id uuid primary key default gen_random_uuid()", sql
            )
            self.assertIn(
                "occurred_at timestamptz not null default now()", sql
            )
            self.assertIn("account_label text not null", sql)
            self.assertIn(
                "role text not null check (role in ('office_staff', "
                "'central_admin', 'unknown'))",
                sql,
            )
            self.assertIn(
                "status text not null check (status in ('success', 'failed'))",
                sql,
            )
            self.assertIn("failure_reason text null", sql)
            self.assertIn(
                "device_info text not null default ''", sql
            )

    def test_office_id_matches_the_text_offices_key(self):
        for sql in SHIPPED:
            self.assertIn(
                "office_id text null references public.offices(id) "
                "on delete set null",
                sql,
            )

    def test_rows_survive_a_deleted_office_or_user(self):
        for sql in SHIPPED:
            self.assertIn(
                "user_id uuid null references auth.users(id) on delete set null",
                sql,
            )

    def test_indexes_cover_newest_first_office_and_status(self):
        for sql in SHIPPED:
            for index, columns in (
                ("login_history_occurred_at_idx", "(occurred_at desc)"),
                (
                    "login_history_office_idx",
                    "(office_id, occurred_at desc)",
                ),
                (
                    "login_history_status_idx",
                    "(status, occurred_at desc)",
                ),
            ):
                self.assertIn(
                    f"create index if not exists {index} on "
                    f"public.login_history {columns}",
                    sql,
                )

    def test_rls_is_enabled(self):
        for sql in SHIPPED:
            self.assertIn(
                "alter table public.login_history enable row level security",
                sql,
            )


class TablePrivileges(unittest.TestCase):
    """No browser role may touch rows, so PostgREST has nothing to expose."""

    def test_every_direct_privilege_is_revoked_from_client_roles(self):
        for sql in SHIPPED:
            self.assertIn(
                "revoke all on table public.login_history from public, anon, "
                "authenticated",
                sql,
            )

    def test_no_table_grant_is_issued_to_a_client_role(self):
        for sql in SHIPPED:
            for command in ("select", "insert", "update", "delete", "all"):
                for role in ("public", "anon", "authenticated"):
                    self.assertNotIn(
                        f"grant {command} on table public.login_history "
                        f"to {role}",
                        sql,
                    )
                    self.assertNotIn(
                        f"grant {command} on public.login_history to {role}",
                        sql,
                    )


class WriteRpc(unittest.TestCase):
    def test_write_rpc_is_definer_with_a_fixed_search_path(self):
        for sql in SHIPPED:
            signature = header(sql, "record_login_attempt")
            self.assertIn("returns void", signature)
            self.assertIn("security definer", signature)
            self.assertIn("set search_path = public, pg_temp", signature)
            self.assertIn("p_device_info text default ''", signature)
            self.assertNotIn(" stable", signature)

    def test_signed_out_callers_may_record_a_failed_attempt(self):
        for sql in SHIPPED:
            self.assertIn(
                "grant execute on function public.record_login_attempt("
                "text, text, text, text) to anon, authenticated",
                sql,
            )

    def test_failed_attempts_leak_nothing_and_store_one_coarse_reason(self):
        for sql in SHIPPED:
            fn = body(sql, "record_login_attempt")
            failed = fn[
                fn.index("if p_status is distinct from 'success' then") :
                fn.index("if v_user_id is null then")
            ]
            # No lookup of a user or office row: the write path cannot depend on
            # whether the account exists.
            self.assertNotIn("from public.offices", failed)
            self.assertNotIn("auth.users", failed)
            self.assertNotIn("auth.jwt()", failed)
            self.assertIn(
                "when p_failure_reason in ( 'invalid_credentials', "
                "'inactive_office', 'auth_error' ) then p_failure_reason "
                "else 'auth_error'",
                failed,
            )
            self.assertIn(
                "null, coalesce(nullif(v_account, ''), 'unknown account'), "
                "null, 'unknown', 'failed', v_reason, v_device",
                failed,
            )

    def test_one_uniform_void_answer(self):
        for sql in SHIPPED:
            fn = body(sql, "record_login_attempt")
            self.assertNotIn("return query", fn)
            # Both branches are plain `return;` (an implicit end also counts).
            self.assertGreaterEqual(fn.count("return;"), 2)

    def test_free_text_is_truncated(self):
        for sql in SHIPPED:
            fn = body(sql, "record_login_attempt")
            self.assertIn(
                "v_account := left(btrim(coalesce(p_account, '')), 200)", fn
            )
            self.assertIn(
                "v_device := left(btrim(coalesce(p_device_info, '')), 200)", fn
            )

    def test_success_resolves_the_role_server_side(self):
        for sql in SHIPPED:
            fn = body(sql, "record_login_attempt")
            self.assertIn(
                "coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = "
                "'central_admin'",
                fn,
            )
            self.assertIn("v_role := 'central_admin'", fn)
            self.assertIn("where o.auth_user_id = v_user_id", fn)
            self.assertIn("and o.status = 'active'", fn)
            self.assertIn("v_role := 'office_staff'", fn)

    def test_a_success_without_a_session_is_not_recorded(self):
        for sql in SHIPPED:
            fn = body(sql, "record_login_attempt")
            self.assertIn(
                "if v_user_id is null then return; end if;", fn
            )


class ReadRpc(unittest.TestCase):
    def test_only_the_central_admin_may_read(self):
        for sql in SHIPPED:
            fn = body(sql, "admin_list_login_history")
            self.assertIn("errcode = '42501'", fn)
            self.assertIn(
                "coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> "
                "'central_admin'",
                fn,
            )

    def test_execute_is_authenticated_only(self):
        for sql in SHIPPED:
            revoke = sql[
                sql.index("revoke all on function public.admin_list_login_history") :
            ]
            revoke = revoke[: revoke.index(";")]
            self.assertIn("from public, anon", revoke)

            grant = sql[
                sql.index(
                    "grant execute on function "
                    "public.admin_list_login_history"
                ) :
            ]
            grant = grant[: grant.index(";")]
            self.assertIn("to authenticated", grant)
            self.assertNotIn("anon", grant)

    def test_filters_and_newest_first_ordering(self):
        for sql in SHIPPED:
            fn = body(sql, "admin_list_login_history")
            self.assertIn(
                "where (p_office_id is null or lh.office_id = p_office_id)", fn
            )
            self.assertIn(
                "position(lower(v_search) in lower(lh.account_label)) > 0", fn
            )
            self.assertIn(
                "and (p_status is null or lh.status = p_status)", fn
            )
            self.assertIn(
                "and (p_date_from is null or lh.occurred_at >= p_date_from)", fn
            )
            self.assertIn(
                "and (p_date_to is null or lh.occurred_at <= p_date_to)", fn
            )
            self.assertIn("order by lh.occurred_at desc", fn)

    def test_the_limit_is_clamped(self):
        for sql in SHIPPED:
            fn = body(sql, "admin_list_login_history")
            self.assertIn(
                "limit least(greatest(coalesce(p_limit, 100), 1), 500)", fn
            )

    def test_the_projection_never_returns_the_auth_user_id(self):
        for sql in SHIPPED:
            self.assertNotIn(
                "user_id", header(sql, "admin_list_login_history")
            )
            self.assertNotIn("user_id", body(sql, "admin_list_login_history"))


class SchemaMirror(unittest.TestCase):
    def test_ai_service_schema_matches_the_migration(self):
        for name in FUNCTIONS:
            self.assertEqual(
                header(MIGRATION, name),
                header(SCHEMA, name),
                f"{name} signature drifted between the migration and schema.sql",
            )
            self.assertEqual(
                body(MIGRATION, name),
                body(SCHEMA, name),
                f"{name} body drifted between the migration and schema.sql",
            )


if __name__ == "__main__":
    unittest.main()
