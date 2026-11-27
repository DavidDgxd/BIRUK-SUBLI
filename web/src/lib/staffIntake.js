import { supabase } from './supabase.js';
import {
  embedImageFromUrlOrNull,
  embedImageOrNull,
  embedItemText,
  embedText,
  MAX_EMBED_TEXT_LENGTH,
  SearchError,
} from './aiService.js';
import { combineEmbeddings } from './searchItems.js';
import { uploadItemImage } from './storage.js';

/*
 * Staff custody intake.
 *
 * A counter officer logs an item that has been physically handed in. The photo
 * is mandatory and is kept in the shared `item-photos` bucket (under its own
 * `staff-intake/` folder), the title/category/description are embedded for later
 * search, and the row is written through the submit_staff_custody RPC — which
 * always opens it as 'held' and returns the generated ref_code (the custody
 * receipt reference) plus the new item's id, which the receipt uses to request
 * reverse matching (US-16).
 *
 * `description` is the staff verification record (marks, serial numbers,
 * condition). It is deliberately NOT embedded: the public text index is built
 * from title, category and caption only, so a claimant cannot probe the marks
 * through search. Anon also has no direct read on items — see the "hide private
 * verification details" section of schema.sql.
 *
 * The RPC is used rather than a plain insert so the same call works once real
 * staff auth replaces the dev mock session, and so the server owns the
 * 'held' status and cash retention rules.
 *
 * Embedding: public-safe text is embedded twice — once with CLIP for the legacy
 * combined vector and once with the small English text tower for the two-tower
 * index — and the photo is embedded with CLIP as a best-effort extra. If the
 * photo half fails, the item still matches on text alone — the counter must
 * never be blocked from taking custody. If the text half fails the submission
 * fails, because an unsearchable item is worse than a retry.
 *
 * US-5: `aiCaption` is the raw suggestion produced from the photo. The staffer
 * may edit it before submitting, so it is stored separately from the confirmed
 * verification notes in items.ai_caption.
 */

/* Cash is the only category that asks for finder details (US-27). The same
 * checks run in the form, and the server enforces them with
 * items_cash_finder_required so a direct RPC call cannot skip them. */
const CASH_FINDER_MESSAGES = {
  finderName: 'Enter the finder’s name so the reward can be claimed.',
  finderContact:
    'Enter the finder’s phone number or email so they can be reached.',
};

/** Returns per-field messages; empty for non-cash items or complete details. */
export function validateCashFinderDetails({
  category,
  finderName,
  finderContact,
}) {
  if (category !== 'Cash') return {};
  const errors = {};
  if (!String(finderName ?? '').trim()) {
    errors.finderName = CASH_FINDER_MESSAGES.finderName;
  }
  if (!String(finderContact ?? '').trim()) {
    errors.finderContact = CASH_FINDER_MESSAGES.finderContact;
  }
  return errors;
}

/**
 * date_received + 6 months as YYYY-MM-DD, matching PostgreSQL's
 * `date + interval '6 months'` month-end clamp. Computed without a Date
 * timezone round-trip so the receipt shows the same calendar date the database
 * stores for the reward clock.
 */
export function cashRewardDate(dateReceived) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(dateReceived ?? '').trim(),
  );
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonth = monthIndex + 6;
  const targetYear = year + Math.floor(targetMonth / 12);
  const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const pad = (value) => String(value).padStart(2, '0');
  return `${targetYear}-${pad(targetMonthIndex + 1)}-${pad(targetDay)}`;
}

/**
 * Uploads the photo, embeds the intake text and the photo concurrently, averages
 * the vectors, and opens the custody record.
 *
 * Resolves to { refCode, itemId, imageUrl, usedPhoto }. Throws SearchError with
 * code 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db', or a
 * StorageError with code 'image-convert' | 'image-upload'.
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
  photoUrl = '',
  foundReportId = null,
  aiCaption,
  signal,
}) {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();
  const cleanStorage = storageLocation.trim();
  const cleanCaption = aiCaption?.trim() || null;
  const isCash = category === 'Cash';

  // Storage location and the staff-only description are deliberately left out:
  // where a shelf is says nothing about what the item is, and the description
  // holds the counter check. The public index only sees fields a visitor can
  // already infer from the photo and the listing.
  const matchingText = [cleanTitle, category, cleanCaption]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_EMBED_TEXT_LENGTH);

  // A pre-filled self-report already has its photo in the shared bucket. Reuse
  // that URL instead of downloading and re-uploading the same object. When the
  // officer picks a different file, that file wins and is stored normally.
  //
  // The reused photo is fetched and embedded too: a text-only vector scores
  // much higher on every text query than the text+photo vectors other items use.
  const reusedPhoto = Boolean(photoUrl) && !photo;
  const [imageUrl, legacyTextResult, itemTextResult, photoEmbedding] =
    await Promise.all([
      photo
        ? uploadItemImage(photo, signal, 'staff-intake')
        : Promise.resolve(photoUrl),
      embedText(matchingText, signal),
      embedItemText(matchingText, signal),
      photo
        ? embedImageOrNull(photo, signal, { label: 'staffIntake' })
        : photoUrl
          ? embedImageFromUrlOrNull(photoUrl, signal, { label: 'staffIntake' })
          : Promise.resolve(null),
    ]);

  const legacyEmbedding = combineEmbeddings(
    [legacyTextResult.embedding, photoEmbedding].filter(Boolean),
  );

  const amount = Number(cashAmount);
  const cleanAmount = Number.isFinite(amount)
    ? Math.round(amount * 100) / 100
    : 0;

  let query = supabase.rpc('submit_staff_custody', {
    p_office_id: officeId,
    p_title: cleanTitle,
    p_description: cleanDescription,
    p_category: category,
    p_storage_location: cleanStorage,
    p_image_url: imageUrl,
    p_embedding: legacyEmbedding,
    p_text_embedding: itemTextResult.embedding,
    p_image_embedding: photoEmbedding,
    p_date_received: dateReceived,
    p_cash_amount: isCash ? cleanAmount : null,
    p_finder_name: isCash ? finderName?.trim() || null : null,
    p_finder_contact: finderContact?.trim() || null,
    p_found_report_id: foundReportId || null,
    p_ai_caption: cleanCaption,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) {
    if (
      error.code === 'P0002' ||
      /no longer pending/i.test(error.message ?? '')
    ) {
      throw new SearchError('report-taken', error.message);
    }
    throw new SearchError('db', error.message);
  }

  // submit_staff_custody returns table (ref_code, item_id); PostgREST returns
  // a returns-table function as an array of rows, and the submit produces
  // exactly one. Older deployments returned the reference as a bare string,
  // so accept both shapes while the migration rolls out. [FR-001]
  const first = Array.isArray(data) ? data[0] : data;
  const row = first && typeof first === 'object' ? first : null;
  const legacyRefCode = typeof first === 'string' ? first : null;

  return {
    refCode: legacyRefCode ?? row?.ref_code ?? null,
    itemId: row?.item_id ?? null,
    imageUrl,
    usedPhoto: Boolean(photoEmbedding),
    reusedPhoto,
  };
}
