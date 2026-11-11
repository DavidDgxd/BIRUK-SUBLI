-- Central-admin management for the bilingual synonym table.
--
-- The table itself is service-role only; these SECURITY DEFINER functions are
-- the narrow, role-checked surface the admin console uses. Every function
-- re-checks the central_admin claim because the UI gate is not a boundary.

create or replace function public.list_search_synonyms()
returns table (
    term text,
    synonyms text[],
    enabled boolean,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can manage search synonyms.'
            using errcode = '42501';
    end if;

    return query
        select s.term, s.synonyms, s.enabled, s.updated_at
        from public.search_synonyms s
        order by s.term;
end;
$$;

revoke all on function public.list_search_synonyms() from public, anon;
grant execute on function public.list_search_synonyms() to authenticated;

create or replace function public.upsert_search_synonym(
    p_term text,
    p_synonyms text[],
    p_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_term text;
    v_synonyms text[];
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can manage search synonyms.'
            using errcode = '42501';
    end if;

    v_term := lower(btrim(coalesce(p_term, '')));
    if v_term = '' or length(v_term) > 64 then
        raise exception 'A search term must be 1–64 characters.'
            using errcode = '22023';
    end if;

    select array_agg(distinct btrim(value))
      into v_synonyms
      from unnest(coalesce(p_synonyms, '{}'::text[])) as value
     where btrim(value) <> ''
       and length(btrim(value)) <= 64;

    if v_synonyms is null then
        raise exception 'Add at least one English synonym.'
            using errcode = '22023';
    end if;

    insert into public.search_synonyms (term, synonyms, enabled)
    values (v_term, v_synonyms, coalesce(p_enabled, true))
    on conflict (term) do update
        set synonyms = excluded.synonyms,
            enabled = excluded.enabled;
end;
$$;

revoke all on function public.upsert_search_synonym(text, text[], boolean)
    from public, anon;
grant execute on function public.upsert_search_synonym(text, text[], boolean)
    to authenticated;

create or replace function public.delete_search_synonym(p_term text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_term text;
begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'central_admin' then
        raise exception 'Only the central admin can manage search synonyms.'
            using errcode = '42501';
    end if;

    v_term := lower(btrim(coalesce(p_term, '')));
    if v_term = '' then
        raise exception 'A search term is required.'
            using errcode = '22023';
    end if;

    delete from public.search_synonyms where term = v_term;
end;
$$;

revoke all on function public.delete_search_synonym(text) from public, anon;
grant execute on function public.delete_search_synonym(text) to authenticated;
