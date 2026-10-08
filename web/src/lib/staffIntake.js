import { supabase } from './supabase.js';
import { embedImageOrNull, embedText, SearchError } from './aiService.js';
import { combineEmbeddings } from './searchItems.js';
import { uploadItemImage } from './storage.js';

/*
 * Staff custody intake.
 *
 * A counter officer logs an item that has been physically handed in. The photo
 * is mandatory and is kept in the shared `item-photos` bucket (under its own
 * `staff-intake/` folder), the title/category/description are embedded for later
 * search, and the row is written through the submit_staff_custody RPC — which
 * always opens it as 'held' and returns the generated ref_code used as the
 * custody receipt reference.
 *
 * The RPC is used rather than a plain insert so the same call works once real
 * staff auth replaces the dev mock session, and so the server owns the
 * 'held' status and cash retention rules.
 *
 * Embedding: the intake text is embedded for the matching vector; the photo is
 * embedded as a best-effort extra. If the photo half fails, the item still
 * matches on text alone — the counter must never be blocked from taking custody.
 * If the text half fails the submission fails, because an unsearchable item is
 * worse than a retry.
 */

/**
 * Uploads the photo, embeds the intake text and the photo concurrently, averages
 * the vectors, and opens the custody record.
 *
 * Resolves to { refCode, imageUrl, usedPhoto }. Throws SearchError with code
 * 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db', or a StorageError
 * with code 'image-convert' | 'image-upload'.
 */
export async function submitStaffCustody({
  officeId,
  title,
  description,
  category,
  storageLocation,
  dateReceived,
  cashAmount,
  finderName,
  finderContact,
  photo,
  signal,
}) {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();
  const cleanStorage = storageLocation.trim();
  const isCash = category === 'Cash';

  // Storage location is deliberately left out: where a shelf is says nothing
  // about what the item is, and it would only add noise to the vector.
  const matchingText = [cleanTitle, category, cleanDescription]
    .filter(Boolean)
    .join(' ');

  const [imageUrl, textResult, photoEmbedding] = await Promise.all([
    uploadItemImage(photo, signal, 'staff-intake'),
    embedText(matchingText, signal),
    embedImageOrNull(photo, signal, { label: 'staffIntake' }),
  ]);

  const embedding = combineEmbeddings(
    [textResult.embedding, photoEmbedding].filter(Boolean),
  );

  let query = supabase.rpc('submit_staff_custody', {
    p_office_id: officeId,
    p_title: cleanTitle,
    p_description: cleanDescription,
    p_category: category,
    p_storage_location: cleanStorage,
    p_image_url: imageUrl,
    p_embedding: embedding,
    p_date_received: dateReceived,
    p_cash_amount: isCash ? Number(cashAmount) || 0 : null,
    p_finder_name: isCash ? finderName?.trim() || null : null,
    p_finder_contact: finderContact?.trim() || null,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new SearchError('db', error.message);

  return { refCode: data, imageUrl, usedPhoto: Boolean(photoEmbedding) };
}
