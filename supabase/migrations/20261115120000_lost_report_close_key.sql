-- US-33: a citizen closes their own lost report.
--
-- A report carries a high-entropy close_key, returned exactly once next to the
-- ref_code. close_lost_report_by_key needs both, so a ref_code alone can never
-- close a report or reveal whether that report exists.
--
-- close_key is a bearer secret and contact_info is PII, so neither anon nor
-- authenticated may SELECT the table. Reads go through SECURITY DEFINER
-- functions that project only the columns the caller is allowed to see.

alter table public.lost_reports
    add column if not exists close_key text,
    add column if not exists closed_at timestamptz,
    add column if not exists closed_by text;

-- Backfill before the column becomes mandatory. Two UUIDs make 64 hex
-- characters of entropy without depending on pgcrypto.
update public.lost_reports
   set close_key = replace(gen_random_uuid()::text, '-', '')
               || replace(gen_random_uuid()::text, '-', '')
 where close_key is null;

alter table public.lost_reports
    alter column close_key
        set default (
            replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '')
        ),
    alter column close_key set not null;

-- Enforced by the table, not only by the generator, so a manual insert or a
-- restored dump cannot store a guessable or malformed key.
alter table public.lost_reports
    drop constraint if exists lost_reports_close_key_check,
    add constraint lost_reports_close_key_check
        check (close_key ~ '^[0-9a-f]{64}$');

create unique index if not exists lost_reports_close_key_idx
on public.lost_reports (close_key);

-- 'closed' is the new self-service/staff state. Older values stay valid so
-- historical rows keep their meaning.
alter table public.lost_reports
    drop constraint if exists lost_reports_status_check,
    add constraint lost_reports_status_check
        check (status in ('open', 'resolved', 'closed_by_user', 'closed'));

alter table public.lost_reports
    drop constraint if exists lost_reports_closed_by_check,
    add constraint lost_reports_closed_by_check
        check (closed_by is null or closed_by in ('self', 'staff'));

create index if not exists lost_reports_closed_at_idx
on public.lost_reports (closed_at)
where closed_at is not null;

-- No direct read for anon or authenticated: close_key must never be reachable
-- through PostgREST, and contact_info must stay behind a staff RPC. Only the
-- service role keeps table SELECT.
revoke select on public.lost_reports from anon;
revoke select on public.lost_reports from authenticated;
revoke select on public.lost_reports from public;
grant select on public.lost_reports to service_role;


-- ----------------------------------------------------------------------------
-- Submission now returns the bearer secret alongside the reference code.
-- ----------------------------------------------------------------------------
drop function if exists public.submit_lost_report(text, text, date, text, text, vector);

create or replace function public.submit_lost_report(
    p_description  text,
    p_area_route   text,
    p_date_lost    date,
    p_contact_info text default null,
    p_image_url    text default null,
    p_embedding    vector(512) default null
)
returns table (ref_code text, close_key text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code  text;
    v_close_key text;
begin
    if p_description is null or btrim(p_description) = '' then
        raise exception 'A description is required.' using errcode = '22023';
    end if;
    if p_area_route is null or btrim(p_area_route) = '' then
        raise exception 'An area or route is required.' using errcode = '22023';
    end if;
    if p_date_lost is null then
        raise exception 'A date is required.' using errcode = '22023';
    end if;
    if p_date_lost > current_date then
        raise exception 'The date cannot be in the future.' using errcode = '22023';
    end if;
    if p_embedding is null then
        raise exception 'An embedding is required.' using errcode = '22023';
    end if;

    insert into public.lost_reports
        (description, area_route, date_lost, contact_info, image_url, embedding)
    values
        (btrim(p_description),
         btrim(p_area_route),
         p_date_lost,
         nullif(btrim(coalesce(p_contact_info, '')), ''),
         nullif(btrim(coalesce(p_image_url, '')), ''),
         p_embedding)
    returning lost_reports.ref_code, lost_reports.close_key
      into v_ref_code, v_close_key;

    return query select v_ref_code, v_close_key;
end;
$$;

revoke all on function public.submit_lost_report(text, text, date, text, text, vector)
    from public;
grant execute on function public.submit_lost_report(text, text, date, text, text, vector)
    to anon, authenticated;


-- ----------------------------------------------------------------------------
-- Public self-close. The ref_code and close_key are checked in one predicate,
-- so a valid ref_code with a wrong key follows exactly the same path as an
-- unknown ref_code: no lookup branch, no writes, one identical error.
-- ----------------------------------------------------------------------------
create or replace function public.close_lost_report_by_key(
    p_ref_code  text,
    p_close_key text
)
returns table (ref_code text, status text, closed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    c_not_found constant text := 'Report not found or invalid close link.';
    v_ref_code  text := upper(btrim(coalesce(p_ref_code, '')));
    v_close_key text := btrim(coalesce(p_close_key, ''));
    v_id        uuid;
    v_status    text;
    v_closed_at timestamptz;
begin
    -- Blank inputs fail before the lookup, so they cannot be told apart from a
    -- ref_code that does not exist.
    if v_ref_code = '' or v_close_key = '' then
        raise exception '%', c_not_found using errcode = 'P0002';
    end if;

    -- One equality path for both values. A wrong key cannot distinguish a real
    -- ref_code from a missing one because neither predicate can match.
    select lr.id, lr.status, lr.closed_at
      into v_id, v_status, v_closed_at
    from public.lost_reports lr
    where lr.ref_code = v_ref_code
      and lr.close_key = v_close_key
    for update;

    if not found then
        raise exception '%', c_not_found using errcode = 'P0002';
    end if;

    -- Only 'open' may change. A retried confirmation is idempotent, and a
    -- report the citizen already resolved keeps its status and audit fields.
    if v_status <> 'open' then
        return query select v_ref_code, v_status, v_closed_at;
        return;
    end if;

    update public.lost_reports
       set status = 'closed',
           closed_at = timezone('utc'::text, now()),
           closed_by = 'self'
     where id = v_id
       and status = 'open'
    returning lost_reports.closed_at into v_closed_at;

    return query select v_ref_code, 'closed'::text, v_closed_at;
end;
$$;

revoke all on function public.close_lost_report_by_key(text, text) from public;
grant execute on function public.close_lost_report_by_key(text, text)
    to anon, authenticated;
