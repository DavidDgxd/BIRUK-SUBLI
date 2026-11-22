-- Issue #123: real-Postgres masking tests for every public item RPC.
-- Run: psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -f supabase/tests/match_items_masking.sql
\set ON_ERROR_STOP on

create extension if not exists vector;

-- pg_trgm supplies similarity() for the lexical half. WASM Postgres builds
-- without it get a zero-score stub; lexical ranking is not under test here.
do $$
begin
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'similarity') then
        begin
            execute 'create extension if not exists pg_trgm';
        exception when others then
            execute 'create function public.similarity(text, text) returns real language sql immutable as ' || quote_literal('select 0::real');
        end;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then execute 'create role anon nologin'; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'create role authenticated nologin'; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then execute 'create role service_role nologin'; end if;
end $$;

create table public.offices (id text primary key, name text not null, counter_hours text, address text);
create table public.items (
    id uuid primary key, ref_code text, title text, category text, status text, image_url text,
    holding_office_id text references public.offices(id), date_received date, created_at timestamptz,
    is_cash boolean not null default false, embedding vector(512), text_embedding vector(384),
    image_embedding vector(512), search_text text
);
create or replace function public.search_tokens (q text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
    select coalesce(array_agg(distinct token), '{}'::text[])
    from unnest(regexp_split_to_array(lower(coalesce(q, '')), '[^[:alnum:]]+')) as token
    where length(token) >= 3;
$$;

\ir ../migrations/20261114120000_public_browse_items.sql
\ir ../migrations/20261121120000_match_items_redact_cash_documents.sql

create function pg_temp.vec(a float, b float default 0) returns vector(512)
language sql as $$ select ('[' || a || ',' || b || ',' || repeat('0,', 509) || '0]')::vector(512) $$;
create function pg_temp.vec384(a float, b float default 0) returns vector(384)
language sql as $$ select ('[' || a || ',' || b || ',' || repeat('0,', 381) || '0]')::vector(384) $$;

insert into public.offices values ('office-1', 'Central Office', 'Mon-Fri 8-5', 'City Hall');
insert into public.items (id, ref_code, title, category, status, image_url, holding_office_id, date_received, created_at, is_cash, embedding, text_embedding, search_text) values
    ('11111111-1111-1111-1111-111111111101', 'REF-GENERAL', 'Blue umbrella', 'General', 'held', 'umbrella.jpg', 'office-1', current_date - 1, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Blue umbrella General')),
    ('11111111-1111-1111-1111-111111111102', 'REF-CASH-CATEGORY', 'Brown envelope', 'Cash', 'held', 'cash-cat.jpg', 'office-1', current_date - 2, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Brown envelope Cash')),
    ('11111111-1111-1111-1111-111111111103', 'REF-CASH-FLAG', 'Wallet with cash', 'Other', 'held', 'cash-flag.jpg', 'office-1', current_date - 3, now(), true, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Wallet with cash Other')),
    ('11111111-1111-1111-1111-111111111104', 'REF-DOC-NEW', 'Juan Dela Cruz ID', 'Documents / IDs', 'held', 'id-new.jpg', 'office-1', current_date - 4, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Juan Dela Cruz ID Documents / IDs')),
    ('11111111-1111-1111-1111-111111111105', 'REF-DOC-LEGACY', 'Maria Santos passport', 'Document/ID', 'held', 'id-legacy.jpg', 'office-1', current_date - 5, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Maria Santos passport Document/ID')),
    ('11111111-1111-1111-1111-111111111106', 'REF-RELEASED-DOC', 'Released ID', 'Documents / IDs', 'released', 'id-released.jpg', 'office-1', current_date - 6, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Released ID Documents / IDs')),
    ('11111111-1111-1111-1111-111111111107', 'REF-TRANSFERRED', 'Transferred wallet', 'General', 'transferred', 'wallet.jpg', 'office-1', current_date - 7, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Transferred wallet General')),
    ('11111111-1111-1111-1111-111111111108', 'REF-RESOLVED', 'Resolved bag', 'General', 'resolved', 'bag.jpg', 'office-1', current_date - 8, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Resolved bag General')),
    ('11111111-1111-1111-1111-111111111109', 'REF-DISPOSED', 'Disposed phone', 'General', 'disposed', 'phone.jpg', 'office-1', current_date - 9, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Disposed phone General'));

create temp table results as
    select 'match_items' rpc, id, title, category, image_url from public.match_items(pg_temp.vec(1, 0), 0.55, 50, null, null, null)
    union all select 'match_items_hybrid', id, title, category, image_url from public.match_items_hybrid(pg_temp.vec(1, 0), 0.55, 50, null, null, null, 'blue umbrella wallet document id')
    union all select 'match_items_two_tower', id, title, category, image_url from public.match_items_two_tower(pg_temp.vec384(1, 0), null, 0.0, 50, null, null, null, 'blue umbrella wallet document id')
    union all select 'list_public_items', id, title, category, image_url from public.list_public_items(50, 0, null, null, null)
    union all select 'get_item_public', g.id, g.title, g.category, g.image_url from public.items i cross join lateral public.get_item_public(i.id) g;

create temp table expected (id uuid primary key, title text, category text, image_url text);
insert into expected values
    ('11111111-1111-1111-1111-111111111101', 'Blue umbrella', 'General', 'umbrella.jpg'),
    ('11111111-1111-1111-1111-111111111102', 'Cash', 'Cash', null),
    ('11111111-1111-1111-1111-111111111103', 'Cash', 'Cash', null),
    ('11111111-1111-1111-1111-111111111104', 'Documents / IDs', 'Documents / IDs', null),
    ('11111111-1111-1111-1111-111111111105', 'Documents / IDs', 'Document/ID', null);

do $$
declare
    n int;
    t text;
begin
    select count(*) into n
    from (values ('match_items'), ('match_items_hybrid'), ('match_items_two_tower'),
                 ('list_public_items'), ('get_item_public')) r(rpc)
    cross join expected e
    left join results x on x.rpc = r.rpc and x.id = e.id
    where x.id is null or x.title is distinct from e.title
       or x.category is distinct from e.category or x.image_url is distinct from e.image_url;
    if n > 0 then raise exception '% missing or wrongly masked expected rows', n; end if;

    select count(*) into n
    from (values ('match_items'), ('match_items_hybrid'), ('match_items_two_tower'),
                 ('list_public_items'), ('get_item_public')) r(rpc)
    left join (select rpc, count(*) total from results group by rpc) c on c.rpc = r.rpc
    where c.total is distinct from 5;
    if n > 0 then raise exception '% RPCs returned the wrong row count', n; end if;

    select count(*) into n from results
    where id in ('11111111-1111-1111-1111-111111111106'::uuid, '11111111-1111-1111-1111-111111111107'::uuid,
                 '11111111-1111-1111-1111-111111111108'::uuid, '11111111-1111-1111-1111-111111111109'::uuid);
    if n > 0 then raise exception '% non-held rows leaked', n; end if;

    select title into t from public.match_items(pg_temp.vec(1, 0), 0.55, 50, null, null, null)
      order by similarity desc limit 1;
    if t is distinct from 'Blue umbrella' then raise exception 'ranking regressed: %', t; end if;
end $$;
