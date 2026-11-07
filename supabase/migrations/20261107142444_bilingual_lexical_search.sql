-- Bilingual query expansion + lexical ranking for public search.
--
-- US-22 translated Filipino with a curated language gate and opus-mt. That
-- stack could rewrite English ("charger" -> "RATION") and silently skipped
-- words missing from the gate. The AI service now appends English synonyms
-- instead (ai-service/glossary.py) and passes the expanded words here as
-- query_text. This migration adds the lexical half of the hybrid:
--
--   score = vector cosine similarity + 0.25 * lexical match
--
-- The lexical text is deliberately limited to fields the public may already
-- infer: title, category and the photo caption. `description` holds staff-only
-- verification marks and must never influence public ranking.
--
-- The new function has its own name so the existing six-argument match_items
-- keeps working for clients that have not deployed the hybrid yet. PostgREST
-- cannot resolve two overloads from the same named arguments, so a wrapper
-- with the old name is not an option.

create extension if not exists pg_trgm;

alter table public.items
    add column if not exists search_text text generated always as (
        lower(
            coalesce(title, '') || ' ' ||
            coalesce(category, '') || ' ' ||
            coalesce(ai_caption, '')
        )
    ) stored;

create index if not exists items_search_text_trgm_idx
on public.items using gin (search_text gin_trgm_ops);

-- Splits a query into content tokens. Function words are dropped so a token
-- that does appear in a title is not diluted by "the", "with", "na" or "mga".
drop function if exists public.search_tokens(text);

create or replace function public.search_tokens (q text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
    select coalesce(array_agg(distinct token), '{}'::text[])
    from unnest(
        regexp_split_to_array(lower(coalesce(q, '')), '[^[:alnum:]]+')
    ) as token
    where
        length(token) >= 3
        and token not in (
            'the', 'and', 'for', 'with', 'my', 'our', 'your', 'from',
            'this', 'that', 'was', 'has', 'have', 'ang', 'mga', 'na',
            'ng', 'sa', 'si', 'ni', 'ko', 'mo', 'ka', 'ako', 'ikaw',
            'siya', 'ito', 'iyan', 'yung', 'may', 'meron', 'wala',
            'at', 'para', 'dahil'
        );
$$;

revoke all on function public.search_tokens(text) from public;

drop function if exists public.match_items_hybrid(
    vector, double precision, integer, text, date, date, text
);

create or replace function public.match_items_hybrid (
    query_embedding vector(512),
    match_threshold float default 0.55,
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
    similarity float,
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
        1 - (items.embedding <=> query_embedding) as similarity,
        lexical.lexical_score,
        (1 - (items.embedding <=> query_embedding))
            + 0.25 * lexical.lexical_score as score
    from public.items
    join public.offices on items.holding_office_id = offices.id
    cross join input
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
        and items.embedding is not null
        and (filter_office is null or items.holding_office_id = filter_office)
        and (date_from is null or items.date_received >= date_from)
        and (date_to is null or items.date_received <= date_to)
        and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by score desc
    limit match_count;
$$;

revoke all on function public.match_items_hybrid(
    vector, double precision, integer, text, date, date, text
) from public;
grant execute on function public.match_items_hybrid(
    vector, double precision, integer, text, date, date, text
) to anon, authenticated, service_role;
