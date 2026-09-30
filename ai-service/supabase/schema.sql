-- Enable Required Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- 1. Offices Table
create table public.offices (
    id text primary key,
    name text not null,
    address text not null,
    counter_hours text not null,
    auth_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 2. Items Table
create table public.items (
    id uuid primary key default gen_random_uuid(),
    ref_code text unique not null,
    title text not null,
    description text not null,
    category text not null,
    status text not null default 'held' check (
        status in ('held', 'pending_verification', 'claimed', 'released', 'transferred', 'disposed')
    ),
    image_url text,
    is_cash boolean default false not null,
    cash_amount numeric(10, 2) default 0.00,
    holding_office_id text not null references public.offices(id) on delete restrict,
    logging_office_id text not null references public.offices(id) on delete restrict,
    embedding vector(512),
    ai_caption text,
    created_at timestamptz default timezone('utc'::text, now()) not null,
    updated_at timestamptz default timezone('utc'::text, now()) not null
);

create index items_embedding_hnsw_idx 
on public.items using hnsw (embedding vector_cosine_ops);

create index items_status_idx on public.items (status);
create index items_holding_office_idx on public.items (holding_office_id);

-- 3. Match Items Function
create or replace function public.match_items (
    query_embedding vector(512),
    match_threshold float default 0.20,
    match_count int default 10
)
returns table (
    id uuid,
    ref_code text,
    title text,
    description text,
    category text,
    status text,
    image_url text,
    holding_office_id text,
    created_at timestamptz,
    similarity float
)
language sql stable
as $$
    select
        items.id,
        items.ref_code,
        items.title,
        items.description,
        items.category,
        items.status,
        items.image_url,
        items.holding_office_id,
        items.created_at,
        1 - (items.embedding <=> query_embedding) as similarity
    from public.items
    where 
        items.status not in ('released', 'disposed', 'claimed')
        and items.embedding is not null
        and (1 - (items.embedding <=> query_embedding)) > match_threshold
    order by similarity desc
    limit match_count;
$$;
