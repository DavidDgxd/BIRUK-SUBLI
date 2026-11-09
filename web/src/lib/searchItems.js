import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Confidence tiers passed to match_items_hybrid, plus the best/possible split.
//
// `score` is the RPC's blended vector + lexical score. A row only counts as a
// confident match when the query named something in its public text
// (lexical_score >= LEXICAL_CONFIDENCE) or the blended score is strong on its
// own. This is what stops a hub image from being "best" for an unrelated query
// while keeping a genuine semantic match in the possible tier.
export const MATCH_THRESHOLD = 0.55;
export const MATCH_COUNT = 15;
// Retuned on the hybrid eval at 0.68/0.05: P=0.838 R=0.838 noneFP=12%,
// against 0.681/0.865/38% at the old vector-only 0.64. See
// ai-service/eval_search_tiers.py.
export const BEST_FLOOR = 0.68;
export const BEST_DELTA = 0.05;
// Vector-only rows (a photo-only query or a stale RPC) keep the old floor:
// they carry no lexical bonus, so the blended floor would drop them.
export const PHOTO_BEST_FLOOR = 0.64;
export const POSSIBLE_FLOOR = 0.55;
export const POSSIBLE_DELTA = 0.07;
export const POSSIBLE_LIMIT = 3;
export const POSSIBLE_ONLY_LIMIT = 5;
export const STRONG_FLOOR = 0.82;
export const LEXICAL_CONFIDENCE = 0.5;

// Mirrors the lexical weight inside match_items_hybrid. Kept here so the two
// halves of the contract are visible side by side; the client does not re-score
// rows.
export const LEXICAL_WEIGHT = 0.25;

// Absorbs the binary rounding in a delta comparison, e.g. 0.664 - 0.07 is
// 0.5940000000000001, which would otherwise drop an item sitting on 0.594.
const EPSILON = 1e-9;

/**
 * Inventory statuses that mean an item is no longer held. `resolved` is not an
 * items status today (it belongs to lost reports), but it is listed here so the
 * public guard stays correct if inventory adopts that name. `disposed` is the
 * schema's resolved/destroyed terminal state.
 */
export const NON_SEARCHABLE_STATUSES = Object.freeze([
  'released',
  'resolved',
  'transferred',
  'disposed',
]);

/** True when a row is still eligible for a public listing. */
export function isSearchableItemStatus(status) {
  return (
    typeof status === 'string' && !NON_SEARCHABLE_STATUSES.includes(status)
  );
}

/**
 * Turns a raw cosine similarity into a readable percentage and colour tier.
 * Only best matches display it; possible matches hide it because 0.64 (the best
 * floor) would otherwise show as 81% — too confident for a maybe.
 *
 * 0.55-0.599 -> 45-69% (weak); 0.60-0.70 -> 70-98% (moderate/strong).
 */
export function calibrateMatchScore(similarity) {
  const PRIMARY_MIN = 0.6;
  const PRIMARY_MAX = 0.7;
  const SECONDARY_MIN = 0.55;
  const SECONDARY_MAX = 0.599;

  if (similarity < PRIMARY_MIN) {
    const low = Math.min(Math.max(similarity, SECONDARY_MIN), SECONDARY_MAX);
    const normalized = (low - SECONDARY_MIN) / (SECONDARY_MAX - SECONDARY_MIN);
    return { percent: Math.round(45 + normalized * 24), tier: 'weak' };
  }

  const clamped = Math.min(similarity, PRIMARY_MAX);
  const normalized = (clamped - PRIMARY_MIN) / (PRIMARY_MAX - PRIMARY_MIN);
  const percent = Math.round(70 + normalized * 28);

  return { percent, tier: percent >= 85 ? 'strong' : 'moderate' };
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((total, x) => total + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

/** The RPC's blended rank, falling back to similarity for a stale function. */
function scoreOf(item) {
  return Number.isFinite(item.score) ? item.score : item.similarity;
}

/**
 * True when a row may be promoted to the confident tier.
 *
 * A stale RPC has no lexical_score at all, and a photo-only query has no tokens
 * to match, so both report null. Keep the old vector-only behaviour there. A
 * current row with text needs either a lexical hit (the query named something
 * in its title/category/caption) or a blended score strong enough to stand
 * alone.
 */
function isConfident(item, score) {
  if (!Number.isFinite(item.lexical_score)) return true;
  return item.lexical_score >= LEXICAL_CONFIDENCE || score >= STRONG_FLOOR;
}

/** Blended rows use the retuned floor; vector-only rows keep the photo floor. */
function bestFloorOf(item) {
  return Number.isFinite(item.lexical_score) ? BEST_FLOOR : PHOTO_BEST_FLOOR;
}

/**
 * Scales each vector to unit length and averages them, so a text query and a photo
 * count equally. A single vector is returned as is (cosine search ignores its length).
 */
export function combineEmbeddings(vectors) {
  if (vectors.length === 1) return vectors[0];
  const units = vectors.map(normalize);
  return normalize(
    units[0].map((_, i) => units.reduce((total, v) => total + v[i], 0)),
  );
}

/**
 * Embeds the text and/or photo with the AI service, then ranks held items with
 * the match_items_hybrid RPC. The color filter is added to the text so it is
 * embedded with the rest of the description. Office and receipt-date filters
 * are passed to the RPC so they narrow the candidate set before the match limit
 * applies; filtering the returned page instead would hide valid older or
 * other-office items whenever the unfiltered top matches filled the limit.
 *
 * Resolves to { best, possible, state, queryText, expandedText, additions }.
 * `best` holds the confident matches; `possible` holds up to POSSIBLE_LIMIT
 * weaker ones (or POSSIBLE_ONLY_LIMIT when no best exists) for the "possible
 * matches" section. `state` is 'results' | 'possible' | 'none' so the page can
 * show the "no close match" copy without an empty list. Both lists keep the
 * RPC's descending score order.
 */
export async function searchItems({
  text,
  color,
  photo,
  office,
  dateFrom,
  dateTo,
  expand,
  signal,
}) {
  const trimmed = (text ?? '').trim();
  const needsColor =
    color && !trimmed.toLowerCase().includes(color.toLowerCase());
  const queryText = [needsColor ? color : '', trimmed]
    .filter(Boolean)
    .join(' ');

  const [textResult, imageResult] = await Promise.all([
    queryText ? embedText(queryText, signal, { expand }) : null,
    photo ? embedImage(photo, signal) : null,
  ]);

  const embedding = combineEmbeddings(
    [textResult?.embedding, imageResult?.embedding].filter(Boolean),
  );
  const expandedText = textResult?.expandedText ?? queryText;

  const { data, error } = await supabase
    .rpc('match_items_hybrid', {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_office: office || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      query_text: textResult ? expandedText : null,
    })
    .abortSignal(signal);

  if (error) throw new SearchError('db', error.message);

  // The RPC already applies the floor, office filter and excludes released,
  // resolved and other terminal rows; re-checking them here keeps the guarantee
  // even if a stale function is still deployed. A non-held item must never
  // surface in a public listing, even if that function is stale or a row's
  // status changed between the query and the read.
  const all = (data ?? []).filter(
    (item) =>
      isSearchableItemStatus(item.status) &&
      item.similarity >= MATCH_THRESHOLD &&
      (!office || item.holding_office_id === office),
  );

  // The RPC already sorts, but sorting here keeps the cap deterministic if a
  // stale function or a test fixture returns rows in another order.
  const ordered = [...all].sort((a, b) => scoreOf(b) - scoreOf(a));
  const top = ordered.length ? scoreOf(ordered[0]) : 0;
  const best = ordered.filter((item) => {
    const score = scoreOf(item);
    return (
      score >= bestFloorOf(item) &&
      isConfident(item, score) &&
      score >= top - BEST_DELTA - EPSILON
    );
  });
  const possibleLimit = best.length ? POSSIBLE_LIMIT : POSSIBLE_ONLY_LIMIT;
  const possible = ordered
    .filter((item) => {
      const score = scoreOf(item);
      return (
        !best.includes(item) &&
        score >= POSSIBLE_FLOOR &&
        score >= top - POSSIBLE_DELTA - EPSILON
      );
    })
    .slice(0, possibleLimit);
  const state = best.length ? 'results' : possible.length ? 'possible' : 'none';

  return {
    best,
    possible,
    state,
    queryText,
    expandedText,
    additions: textResult?.additions ?? [],
  };
}
