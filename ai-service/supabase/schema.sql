-- Enable pgvector
create extension if not exists vector;

-- Items Table
create table public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  office_id text not null default 'BCPIO',
  status text not null default 'found' check (status in ('found', 'lost', 'claimed', 'archived')),
  photo_url text,
  embedding vector(512),
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.items enable row level security;

-- Public read access for found items
create policy "Allow public read access to found items"
on public.items
for select
to anon, authenticated
using (status = 'found');

-- Authenticated staff insert/update access
create policy "Allow authenticated staff to manage items"
on public.items
for all
to authenticated
using (true)
with check (true);

-- Vector Search RPC Function
create or replace function match_items (
  query_embedding vector(512),
  match_threshold float default 0.23,
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  description text,
  category text,
  photo_url text,
  similarity float
)
language sql stable
as $$
  select
    items.id,
    items.title,
    items.description,
    items.category,
    items.photo_url,
    1 - (items.embedding <=> query_embedding) as similarity
  from items
  where items.status = 'found'
    and 1 - (items.embedding <=> query_embedding) > match_threshold
  order by items.embedding <=> query_embedding
  limit match_count;
$$;
