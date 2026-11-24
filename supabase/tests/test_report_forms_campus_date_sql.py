"""Checks that lost and found self-reports judge dates by the campus calendar (#139).

Both public forms default the date to the reporter's local date in Asia/Manila
(UTC+8). submit_lost_report and submit_found_report used current_date, the UTC
date on the database, so the default was rejected as "in the future" between
00:00 and 07:59 local time. Run with:

    python3 -m unittest discover -s supabase/tests -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_SQL = ROOT / "supabase" / "migrations" / "20261124140000_report_forms_campus_date.sql"
SCHEMA_SQL = ROOT / "ai-service" / "supabase" / "schema.sql"
CAMPUS_TODAY = "(now() at time zone 'asia/manila')::date"
CHECKS = {
    "submit_lost_report": "p_date_lost",
    "submit_found_report": "p_found_date",
}


def read(path):
    """Comment-free, lowercase, whitespace-collapsed SQL for token checks."""
    raw = path.read_text(encoding="utf-8")
    body = "\n".join(re.sub(r"--.*", "", line) for line in raw.splitlines())
    return re.sub(r"\s+", " ", body).strip().lower()


def last_definition(sql, name):
    """The final create-or-replace of a function, up to its closing $$."""
    start = sql.rindex(f"create or replace function public.{name}(")
    body_start = sql.index("as $$", start) + len("as $$")
    return sql[start : sql.index("$$", body_start)]


class ReportFormsCampusDateTests(unittest.TestCase):
    def assert_campus_date(self, path):
        sql = read(path)
        for name, param in CHECKS.items():
            with self.subTest(file=path.name, function=name):
                fn = last_definition(sql, name)
                self.assertNotIn("current_date", fn)
                self.assertIn(f"if {param} > {CAMPUS_TODAY} then", fn)

    def test_migration_uses_campus_date(self):
        self.assert_campus_date(MIGRATION_SQL)

    def test_schema_mirror_uses_campus_date(self):
        self.assert_campus_date(SCHEMA_SQL)

    def test_migration_keeps_signatures_and_public_grants(self):
        sql = read(MIGRATION_SQL)
        self.assertNotIn("drop function", sql)
        self.assertIn("returns table (ref_code text, close_key text)", sql)
        self.assertIn("returns text", sql)
        for name in CHECKS:
            args = "(text, text, date, text, text, vector)"
            self.assertIn(f"revoke all on function public.{name}{args} from public", sql)
            self.assertIn(
                f"grant execute on function public.{name}{args} to anon, authenticated", sql
            )


if __name__ == "__main__":
    unittest.main()
