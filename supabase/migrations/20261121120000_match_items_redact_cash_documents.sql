-- Issue #123: the public search RPC must mask Cash and Documents / IDs exactly
-- like list_public_items and get_item_public (US-32). The signature, return type,
-- SECURITY DEFINER, pinned search_path, status exclusion and ranking are kept.

create or replace function public.match_items (
    query_embedding vector(512),
    match_threshold float default 0.55,
    match_count int default 15,
    filter_office text default null,
    date_from date default null,
    date_to date default null
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
    similarity float
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
    select
        items.id,
        items.ref_code,
        case
            when items.is_cash or items.category = 'Cash' then 'Cash'
            when lower(btrim(items.category)) in ('documents / ids', 'document/id') then 'Documents / IDs'
            else items.title
        end as title,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.category end as category,
        items.status,
        case when items.is_cash or items.category = 'Cash' or lower(btrim(items.category)) in ('documents / ids', 'document/id') then null else items.image_url end as image_url,
        items.holding_office_id,
        offices.name as holding_office_name,
        offices.counter_hours,
        offices.address as office_address,
        items.created_at,
        1 - (items.embedding <=> query_embedding) as similarity
    from public.items
    join public.offices on items.holding_office_id = offices.id
    where items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      and (filter_office is null or items.holding_office_id = filter_office)
      and (date_from is null or items.date_received >= date_from)
      and (date_to is null or items.date_received <= date_to)
      and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by similarity desc
    limit match_count;
$$;

revoke all on function public.match_items(vector, double precision, integer, text, date, date) from public;
grant execute on function public.match_items(vector, double precision, integer, text, date, date)
    to anon, authenticated, service_role;
