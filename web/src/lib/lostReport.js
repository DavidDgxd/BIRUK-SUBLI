import { supabase } from './supabase.js';
import { embedImage, embedText, SearchError } from './aiService.js';
import { combineEmbeddings } from './searchItems.js';

/*
 * Public lost-item reporting (no account required).
 *
 * A report is stored with a 512-dim embedding so staff intake can match it
 * against items as they are logged. The description is required; a photo is
 * optional and only contributes to the embedding. Photos are NOT uploaded or
 * stored — there is no Storage bucket yet — so image_url is always inserted as
 * null. If the photo cannot be embedded, the report still goes through on text
 * alone (see embedPhotoOrNull).
 *
 * The row is written through the submit_lost_report RPC rather than a table
 * insert. lost_reports has an INSERT policy for anon but no SELECT policy
 * (contact_info is staff-visible PII), so a plain insert could never return the
 * generated ref_code. The RPC is SECURITY DEFINER and returns only that code.
 */

/** A photo embedding is best-effort and must not hold a submission open forever. */
const IMAGE_TIMEOUT_MS = 8000;

/**
 * Embeds the photo, or resolves to null if that fails.
 *
 * Falls back on any photo-side problem (unreachable service, bad response,
 * timeout) so a citizen is never blocked from filing a report by the optional
 * half of it. A genuine cancel propagates instead — that is the caller
 * aborting, not the photo failing.
 */
async function embedPhotoOrNull(file, signal) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Photo embedding timed out', 'TimeoutError'),
      ),
    IMAGE_TIMEOUT_MS,
  );
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const { embedding } = await embedImage(file, controller.signal);
    return embedding;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (import.meta.env.DEV) {
      console.warn(
        '[lostReport] photo embedding failed, matching on text only:',
        error.message,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Embeds the description and the optional photo concurrently, averages the
 * vectors, and stores the report.
 *
 * Resolves to { refCode, usedPhoto }. Throws SearchError with code
 * 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db'.
 */
export async function submitLostReport({
  description,
  areaRoute,
  dateLost,
  contactInfo,
  photo,
  signal,
}) {
  const [textResult, photoEmbedding] = await Promise.all([
    embedText(description.trim(), signal),
    photo ? embedPhotoOrNull(photo, signal) : null,
  ]);

  const embedding = combineEmbeddings(
    [textResult.embedding, photoEmbedding].filter(Boolean),
  );

  let query = supabase.rpc('submit_lost_report', {
    p_description: description.trim(),
    p_area_route: areaRoute.trim(),
    p_date_lost: dateLost,
    p_contact_info: contactInfo?.trim() || null,
    p_image_url: null,
    p_embedding: embedding,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new SearchError('db', error.message);

  return { refCode: data, usedPhoto: Boolean(photoEmbedding) };
}
