-- Search vocabulary the AI service can read with the anon key.
--
-- The table stays service-role only. search_synonyms_vocabulary() is the one
-- read-only surface the AI service needs: enabled rows only, no admin claim and
-- no write access. This replaces the service-role key on the search path.
--
-- The table is authoritative while it can be read: a disabled or deleted row
-- must stop the term from expanding, so the AI service only uses the built-in
-- glossary when this function is unreachable or not configured.

create or replace function public.search_synonyms_vocabulary()
returns table (
    term text,
    synonyms text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select s.term, s.synonyms
    from public.search_synonyms s
    where s.enabled
    order by s.term;
$$;

revoke all on function public.search_synonyms_vocabulary() from public;
grant execute on function public.search_synonyms_vocabulary()
    to anon, authenticated, service_role;

-- Normalize synonyms on every write, including direct service-role edits.
-- Lowercasing lets a synonym dedupe against the typed word, and preserving the
-- first occurrence keeps the admin's ordering.
create or replace function public.normalize_search_synonyms()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    new.synonyms := (
        select array_agg(value order by first_seen)
        from (
            select
                lower(btrim(value)) as value,
                min(ord) as first_seen
            from unnest(new.synonyms)
                with ordinality as entry(value, ord)
            where btrim(value) <> ''
            group by lower(btrim(value))
        ) normalized
    );
    return new;
end;
$$;

drop trigger if exists search_synonyms_normalize on public.search_synonyms;
create trigger search_synonyms_normalize
before insert or update of synonyms on public.search_synonyms
for each row execute function public.normalize_search_synonyms();

update public.search_synonyms s
set synonyms = normalized.synonyms
from (
    select
        term,
        array_agg(value order by first_seen) as synonyms
    from (
        select
            term,
            lower(btrim(value)) as value,
            min(ord) as first_seen
        from public.search_synonyms,
            unnest(synonyms) with ordinality as entry(value, ord)
        where btrim(value) <> ''
        group by term, lower(btrim(value))
    ) normalized_by_term
    group by term
) normalized
where s.term = normalized.term
  and s.synonyms is distinct from normalized.synonyms;

-- The seed misspelled this term; fix existing databases and remove the
-- duplicate when the corrected term already exists.
update public.search_synonyms
set term = 'eskwelahan'
where term = 'eskwelaham'
  and not exists (
      select 1
      from public.search_synonyms existing
      where existing.term = 'eskwelahan'
  );

delete from public.search_synonyms where term = 'eskwelaham';

-- Keep the audit log's new_synonyms identical to the stored row.
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

    select array_agg(value order by first_seen)
      into v_synonyms
      from (
          select
              lower(btrim(value)) as value,
              min(ord) as first_seen
          from unnest(coalesce(p_synonyms, '{}'::text[]))
              with ordinality as entry(value, ord)
          where btrim(value) <> ''
            and length(btrim(value)) <= 64
          group by lower(btrim(value))
      ) normalized;

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
