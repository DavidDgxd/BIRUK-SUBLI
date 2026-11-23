-- Issues #123 and #128: real-Postgres masking tests for every public item RPC.
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
    ('11111111-1111-1111-1111-111111111102', 'REF-CASH-CATEGORY', 'Brown envelope', 'Cash', 'held', 'cash-cat.jpg', 'office-1', current_date - 2, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Brown envelope Cash five thousand pesos inside')),
    ('11111111-1111-1111-1111-111111111103', 'REF-CASH-FLAG', 'Wallet with cash', 'Other', 'held', 'cash-flag.jpg', 'office-1', current_date - 3, now(), true, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Wallet with cash Other folded bills')),
    ('11111111-1111-1111-1111-111111111104', 'REF-DOC-NEW', 'Juan Dela Cruz ID', 'Documents / IDs', 'held', 'id-new.jpg', 'office-1', current_date - 4, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Juan Dela Cruz ID Documents / IDs issued in quezon')),
    ('11111111-1111-1111-1111-111111111105', 'REF-DOC-LEGACY', 'Maria Santos passport', 'Document/ID', 'held', 'id-legacy.jpg', 'office-1', current_date - 5, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Maria Santos passport Document/ID burgundy cover')),
    ('11111111-1111-1111-1111-111111111106', 'REF-RELEASED-DOC', 'Released ID', 'Documents / IDs', 'released', 'id-released.jpg', 'office-1', current_date - 6, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Released ID Documents / IDs')),
    ('11111111-1111-1111-1111-111111111107', 'REF-TRANSFERRED', 'Transferred wallet', 'General', 'transferred', 'wallet.jpg', 'office-1', current_date - 7, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Transferred wallet General')),
    ('11111111-1111-1111-1111-111111111108', 'REF-RESOLVED', 'Resolved bag', 'General', 'resolved', 'bag.jpg', 'office-1', current_date - 8, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Resolved bag General')),
    ('11111111-1111-1111-1111-111111111109', 'REF-DISPOSED', 'Disposed phone', 'General', 'disposed', 'phone.jpg', 'office-1', current_date - 9, now(), false, pg_temp.vec(1, 0), pg_temp.vec384(1, 0), lower('Disposed phone General')),
    ('11111111-1111-1111-1111-111111111110', 'REF-GENERAL-CAPTION', 'Phone case', 'Electronics', 'held', 'case.jpg', 'office-1', current_date - 13, now(), false, pg_temp.vec(0.8, 0.6), pg_temp.vec384(0.8, 0.6), lower('Phone case Electronics black case with a cracked corner'));

-- Issue #128: keyword-scored output of both search RPCs for a fixed set of
-- queries. Captured on the #124 definitions, then again after the #128 migration.
create function pg_temp.lexical_rows() returns table (label text, rpc text, id uuid, lexical_score float, score float, rank bigint)
language sql as $$
    with queries(label, text) as (values
        ('mixed', 'blue umbrella wallet document id'), ('umbrella', 'umbrella'),
        ('caption', 'cracked corner'), ('cash', 'cash'), ('documents', 'documents'),
        ('secret', 'juan dela cruz maria santos passport brown envelope wallet 5000'),
        ('hidden', 'santos 5000'), ('caption-hidden', 'thousand quezon folded burgundy'),
        ('unrelated', 'zebra'), ('empty', ''), ('photo-only', null))
    select q.label, 'match_items_hybrid', h.id, h.lexical_score, h.score,
           row_number() over (partition by q.label order by h.score desc, h.id)
    from queries q
    cross join lateral public.match_items_hybrid(pg_temp.vec(1, 0), 0.55, 50, null, null, null, q.text) h
    union all
    select q.label, 'match_items_two_tower', t.id, t.lexical_score, t.score,
           row_number() over (partition by q.label order by t.score desc, t.id)
    from queries q
    cross join lateral public.match_items_two_tower(pg_temp.vec384(1, 0), null, 0.0, 50, null, null, null, q.text) t
$$;

create temp table lexical_before as select * from pg_temp.lexical_rows();

\ir ../migrations/20261123120000_mask_lexical_search_text.sql
\ir ../migrations/20261124120000_mask_vector_search_scores.sql

create temp table results as
    select 'match_items' rpc, id, title, category, image_url from public.match_items(pg_temp.vec(1, 0), 0.55, 50, null, null, null)
    union all select 'match_items_hybrid', id, title, category, image_url from public.match_items_hybrid(pg_temp.vec(1, 0), 0.55, 50, null, null, null, 'blue umbrella wallet document id')
    union all select 'match_items_two_tower', id, title, category, image_url from public.match_items_two_tower(pg_temp.vec384(1, 0), null, 0.0, 50, null, null, null, 'blue umbrella wallet document id')
    union all select 'list_public_items', id, title, category, image_url from public.list_public_items(50, 0, null, null, null)
    union all select 'get_item_public', g.id, g.title, g.category, g.image_url from public.items i cross join lateral public.get_item_public(i.id) g;

create temp table expected (id uuid primary key, title text, category text, image_url text);
insert into expected values
    ('11111111-1111-1111-1111-111111111101', 'Blue umbrella', 'General', 'umbrella.jpg'),
    ('11111111-1111-1111-1111-111111111110', 'Phone case', 'Electronics', 'case.jpg'),
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
    where c.total is distinct from 6;
    if n > 0 then raise exception '% RPCs returned the wrong row count', n; end if;

    select count(*) into n from results
    where id in ('11111111-1111-1111-1111-111111111106'::uuid, '11111111-1111-1111-1111-111111111107'::uuid,
                 '11111111-1111-1111-1111-111111111108'::uuid, '11111111-1111-1111-1111-111111111109'::uuid);
    if n > 0 then raise exception '% non-held rows leaked', n; end if;

    select title into t from public.match_items(pg_temp.vec(1, 0), 0.55, 50, null, null, null)
      order by similarity desc limit 1;
    if t is distinct from 'Blue umbrella' then raise exception 'ranking regressed: %', t; end if;
end $$;

-- Issue #128: keyword scores must not reveal masked text. Controls share each
-- masked row's public text and vectors but hide different text, so any score
-- gap between a masked row and its control would come from the hidden text.
insert into public.items (id, ref_code, title, category, status, image_url, holding_office_id, date_received, created_at, is_cash, embedding, text_embedding, search_text) values
    ('11111111-1111-1111-1111-111111111111', 'REF-CASH-CONTROL', 'Coin purse', 'Cash', 'held', 'purse.jpg', 'office-1', current_date - 10, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Coin purse Cash')),
    ('11111111-1111-1111-1111-111111111112', 'REF-DOC-CONTROL', 'Library card', 'Documents / IDs', 'held', 'card.jpg', 'office-1', current_date - 11, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Library card Documents / IDs')),
    ('11111111-1111-1111-1111-111111111113', 'REF-DOC-LEGACY-CONTROL', 'Bus pass', 'Document/ID', 'held', 'pass.jpg', 'office-1', current_date - 12, now(), false, pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589), lower('Bus pass Document/ID'));

create temp table lexical as select * from pg_temp.lexical_rows();

-- Each masked row paired with the control that has the same public text.
create temp table masked_pairs (masked uuid, control uuid);
insert into masked_pairs values
    ('11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111111'),
    ('11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111111'),
    ('11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111112'),
    ('11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111113');

do $$
declare
    n int;
begin
    -- A hidden term scores a masked row exactly like its control.
    select count(*) into n from (values ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    cross join (values ('secret'), ('hidden'), ('caption-hidden')) q(label)
    cross join masked_pairs p
    left join lexical m on m.label = q.label and m.rpc = r.rpc and m.id = p.masked
    left join lexical c on c.label = q.label and c.rpc = r.rpc and c.id = p.control
    where m.id is null or c.id is null
       or m.lexical_score is distinct from c.lexical_score or m.score is distinct from c.score;
    if n > 0 then raise exception '% masked rows score differently from their control: hidden text leaks', n; end if;

    -- A hidden-only term, from the title or only the caption, scores a masked
    -- row exactly like an unrelated term. None of "santos 5000", "thousand
    -- quezon folded burgundy" or "zebra" shares a trigram with the masked text.
    select count(*) into n from (values ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    cross join (values ('hidden'), ('caption-hidden')) q(label)
    cross join masked_pairs p
    left join lexical h on h.label = q.label and h.rpc = r.rpc and h.id = p.masked
    left join lexical u on u.label = 'unrelated' and u.rpc = r.rpc and u.id = p.masked
    where h.id is null or u.id is null
       or h.lexical_score is distinct from u.lexical_score or h.score is distinct from u.score;
    if n > 0 then raise exception '% masked rows score a hidden term differently from an unrelated one', n; end if;

    select count(*) into n from lexical
    where label in ('secret', 'hidden', 'caption-hidden') and id in (select masked from masked_pairs) and lexical_score >= 1;
    if n > 0 then raise exception '% masked rows got a keyword hit on hidden text', n; end if;

    -- Public text still matches: masked rows on their masked title, unmasked
    -- rows on their title and caption.
    select count(*) into n from (values ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    cross join (values ('cash', '11111111-1111-1111-1111-111111111102'::uuid),
                       ('cash', '11111111-1111-1111-1111-111111111103'::uuid),
                       ('documents', '11111111-1111-1111-1111-111111111104'::uuid),
                       ('documents', '11111111-1111-1111-1111-111111111105'::uuid),
                       ('umbrella', '11111111-1111-1111-1111-111111111101'::uuid),
                       ('caption', '11111111-1111-1111-1111-111111111110'::uuid)) e(label, id)
    left join lexical x on x.label = e.label and x.rpc = r.rpc and x.id = e.id
    where x.lexical_score is distinct from 1::float;
    if n > 0 then raise exception '% public-text keyword hits were lost', n; end if;

    -- A query with no tokens (empty text, or the photo-only path with
    -- query_text null) returns a null lexical_score for every row.
    select count(*) into n from lexical where label in ('empty', 'photo-only') and lexical_score is not null;
    if n > 0 then raise exception '% rows returned a lexical_score for a query with no tokens', n; end if;

    select count(*) into n from (values ('empty'), ('photo-only')) q(label)
    cross join (values ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    left join (select label, rpc, count(*) total from lexical group by label, rpc) c on c.label = q.label and c.rpc = r.rpc
    where c.total is distinct from 9;
    if n > 0 then raise exception '% no-token queries returned the wrong row count', n; end if;

    -- Unmasked rows keep their #124 lexical_score, score and relative order.
    select count(*) into n
    from lexical_before b
    left join lexical a on a.label = b.label and a.rpc = b.rpc and a.id = b.id
    where b.id in ('11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111110'::uuid)
      and (a.id is null or a.lexical_score is distinct from b.lexical_score or a.score is distinct from b.score);
    if n > 0 then raise exception '% unmasked rows changed lexical_score or score', n; end if;

    select count(*) into n from (
        select label, rpc, id, row_number() over (partition by label, rpc order by rank) pos
        from lexical_before
        where id in ('11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111110'::uuid)
    ) b
    left join (
        select label, rpc, id, row_number() over (partition by label, rpc order by rank) pos
        from lexical
        where id in ('11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111110'::uuid)
    ) a on a.label = b.label and a.rpc = b.rpc and a.id = b.id
    where a.pos is distinct from b.pos;
    if n > 0 then raise exception '% unmasked rows changed relative order', n; end if;
end $$;

-- Issue #130: vector scores must not reveal masked title/caption text either.
-- A hidden-title query and an unrelated query must produce identical
-- similarity, text_similarity, image_similarity and score for a masked row, and
-- that row must match a control row with the same public text.
create function pg_temp.vector_rows() returns table (
    label text, rpc text, id uuid, similarity float,
    text_similarity float, image_similarity float, score float
)
language sql as $$
    with queries(label, text, emb512, emb384) as (values
        ('hidden', 'juan dela cruz maria santos passport 5000',
         pg_temp.vec(0.9, 0.43589), pg_temp.vec384(0.9, 0.43589)),
        ('unrelated', 'zebra', pg_temp.vec(0, 1), pg_temp.vec384(0, 1))
    )
    select q.label, 'match_items', m.id, m.similarity, null::float, null::float, null::float
    from queries q
    cross join lateral public.match_items(q.emb512, 0.0, 50, null, null, null) m
    union all
    select q.label, 'match_items_hybrid', h.id, h.similarity, null::float, null::float, h.score
    from queries q
    cross join lateral public.match_items_hybrid(q.emb512, 0.0, 50, null, null, null, q.text) h
    union all
    select q.label, 'match_items_two_tower', t.id, null::float, t.text_similarity, t.image_similarity, t.score
    from queries q
    cross join lateral public.match_items_two_tower(q.emb384, null, 0.0, 50, null, null, null, q.text) t
$$;

create temp table vector_scores as select * from pg_temp.vector_rows();

do $$
declare
    n int;
begin
    -- Every masked row and its public-text control report the same vector
    -- columns, for both a hidden-title and an unrelated query.
    select count(*) into n
    from (values ('match_items'), ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    cross join (values ('hidden'), ('unrelated')) q(label)
    cross join masked_pairs p
    left join vector_scores m on m.label = q.label and m.rpc = r.rpc and m.id = p.masked
    left join vector_scores c on c.label = q.label and c.rpc = r.rpc and c.id = p.control
    where m.id is null or c.id is null
       or m.similarity is distinct from c.similarity
       or m.text_similarity is distinct from c.text_similarity
       or m.image_similarity is distinct from c.image_similarity
       or m.score is distinct from c.score;
    if n > 0 then raise exception '% masked vector scores diverge from their control', n; end if;

    -- A query naming the hidden text scores a masked row exactly like an
    -- unrelated term: nothing shifts on hidden title or caption.
    select count(*) into n
    from (values ('match_items'), ('match_items_hybrid'), ('match_items_two_tower')) r(rpc)
    cross join masked_pairs p
    left join vector_scores h on h.label = 'hidden' and h.rpc = r.rpc and h.id = p.masked
    left join vector_scores u on u.label = 'unrelated' and u.rpc = r.rpc and u.id = p.masked
    where h.id is null or u.id is null
       or h.similarity is distinct from u.similarity
       or h.text_similarity is distinct from u.text_similarity
       or h.image_similarity is distinct from u.image_similarity
       or h.score is distinct from u.score;
    if n > 0 then raise exception '% hidden-title query shifts a masked vector score', n; end if;

    -- The neutral columns are populated, not hidden behind a null.
    select count(*) into n from vector_scores v
    where v.id in (select masked from masked_pairs)
      and ((v.rpc in ('match_items', 'match_items_hybrid') and v.similarity is null)
        or (v.rpc = 'match_items_two_tower' and v.text_similarity is null)
        or (v.rpc in ('match_items_hybrid', 'match_items_two_tower') and v.score is null));
    if n > 0 then raise exception '% masked vector scores were null', n; end if;

    -- Masked rows expose no photo signal of their own.
    select count(*) into n from vector_scores v
    where v.rpc = 'match_items_two_tower' and v.id in (select masked from masked_pairs)
      and v.image_similarity is not null;
    if n > 0 then raise exception '% masked rows leaked an image similarity', n; end if;
end $$;

