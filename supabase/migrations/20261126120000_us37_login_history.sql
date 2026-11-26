-- US-37: login history for office and admin accounts.
--
-- Every office sign-in and every failed attempt is appended to
-- public.login_history by one RPC, and only the central admin can read the
-- table back through a second RPC. There is no client policy at all: RLS is
-- enabled and every direct table privilege is revoked from public, anon and
-- authenticated, so PostgREST can never read or write a row on behalf of a
-- browser session. The two SECURITY DEFINER functions are the entire surface.
--
-- `office_id` is `text`, not `uuid`, because `public.offices.id` is text (the
-- directory keys are names like 'BCPIO'). Typing it as uuid here would make
-- the office filter and the foreign key unusable.
--
-- A failed attempt carries no user, no office and one coarse reason, so a row
-- can never confirm whether an email or account exists. The reason is bucketed
-- to invalid_credentials, inactive_office or auth_error and nothing else is
-- stored; inactive_office is only reachable after a real session existed, so it
-- still says nothing about whether the account was real. The RPC also returns
-- void in every case: there is no row, count or error that a caller could use
-- as an existence oracle.

create table if not exists public.login_history (
    id uuid primary key default gen_random_uuid(),
    occurred_at timestamptz not null default now(),
    -- Nullable: a failed attempt is not tied to an authenticated user.
    user_id uuid null references auth.users(id) on delete set null,
    -- Office name on an office success, the submitted identifier otherwise.
    account_label text not null,
    office_id text null references public.offices(id) on delete set null,
    role text not null check (role in ('office_staff', 'central_admin', 'unknown')),
    status text not null check (status in ('success', 'failed')),
    failure_reason text null,
    device_info text not null default ''
);

create index if not exists login_history_occurred_at_idx
    on public.login_history (occurred_at desc);
create index if not exists login_history_office_idx
    on public.login_history (office_id, occurred_at desc);
create index if not exists login_history_status_idx
    on public.login_history (status, occurred_at desc);

alter table public.login_history enable row level security;

-- Belt and braces: even if a future policy is added by mistake, no browser role
-- holds a table privilege, so PostgREST rejects the request before RLS runs.
revoke all on table public.login_history from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Write path: append one attempt for the caller.
-- Callable while signed out, because a failed sign-in has no session yet.
-- ----------------------------------------------------------------------------
create or replace function public.record_login_attempt(
    p_account        text,
    p_status         text,
    p_failure_reason text default null,
    p_device_info    text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_user_id   uuid := auth.uid();
    v_role      text := 'unknown';
    v_office_id text;
    v_office    text;
    v_account   text;
    v_device    text;
    v_reason    text;
begin
    -- Both free-text fields are bounded so a scripted caller cannot bloat the
    -- table or smuggle a long payload into the admin view.
    v_account := left(btrim(coalesce(p_account, '')), 200);
    v_device  := left(btrim(coalesce(p_device_info, '')), 200);

    if p_status is distinct from 'success' then
        -- The failure branch touches no user or office row. Whatever the caller
        -- claimed is reduced to one coarse bucket, and the row is written the
        -- same way for an unknown account as for a real one.
        v_reason := case
            when p_failure_reason in (
                'invalid_credentials', 'inactive_office', 'auth_error'
            ) then p_failure_reason
            else 'auth_error'
        end;

        insert into public.login_history (
            user_id, account_label, office_id, role, status, failure_reason,
            device_info
        ) values (
            null,
            coalesce(nullif(v_account, ''), 'Unknown account'),
            null,
            'unknown',
            'failed',
            v_reason,
            v_device
        );
        return;
    end if;

    -- A success claim with no session is not evidence of anything, so nothing
    -- is written and the caller learns nothing from the silence.
    if v_user_id is null then
        return;
    end if;

    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'central_admin' then
        v_role := 'central_admin';
        -- The JWT email is authoritative; the submitted label is only a fallback.
        v_account := left(coalesce(nullif(auth.jwt() ->> 'email', ''), v_account), 200);
    else
        select o.id, o.name
          into v_office_id, v_office
          from public.offices o
         where o.auth_user_id = v_user_id
           and o.status = 'active';

        if found then
            v_role := 'office_staff';
            v_account := v_office;
        else
            -- Authenticated but not linked to an active office yet, so the row
            -- stays role-less rather than borrowing an office it does not hold.
            v_office_id := null;
            v_account := left(coalesce(nullif(v_account, ''), 'Unknown account'), 200);
        end if;
    end if;

    insert into public.login_history (
        user_id, account_label, office_id, role, status, failure_reason,
        device_info
    ) values (
        v_user_id,
        coalesce(nullif(v_account, ''), 'Unknown account'),
        v_office_id,
        v_role,
        'success',
        null,
        v_device
    );
end;
$$;

revoke all on function public.record_login_attempt(text, text, text, text)
    from public;
grant execute on function public.record_login_attempt(text, text, text, text)
    to anon, authenticated;


-- ----------------------------------------------------------------------------
-- Read path: central admin only, newest first.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_login_history(
    p_office_id text default null,
    p_search    text default null,
    p_status    text default null,
    p_date_from timestamptz default null,
    p_date_to   timestamptz default null,
    p_limit     int default 100
)
returns table (
    id             uuid,
    occurred_at    timestamptz,
    account_label  text,
    office_id      text,
    role           text,
    status         text,
    failure_reason text,
    device_info    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
    -- The role is re-checked here, not trusted from the page. A signed-out
    -- caller has no role claim, so every non-admin path raises the same 42501.
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can view login history.'
            using errcode = '42501';
    end if;

    return query
        select lh.id,
               lh.occurred_at,
               lh.account_label,
               lh.office_id,
               lh.role,
               lh.status,
               lh.failure_reason,
               lh.device_info
        from public.login_history lh
        where (p_office_id is null or lh.office_id = p_office_id)
          -- position() keeps a typed % or _ literal instead of a wildcard.
          and (v_search is null
               or position(lower(v_search) in lower(lh.account_label)) > 0)
          and (p_status is null or lh.status = p_status)
          and (p_date_from is null or lh.occurred_at >= p_date_from)
          and (p_date_to is null or lh.occurred_at <= p_date_to)
        order by lh.occurred_at desc, lh.id desc
        limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.admin_list_login_history(
    text, text, text, timestamptz, timestamptz, int
) from public, anon;
grant execute on function public.admin_list_login_history(
    text, text, text, timestamptz, timestamptz, int
) to authenticated;
