-- US-37 follow-ups: trust inactive_office only with a session, cap anonymous
-- failure writes in a short sliding window, and filter by role server-side.
create or replace function public.record_login_attempt(
    p_account text, p_status text,
    p_failure_reason text default null, p_device_info text default ''
)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_role text := 'unknown';
    v_office_id text; v_office text; v_account text; v_device text;
    v_reason text; v_recent bigint;
begin
    v_account := left(btrim(coalesce(p_account, '')), 200);
    v_device := left(btrim(coalesce(p_device_info, '')), 200);
    if p_status is distinct from 'success' then
        if v_user_id is null then
            select count(*) into v_recent from public.login_history lh
             where lh.user_id is null
               and lh.occurred_at > now() - interval '1 minute';
            if v_recent >= 120 then return; end if;
        end if;
        v_reason := case
            when p_failure_reason = 'inactive_office' and v_user_id is null
                then 'auth_error'
            when p_failure_reason in (
                'invalid_credentials', 'inactive_office', 'auth_error'
            ) then p_failure_reason
            else 'auth_error'
        end;
        insert into public.login_history (
            user_id, account_label, office_id, role, status, failure_reason,
            device_info
        ) values (
            null, coalesce(nullif(v_account, ''), 'Unknown account'), null,
            'unknown', 'failed', v_reason, v_device
        );
        return;
    end if;
    if v_user_id is null then return; end if;
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'central_admin' then
        v_role := 'central_admin';
        v_account := left(coalesce(nullif(auth.jwt() ->> 'email', ''), v_account), 200);
    else
        select o.id, o.name into v_office_id, v_office from public.offices o
         where o.auth_user_id = v_user_id and o.status = 'active';
        if found then
            v_role := 'office_staff';
            v_account := v_office;
        else
            v_office_id := null;
            v_account := left(coalesce(nullif(v_account, ''), 'Unknown account'), 200);
        end if;
    end if;
    insert into public.login_history (
        user_id, account_label, office_id, role, status, failure_reason,
        device_info
    ) values (
        v_user_id, coalesce(nullif(v_account, ''), 'Unknown account'),
        v_office_id, v_role, 'success', null, v_device
    );
end;
$$;
revoke all on function public.record_login_attempt(text, text, text, text) from public;
grant execute on function public.record_login_attempt(text, text, text, text) to anon, authenticated;
drop function if exists public.admin_list_login_history(
    text, text, text, timestamptz, timestamptz, int
);
create or replace function public.admin_list_login_history(
    p_office_id text default null, p_search text default null,
    p_status text default null, p_date_from timestamptz default null,
    p_date_to timestamptz default null, p_limit int default 100,
    p_role text default null
)
returns table (
    id uuid, occurred_at timestamptz, account_label text, office_id text,
    role text, status text, failure_reason text, device_info text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
    v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can view login history.'
            using errcode = '42501';
    end if;
    return query
        select lh.id, lh.occurred_at, lh.account_label, lh.office_id,
               lh.role, lh.status, lh.failure_reason, lh.device_info
        from public.login_history lh
        where (p_office_id is null or lh.office_id = p_office_id)
          and (p_role is null or lh.role = p_role)
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
    text, text, text, timestamptz, timestamptz, int, text
) from public, anon;
grant execute on function public.admin_list_login_history(
    text, text, text, timestamptz, timestamptz, int, text
) to authenticated;
