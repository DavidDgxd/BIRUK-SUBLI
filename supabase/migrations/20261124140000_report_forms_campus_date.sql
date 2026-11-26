-- ============================================================================
-- Lost and found self-reports: check the date against the campus date (UTC+8).
--
-- submit_lost_report and submit_found_report rejected dates later than
-- current_date, the UTC date on the database. Both public forms default the
-- date to the reporter's local date, so between 00:00 and 07:59 Asia/Manila
-- the default was one day ahead of UTC and was rejected as in the future.
-- Same cause as #136 (staff intake). (#139)
--
-- Both checks now use the Asia/Manila calendar date. Signatures and return
-- types are unchanged. submit_found_report had no migration before this one;
-- its body matches ai-service/supabase/schema.sql and the live function.
-- ============================================================================

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
    if p_date_lost > (now() at time zone 'Asia/Manila')::date then
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

create or replace function public.submit_found_report(
    p_short_note     text,
    p_found_location text,
    p_found_date     date,
    p_image_url      text,
    p_finder_contact text default null,
    p_embedding      vector(512) default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
begin
    if p_short_note is null or btrim(p_short_note) = '' then
        raise exception 'A short note is required.' using errcode = '22023';
    end if;
    if p_found_location is null or btrim(p_found_location) = '' then
        raise exception 'A found location is required.' using errcode = '22023';
    end if;
    if p_found_date is null then
        raise exception 'A date is required.' using errcode = '22023';
    end if;
    if p_found_date > (now() at time zone 'Asia/Manila')::date then
        raise exception 'The date cannot be in the future.' using errcode = '22023';
    end if;
    if p_image_url is null or btrim(p_image_url) = '' then
        raise exception 'A photo is required.' using errcode = '22023';
    end if;

    insert into public.found_reports
        (short_note, found_location, found_date, image_url, finder_contact, embedding)
    values
        (btrim(p_short_note),
         btrim(p_found_location),
         p_found_date,
         btrim(p_image_url),
         nullif(btrim(coalesce(p_finder_contact, '')), ''),
         p_embedding)
    returning ref_code into v_ref_code;

    return v_ref_code;
end;
$$;

revoke all on function public.submit_found_report(text, text, date, text, text, vector)
    from public;
grant execute on function public.submit_found_report(text, text, date, text, text, vector)
    to anon, authenticated;
