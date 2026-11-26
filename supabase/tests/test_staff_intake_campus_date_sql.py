"""Checks that staff intake judges the receipt date by the campus calendar (#136).

The intake form defaults "Date received" to the staffer's local date in
Asia/Manila (UTC+8). submit_staff_custody used current_date, the UTC date on
the database, so the default was rejected as "in the future" between 00:00 and
07:59 local time. Run with:

    python3 -m unittest discover -s supabase/tests -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_SQL = ROOT / "supabase" / "migrations" / "20261124130000_staff_intake_campus_date.sql"
SCHEMA_SQL = ROOT / "ai-service" / "supabase" / "schema.sql"
CAMPUS_TODAY = "(now() at time zone 'asia/manila')::date"


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


class StaffIntakeCampusDateTests(unittest.TestCase):
    def assert_campus_date(self, path):
        fn = last_definition(read(path), "submit_staff_custody")
        self.assertNotIn("current_date", fn)
        self.assertIn(f"p_date_received date default {CAMPUS_TODAY}", fn)
        self.assertIn(f"if p_date_received > {CAMPUS_TODAY} then", fn)

    def test_migration_uses_campus_date(self):
        self.assert_campus_date(MIGRATION_SQL)

    def test_schema_mirror_uses_campus_date(self):
        self.assert_campus_date(SCHEMA_SQL)

    def test_migration_keeps_signature_so_grants_survive(self):
        sql = read(MIGRATION_SQL)
        self.assertNotIn("drop function", sql)
        self.assertIn("returns table ( ref_code text, item_id uuid )", sql)
        self.assertIn("security definer", sql)


if __name__ == "__main__":
    unittest.main()
