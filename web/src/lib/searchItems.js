import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Score bands passed to match_items, plus the primary/secondary split.
//
// Scores are tightly compressed in this setup: an unrelated item (a wallet,
// for a bottle query) sits below 0.24, a semantic synonym ("flask") lands near
// 0.255, and a near-exact text match tops out around 0.29-0.30. So 0.24 is the
// confidence cutoff between results we show up front and the low-confidence
// "other possible matches" drawer, and 0.18 is how far below that we reach to
// fill the drawer. calibrateMatchScore() maps both bands onto readable
// percentages so nothing shows a flat "25%".
export const MATCH_THRESHOLD = 0.18;
export const PRIMARY_THRESHOLD = 0.24;
export const MATCH_COUNT = 15;

/**
 * Turns a raw cosine similarity into the percentage shown on a result card and
 * the tier that colours it.
 *
 * Confident band, [0.24, 0.30] -> [65%, 98%]:
 *   0.24  -> 65%   (weak)
 *   0.255 -> 73%   (moderate)
 *   0.29  -> 93%   (strong)
 *   0.30+ -> 98%   (strong)
 *
 * Low-confidence band, [0.18, 0.24) -> [40%, 64%], always 'weak':
 *   0.18  -> 40%
 *   0.21  -> 52%
 *   0.239 -> 64%
 */
export function calibrateMatchScore(similarity) {
  const CONFIDENT_MIN = 0.24;
  const CONFIDENT_MAX = 0.3;
  const LOW_MIN = 0.18;

  if (similarity < CONFIDENT_MIN) {
    const low = Math.min(Math.max(similarity, LOW_MIN), CONFIDENT_MIN);
    const normalized = (low - LOW_MIN) / (CONFIDENT_MIN - LOW_MIN);
    return { percent: Math.round(40 + normalized * 24), tier: 'weak' };
  }

  const clamped = Math.min(similarity, CONFIDENT_MAX);
  const normalized =
    (clamped - CONFIDENT_MIN) / (CONFIDENT_MAX - CONFIDENT_MIN);
  const percent = Math.round(65 + normalized * 33);

  let tier = 'weak';
  if (percent >= 85) tier = 'strong';
  else if (percent >= 70) tier = 'moderate';

  return { percent, tier };
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
 * with the rest of the description.
 *
 * Resolves to { primary, secondary, all, queryText, translatedText }, where
 * primary holds the confident matches and secondary the low-confidence ones
 * kept for the "other possible matches" drawer. Both keep the RPC's descending
 * score order.
 */
export async function searchItems({ text, color, photo, signal }) {
  const trimmed = (text ?? '').trim();
  const needsColor =
    color && !trimmed.toLowerCase().includes(color.toLowerCase());
  const queryText = [needsColor ? color : '', trimmed]
    .filter(Boolean)
    .join(' ');

  const [textResult, imageResult] = await Promise.all([
    queryText ? embedText(queryText, signal) : null,
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
    })
    .abortSignal(signal);

  if (error) throw new SearchError('db', error.message);

  // The RPC already applies the floor; re-checking here keeps the guarantee
  // even if an older match_items is still deployed.
  const all = (data ?? []).filter((item) => item.similarity >= MATCH_THRESHOLD);

  return {
    primary: all.filter((item) => item.similarity >= PRIMARY_THRESHOLD),
    secondary: all.filter((item) => item.similarity < PRIMARY_THRESHOLD),
    all,
    queryText,
    translatedText: textResult?.translatedText ?? null,
  };
}
