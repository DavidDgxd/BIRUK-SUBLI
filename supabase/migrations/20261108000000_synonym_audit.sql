-- Make the search vocabulary auditable and safer to edit.
--
-- Adds created_at/updated_by/notes, database-level constraints (the RPCs
-- normalize too, but direct service-role edits should not be able to insert a
-- mixed-case or empty term), and a change log the RPCs write on every upsert
-- and delete. The AI service only reads term/synonyms/enabled, so none of this
-- changes search behaviour.

alter table public.search_synonyms
    add column if not exists created_at timestamptz not null
        default timezone('utc'::text, now()),
    add column if not exists updated_by uuid
        references auth.users(id) on delete set null,
    add column if not exists notes text;

alter table public.search_synonyms
    drop constraint if exists search_synonyms_term_normalized,
    drop constraint if exists search_synonyms_notes_length;

alter table public.search_synonyms
    add constraint search_synonyms_term_normalized
        check (
            term = lower(btrim(term))
            and length(term) between 1 and 64
        ),
    add constraint search_synonyms_notes_length
        check (notes is null or length(notes) <= 240);

create table if not exists public.search_synonym_events (
    id bigint generated always as identity primary key,
    term text not null,
    action text not null check (action in ('upsert', 'delete')),
    actor uuid references auth.users(id) on delete set null,
    old_synonyms text[],
    new_synonyms text[],
    created_at timestamptz not null
        default timezone('utc'::text, now())
);

create index if not exists search_synonym_events_created_idx
on public.search_synonym_events (created_at desc);

alter table public.search_synonym_events enable row level security;

revoke all on table public.search_synonym_events from anon, authenticated;
grant all on table public.search_synonym_events to service_role;

drop function if exists public.list_search_synonyms();

create or replace function public.list_search_synonyms()
returns table (
    term text,
    synonyms text[],
    enabled boolean,
    notes text,
    updated_by text,
    updated_at timestamptz,
    created_at timestamptz
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
        select
            s.term,
            s.synonyms,
            s.enabled,
            s.notes,
            u.email::text as updated_by,
            s.updated_at,
            s.created_at
        from public.search_synonyms s
        left join auth.users u on u.id = s.updated_by
        order by s.term;
end;
$$;

revoke all on function public.list_search_synonyms() from public, anon;
grant execute on function public.list_search_synonyms() to authenticated;

drop function if exists public.upsert_search_synonym(text, text[], boolean);
drop function if exists public.upsert_search_synonym(text, text[], boolean, text);

create or replace function public.upsert_search_synonym(
    p_term text,
    p_synonyms text[],
    p_enabled boolean default true,
    p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_term text;
    v_synonyms text[];
    v_notes text;
    v_old text[];
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

    v_notes := nullif(btrim(coalesce(p_notes, '')), '');
    if v_notes is not null and length(v_notes) > 240 then
        raise exception 'Keep notes under 240 characters.'
            using errcode = '22023';
    end if;

    select s.synonyms into v_old
      from public.search_synonyms s
     where s.term = v_term;

    insert into public.search_synonyms (
        term, synonyms, enabled, notes, updated_by
    ) values (
        v_term, v_synonyms, coalesce(p_enabled, true), v_notes, auth.uid()
    )
    on conflict (term) do update
        set synonyms = excluded.synonyms,
            enabled = excluded.enabled,
            notes = excluded.notes,
            updated_by = excluded.updated_by;

    insert into public.search_synonym_events (
        term, action, actor, old_synonyms, new_synonyms
    ) values (
        v_term, 'upsert', auth.uid(), v_old, v_synonyms
    );
end;
$$;

revoke all on function public.upsert_search_synonym(text, text[], boolean, text)
    from public, anon;
grant execute on function public.upsert_search_synonym(text, text[], boolean, text)
    to authenticated;

create or replace function public.delete_search_synonym(p_term text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_term text;
    v_old text[];
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

    delete from public.search_synonyms
     where term = v_term
    returning synonyms into v_old;

    if found then
        insert into public.search_synonym_events (
            term, action, actor, old_synonyms, new_synonyms
        ) values (
            v_term, 'delete', auth.uid(), v_old, null
        );
    end if;
end;
$$;

revoke all on function public.delete_search_synonym(text) from public, anon;
grant execute on function public.delete_search_synonym(text) to authenticated;
