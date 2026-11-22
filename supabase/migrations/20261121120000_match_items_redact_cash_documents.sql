-- Issue #123: mask Cash and Documents / IDs in every public search RPC.
-- The helpers keep match_items, match_items_hybrid and match_items_two_tower
-- aligned with list_public_items/get_item_public. Signatures, SECURITY DEFINER,
-- pinned search_path, status exclusion and ranking are unchanged.

create or replace function public.mask_public_title(p_title text, p_category text, p_is_cash boolean)
returns text language sql immutable set search_path = public as $$
    select case
        when coalesce(p_is_cash, false) or p_category = 'Cash' then 'Cash'
        when lower(btrim(coalesce(p_category, ''))) in ('documents / ids', 'document/id') then 'Documents / IDs'
        else p_title
    end
$$;
create or replace function public.mask_public_image_url(p_image_url text, p_category text, p_is_cash boolean)
returns text language sql immutable set search_path = public as $$
    select case
        when coalesce(p_is_cash, false) or p_category = 'Cash'
             or lower(btrim(coalesce(p_category, ''))) in ('documents / ids', 'document/id') then null
        else p_image_url
    end
$$;
revoke all on function public.mask_public_title(text, text, boolean) from public;
revoke all on function public.mask_public_image_url(text, text, boolean) from public;

create or replace function public.match_items(
    query_embedding vector(512), match_threshold float default 0.55,
    match_count int default 15, filter_office text default null,
    date_from date default null, date_to date default null
) returns table (
    id uuid, ref_code text, title text, category text, status text, image_url text,
    holding_office_id text, holding_office_name text, counter_hours text,
    office_address text, created_at timestamptz, similarity float
) language sql stable security definer set search_path = public, pg_temp as $$
    select
        items.id, items.ref_code,
        public.mask_public_title(items.title, items.category, items.is_cash) as title,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.category end as category,
        items.status,
        public.mask_public_image_url(items.image_url, items.category, items.is_cash) as image_url,
        items.holding_office_id, offices.name as holding_office_name,
        offices.counter_hours, offices.address as office_address, items.created_at,
        1 - (items.embedding <=> query_embedding) as similarity
    from public.items
    join public.offices on items.holding_office_id = offices.id
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by similarity desc limit match_count;
$$;
revoke all on function public.match_items(vector, double precision, integer, text, date, date) from public;
grant execute on function public.match_items(vector, double precision, integer, text, date, date) to anon, authenticated, service_role;

create or replace function public.match_items_hybrid(
    query_embedding vector(512), match_threshold float default 0.55,
    match_count int default 15, filter_office text default null,
    date_from date default null, date_to date default null, query_text text default null
) returns table (
    id uuid, ref_code text, title text, category text, status text, image_url text,
    holding_office_id text, holding_office_name text, counter_hours text,
    office_address text, created_at timestamptz, similarity float,
    lexical_score float, score float
) language sql stable security definer set search_path = public, pg_temp as $$
    with input as (select public.search_tokens(query_text) as tokens)
    select
        items.id, items.ref_code,
        public.mask_public_title(items.title, items.category, items.is_cash) as title,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.category end as category,
        items.status,
        public.mask_public_image_url(items.image_url, items.category, items.is_cash) as image_url,
        items.holding_office_id, offices.name as holding_office_name,
        offices.counter_hours, offices.address as office_address, items.created_at,
        1 - (items.embedding <=> query_embedding) as similarity,
        case when cardinality(input.tokens) = 0 then null else lexical.lexical_score end as lexical_score,
        (1 - (items.embedding <=> query_embedding)) + 0.25 * coalesce(lexical.lexical_score, 0) as score
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join input
    cross join lateral (
        select greatest(
            coalesce((select max(case when items.search_text ~ ('\m' || token || '\M') then 1.0 else 0.0 end)
                      from unnest(input.tokens) as token), 0.0),
            coalesce(similarity(items.search_text, lower(coalesce(query_text, ''))), 0.0)
        )::float as lexical_score
    ) as lexical
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by score desc limit match_count;
$$;
revoke all on function public.match_items_hybrid(vector, double precision, integer, text, date, date, text) from public;
grant execute on function public.match_items_hybrid(vector, double precision, integer, text, date, date, text) to anon, authenticated, service_role;

create or replace function public.match_items_two_tower(
    query_text_embedding vector(384) default null,
    query_image_embedding vector(512) default null,
    match_threshold float default 0.30, match_count int default 15,
    filter_office text default null, date_from date default null,
    date_to date default null, query_text text default null
) returns table (
    id uuid, ref_code text, title text, category text, status text, image_url text,
    holding_office_id text, holding_office_name text, counter_hours text,
    office_address text, created_at timestamptz, text_similarity float,
    image_similarity float, lexical_score float, score float
) language sql stable security definer set search_path = public, pg_temp as $$
    with input as (select public.search_tokens(query_text) as tokens)
    select
        items.id, items.ref_code,
        public.mask_public_title(items.title, items.category, items.is_cash) as title,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.category end as category,
        items.status,
        public.mask_public_image_url(items.image_url, items.category, items.is_cash) as image_url,
        items.holding_office_id, offices.name as holding_office_name,
        offices.counter_hours, offices.address as office_address, items.created_at,
        sims.text_similarity, sims.image_similarity,
        case when cardinality(input.tokens) = 0 then null else lexical.lexical_score end as lexical_score,
        vector_score.value + 0.25 * coalesce(lexical.lexical_score, 0) as score
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join input
    cross join lateral (
        select
            case when query_text_embedding is not null and items.text_embedding is not null
                 then 1 - (items.text_embedding <=> query_text_embedding) end as text_similarity,
            case when query_image_embedding is not null and items.image_embedding is not null
                 then 1 - (items.image_embedding <=> query_image_embedding) end as image_similarity
    ) as sims
    cross join lateral (
        select case
            when sims.text_similarity is not null and sims.image_similarity is not null
            then 0.65 * sims.text_similarity + 0.35 * sims.image_similarity
            when sims.text_similarity is not null then sims.text_similarity
            else sims.image_similarity
        end as value
    ) as vector_score
    cross join lateral (
        select greatest(
            coalesce((select max(case when items.search_text ~ ('\m' || token || '\M') then 1.0 else 0.0 end)
                      from unnest(input.tokens) as token), 0.0),
            coalesce(similarity(items.search_text, lower(coalesce(query_text, ''))), 0.0)
        )::float as lexical_score
    ) as lexical
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and ((query_text_embedding is not null and items.text_embedding is not null)
           or (query_image_embedding is not null and items.image_embedding is not null))
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and vector_score.value >= match_threshold
    order by score desc limit match_count;
$$;
revoke all on function public.match_items_two_tower(vector, vector, double precision, integer, text, date, date, text) from public;
grant execute on function public.match_items_two_tower(vector, vector, double precision, integer, text, date, date, text) to anon, authenticated, service_role;
