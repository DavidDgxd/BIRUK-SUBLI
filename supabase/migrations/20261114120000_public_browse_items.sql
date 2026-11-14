-- US-32: public held-items browse. Anonymous SELECT on public.items is revoked
-- (ADR-004); this SECURITY DEFINER projection exposes held rows only, with cash
-- announced as "Cash" and no staff notes, storage, finder, claimant or amount.

create or replace function public.list_public_items (
    p_limit int default 12,
    p_offset int default 0,
    p_office text default null,
    p_date_from date default null,
    p_date_to date default null
)
returns table (
    id uuid, title text, category text, status text,
    image_url text, date_received date,
    holding_office_id text, holding_office_name text
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
    select
        items.id,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.title end as title,
        case when items.is_cash or items.category = 'Cash' then 'Cash' else items.category end as category,
        items.status,
        case when items.is_cash or items.category = 'Document/ID' then null else items.image_url end as image_url,
        items.date_received,
        items.holding_office_id, offices.name as holding_office_name
    from public.items
    join public.offices on items.holding_office_id = offices.id
    where items.status = 'held'
      and (p_office is null or items.holding_office_id = p_office)
      and (p_date_from is null or items.date_received >= p_date_from)
      and (p_date_to is null or items.date_received <= p_date_to)
    order by items.date_received desc, items.id desc
    limit least(greatest(p_limit, 1), 25)
    offset greatest(p_offset, 0);
$$;

revoke all on function public.list_public_items(integer, integer, text, date, date) from public;
grant execute on function public.list_public_items(integer, integer, text, date, date) to anon, authenticated, service_role;
