import { supabase } from './supabase.js';
import { embedImage, embedQuery, embedText, SearchError } from './aiService.js';

// Confidence tiers passed to match_items_two_tower, plus the best/possible
// split. `score` is the RPC's blended vector + lexical score. A row only counts
// as confident when the query named something in its public text
// (lexical_score >= LEXICAL_CONFIDENCE) or the relevant vector is strong on its
// own. This stops a hub image from being "best" for an unrelated query while
// keeping a genuine semantic match in the possible tier.
export const MATCH_THRESHOLD = 0.3;
export const MATCH_COUNT = 15;
export const BEST_FLOOR = 0.72;
export const BEST_DELTA = 0.05;
export const POSSIBLE_FLOOR = 0.55;
export const POSSIBLE_DELTA = 0.07;
export const POSSIBLE_LIMIT = 3;
export const POSSIBLE_ONLY_LIMIT = 5;
export const TEXT_STRONG_FLOOR = 0.75;
export const IMAGE_STRONG_FLOOR = 0.82;
// The legacy hybrid fallback keeps #93's floor; this PR only retunes the
// two-tower tiers. Rows with no lexical score at all (photo-only or the oldest
// match_items fallback) keep the vector-only floor.
export const LEGACY_BEST_FLOOR = 0.68;
export const VECTOR_ONLY_BEST_FLOOR = 0.64;
export const LEGACY_STRONG_FLOOR = 0.82;
export const LEXICAL_CONFIDENCE = 0.5;

// Mirrors the lexical weight inside match_items_two_tower. Kept here so the two
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

/** The RPC's blended rank, falling back to a raw similarity for a stale RPC. */
function scoreOf(item) {
  if (Number.isFinite(item.score)) return item.score;
  if (Number.isFinite(item.similarity)) return item.similarity;
  return 0;
}

/**
 * True when a row may be promoted to the confident tier.
 *
 * A stale RPC has no lexical_score at all; keep the old vector-only behaviour
 * there. A current row needs either a lexical hit (the query named something in
 * its title/category/caption) or a strong score in the modality that was
 * actually queried.
 */
function bestFloorOf(item, usedLegacy) {
  if (!Number.isFinite(item.lexical_score)) return VECTOR_ONLY_BEST_FLOOR;
  return usedLegacy ? LEGACY_BEST_FLOOR : BEST_FLOOR;
}

function isConfident(item, score) {
  if (!Number.isFinite(item.lexical_score)) return true;
  if (item.lexical_score >= LEXICAL_CONFIDENCE) return true;

  const hasModality =
    Number.isFinite(item.text_similarity) ||
    Number.isFinite(item.image_similarity);
  if (!hasModality) return score >= LEGACY_STRONG_FLOOR;

  return (
    (Number.isFinite(item.text_similarity) &&
      item.text_similarity >= TEXT_STRONG_FLOOR) ||
    (Number.isFinite(item.image_similarity) &&
      item.image_similarity >= IMAGE_STRONG_FLOOR)
  );
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
 * Embeds the two query halves independently. A text-tower outage must not take
 * photo search down with it, so the outcomes are settled separately and the
 * caller decides whether to continue with one half or fall back.
 */
async function embedSearchInputs(queryText, photo, expand, signal) {
  const [text, image] = await Promise.allSettled([
    queryText
      ? embedQuery(queryText, signal, { expand })
      : Promise.resolve(null),
    photo ? embedImage(photo, signal) : Promise.resolve(null),
  ]);

  if (signal?.aborted) {
    const rejected = [text, image].find(
      (outcome) => outcome.status === 'rejected',
    );
    throw rejected?.reason ?? new DOMException('Aborted', 'AbortError');
  }

  return {
    text: text.status === 'fulfilled' ? text.value : null,
    image: image.status === 'fulfilled' ? image.value : null,
    textError: text.status === 'rejected' ? text.reason : null,
    imageError: image.status === 'rejected' ? image.reason : null,
  };
}

async function fetchTwoTower({
  text,
  image,
  queryText,
  expandedText,
  office,
  dateFrom,
  dateTo,
  signal,
}) {
  const { data, error } = await supabase
    .rpc('match_items_two_tower', {
      query_text_embedding: text?.embedding ?? null,
      query_image_embedding: image?.embedding ?? null,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_office: office || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      query_text: text ? expandedText : queryText || null,
    })
    .abortSignal(signal);

  if (error) throw new SearchError('db', error.message);
  return data;
}

/**
 * Last-resort path for an AI-service or RPC outage: the legacy CLIP text
 * embedding and the legacy match_items_hybrid RPC. Both are still deployed and
 * the item's combined vector is public-safe, so search degrades instead of
 * failing entirely.
 */
async function fetchLegacy({
  queryText,
  expand,
  image,
  office,
  dateFrom,
  dateTo,
  signal,
  fallbackError,
}) {
  let legacy = null;
  if (queryText) {
    try {
      legacy = await embedText(queryText, signal, { expand });
    } catch (error) {
      if (!image) throw fallbackError ?? error;
    }
  }

  const embedding = combineEmbeddings(
    [legacy?.embedding, image?.embedding].filter(Boolean),
  );
  if (!embedding) {
    throw (
      fallbackError ??
      new SearchError('ai-failed', 'No search input could be embedded.')
    );
  }

  const { data, error } = await supabase
    .rpc('match_items_hybrid', {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_office: office || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      query_text: legacy?.expandedText ?? queryText ?? null,
    })
    .abortSignal(signal);

  if (!error) {
    return {
      data,
      expandedText: legacy?.expandedText ?? queryText,
      additions: legacy?.additions ?? [],
    };
  }

  // Final fallback for a deployment where neither hybrid RPC exists yet. The
  // original match_items function has been present since the first search
  // release; the UI degrades to its vector-only tiers.
  console.warn(
    '[searchItems] hybrid RPC missing, falling back to match_items:',
    error.message,
  );
  const fallback = await supabase
    .rpc('match_items', {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_office: office || null,
      date_from: dateFrom || null,
      date_to: dateTo || null,
    })
    .abortSignal(signal);

  if (fallback.error) {
    throw new SearchError('db', fallback.error.message);
  }
  return {
    data: fallback.data,
    expandedText: legacy?.expandedText ?? queryText,
    additions: legacy?.additions ?? [],
  };
}

/**
 * Embeds the text and/or photo with the AI service, then ranks held items with
 * the two-tower RPC. Text goes through the small English text tower and photos
 * through CLIP; the RPC fuses them instead of averaging disjoint embeddings.
 * The color filter is added to the text so it is embedded with the rest of the
 * description. Office and receipt-date filters are passed to the RPC so they
 * narrow the candidate set before the match limit applies; filtering the
 * returned page instead would hide valid older or other-office items whenever
 * the unfiltered top matches filled the limit.
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

  const {
    text: textResult,
    image: imageResult,
    textError,
    imageError,
  } = await embedSearchInputs(queryText, photo, expand, signal);

  let data;
  let expandedText = textResult?.expandedText ?? queryText;
  let additions = textResult?.additions ?? [];
  let usedLegacy = false;

  if (textResult || imageResult) {
    try {
      data = await fetchTwoTower({
        text: textResult,
        image: imageResult,
        queryText,
        expandedText,
        office,
        dateFrom,
        dateTo,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      usedLegacy = true;
      console.warn(
        '[searchItems] two-tower search failed, falling back to the legacy RPC:',
        error.message,
      );
      const legacy = await fetchLegacy({
        queryText,
        expand,
        image: imageResult,
        office,
        dateFrom,
        dateTo,
        signal,
        fallbackError: error,
      });
      data = legacy.data;
      expandedText = legacy.expandedText;
      additions = legacy.additions;
    }
  } else {
    const fallbackError = textError ?? imageError;
    if (!fallbackError) {
      throw new SearchError('ai-failed', 'No search input could be embedded.');
    }
    usedLegacy = true;
    console.warn(
      '[searchItems] new text tower unavailable, falling back to the legacy RPC:',
      fallbackError.message,
    );
    const legacy = await fetchLegacy({
      queryText,
      expand,
      image: null,
      office,
      dateFrom,
      dateTo,
      signal,
      fallbackError,
    });
    data = legacy.data;
    expandedText = legacy.expandedText;
    additions = legacy.additions;
  }

  // The RPC already applies the floor, office filter and excludes released,
  // resolved and other terminal rows; re-checking them here keeps the guarantee
  // even if a stale function is still deployed. A non-held item must never
  // surface in a public listing, even if that function is stale or a row's
  // status changed between the query and the read.
  const all = (data ?? []).filter(
    (item) =>
      isSearchableItemStatus(item.status) &&
      scoreOf(item) >= MATCH_THRESHOLD &&
      (!office || item.holding_office_id === office),
  );

  // The RPC already sorts, but sorting here keeps the cap deterministic if a
  // stale function or a test fixture returns rows in another order.
  const ordered = [...all].sort((a, b) => scoreOf(b) - scoreOf(a));
  const top = ordered.length ? scoreOf(ordered[0]) : 0;
  const best = ordered.filter((item) => {
    const score = scoreOf(item);
    return (
      score >= bestFloorOf(item, usedLegacy) &&
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
    additions,
  };
}
