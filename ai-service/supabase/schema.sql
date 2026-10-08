-- ============================================================================
-- BIRUK SUBLI: Core Database Schema 
-- ============================================================================

-- 0. SYSTEM EXTENSIONS
-- Enables UUID primary keys and pgvector cosine distance operations
create extension if not exists "uuid-ossp";
create extension if not exists "vector";


-- ============================================================================
-- 1. REFERENCE NUMBER SEQUENCES
-- Generates human-readable, collision-free codes for counter paper trails
-- ============================================================================
create sequence if not exists items_ref_seq start 100;
create sequence if not exists found_reports_ref_seq start 100;
create sequence if not exists lost_reports_ref_seq start 100;


-- ============================================================================
-- 2. PARTICIPATING OFFICES DIRECTORY
-- Authoritative registry of physical drop-off locations and desk credentials.
-- Connected as the primary foreign key target for all custody transfers.
-- ============================================================================
create table if not exists public.offices (
    id text primary key,                               -- Unique site key (e.g. 'BCPIO', 'CITY_HALL_INFO')
    name text not null,                                -- Official public-facing office name
    address text not null,                             -- Physical floor, building, and location details
    counter_hours text not null,                       -- Public operating schedule
    phone_number text not null default '(074) 442-1111',
    map_pin text,                                      -- Geospatial URI or map coordinates
    status text not null default 'active' check (status in ('active', 'suspended')),
    auth_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz default timezone('utc'::text, now()) not null
);


-- ============================================================================
-- 3. FOUND ITEMS INVENTORY & CUSTODY LOGBOOK
-- Central ledger of all physical property officially received at a city counter.
-- Uses single-table inheritance for cash attributes and counter-release auditing.
-- ============================================================================
create table if not exists public.items (
    id uuid primary key default gen_random_uuid(),
    ref_code text unique not null default ('BS-' || lpad(nextval('items_ref_seq')::text, 4, '0')),
    title text not null,
    -- Staff-only verification notes: marks, serial numbers, contents, condition.
    -- Never returned by match_items — the public sees the title + category only,
    -- so a claimant cannot read the marks and use them to pass the desk check.
    description text not null,
    category text not null default 'General',          -- Classification ('General', 'Cash', 'Document/ID')
    status text not null default 'held' check (
        -- 'held': in municipal custody and searchable
        -- 'released': returned to owner in person
        -- 'transferred': endorsed out of network (e.g., forwarded to PNP)
        -- 'disposed': resolved / destroyed per city regulations
        status in ('held', 'released', 'transferred', 'disposed')
    ),
    image_url text,
    date_received date not null default current_date,

    -- Physical slot the item sits in at the holding counter (e.g. "Locker 2,
    -- Bin B"). Staff-internal: deliberately not returned by match_items.
    storage_location text,

    -- Multi-Office Custody Relationships:
    -- holding_office_id represents where the item is physically stored right now.
    -- logging_office_id records the original intake location for tracking history.
    holding_office_id text not null references public.offices(id) on delete restrict,
    logging_office_id text not null references public.offices(id) on delete restrict,

    -- Vector Search & Vision Captioning:
    -- 512-dimension dense vector produced by the local CLIP embedding microservice.
    embedding vector(512),
    ai_caption text,

    -- Currency Retention Attributes (Civil Code Art. 720 Compliance):
    -- Cash is kept discreet; monetary figures are excluded from announcements.
    is_cash boolean default false not null,
    cash_amount numeric(10, 2) default 0.00,
    reward_date date,                                  -- Evaluated via trigger: date_received + 6 months
    finder_name text,                                  -- Mandatory for cash to fulfill the reward claim
    finder_contact text,
    finder_address text,

    -- In-Person Counter Release Verification:
    -- Retains traceability without storing sensitive identity document images.
    releasing_office_id text references public.offices(id) on delete restrict,
    claimant_name text,                                -- Name verified against government-issued ID
    claimant_id_ref text,                              -- ID Type + last 4 characters only (e.g. 'UMID-4921')
    release_notes text,                                -- Custody exceptions (e.g., authorization letters)
    released_at timestamptz,

    created_at timestamptz default timezone('utc'::text, now()) not null,
    updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Fast indexing for vector similarity and multi-office filtering
create index if not exists items_embedding_hnsw_idx 
on public.items using hnsw (embedding vector_cosine_ops);

create index if not exists items_status_idx on public.items (status);
create index if not exists items_holding_office_idx on public.items (holding_office_id);
create index if not exists items_date_received_idx on public.items (date_received);

-- Trigger: Automatically enforces the 6-month holding deadline on cash deposits
create or replace function public.calculate_cash_reward_date()
returns trigger language plpgsql as $$
begin
    if new.is_cash = true and new.reward_date is null then
        new.reward_date := new.date_received + interval '6 months';
    end if;
    return new;
end;
$$;

drop trigger if exists trigger_cash_reward_date on public.items;
create trigger trigger_cash_reward_date
before insert or update on public.items
for each row execute function public.calculate_cash_reward_date();


-- ============================================================================
-- 4. PUBLIC FOUND-ITEM SELF-REPORTS
-- Staging table for items reported by finders prior to physical drop-off.
-- Connected to the staff intake workflow to pre-fill logs on handover.
-- ============================================================================
create table if not exists public.found_reports (
    id uuid primary key default gen_random_uuid(),
    ref_code text unique not null default ('FR-' || lpad(nextval('found_reports_ref_seq')::text, 4, '0')),
    image_url text not null,
    short_note text not null,
    found_location text not null,
    found_date date not null,
    finder_contact text,                               -- Optional citizen phone or email
    embedding vector(512),                             -- Optional note/location/photo vector for reverse matching
    status text not null default 'pending' check (
        status in ('pending', 'converted_at_intake', 'no_show')
    ),
    created_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists found_reports_embedding_hnsw_idx
on public.found_reports using hnsw (embedding vector_cosine_ops);

create index if not exists found_reports_status_idx on public.found_reports (status);


-- ============================================================================
-- 5. CITIZEN LOST-ITEM REPORTS & REVERSE MATCHING
-- Inverted search registry storing missing item descriptions as vectors.
-- Allows new intake records to actively match against past citizen inquiries.
-- ============================================================================
create table if not exists public.lost_reports (
    id uuid primary key default gen_random_uuid(),
    ref_code text unique not null default ('LR-' || lpad(nextval('lost_reports_ref_seq')::text, 4, '0')),
    description text not null,
    image_url text,                                    -- Optional citizen-provided photo
    area_route text not null,                          -- General area where item went missing
    date_lost date not null,
    contact_info text,                                 -- Staff-visible contact for notification
    embedding vector(512) not null,                    -- Pre-calculated vector for background matching
    status text not null default 'open' check (
        status in ('open', 'resolved', 'closed_by_user')
    ),
    created_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists lost_reports_embedding_hnsw_idx 
on public.lost_reports using hnsw (embedding vector_cosine_ops);

create index if not exists lost_reports_status_idx on public.lost_reports (status);

-- Junction table tracking false or dismissed pairings
-- Connects items to lost_reports, ensuring staff do not re-evaluate ignored alerts.
create table if not exists public.dismissed_matches (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.items(id) on delete cascade,
    lost_report_id uuid not null references public.lost_reports(id) on delete cascade,
    dismissed_at timestamptz default timezone('utc'::text, now()) not null,
    unique(item_id, lost_report_id)
);


-- ============================================================================
-- 6. RPC: CITIZEN VECTOR SEARCH
-- Computes cosine similarity between a user query vector and held inventory.
-- Joins with offices to provide physical counter details and supports metadata filters.
--
-- Similarity here is calibrated against the photo-backed distribution:
-- unrelated queries ("bottle", "wallet") score 0.55-0.58, a semantic synonym
-- ("blower") lands near 0.60 and a direct match ("fan") near 0.675. The default
-- floor of 0.55 sits just above that noise band so the client can separate
-- confident results from low-confidence "other possible matches"; callers that
-- only want confident results pass a higher threshold (the web client passes
-- 0.55 and splits the two bands at 0.60).
--
-- SECURITY DEFINER + public-safe projection: this is the ONLY way an anonymous
-- caller reaches `items`. description (the staff verification notes),
-- storage_location, cash and claimant fields are deliberately not returned — if
-- a would-be claimant can read the marks, they can pass the counter check. Anon
-- has no table-level SELECT on items at all (see section 12).
-- ============================================================================
-- Dropped first because removing `description` changes the return type, which
-- `create or replace` refuses to alter. Safe to re-run: absent on a fresh DB.
drop function if exists public.match_items(vector, double precision, integer, text, date);

create or replace function public.match_items (
    query_embedding vector(512),
    match_threshold float default 0.55,
    match_count int default 15,
    filter_office text default null,
    date_from date default null
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
        items.status = 'held'                          -- Excludes released/disposed items
        and items.embedding is not null
        and (filter_office is null or items.holding_office_id = filter_office)
        and (date_from is null or items.date_received >= date_from)
        -- Hard floor: callers may raise the bar but never drop below 0.55.
        and (1 - (items.embedding <=> query_embedding)) >= greatest(match_threshold, 0.55)
    order by similarity desc
    limit match_count;
$$;

revoke all on function public.match_items(vector, double precision, integer, text, date) from public;
grant execute on function public.match_items(vector, double precision, integer, text, date)
    to anon, authenticated, service_role;


-- ============================================================================
-- 7. RPC: REVERSE MATCHING ENGINE
-- Compares newly logged items against open citizen lost-reports.
-- Excludes previously reviewed or dismissed candidate pairings.
-- ============================================================================
create or replace function public.match_lost_reports (
    item_id_input uuid,
    item_embedding vector(512),
    match_threshold float default 0.20,
    match_count int default 5
)
returns table (
    lost_report_id uuid,
    ref_code text,
    description text,
    image_url text,
    area_route text,
    date_lost date,
    contact_info text,
    similarity float
)
language sql stable
as $$
    select
        lr.id as lost_report_id,
        lr.ref_code,
        lr.description,
        lr.image_url,
        lr.area_route,
        lr.date_lost,
        lr.contact_info,
        1 - (lr.embedding <=> item_embedding) as similarity
    from public.lost_reports lr
    where lr.status = 'open'
      and not exists (
          select 1 from public.dismissed_matches dm 
          where dm.item_id = item_id_input and dm.lost_report_id = lr.id
      )
      and (1 - (lr.embedding <=> item_embedding)) > match_threshold
    order by similarity desc
    limit match_count;
$$;


-- ============================================================================
-- 8. RPC: COUNTER RELEASE AUDIT
-- Atomic operation executed when a claimant presents valid ID at the desk.
-- Updates item status to 'released', withdrawing it immediately from public search.
-- ============================================================================
create or replace function public.release_item_at_counter(
    p_item_id uuid,
    p_releasing_office_id text,
    p_claimant_name text,
    p_claimant_id_ref text,
    p_release_notes text default null
)
returns void
language plpgsql
security definer
as $$
begin
    update public.items
    set 
        status = 'released',
        releasing_office_id = p_releasing_office_id,
        claimant_name = p_claimant_name,
        claimant_id_ref = p_claimant_id_ref,
        release_notes = p_release_notes,
        released_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    where id = p_item_id;
end;
$$;


-- ============================================================================
-- 9. RPC: CUSTODY TRANSFER TRANSACTION
-- Moves physical custody between participating desks while preserving searchability.
-- ============================================================================
create or replace function public.transfer_item_custody(
    p_item_id uuid,
    p_new_office_id text
)
returns void
language plpgsql
security definer
as $$
begin
    update public.items
    set 
        holding_office_id = p_new_office_id,
        updated_at = timezone('utc'::text, now())
    where id = p_item_id;
end;
$$;

-- ============================================================================
-- 10. STAFF ACTION VIEW
-- Aggregates approaching 6-month statutory deadlines for currency items.
-- ============================================================================
create or replace view public.staff_reminders_view
with (security_invoker = true)
as
select 
    id,
    ref_code,
    holding_office_id,
    'cash_due_6mo' as reminder_type,
    'Six months held. Contact finder for reward under current policy.' as message,
    reward_date
from public.items
where is_cash = true 
  and status = 'held' 
  and reward_date <= current_date

union all

select 
    id,
    ref_code,
    holding_office_id,
    'cash_warning_3wk' as reminder_type,
    'Reward date in 3 weeks.' as message,
    reward_date
from public.items
where is_cash = true 
  and status = 'held' 
  and reward_date between current_date and (current_date + interval '21 days');

-- Restrict reminders to authenticated counter staff
revoke all on public.staff_reminders_view from anon, public;
grant select on public.staff_reminders_view to authenticated;

-- ============================================================================
-- 11. RPC: CENTRAL ADMINISTRATIVE USAGE REPORT
-- Compiles custodial metrics across offices without exposing private citizen data.
-- ============================================================================
create or replace function public.get_usage_report(
    p_start_date date,
    p_end_date date,
    p_office_id text default null
)
returns table (
    office_id text,
    office_name text,
    items_logged bigint,
    items_released bigint,
    items_currently_held bigint,
    avg_days_held numeric
)
language sql stable
as $$
    select 
        o.id as office_id,
        o.name as office_name,
        count(i.id) filter (where i.date_received between p_start_date and p_end_date) as items_logged,
        count(i.id) filter (where i.released_at::date between p_start_date and p_end_date) as items_released,
        count(i.id) filter (where i.status = 'held') as items_currently_held,
        round(coalesce(avg(i.released_at::date - i.date_received) filter (where i.status = 'released'), 0), 1) as avg_days_held
    from public.offices o
    left join public.items i on o.id = i.holding_office_id
    where (p_office_id is null or o.id = p_office_id)
    group by o.id, o.name;
$$;


-- ============================================================================
-- 12. SECURITY & ROW LEVEL SECURITY (RLS) POLICIES
-- Balances unauthenticated public search with protected counter operations.
-- ============================================================================
alter table public.offices enable row level security;
alter table public.items enable row level security;
alter table public.found_reports enable row level security;
alter table public.lost_reports enable row level security;
alter table public.dismissed_matches enable row level security;

-- Offices: Everyone can view the physical directory
create policy "Offices are viewable by everyone" 
on public.offices for select to public using (true);

-- Items: the public has NO direct table access. A row-only RLS policy would
-- still expose every column of a held item through PostgREST, including the
-- verification notes in `description` and the physical `storage_location`, so
-- the public read policy is dropped and anon's SELECT privilege revoked. Public
-- search goes exclusively through the SECURITY DEFINER match_items RPC, which
-- returns only the safe projection. Staff and the seeding script keep access.
revoke select on public.items from anon;
revoke select on public.items from public;
drop policy if exists "Public can view held items" on public.items;
grant select on public.items to authenticated;
grant select on public.items to service_role;

create policy "Staff have full access to items"
on public.items for all to authenticated using (true);

-- Found Reports: Public can insert new self-reports; staff can review all
create policy "Anyone can submit a found report" 
on public.found_reports for insert to public with check (true);

create policy "Staff can manage found reports" 
on public.found_reports for all to authenticated using (true);

-- Lost Reports: Public can insert search alerts; only staff can view contacts
create policy "Anyone can submit a lost report" 
on public.lost_reports for insert to public with check (true);

create policy "Staff can view and manage lost reports" 
on public.lost_reports for all to authenticated using (true);

-- Dismissed Matches: Authenticated counter staff only
create policy "Staff can manage dismissed matches" 
on public.dismissed_matches for all to authenticated using (true);


-- ============================================================================
-- 10. PUBLIC LOST-REPORT SUBMISSION RPC
--
-- Why this exists: lost_reports has an INSERT policy for `anon` but no SELECT
-- policy (contact_info is staff-visible PII, so an anon SELECT policy would
-- leak every report). Without SELECT, PostgREST cannot return the inserted
-- row, so an anonymous client can never read back the generated ref_code.
-- This SECURITY DEFINER function inserts and returns only the ref_code, so a
-- citizen gets a receipt without any row-level read access.
-- ============================================================================
create or replace function public.submit_lost_report(
    p_description  text,
    p_area_route   text,
    p_date_lost    date,
    p_contact_info text default null,
    p_image_url    text default null,
    p_embedding    vector(512) default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
begin
    if p_description is null or btrim(p_description) = '' then
        raise exception 'A description is required.' using errcode = '22023';
    end if;
    if p_area_route is null or btrim(p_area_route) = '' then
        raise exception 'An area or route is required.' using errcode = '22023';
    end if;
    if p_date_lost is null then
        raise exception 'A date is required.' using errcode = '22023';
    end if;
    if p_date_lost > current_date then
        raise exception 'The date cannot be in the future.' using errcode = '22023';
    end if;
    if p_embedding is null then
        raise exception 'An embedding is required.' using errcode = '22023';
    end if;

    insert into public.lost_reports
        (description, area_route, date_lost, contact_info, image_url, embedding)
    values
        (btrim(p_description),
         btrim(p_area_route),
         p_date_lost,
         nullif(btrim(coalesce(p_contact_info, '')), ''),
         nullif(btrim(coalesce(p_image_url, '')), ''),
         p_embedding)
    returning ref_code into v_ref_code;

    return v_ref_code;
end;
$$;

revoke all on function public.submit_lost_report(text, text, date, text, text, vector) from public;
grant execute on function public.submit_lost_report(text, text, date, text, text, vector) to anon, authenticated;


-- ============================================================================
-- 13. PUBLIC FOUND-REPORT SUBMISSION RPC
--
-- Mirrors submit_lost_report for the same reason: found_reports has an INSERT
-- policy for `anon` but no SELECT policy (finder_contact is staff-visible PII),
-- so PostgREST cannot return the inserted row and an anonymous client can never
-- read back the generated ref_code. This SECURITY DEFINER function inserts and
-- returns only that code. image_url is required — the finder's photo is uploaded
-- to the item-photos bucket first and stored with the report.
-- ============================================================================
create or replace function public.submit_found_report(
    p_short_note     text,
    p_found_location text,
    p_found_date     date,
    p_image_url      text,
    p_finder_contact text default null,
    p_embedding      vector(512) default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
begin
    if p_short_note is null or btrim(p_short_note) = '' then
        raise exception 'A short note is required.' using errcode = '22023';
    end if;
    if p_found_location is null or btrim(p_found_location) = '' then
        raise exception 'A found location is required.' using errcode = '22023';
    end if;
    if p_found_date is null then
        raise exception 'A date is required.' using errcode = '22023';
    end if;
    if p_found_date > current_date then
        raise exception 'The date cannot be in the future.' using errcode = '22023';
    end if;
    if p_image_url is null or btrim(p_image_url) = '' then
        raise exception 'A photo is required.' using errcode = '22023';
    end if;

    insert into public.found_reports
        (short_note, found_location, found_date, image_url, finder_contact, embedding)
    values
        (btrim(p_short_note),
         btrim(p_found_location),
         p_found_date,
         btrim(p_image_url),
         nullif(btrim(coalesce(p_finder_contact, '')), ''),
         p_embedding)
    returning ref_code into v_ref_code;

    return v_ref_code;
end;
$$;

revoke all on function public.submit_found_report(text, text, date, text, text, vector) from public;
grant execute on function public.submit_found_report(text, text, date, text, text, vector) to anon, authenticated;


-- ============================================================================
-- 14. STORAGE: ITEM PHOTO BUCKET
-- The public bucket behind the found-item report photo upload
-- (web/src/lib/storage.js). A citizen uploads without an account, the returned
-- public URL is stored on found_reports, and counter staff read it back. WebP
-- only, 2 MB, because the client re-encodes and downscales every upload.
--
-- The storage.objects policies below are what make anonymous upload and public
-- read possible: the Storage API evaluates them per request, keyed by bucket_id.
-- RLS is already enabled on storage.objects by Supabase; these policies scope it
-- to this bucket. (Idempotent: safe to re-run.)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', true, 2097152, array['image/webp'])
on conflict (id) do nothing;

-- Citizens upload photos with the anon key, so INSERT is open to `public`.
drop policy if exists "Anyone can upload photos" on storage.objects;
create policy "Anyone can upload photos"
on storage.objects for insert to public
with check (bucket_id = 'item-photos');

-- The bucket is public; the URL is embedded in reports and result cards.
drop policy if exists "Public can view item photos" on storage.objects;
create policy "Public can view item photos"
on storage.objects for select to public
using (bucket_id = 'item-photos');

-- Only authenticated counter staff may remove a photo.
drop policy if exists "Staff can delete photos" on storage.objects;
create policy "Staff can delete photos"
on storage.objects for delete to authenticated
using (bucket_id = 'item-photos');


-- ============================================================================
-- 15. STAFF CUSTODY INTAKE RPC
--
-- The counter page (web/src/pages/StaffIntake.jsx) calls this once the intake
-- photo is in the item-photos bucket and the title/category/description has
-- been embedded. It opens the custody record as 'held' — the status is not a
-- parameter — and stamps the office as both the current holder and the logging
-- desk. Returns the generated ref_code, which the counter quotes as the
-- custody receipt reference.
--
-- Cash is the one category with a statutory rule: the trigger
-- calculate_cash_reward_date() sets reward_date to receipt date + 6 months
-- whenever is_cash is true, so a 'Cash' category is normalised and flagged here.
-- ============================================================================
create or replace function public.submit_staff_custody(
    p_office_id        text,
    p_title            text,
    p_description      text,
    p_storage_location text,
    p_image_url        text,
    p_category         text default 'General',
    p_embedding        vector(512) default null,
    p_date_received    date default current_date,
    p_cash_amount      numeric default null,
    p_finder_name      text default null,
    p_finder_contact   text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ref_code text;
    v_category text;
    v_is_cash  boolean := false;
    v_amount   numeric(10, 2) := 0.00;
begin
    if p_office_id is null or btrim(p_office_id) = '' then
        raise exception 'An intake office is required.' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.offices
        where id = p_office_id and status = 'active'
    ) then
        raise exception 'Unknown or inactive office: %', p_office_id
            using errcode = '22023';
    end if;
    if p_title is null or btrim(p_title) = '' then
        raise exception 'An item title is required.' using errcode = '22023';
    end if;
    if p_description is null or btrim(p_description) = '' then
        raise exception 'A description is required.' using errcode = '22023';
    end if;
    if p_storage_location is null or btrim(p_storage_location) = '' then
        raise exception 'A storage location is required.' using errcode = '22023';
    end if;
    if p_image_url is null or btrim(p_image_url) = '' then
        raise exception 'A photo is required.' using errcode = '22023';
    end if;
    if p_date_received is null then
        raise exception 'A receipt date is required.' using errcode = '22023';
    end if;
    if p_date_received > current_date then
        raise exception 'The receipt date cannot be in the future.'
            using errcode = '22023';
    end if;

    v_category := coalesce(nullif(btrim(p_category), ''), 'General');
    if lower(v_category) = 'cash' then
        v_is_cash := true;
        v_category := 'Cash';
        v_amount := coalesce(p_cash_amount, 0.00);
        if v_amount < 0 then
            raise exception 'A cash amount cannot be negative.'
                using errcode = '22023';
        end if;
    end if;

    insert into public.items (
        title, description, category, status,
        image_url, date_received,
        holding_office_id, logging_office_id,
        storage_location, embedding,
        is_cash, cash_amount, finder_name, finder_contact
    ) values (
        btrim(p_title),
        btrim(p_description),
        v_category,
        'held',                                   -- intake always opens as held
        btrim(p_image_url),
        p_date_received,
        p_office_id,                              -- holds it now
        p_office_id,                              -- took it in
        btrim(p_storage_location),
        p_embedding,
        v_is_cash,
        v_amount,
        nullif(btrim(coalesce(p_finder_name, '')), ''),
        nullif(btrim(coalesce(p_finder_contact, '')), '')
    )
    returning ref_code into v_ref_code;

    return v_ref_code;
end;
$$;

revoke all on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text
) from public;

-- TEMPORARY (dev mock auth): the web client runs on the anon key because real
-- Supabase Auth / staff provisioning is not wired up yet (see
-- web/src/context/StaffAuthContext.jsx). This grant is what lets that mock
-- session log intake. Revoke the `anon` grant and keep only `authenticated`
-- once the staff provider signs in for real.
grant execute on function public.submit_staff_custody(
    text, text, text, text, text, text, vector, date, numeric, text, text
) to anon, authenticated;
