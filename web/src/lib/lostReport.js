import { supabase } from './supabase.js';
import {
  embedImageOrNull,
  embedText,
  MAX_EMBED_TEXT_LENGTH,
  SearchError,
} from './aiService.js';
import { combineEmbeddings } from './searchItems.js';

/*
 * Public lost-item reporting (no account required).
 *
 * A report is stored with a 512-dim embedding so staff intake can match it
 * against items as they are logged. The description is required; a photo is
 * optional and only contributes to the embedding. Photos are NOT uploaded or
 * stored — there is no Storage bucket yet — so image_url is always inserted as
 * null. If the photo cannot be embedded, the report still goes through on text
 * alone (see embedImageOrNull in aiService).
 *
 * The row is written through the submit_lost_report RPC rather than a table
 * insert. lost_reports has an INSERT policy for anon but no SELECT policy
 * (contact_info is PII and close_key is a bearer secret), so a plain insert
 * could never return the generated ref_code. The RPC is SECURITY DEFINER and
 * returns the receipt — ref_code and the private close_key — exactly once.
 */

/**
 * The single message the public sees for a missing key, a wrong key, or a
 * ref_code that does not exist. Keeping it here (and using it for every
 * report-level failure) is what stops the close page becoming a ref_code
 * oracle (AC 3).
 */
export const CLOSE_REPORT_NOT_FOUND_MESSAGE =
  'Report not found or invalid close link.';

/**
 * A genuine outage must not look like a bad link: an unreachable database or a
 * 5xx is something the citizen can retry, and saying "invalid close link"
 * would make them throw the receipt away.
 */
export const CLOSE_REPORT_RETRY_MESSAGE =
  'Unable to reach the server right now. Please try again.';

/** PostgREST reports both a wrong key and an unknown ref_code as P0002. */
const NOT_FOUND_ERROR_CODE = 'P0002';

/** code: 'not-found' | 'network' | 'validation' | 'db' */
export class LostReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LostReportError';
    this.code = code;
  }
}

/** The one row a table-returning RPC resolves to, whether wrapped or not. */
function receiptRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

/** Awaits an RPC builder without letting a fetch failure escape as a TypeError. */
async function runRpc(query) {
  try {
    return await query;
  } catch (thrown) {
    if (thrown?.name === 'AbortError') throw thrown;
    return { data: null, error: thrown ?? new Error('network failure') };
  }
}

/** The private link a citizen keeps after filing a lost report. */
export function buildCloseLink({
  refCode,
  closeKey,
  origin = window.location.origin,
}) {
  const ref = encodeURIComponent(String(refCode ?? '').trim());
  const key = encodeURIComponent(String(closeKey ?? '').trim());
  return `${origin}/close-report?ref=${ref}&key=${key}`;
}

/**
 * Embeds the description and the optional photo concurrently, averages the
 * vectors, and stores the report.
 *
 * Resolves to { refCode, closeKey, usedPhoto }. Throws SearchError with code
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
  // A description may sit right at the embed limit; the row keeps it in full,
  // but only what /embed/text accepts is sent for matching.
  const matchingText = description.trim().slice(0, MAX_EMBED_TEXT_LENGTH);

  const [textResult, photoEmbedding] = await Promise.all([
    embedText(matchingText, signal),
    photo ? embedImageOrNull(photo, signal, { label: 'lostReport' }) : null,
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

  const receipt = receiptRow(data);
  if (!receipt?.ref_code || !receipt?.close_key) {
    throw new SearchError('db', 'The report receipt was incomplete.');
  }

  return {
    refCode: receipt.ref_code,
    closeKey: receipt.close_key,
    usedPhoto: Boolean(photoEmbedding),
  };
}

/**
 * Closes an open report with the private key from the receipt (AC 2).
 *
 * A blank ref or key is rejected before the RPC, and every P0002 rejection —
 * missing key, wrong key, unknown ref_code — resolves to the same message, so
 * the page cannot be used to probe which ref_codes exist (AC 3). A real
 * network/5xx failure is reported separately so an outage is not mistaken for
 * a bad link.
 *
 * Resolves to { refCode, status, closedAt }. Throws LostReportError
 * 'not-found' | 'network'.
 */
export async function closeLostReport({ refCode, closeKey, signal }) {
  const normalizedRef = String(refCode ?? '').trim().toUpperCase();
  const normalizedKey = String(closeKey ?? '').trim();

  if (!normalizedRef || !normalizedKey) {
    throw new LostReportError('not-found', CLOSE_REPORT_NOT_FOUND_MESSAGE);
  }

  let query = supabase.rpc('close_lost_report_by_key', {
    p_ref_code: normalizedRef,
    p_close_key: normalizedKey,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await runRpc(query);
  if (error) {
    if (error.code === NOT_FOUND_ERROR_CODE) {
      throw new LostReportError('not-found', CLOSE_REPORT_NOT_FOUND_MESSAGE);
    }
    throw new LostReportError('network', CLOSE_REPORT_RETRY_MESSAGE);
  }

  const row = receiptRow(data);
  if (!row?.ref_code) {
    throw new LostReportError('not-found', CLOSE_REPORT_NOT_FOUND_MESSAGE);
  }

  return {
    refCode: row.ref_code,
    status: row.status,
    closedAt: row.closed_at ?? null,
  };
}
