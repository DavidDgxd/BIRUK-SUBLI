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
    status text not null default 'pending' check (
        status in ('pending', 'converted_at_intake', 'no_show')
    ),
    created_at timestamptz default timezone('utc'::text, now()) not null
);

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
-- ============================================================================
create or replace function public.match_items (
    query_embedding vector(512),
    match_threshold float default 0.20,
    match_count int default 10,
    filter_office text default null,
    date_from date default null
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
    holding_office_name text,
    counter_hours text,
    office_address text,
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
        and (1 - (items.embedding <=> query_embedding)) > match_threshold
    order by similarity desc
    limit match_count;
$$;


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

-- Items: The public can read active inventory; only staff can insert/update
create policy "Public can view held items" 
on public.items for select to public using (status = 'held');

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
