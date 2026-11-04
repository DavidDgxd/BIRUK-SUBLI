import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Confidence tiers passed to match_items, plus the best/possible split.
//
// Tuned on the 20 held items with ai-service/eval_search_tiers.py (36 labeled
// queries): 0.64/0.05 gives precision 0.967, recall 0.784 and no result for any
// of the "none" queries; the possible tier (0.55/0.07) restores the baseline
// recall. Re-run that eval whenever the inventory changes materially.
export const MATCH_THRESHOLD = 0.55;
export const MATCH_COUNT = 15;
export const BEST_FLOOR = 0.64;
export const BEST_DELTA = 0.05;
export const POSSIBLE_FLOOR = 0.55;
export const POSSIBLE_DELTA = 0.07;
export const POSSIBLE_LIMIT = 3;
export const POSSIBLE_ONLY_LIMIT = 5;

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
 * the match_items RPC. The color filter is added to the text so it is embedded
 * with the rest of the description. Office and receipt-date filters are passed
 * to the RPC so they narrow the candidate set before the match limit applies;
 * filtering the returned page instead would hide valid older/other-office items
 * whenever the unfiltered top matches filled the limit.
 *
 * Resolves to { best, possible, state, queryText, translatedText }. `best` holds
 * the confident matches; `possible` holds up to POSSIBLE_LIMIT weaker ones (or
 * POSSIBLE_ONLY_LIMIT when no best exists) for the "possible matches" section.
 * `state` is 'results' | 'possible' | 'none' so
 * the page can show the "no close match" copy without an empty list. Both lists
 * keep the RPC's descending score order.
 */
export async function searchItems({
  text,
  color,
  photo,
  office,
  dateFrom,
  dateTo,
  translate,
  signal,
}) {
  const trimmed = (text ?? '').trim();
  const needsColor =
    color && !trimmed.toLowerCase().includes(color.toLowerCase());
  const queryText = [needsColor ? color : '', trimmed]
    .filter(Boolean)
    .join(' ');

  const [textResult, imageResult] = await Promise.all([
    queryText ? embedText(queryText, signal, { translate }) : null,
    photo ? embedImage(photo, signal) : null,
  ]);

  const embedding = combineEmbeddings(
    [textResult?.embedding, imageResult?.embedding].filter(Boolean),
  );

  const { data, error } = await supabase
    .rpc('match_items', {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_office: office || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
    })
    .abortSignal(signal);

  if (error) throw new SearchError('db', error.message);

  // The RPC already applies the floor, office filter and excludes released,
  // resolved and other terminal rows; re-checking them here keeps the guarantee
  // even if an older match_items is still deployed. A non-held item must never
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
  const ordered = [...all].sort((a, b) => b.similarity - a.similarity);
  const top = ordered.length ? ordered[0].similarity : 0;
  const best = ordered.filter(
    (item) =>
      item.similarity >= BEST_FLOOR &&
      item.similarity >= top - BEST_DELTA - EPSILON,
  );
  const possibleLimit = best.length ? POSSIBLE_LIMIT : POSSIBLE_ONLY_LIMIT;
  const possible = ordered
    .filter(
      (item) =>
        !best.includes(item) &&
        item.similarity >= POSSIBLE_FLOOR &&
        item.similarity >= top - POSSIBLE_DELTA - EPSILON,
    )
    .slice(0, possibleLimit);
  const state = best.length ? 'results' : possible.length ? 'possible' : 'none';

  return {
    best,
    possible,
    state,
    queryText,
    translatedText: textResult?.translatedText ?? null,
  };
}
