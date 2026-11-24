-- ============================================================================
-- Staff intake: check the receipt date against the campus date (UTC+8).
--
-- submit_staff_custody compared p_date_received with current_date, which is
-- the UTC date on the database. The intake form defaults "Date received" to
-- the staffer's local date, so between 00:00 and 07:59 Asia/Manila the default
-- was one day ahead of UTC and every submit failed with "The receipt date
-- cannot be in the future." (#136)
--
-- The campus runs on Asia/Manila time, so both the parameter default and the
-- future-date check now use that calendar date. Signature and return type are
-- unchanged, so create or replace keeps the existing grants.
-- ============================================================================

create or replace function public.submit_staff_custody(
    p_office_id        text,
    p_title            text,
    p_description      text,
    p_storage_location text,
    p_image_url        text,
    p_category         text default 'General',
    p_embedding        vector(512) default null,
    p_date_received    date default (now() at time zone 'Asia/Manila')::date,
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
    if p_date_received > (now() at time zone 'Asia/Manila')::date then
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
