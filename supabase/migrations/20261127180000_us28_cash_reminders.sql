-- ============================================================================
-- US-28: cash 6-month reminders for the holding office.
--
-- staff_reminders_view only lived in schema.sql and did not match the story:
--
--   * it warned 21 days ahead; the rule is 14 days;
--   * an item due today matched both halves of a UNION ALL and was listed
--     twice, once as due and once as a warning;
--   * it compared against current_date, the UTC date on the database, so the
--     reminder rolled over at 08:00 Asia/Manila instead of midnight;
--   * it carried no finder name or contact, which is the point of the reminder;
--   * items RLS lets every authenticated session read every row, so with
--     security_invoker the view showed other offices' cash too.
--
-- One SELECT with a CASE decides due versus approaching, so each item appears
-- at most once. An item leaves the view as soon as it is no longer held: a
-- release to the owner today, and the finder payout once US-34 (#103) adds it.
-- reward_date is derived by calculate_cash_reward_date() on every insert and
-- update (US-27), so a corrected date_received moves the reminder with it.
-- ============================================================================

-- The column list changes, which CREATE OR REPLACE VIEW cannot do.
drop view if exists public.staff_reminders_view;

create view public.staff_reminders_view
with (security_invoker = true)
as
with campus as (
    select (now() at time zone 'Asia/Manila')::date as today
)
select
    i.id,
    i.ref_code,
    i.title,
    i.holding_office_id,
    case
        when i.reward_date <= campus.today then 'due'
        else 'approaching'
    end as reminder_type,
    i.reward_date,
    (i.reward_date - campus.today) as days_until_reward,
    i.cash_amount,
    i.finder_name,
    i.finder_contact
from public.items i
cross join campus
join public.offices o
  on o.id = i.holding_office_id
 and o.auth_user_id = auth.uid()
 and o.status = 'active'
where i.is_cash = true
  and i.status = 'held'
  and i.reward_date is not null
  and i.reward_date <= campus.today + 14;

-- Counter sessions only. The office join above already returns nothing for
-- an admin or any session without an active office row.
revoke all on public.staff_reminders_view from anon, public;
grant select on public.staff_reminders_view to authenticated;
