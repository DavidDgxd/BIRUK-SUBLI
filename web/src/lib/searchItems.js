import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Score bands passed to match_items, plus the primary/secondary split.
//
// These are calibrated against the photo-backed distribution: an unrelated
// query ("bottle", "wallet") scores 0.55-0.58, a semantic synonym ("blower")
// lands near 0.604, and a direct match ("fan") near 0.675. So 0.60 is the
// confidence cutoff between results we show up front and the low-confidence
// "other possible matches" drawer, and 0.55 is how far below that we reach to
// fill the drawer. calibrateMatchScore() maps both bands onto readable
// percentages so nothing shows a flat "55%".
export const MATCH_THRESHOLD = 0.55;
export const PRIMARY_THRESHOLD = 0.6;
export const MATCH_COUNT = 15;

/**
 * Turns a raw cosine similarity into the percentage shown on a result card and
 * the tier that colours it.
 *
 * Primary band, [0.60, 0.70] -> [70%, 98%]:
 *   0.60  -> 70%   (moderate)
 *   0.604 -> 71%   (moderate)
 *   0.65  -> 84%   (moderate)
 *   0.675 -> 91%   (strong)
 *   0.70+ -> 98%   (strong)
 *
 * Secondary drawer band, [0.55, 0.599] -> [45%, 69%], always 'weak':
 *   0.55  -> 45%
 *   0.575 -> 57%
 *   0.599 -> 69%
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
