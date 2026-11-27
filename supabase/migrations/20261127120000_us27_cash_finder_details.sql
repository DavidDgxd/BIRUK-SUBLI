-- ============================================================================
-- US-27: require finder details for cash and keep the reward date derived.
--
-- items already stores is_cash, cash_amount, reward_date, finder_name and
-- finder_contact, and submit_staff_custody already accepts the finder
-- parameters. This migration closes the remaining database gap:
--
--   * a cash row must name who handed it in and how to reach them; and
--   * reward_date is always date_received + 6 months, including when the
--     counter corrects the receipt date after intake.
--
-- The public search RPCs never project these columns, and anon has no SELECT
-- on items, so finder PII and the amount stay staff-only.
-- ============================================================================

create or replace function public.calculate_cash_reward_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.is_cash = true then
        new.reward_date := new.date_received + interval '6 months';
    else
        new.reward_date := null;
    end if;
    return new;
end;
$$;

-- NOT VALID keeps existing cash rows from blocking deployment; PostgreSQL
-- still enforces the check on every new insert and update. Backfill any old
-- rows and run VALIDATE CONSTRAINT when the reward records are complete.
do $$
begin
    alter table public.items
        add constraint items_cash_finder_required check (
            not is_cash
            or (
                nullif(btrim(finder_name), '') is not null
                and nullif(btrim(finder_contact), '') is not null
            )
        ) not valid;
exception
    when duplicate_object then null;
end;
$$;
