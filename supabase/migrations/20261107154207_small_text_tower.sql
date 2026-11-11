-- Replace BGE-M3 with a small English retrieval tower.
--
-- The glossary turns a Filipino query into English before it reaches this
-- tower, so the tensor does not need to be multilingual. BGE-small-en-v1.5
-- keeps the same retrieval quality on the demo inventory while using roughly
-- 130 MB instead of 2.2 GB.
--
-- Existing 1024-dim text vectors cannot be cast to 384, so they are cleared
-- and rebuilt by ai-service/backfill_two_tower_embeddings.py. Text search
-- returns no rows until that backfill runs: the client only falls back when the
-- RPC errors, not when it returns an empty result. Run the backfill
-- immediately after applying this migration.

update public.items set text_embedding = null;

drop index if exists public.items_text_embedding_hnsw_idx;

alter table public.items
    alter column text_embedding type vector(384);

create index if not exists items_text_embedding_hnsw_idx
on public.items using hnsw (text_embedding vector_cosine_ops);

drop function if exists public.match_items_two_tower(
    vector, vector, double precision, integer, text, date, date, text
);

create or replace function public.match_items_two_tower (
    query_text_embedding vector(384) default null,
    query_image_embedding vector(512) default null,
    match_threshold float default 0.30,
    match_count int default 15,
    filter_office text default null,
    date_from date default null,
    date_to date default null,
    query_text text default null
)
returns table (
    id uuid,
    ref_code text,
    title text,
    category text,
    status text,
    image_url text,
    holding_office_id text,
    holding_office_name text,
    counter_hours text,
    office_address text,
    created_at timestamptz,
    text_similarity float,
    image_similarity float,
    lexical_score float,
    score float
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
    with input as (
        select public.search_tokens(query_text) as tokens
    )
    select
        items.id,
        items.ref_code,
        items.title,
        items.category,
        items.status,
        items.image_url,
        items.holding_office_id,
        offices.name as holding_office_name,
        offices.counter_hours,
        offices.address as office_address,
        items.created_at,
        sims.text_similarity,
        sims.image_similarity,
        -- A photo-only query has no tokens, so there is nothing to match
        -- lexically. Return null instead of 0 so the client falls back to its
        -- vector floor rather than demanding a strong score with no lexical hit.
        case
            when cardinality(input.tokens) = 0 then null
            else lexical.lexical_score
        end as lexical_score,
        vector_score.value + 0.25 * coalesce(lexical.lexical_score, 0) as score
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join input
    cross join lateral (
        select
            case
                when query_text_embedding is not null
                     and items.text_embedding is not null
                then 1 - (items.text_embedding <=> query_text_embedding)
            end as text_similarity,
            case
                when query_image_embedding is not null
                     and items.image_embedding is not null
                then 1 - (items.image_embedding <=> query_image_embedding)
            end as image_similarity
    ) as sims
    cross join lateral (
        select case
            when sims.text_similarity is not null
                 and sims.image_similarity is not null
            then 0.65 * sims.text_similarity + 0.35 * sims.image_similarity
            when sims.text_similarity is not null then sims.text_similarity
            else sims.image_similarity
        end as value
    ) as vector_score
    cross join lateral (
        select greatest(
            coalesce(
                (
                    select max(
                        case
                            when items.search_text ~ ('\m' || token || '\M')
                            then 1.0
                            else 0.0
                        end
                    )
                    from unnest(input.tokens) as token
                ),
                0.0
            ),
            coalesce(
                similarity(
                    items.search_text,
                    lower(coalesce(query_text, ''))
                ),
                0.0
            )
        )::float as lexical_score
    ) as lexical
    where
        items.status not in ('released', 'resolved', 'transferred', 'disposed')
        and (
            (query_text_embedding is not null and items.text_embedding is not null)
            or (query_image_embedding is not null and items.image_embedding is not null)
        )
        and (filter_office is null or items.holding_office_id = filter_office)
        and (date_from is null or items.date_received >= date_from)
        and (date_to is null or items.date_received <= date_to)
        and vector_score.value >= match_threshold
    order by score desc
    limit match_count;
$$;

revoke all on function public.match_items_two_tower(
    vector, vector, double precision, integer, text, date, date, text
) from public;
grant execute on function public.match_items_two_tower(
    vector, vector, double precision, integer, text, date, date, text
) to anon, authenticated, service_role;

-- Staff intake gains the two public-safe embeddings. The legacy p_embedding is
-- still accepted and written so the pre-two-tower client and the reverse-match
-- flows keep working during rollout.
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
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
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
        'held',
        btrim(p_image_url),
        p_date_received,
        p_office_id,
        p_office_id,
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
    returning ref_code into v_ref_code;

    return v_ref_code;
end;
$$;

revoke all on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text, vector, vector
) from public;

-- TEMPORARY (dev mock auth): the web client runs on the anon key because real
-- Supabase Auth / staff provisioning is not wired up yet.
grant execute on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text, uuid, text, vector, vector
) to anon, authenticated;
