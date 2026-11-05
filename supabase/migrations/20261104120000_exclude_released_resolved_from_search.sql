-- US-15: exclude released and resolved items from public search.
--
-- `match_items` is the only vector-search path the public has, so its status
-- predicate is the guarantee that an item stops appearing the moment it leaves
-- custody. `released` covers a counter handover and `resolved` covers the
-- resolved/destroyed case (stored as `disposed` in the current items check);
-- `transferred` is listed too because an endorsed-out item is no longer held.
--
-- The signature and return type are unchanged, so CREATE OR REPLACE is enough.
-- The status list is stated as exclusions rather than `status = 'held'` so the
-- US-15 rule stays explicit if another terminal status is introduced.

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
        items.title,
        items.category,
        items.status,
        items.image_url,
        items.holding_office_id,
        offices.name as holding_office_name,
        offices.counter_hours,
        offices.address as office_address,
        items.created_at,
        1 - (items.embedding <=> query_embedding) as similarity
    from public.items
    join public.offices on items.holding_office_id = offices.id
    where
        -- Released/resolved rows (and the other terminal custody states) are
        -- not live results, even though their embeddings remain stored.
        items.status not in ('released', 'resolved', 'transferred', 'disposed')
        and items.embedding is not null
        and (filter_office is null or items.holding_office_id = filter_office)
        and (date_from is null or items.date_received >= date_from)
        and (date_to is null or items.date_received <= date_to)
        -- Hard floor: callers may raise the bar but never drop below 0.55.
        and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by similarity desc
    limit match_count;
$$;

revoke all on function public.match_items(vector, double precision, integer, text, date, date) from public;
grant execute on function public.match_items(vector, double precision, integer, text, date, date)
    to anon, authenticated, service_role;


-- The detail page is the other public read path. Keep its status rule identical
-- to match_items so a released or resolved record cannot outlive the search
-- that hid it by being opened from an old link.
create or replace function public.get_item_public (item_id_input uuid)
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
    created_at timestamptz
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
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
        items.created_at
    from public.items
    join public.offices on items.holding_office_id = offices.id
    where items.id = item_id_input
      and items.status not in ('released', 'resolved', 'transferred', 'disposed');
$$;

revoke all on function public.get_item_public(uuid) from public;
grant execute on function public.get_item_public(uuid)
    to anon, authenticated, service_role;
