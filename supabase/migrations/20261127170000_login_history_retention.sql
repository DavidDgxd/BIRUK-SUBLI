-- US-37 retention: let the central admin prune old login-history rows.
create or replace function public.admin_prune_login_history(
    p_retain_days integer default 90
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_deleted bigint;
begin
    -- Same guard as admin_list_login_history: signed-out and non-admin callers
    -- receive one identical 42501 before any retention validation runs.
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can prune login history.'
            using errcode = '42501';
    end if;

    if p_retain_days is null or p_retain_days < 1 then
        raise exception 'Retention days must be a positive integer.'
            using errcode = '22023';
    end if;

    delete from public.login_history lh
     where lh.occurred_at < now() - make_interval(days => p_retain_days);

    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

revoke all on function public.admin_prune_login_history(integer)
    from public, anon;
grant execute on function public.admin_prune_login_history(integer)
    to authenticated;
