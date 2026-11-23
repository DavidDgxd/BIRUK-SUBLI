-- Issue #130: vector scores must not reveal masked Cash and Documents / IDs text.
-- #129 masked the lexical half, but `similarity`, `text_similarity`,
-- `image_similarity` and the vector part of `score` still came from
-- `items.embedding` / `items.text_embedding` / `items.image_embedding`, all
-- built from the raw title and caption. A query naming a hidden title therefore
-- out-scored an unrelated one for its own masked row (measured with the real
-- CLIP legacy model: 0.719 for "juan dela cruz" vs 0.492 for "zebra", a 0.227
-- gap that crossed the 0.55 floor).
--
-- Masked rows now report a fixed neutral score (0.55, the public floor) and no
-- image similarity, so nothing in the returned scores depends on the hidden
-- text or photo. Non-masked rows keep their exact vectors and ranking, and the
-- staff-only reverse-match RPC still reads the full `items.embedding`, so
-- US-16 recall is untouched. Ordering ties fall back to the public
-- date_received/id pair instead of a secret-dependent vector.

-- Neutral public vector score for a masked row; the real value for everyone
-- else. 0.55 is the same floor the legacy RPCs apply, so masked rows remain
-- visible exactly as before without exposing a hidden-text-derived number.
create or replace function public.mask_public_similarity(
    p_similarity float, p_category text, p_is_cash boolean
) returns float language sql immutable set search_path = public as $$
    select case
        when public.mask_public_kind(p_category, p_is_cash) is null then p_similarity
        else 0.55
    end
$$;
revoke all on function public.mask_public_similarity(float, text, boolean) from public;

-- Masked rows expose no image similarity: the stored image_embedding still
-- describes the hidden photo/caption, so it must not contribute a score.
create or replace function public.mask_public_image_similarity(
    p_similarity float, p_category text, p_is_cash boolean
) returns float language sql immutable set search_path = public as $$
    select case
        when public.mask_public_kind(p_category, p_is_cash) is null then p_similarity
    end
$$;
revoke all on function public.mask_public_image_similarity(float, text, boolean) from public;

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
        sims.similarity
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join lateral (
        select public.mask_public_similarity(
            1 - (items.embedding <=> query_embedding),
            items.category, items.is_cash
        ) as similarity
    ) as sims
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and sims.similarity >= greatest(match_threshold, 0.55)
    order by sims.similarity desc, items.date_received desc, items.id desc
    limit match_count;
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
        sims.similarity,
        case when cardinality(input.tokens) = 0 then null else lexical.lexical_score end as lexical_score,
        sims.similarity + 0.25 * coalesce(lexical.lexical_score, 0) as score
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join input
    cross join lateral (
        select public.mask_public_similarity(
            1 - (items.embedding <=> query_embedding),
            items.category, items.is_cash
        ) as similarity
    ) as sims
    cross join lateral (
        select public.mask_public_search_text(items.search_text, items.category, items.is_cash) as search_text
    ) as src
    cross join lateral (
        select greatest(
            coalesce((select max(case when src.search_text ~ ('\m' || token || '\M') then 1.0 else 0.0 end)
                      from unnest(input.tokens) as token), 0.0),
            coalesce(similarity(src.search_text, lower(coalesce(query_text, ''))), 0.0)
        )::float as lexical_score
    ) as lexical
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and sims.similarity >= greatest(match_threshold, 0.55)
    order by score desc, items.date_received desc, items.id desc
    limit match_count;
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
            case when query_text_embedding is not null
                 then public.mask_public_similarity(
                     case when items.text_embedding is not null
                          then 1 - (items.text_embedding <=> query_text_embedding) end,
                     items.category, items.is_cash)
            end as text_similarity,
            case when query_image_embedding is not null
                 then public.mask_public_image_similarity(
                     case when items.image_embedding is not null
                          then 1 - (items.image_embedding <=> query_image_embedding) end,
                     items.category, items.is_cash)
            end as image_similarity
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
        select public.mask_public_search_text(items.search_text, items.category, items.is_cash) as search_text
    ) as src
    cross join lateral (
        select greatest(
            coalesce((select max(case when src.search_text ~ ('\m' || token || '\M') then 1.0 else 0.0 end)
                      from unnest(input.tokens) as token), 0.0),
            coalesce(similarity(src.search_text, lower(coalesce(query_text, ''))), 0.0)
        )::float as lexical_score
    ) as lexical
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and (
          (query_text_embedding is not null
           and (public.mask_public_kind(items.category, items.is_cash) is not null
                or items.text_embedding is not null))
          or (query_image_embedding is not null and items.image_embedding is not null)
      )
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and vector_score.value >= match_threshold
    order by score desc, items.date_received desc, items.id desc
    limit match_count;
$$;
revoke all on function public.match_items_two_tower(vector, vector, double precision, integer, text, date, date, text) from public;
grant execute on function public.match_items_two_tower(vector, vector, double precision, integer, text, date, date, text) to anon, authenticated, service_role;
