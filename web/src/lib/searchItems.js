import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';

// Cosine similarity floor and page size passed to match_items.
//
// These numbers only make sense for text-to-PHOTO search: CLIP scores a text query
// against an item photo at roughly 0.20 to 0.35. Text-to-text scores run much higher
// (0.5 to 0.8 even for unrelated phrases), so items seeded from text alone, without
// --image, will look like strong matches for everything. Tune against photo-based items.
// In `npm run dev` each result card shows its raw score to help with this.
export const MATCH_THRESHOLD = 0.2;
export const MATCH_COUNT = 12;

// Score cutoffs for the labels on result cards.
export const STRONG_MATCH = 0.3;
export const GOOD_MATCH = 0.25;

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

  return {
    items: data ?? [],
    queryText,
    translatedText: textResult?.translatedText ?? null,
  };
}
