-- Issue #123: real-Postgres masking tests for the public item RPCs.
-- CI runs this against the pgvector Postgres service in the schema job:
--   psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -f supabase/tests/match_items_masking.sql
\set ON_ERROR_STOP on

create extension if not exists vector;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then execute 'create role anon nologin'; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'create role authenticated nologin'; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then execute 'create role service_role nologin'; end if;
end $$;

create table public.offices (
    id text primary key,
    name text not null,
    counter_hours text,
    address text
);

create table public.items (
    id uuid primary key,
    ref_code text,
    title text,
    category text,
    status text,
    image_url text,
    holding_office_id text references public.offices(id),
    date_received date,
    created_at timestamptz,
    is_cash boolean not null default false,
    embedding vector(512)
);

\ir ../migrations/20261104120000_exclude_released_resolved_from_search.sql
\ir ../migrations/20261114120000_public_browse_items.sql
\ir ../migrations/20261121120000_match_items_redact_cash_documents.sql

create function pg_temp.vec(a float, b float default 0) returns vector(512)
language sql as $$
    select ('[' || a || ',' || b || ',' || repeat('0,', 509) || '0]')::vector(512)
$$;

insert into public.offices values ('office-1', 'Central Office', 'Mon-Fri 8-5', 'City Hall');
insert into public.items (id, ref_code, title, category, status, image_url, holding_office_id, date_received, created_at, is_cash, embedding) values
    ('11111111-1111-1111-1111-111111111101', 'REF-GENERAL', 'Blue umbrella', 'General', 'held', 'umbrella.jpg', 'office-1', current_date - 1, now(), false, pg_temp.vec(1, 0)),
    ('11111111-1111-1111-1111-111111111102', 'REF-CASH-CATEGORY', 'Brown envelope', 'Cash', 'held', 'cash-cat.jpg', 'office-1', current_date - 2, now(), false, pg_temp.vec(0.9, 0.43589)),
    ('11111111-1111-1111-1111-111111111103', 'REF-CASH-FLAG', 'Wallet with cash', 'Other', 'held', 'cash-flag.jpg', 'office-1', current_date - 3, now(), true, pg_temp.vec(0.9, 0.43589)),
    ('11111111-1111-1111-1111-111111111104', 'REF-DOC-NEW', 'Juan Dela Cruz ID', 'Documents / IDs', 'held', 'id-new.jpg', 'office-1', current_date - 4, now(), false, pg_temp.vec(0.9, 0.43589)),
    ('11111111-1111-1111-1111-111111111105', 'REF-DOC-LEGACY', 'Maria Santos passport', 'Document/ID', 'held', 'id-legacy.jpg', 'office-1', current_date - 5, now(), false, pg_temp.vec(0.9, 0.43589)),
    ('11111111-1111-1111-1111-111111111106', 'REF-RELEASED-DOC', 'Released ID', 'Documents / IDs', 'released', 'id-released.jpg', 'office-1', current_date - 6, now(), false, pg_temp.vec(1, 0)),
    ('11111111-1111-1111-1111-111111111107', 'REF-TRANSFERRED', 'Transferred wallet', 'General', 'transferred', 'wallet.jpg', 'office-1', current_date - 7, now(), false, pg_temp.vec(1, 0)),
    ('11111111-1111-1111-1111-111111111108', 'REF-RESOLVED', 'Resolved bag', 'General', 'resolved', 'bag.jpg', 'office-1', current_date - 8, now(), false, pg_temp.vec(1, 0)),
    ('11111111-1111-1111-1111-111111111109', 'REF-DISPOSED', 'Disposed phone', 'General', 'disposed', 'phone.jpg', 'office-1', current_date - 9, now(), false, pg_temp.vec(1, 0));

create temp table matched as
    select * from public.match_items(pg_temp.vec(1, 0), 0.55, 50, null, null, null);

do $$
declare
    n int;
    t text;
    c text;
    i text;
begin
    select count(*) into n from matched;
    if n <> 5 then raise exception 'match_items returned % rows, expected 5 held rows', n; end if;
    if exists (select 1 from matched where ref_code in ('REF-RELEASED-DOC', 'REF-TRANSFERRED', 'REF-RESOLVED', 'REF-DISPOSED')) then
        raise exception 'match_items leaked a non-held row';
    end if;

    select title, category, image_url into t, c, i from matched where ref_code = 'REF-CASH-CATEGORY';
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'cash category not masked: %/%/%', t, c, i; end if;
    select title, category, image_url into t, c, i from matched where ref_code = 'REF-CASH-FLAG';
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'is_cash flag not masked: %/%/%', t, c, i; end if;

    select title, image_url into t, i from matched where ref_code = 'REF-DOC-NEW';
    if t <> 'Documents / IDs' or i is not null then raise exception 'Documents / IDs not masked: %/%', t, i; end if;
    select title, image_url into t, i from matched where ref_code = 'REF-DOC-LEGACY';
    if t <> 'Documents / IDs' or i is not null then raise exception 'Document/ID not masked: %/%', t, i; end if;

    select title, category, image_url into t, c, i from matched where ref_code = 'REF-GENERAL';
    if t <> 'Blue umbrella' or c <> 'General' or i <> 'umbrella.jpg' then raise exception 'general row changed: %/%/%', t, c, i; end if;
    select title into t from matched order by similarity desc limit 1;
    if t <> 'Blue umbrella' then raise exception 'ranking regressed, top row is %', t; end if;

    select count(*) into n from public.list_public_items(50, 0, null, null, null);
    if n <> 5 then raise exception 'list_public_items returned % rows, expected 5', n; end if;
    select title, category, image_url into t, c, i from public.list_public_items(50, 0, null, null, null) where id = '11111111-1111-1111-1111-111111111102';
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'list_public_items cash category not masked: %/%/%', t, c, i; end if;
    select title, category, image_url into t, c, i from public.list_public_items(50, 0, null, null, null) where id = '11111111-1111-1111-1111-111111111103';
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'list_public_items cash flag not masked: %/%/%', t, c, i; end if;
    select title, image_url into t, i from public.list_public_items(50, 0, null, null, null) where id = '11111111-1111-1111-1111-111111111104';
    if t <> 'Documents / IDs' or i is not null then raise exception 'list_public_items current document not masked: %/%', t, i; end if;
    select title, image_url into t, i from public.list_public_items(50, 0, null, null, null) where id = '11111111-1111-1111-1111-111111111105';
    if t <> 'Documents / IDs' or i is not null then raise exception 'list_public_items legacy document not masked: %/%', t, i; end if;

    select title, category, image_url into t, c, i from public.get_item_public('11111111-1111-1111-1111-111111111102');
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'get_item_public cash category not masked: %/%/%', t, c, i; end if;
    select title, category, image_url into t, c, i from public.get_item_public('11111111-1111-1111-1111-111111111103');
    if t <> 'Cash' or c <> 'Cash' or i is not null then raise exception 'get_item_public cash flag not masked: %/%/%', t, c, i; end if;
    select title, image_url into t, i from public.get_item_public('11111111-1111-1111-1111-111111111104');
    if t <> 'Documents / IDs' or i is not null then raise exception 'get_item_public current document not masked: %/%', t, i; end if;
    select title, image_url into t, i from public.get_item_public('11111111-1111-1111-1111-111111111105');
    if t <> 'Documents / IDs' or i is not null then raise exception 'get_item_public legacy document not masked: %/%', t, i; end if;

    select count(*) into n
      from unnest(array['11111111-1111-1111-1111-111111111106', '11111111-1111-1111-1111-111111111107',
                        '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111109']::uuid[]) as x(id)
      join lateral public.get_item_public(x.id) g on true;
    if n <> 0 then raise exception 'get_item_public returned a non-held row'; end if;
end $$;
