import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Cosine similarity floor and page size passed to match_items.
//
// Scores are tightly compressed in this setup: an unrelated item (a wallet,
// for a bottle query) sits below 0.24, a semantic synonym ("flask") lands near
// 0.255, and a near-exact text match tops out around 0.29-0.30. The floor is
// therefore 0.24 — anything below it is noise — and calibrateMatchScore()
// stretches [0.24, 0.30] across the badge range so the percentage is meaningful
// instead of a flat 24-30%.
export const MATCH_THRESHOLD = 0.24;
export const MATCH_COUNT = 12;

/**
 * Stretches the compressed raw similarity range [0.24, 0.30] onto [65%, 98%]
 * and picks the badge tier from the rounded percentage, so a synonym and a
 * near-exact match read as clearly different rather than both showing "25%".
 *
 *   0.24  -> 65%   (weak; the MATCH_THRESHOLD floor)
 *   0.255 -> 73%
 *   0.29  -> 93%
 *   0.30+ -> 98%   (strong)
 */
export function calibrateMatchScore(similarity) {
  const MIN_SCORE = 0.24;
  const MAX_SCORE = 0.3;

  const clamped = Math.min(Math.max(similarity, MIN_SCORE), MAX_SCORE);
  const normalized = (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);

  // Maps 0.24 -> 65%, 0.255 -> 73%, 0.29 -> 93%, 0.30 -> 98%.
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
 * Resolves to { items, queryText, translatedText }.
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
  const items = (data ?? []).filter(
    (item) => item.similarity >= MATCH_THRESHOLD,
  );

  return {
    items,
    queryText,
    translatedText: textResult?.translatedText ?? null,
  };
}
