import { supabase } from './supabase.js';
import { embedImageOrNull, embedText, SearchError } from './aiService.js';
import { combineEmbeddings } from './searchItems.js';
import { uploadItemImage } from './storage.js';

/*
 * Public found-item reporting (no account required).
 *
 * Unlike a lost report — where the photo is embedded once and discarded — a
 * finder's photo is kept: it is uploaded to the shared `item-photos` bucket and
 * stored on the report, because staff use it at intake to identify the item.
 * The photo is therefore mandatory here.
 *
 * The short note and found location are embedded together with the photo and the
 * averaged vector is stored, so a find can later be reverse-matched against open
 * lost reports (mirroring lost_reports.embedding).
 *
 * The row is written through the submit_found_report RPC rather than a table
 * insert. found_reports has an INSERT policy for anon but no SELECT policy
 * (finder_contact is staff-visible PII), so a plain insert could never return the
 * generated ref_code. The RPC is SECURITY DEFINER and returns only that code.
 */

/**
 * Uploads the photo, embeds the note/location and photo concurrently, averages
 * the vectors, and stores the report.
 *
 * The photo is embedded best-effort (see embedImageOrNull in aiService): the
 * photo is still uploaded and stored either way, but if it cannot be read for
 * matching the report falls back to the note/location text alone.
 *
 * Resolves to { refCode, imageUrl, usedPhoto }. Throws SearchError with code
 * 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db', or a StorageError
 * with code 'image-convert' | 'image-upload' from the upload.
 */
export async function submitFoundReport({
  shortNote,
  foundLocation,
  foundDate,
  finderContact,
  photo,
  signal,
}) {
  const note = shortNote.trim();
  const location = foundLocation.trim();

  const [imageUrl, textResult, photoEmbedding] = await Promise.all([
    uploadItemImage(photo, signal),
    embedText(`${note} ${location}`, signal),
    embedImageOrNull(photo, signal, { label: 'foundReport' }),
  ]);

  const embedding = combineEmbeddings(
    [textResult.embedding, photoEmbedding].filter(Boolean),
  );

  let query = supabase.rpc('submit_found_report', {
    p_short_note: note,
    p_found_location: location,
    p_found_date: foundDate,
    p_image_url: imageUrl,
    p_finder_contact: finderContact?.trim() || null,
    p_embedding: embedding,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new SearchError('db', error.message);

  return { refCode: data, imageUrl, usedPhoto: Boolean(photoEmbedding) };
}
