-- Issue #147: raise the reverse-match floor and restore the closed-report guard.
--
-- `match_lost_reports` flags open lost reports on the custody receipt at intake
-- using the legacy 512-dim CLIP-blended vectors. CLIP text-to-text similarity is
-- compressed: unrelated pairs reach 0.55-0.58, so the old 0.55 floor flagged
-- junk reports and the staff saw "everything shows". The floor is set from the
-- measurements: across 45 unrelated item/report pairs the junk ceiling measured
-- 0.581, while genuine photo-backed pairs measure 0.79-0.82, so 0.68 sits clear
-- of the measured junk ceiling and still keeps photo-backed matches. The value
-- coincides with the search side's `LEGACY_BEST_FLOOR = 0.68`
-- (web/src/lib/searchItems.js:25), but the calibrations differ: search's 0.68 is
-- a top-tier floor on a blended (text + image + lexical) score with a 0.55
-- "possible" tier below it, while reverse match is a single raw-cosine floor
-- with no lower tier. This trades recall for precision on purpose: genuine
-- text-only pairs measure 0.50-0.66, so a report filed without a photo rarely
-- flags, and only photo-backed reports flag. The two-tower port that restores
-- text-only recall is tracked in issue #151. Callers may still raise the bar; a
-- null threshold falls back to the floor instead of bypassing it.
--
-- US-16 re-created this function without the `lr.closed_at is null` guard that
-- the US-33 staff-closure migration added, while
-- ai-service/supabase/schema.sql kept it. The guard is restored here so a report
-- closed through the staff close path is never flagged again. The result is
-- identical to the canonical schema's block except for the raised floor.
-- Degenerate (zero-norm) embeddings are excluded on both sides (cosine is NaN).

create or replace function public.match_lost_reports (
    item_id         uuid,
    match_threshold float default 0.68,
    match_count     int   default 5
)
returns table (
    lost_report_id uuid,
    ref_code       text,
    description    text,
    image_url      text,
    area_route     text,
    date_lost      date,
    contact_info   text,
    similarity     float
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
    select
        lr.id as lost_report_id,
        lr.ref_code,
        lr.description,
        lr.image_url,
        lr.area_route,
        lr.date_lost,
        lr.contact_info,
        1 - (lr.embedding <=> items.embedding) as similarity
    from public.items
    cross join public.lost_reports lr
    where items.id = item_id
      -- An item outside this list has left custody (or never had a vector) and
      -- is no longer a match target. Empty result, never an error.
      and items.status not in ('released', 'resolved', 'transferred', 'disposed')
      and items.embedding is not null
      -- A zero-norm embedding makes every cosine NaN, and NaN compares above
      -- any floor and sorts first, so a row written by direct RPC probing that
      -- never went through the AI service would flag on every intake. The 0.5
      -- bound is not a semantic threshold: a healthy vector's self-distance is
      -- exactly 0, a zero vector's is NaN, and NaN fails the `<` comparison, so
      -- any small bound rejects only NaN on both sides.
      and (items.embedding <=> items.embedding) < 0.5
      and lr.status = 'open'
      and lr.closed_at is null
      and (lr.embedding <=> lr.embedding) < 0.5
      and not exists (
          select 1 from public.dismissed_matches dm
          where dm.item_id = items.id and dm.lost_report_id = lr.id
      )
      -- Hard floor: callers may raise the bar but never drop below 0.68. A null
      -- threshold falls back to the floor instead of bypassing it. The same
      -- `>=` comparison as the search RPCs, so a row exactly at the floor is
      -- treated the same way everywhere.
      and (1 - (lr.embedding <=> items.embedding))
          >= greatest(coalesce(match_threshold, 0.68), 0.68)
    order by similarity desc
    -- Clamp server-side: a null or oversized match_count cannot widen the
    -- result past the intended 1..25 contact rows.
    limit least(greatest(coalesce(match_count, 5), 1), 25);
$$;

revoke all on function public.match_lost_reports(uuid, double precision, integer)
    from public, anon;
grant execute on function public.match_lost_reports(uuid, double precision, integer)
    to authenticated;
