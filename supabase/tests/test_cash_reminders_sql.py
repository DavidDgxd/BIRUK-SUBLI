"""Checks the US-28 cash reminder view (staff_reminders_view).

The view lists held cash for the signed-in office that is due for the finder
payout, or due within 14 days, once per item, by the Asia/Manila date. Run with:

    python3 -m unittest discover -s supabase/tests -p 'test_*.py'
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_SQL = ROOT / "supabase" / "migrations" / "20261127180000_us28_cash_reminders.sql"
SCHEMA_SQL = ROOT / "ai-service" / "supabase" / "schema.sql"
CAMPUS_TODAY = "(now() at time zone 'asia/manila')::date"


def read(path):
    """Comment-free, lowercase, whitespace-collapsed SQL for token checks."""
    raw = path.read_text(encoding="utf-8")
    body = "\n".join(re.sub(r"--.*", "", line) for line in raw.splitlines())
    return re.sub(r"\s+", " ", body).strip().lower()


def last_view(sql):
    """The final definition of staff_reminders_view, up to its grant."""
    start = sql.rindex("create view public.staff_reminders_view")
    end = sql.index("grant select on public.staff_reminders_view", start)
    return sql[start:end]


class CashReminderViewTests(unittest.TestCase):
    def assert_view(self, path):
        view = last_view(read(path))

        # 14-day window, not the old 21 days.
        self.assertIn("i.reward_date <= campus.today + 14", view)
        self.assertNotIn("21", view)

        # One row per item: a single SELECT, due wins on the reward date itself.
        self.assertNotIn("union", view)
        self.assertIn(
            "case when i.reward_date <= campus.today then 'due' else 'approaching' end",
            view,
        )

        # Campus date, not the UTC database date.
        self.assertIn(f"select {CAMPUS_TODAY} as today", view)
        self.assertNotIn("current_date", view)

        # Only held cash at the signed-in, active office.
        self.assertIn("security_invoker = true", view)
        self.assertIn("i.is_cash = true", view)
        self.assertIn("i.status = 'held'", view)
        self.assertIn("o.auth_user_id = auth.uid()", view)
        self.assertIn("o.status = 'active'", view)

        # The reminder carries what staff need to reach the finder.
        for column in ("i.reward_date", "i.finder_name", "i.finder_contact"):
            self.assertIn(column, view)

    def test_migration_view(self):
        self.assert_view(MIGRATION_SQL)

    def test_schema_mirror_view(self):
        self.assert_view(SCHEMA_SQL)

    def test_schema_mirror_matches_migration(self):
        self.assertEqual(last_view(read(MIGRATION_SQL)), last_view(read(SCHEMA_SQL)))

    def test_anon_cannot_read(self):
        for path in (MIGRATION_SQL, SCHEMA_SQL):
            sql = read(path)
            self.assertIn("revoke all on public.staff_reminders_view from anon, public;", sql)
            self.assertNotIn("grant select on public.staff_reminders_view to anon", sql)

    def test_reward_date_follows_date_received_on_update(self):
        # A corrected receipt date must move the reminder (US-28 AC).
        sql = read(SCHEMA_SQL)
        self.assertIn("new.reward_date := new.date_received + interval '6 months';", sql)
        self.assertIn(
            "create trigger trigger_cash_reward_date before insert or update on public.items",
            sql,
        )


if __name__ == "__main__":
    unittest.main()
