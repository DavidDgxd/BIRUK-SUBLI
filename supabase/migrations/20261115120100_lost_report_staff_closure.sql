-- US-33: staff counter fallback and matching exclusion.
--
-- A citizen who lost the private close link brings their ref_code to any
-- office. These functions require a signed-in active office or the central
-- admin and never project close_key or contact_info.
--
-- The return type of staff_lookup_lost_report changed after review (contact
-- details came out), so it is dropped before it is re-created.

drop function if exists public.staff_lookup_lost_report(text);

create or replace function public.staff_lookup_lost_report(p_ref_code text)
returns table (
    ref_code    text,
    description text,
    area_route  text,
    date_lost   date,
    status      text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text := upper(btrim(coalesce(p_ref_code, '')));
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin'
       and not exists (
           select 1
           from public.offices o
           where o.auth_user_id = auth.uid()
             and o.status = 'active'
       ) then
        raise exception 'Only signed-in counter staff can look up lost reports.'
            using errcode = '42501';
    end if;

    if v_ref_code = '' then
        return;
    end if;

    -- The projection is the whole contract with the counter UI: no close_key
    -- and no contact_info, so a compromised staff session cannot harvest PII
    -- or close other citizens' reports with this call alone.
    return query
        select lr.ref_code,
               lr.description,
               lr.area_route,
               lr.date_lost,
               lr.status
        from public.lost_reports lr
        where lr.ref_code = v_ref_code;
end;
$$;

revoke all on function public.staff_lookup_lost_report(text) from public, anon;
grant execute on function public.staff_lookup_lost_report(text) to authenticated;


create or replace function public.staff_close_lost_report(p_ref_code text)
returns table (ref_code text, status text, closed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code  text := upper(btrim(coalesce(p_ref_code, '')));
    v_id        uuid;
    v_status    text;
    v_closed_at timestamptz;
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin'
       and not exists (
           select 1
           from public.offices o
           where o.auth_user_id = auth.uid()
             and o.status = 'active'
       ) then
        raise exception 'Only signed-in counter staff can close lost reports.'
            using errcode = '42501';
    end if;

    if v_ref_code = '' then
        raise exception 'A reference code is required.' using errcode = '22023';
    end if;

    select lr.id, lr.status, lr.closed_at
      into v_id, v_status, v_closed_at
    from public.lost_reports lr
    where lr.ref_code = v_ref_code
    for update;

    if not found then
        raise exception 'No lost report found for that reference code.'
            using errcode = 'P0002';
    end if;

    -- Only 'open' may change. Closed is idempotent, and resolved /
    -- closed_by_user keep their status and original audit fields.
    if v_status <> 'open' then
        return query select v_ref_code, v_status, v_closed_at;
        return;
    end if;

    update public.lost_reports
       set status = 'closed',
           closed_at = timezone('utc'::text, now()),
           closed_by = 'staff'
     where id = v_id
       and status = 'open'
    returning lost_reports.closed_at into v_closed_at;

    return query select v_ref_code, 'closed'::text, v_closed_at;
end;
$$;

revoke all on function public.staff_close_lost_report(text) from public, anon;
grant execute on function public.staff_close_lost_report(text) to authenticated;


-- ----------------------------------------------------------------------------
-- Matching exclusion: a closed report is never a candidate for a new intake.
-- This keeps the existing signature, safety floor and custody guard; only the
-- closed_at predicate is new, so a future status value cannot reintroduce a
-- closed report.
-- ----------------------------------------------------------------------------
create or replace function public.match_lost_reports (
    item_id         uuid,
    match_threshold float default 0.55,
    match_count     int   default 5
)
returns table (
    lost_report_id uuid,
    ref_code       text,
    description    text,
    image_url      text,
    area_route     text,
    date_lost      date,
    contact_info   text,
    similarity     float
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
    select
        lr.id as lost_report_id,
        lr.ref_code,
        lr.description,
        lr.image_url,
        lr.area_route,
        lr.date_lost,
        lr.contact_info,
        1 - (lr.embedding <=> items.embedding) as similarity
    from public.items
    cross join public.lost_reports lr
    where items.id = item_id
      and items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      and lr.status = 'open'
      and lr.closed_at is null
      and not exists (
          select 1 from public.dismissed_matches dm
          where dm.item_id = items.id and dm.lost_report_id = lr.id
      )
      and (1 - (lr.embedding <=> items.embedding))
          >= greatest(coalesce(match_threshold, 0.55), 0.55)
    order by similarity desc
    limit least(greatest(coalesce(match_count, 5), 1), 25);
$$;
