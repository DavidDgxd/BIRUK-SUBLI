-- US-16: reverse matching at intake.
--
-- `match_lost_reports` changes shape. It now takes the new item's id and reads
-- `items.embedding` server-side, so a caller supplies an identifier and never a
-- vector. The old client-supplied-vector signature is dropped rather than
-- replaced: it returns `lost_reports.contact_info`, so leaving it callable
-- would keep a PII-returning endpoint reachable by anon callers. Both new RPCs
-- are SECURITY DEFINER and executable by `authenticated` only. `revoke all ...
-- from public` alone is not enough: Supabase grants EXECUTE on new public
-- functions to `anon` and `authenticated` by default, so `anon` is revoked
-- explicitly on both.
--
-- `submit_staff_custody` changes its return type from text to
-- table (ref_code, item_id), so it is dropped and recreated. The receipt
-- reference and the new item id come back together, which is what lets the
-- counter request matching for the item it just logged.
--
-- The item status list is stated as exclusions rather than `status = 'held'`,
-- matching US-15: an item that has left custody stops being matched even though
-- its embedding remains stored. A missing item, an embedding-less item, and an
-- item in a terminal status all yield an empty result rather than an error.


-- ----------------------------------------------------------------------------
-- Reverse-match RPC: item id in, open lost reports out.
-- ----------------------------------------------------------------------------
drop function if exists public.match_lost_reports(
    uuid, vector, double precision, integer
);

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
      -- An item outside this list has left custody (or never had a vector) and
      -- is no longer a match target. Empty result, never an error.
      and items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      and lr.status = 'open'
      and not exists (
          select 1 from public.dismissed_matches dm
          where dm.item_id = items.id and dm.lost_report_id = lr.id
      )
      -- Hard floor: callers may raise the bar but never drop below 0.55. A null
      -- threshold falls back to the floor instead of bypassing it. The same
      -- `>=` comparison as the search RPCs, so a row exactly at the floor is
      -- treated the same way everywhere.
      and (1 - (lr.embedding <=> items.embedding))
          >= greatest(coalesce(match_threshold, 0.55), 0.55)
    order by similarity desc
    -- Clamp server-side: a null or oversized match_count cannot widen the
    -- result past the intended 1..25 contact rows.
    limit least(greatest(coalesce(match_count, 5), 1), 25);
$$;

revoke all on function public.match_lost_reports(uuid, double precision, integer)
    from public, anon;
grant execute on function public.match_lost_reports(uuid, double precision, integer)
    to authenticated;


-- Dismissal RPC: persists the (item, lost report) pair the staffer reviewed.
-- The table's unique pair makes a repeat dismissal harmless; an unknown id
-- fails on the foreign key so a fictional pairing is never recorded.
create or replace function public.dismiss_lost_report_match(
    p_item_id        uuid,
    p_lost_report_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.dismissed_matches (item_id, lost_report_id)
    values (p_item_id, p_lost_report_id)
    on conflict (item_id, lost_report_id) do nothing;
end;
$$;

revoke all on function public.dismiss_lost_report_match(uuid, uuid)
    from public, anon;
grant execute on function public.dismiss_lost_report_match(uuid, uuid)
    to authenticated;


-- ----------------------------------------------------------------------------
-- Custody submit: return the receipt reference and the new item id.
-- The return type changed, so the previous signature is dropped first.
-- ----------------------------------------------------------------------------
drop function if exists public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text
);
drop function if exists public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid
);
drop function if exists public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, text
);
drop function if exists public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text
);
drop function if exists public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text, vector, vector
);

create or replace function public.submit_staff_custody(
    p_office_id        text,
    p_title            text,
    p_description      text,
    p_storage_location text,
    p_image_url        text,
    p_category         text default 'General',
    p_embedding        vector(512) default null,
    p_date_received    date default current_date,
    p_cash_amount      numeric default null,
    p_finder_name      text default null,
    p_finder_contact   text default null,
    p_found_report_id  uuid default null,
    p_ai_caption       text default null,
    p_text_embedding   vector(384) default null,
    p_image_embedding  vector(512) default null
)
returns table (
    ref_code text,
    item_id  uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
    v_item_id  uuid;
    v_category text;
    v_is_cash  boolean := false;
    v_amount   numeric(10, 2) := 0.00;
begin
    if p_office_id is null or btrim(p_office_id) = '' then
        raise exception 'An intake office is required.' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.offices
        where id = p_office_id and status = 'active'
    ) then
        raise exception 'Unknown or inactive office: %', p_office_id
            using errcode = '22023';
    end if;
    if p_title is null or btrim(p_title) = '' then
        raise exception 'An item title is required.' using errcode = '22023';
    end if;
    if p_description is null or btrim(p_description) = '' then
        raise exception 'A description is required.' using errcode = '22023';
    end if;
    if p_storage_location is null or btrim(p_storage_location) = '' then
        raise exception 'A storage location is required.' using errcode = '22023';
    end if;
    if p_image_url is null or btrim(p_image_url) = '' then
        raise exception 'A photo is required.' using errcode = '22023';
    end if;
    if p_date_received is null then
        raise exception 'A receipt date is required.' using errcode = '22023';
    end if;
    if p_date_received > current_date then
        raise exception 'The receipt date cannot be in the future.'
            using errcode = '22023';
    end if;

    if p_found_report_id is not null then
        update public.found_reports
           set status = 'converted_at_intake'
         where id = p_found_report_id
           and status = 'pending';

        if not found then
            raise exception 'That self-report is no longer pending.'
                using errcode = 'P0002';
        end if;
    end if;

    v_category := coalesce(nullif(btrim(p_category), ''), 'General');
    if lower(v_category) = 'cash' then
        v_is_cash := true;
        v_category := 'Cash';
        v_amount := coalesce(p_cash_amount, 0.00);
        if v_amount < 0 then
            raise exception 'A cash amount cannot be negative.'
                using errcode = '22023';
        end if;
    end if;

    -- ref_code/item_id are the OUT names of the returns-table signature, so the
    -- insert returns only the id and the reference is read back by alias.
    insert into public.items (
        title, description, category, status,
        image_url, date_received,
        holding_office_id, logging_office_id,
        storage_location, embedding, text_embedding, image_embedding,
        is_cash, cash_amount, finder_name, finder_contact,
        ai_caption
    ) values (
        btrim(p_title),
        btrim(p_description),
        v_category,
        'held',                                   -- intake always opens as held
        btrim(p_image_url),
        p_date_received,
        p_office_id,                              -- holds it now
        p_office_id,                              -- took it in
        btrim(p_storage_location),
        p_embedding,
        p_text_embedding,
        p_image_embedding,
        v_is_cash,
        v_amount,
        nullif(btrim(coalesce(p_finder_name, '')), ''),
        nullif(btrim(coalesce(p_finder_contact, '')), ''),
        nullif(btrim(coalesce(p_ai_caption, '')), '')
    )
    returning id into v_item_id;

    select i.ref_code into v_ref_code from public.items i where i.id = v_item_id;

    return query select v_ref_code, v_item_id;
end;
$$;

revoke all on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text, vector, vector
) from public;

-- TEMPORARY (dev mock auth): the web client runs on the anon key because real
-- Supabase Auth / staff provisioning is not wired up yet (see
-- web/src/context/StaffAuthContext.jsx). This grant is what lets that mock
-- session log intake. Revoke the `anon` grant and keep only `authenticated`
-- once the staff provider signs in for real.
grant execute on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text, vector, vector
) to anon, authenticated;
