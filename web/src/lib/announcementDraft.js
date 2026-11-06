/*
 * Public announcement draft (US-24).
 *
 * Only public-safe fields are accepted. The private verification `description`,
 * `cash_amount`, finder and claimant details are not parameters at all. The
 * sanitiser is a second line of defence for staff-typed titles and the caption
 * model's text: sentences with money, serial/ID references, phone numbers,
 * emails or links are dropped whole. Cash is announced by category, never by
 * value.
 */

const MONEY_MARKER =
  /(?:₱|\bphp\s*\d|\bphp\b|\bpesos?\b|\b(?:usd|dollars?)\b|\$\s*\d|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:php|pesos?|dollars?)\b|\bcash\s+(?:amount|total)\b)/i;
const SENSITIVE_MARKER =
  /(?:\bserial(?:\s*(?:no\.?|number))?\b|\bs\/n\b|\bimei\b|\bimsi\b|\bmac\s+address\b|\baccount(?:\s*(?:no\.?|number))?\b|\bacct\b|\bpassport(?:\s*(?:no\.?|number))?\b|\bid(?:\s*(?:no\.?|number))?\b|\blicen[cs]e(?:\s*(?:no\.?|number))?\b)/i;
const CONTACT_MARKER =
  /(?:\bhttps?:\/\/\S+|\bwww\.\S+|\b\S+@\S+\.\S+|\b(?:\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\b(?:[a-z0-9-]+\.)+(?:com|net|org|ph|io|gov)\b(?:\/\S*)?)/i;

export const MAX_ANNOUNCEMENT_LENGTH = 600;
export const MAX_CAPTION_LENGTH = 220;

const normalise = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…`;
}

/* Public titles such as "Student ID", "Passport" or "Bank account" are safe on
 * their own; only identifiers that carry digits are private. */
const isPrivate = (sentence) =>
  MONEY_MARKER.test(sentence) ||
  CONTACT_MARKER.test(sentence) ||
  (SENSITIVE_MARKER.test(sentence) && /\d/.test(sentence));

/** Drops private sentences and normalises the rest; exported for unit tests. */
export function sanitizeAnnouncementText(
  value,
  { maxLength = MAX_CAPTION_LENGTH } = {},
) {
  const text = normalise(value);
  if (!text) return '';

  const kept = text
    // Do not split after abbreviations such as "no." or "acct.": the
    // identifier and its label must stay in one sentence to be dropped whole.
    .split(/(?<=[.!?])(?<!\b(?:no|nos|acct)\.)\s+|\n+/i)
    .map(normalise)
    .filter((sentence) => sentence && !isPrivate(sentence));

  return truncate(normalise(kept.join(' ')), maxLength);
}

/** Builds the ready-to-post draft; returns '' when there is nothing safe to post. */
export function buildAnnouncementDraft({
  title,
  category = 'General',
  aiCaption = '',
  officeName = '',
  isCash = false,
}) {
  const cleanOffice = sanitizeAnnouncementText(officeName, { maxLength: 100 });
  const cleanTitle = sanitizeAnnouncementText(title, { maxLength: 120 });
  const cleanCategory =
    sanitizeAnnouncementText(category, { maxLength: 40 }) || 'General';
  const cleanCaption = sanitizeAnnouncementText(aiCaption);

  if (!cleanOffice && !cleanTitle) return '';

  const place = cleanOffice || 'a participating office';
  const heading = isCash
    ? `Found cash at ${place}`
    : `Found item at ${place}${cleanTitle ? `: ${cleanTitle}` : ''}`;
  const fallback = isCash
    ? 'Cash has been handed in. Please describe it at the counter.'
    : 'See the photo for details.';
  const tail = [
    '',
    `Category: ${cleanCategory}`,
    '',
    `If this belongs to you, visit ${place} and describe the item at the counter. Bring a valid ID.`,
  ].join('\n');

  if (!cleanCaption) {
    return truncate(`${heading}\n\n${fallback}${tail}`, MAX_ANNOUNCEMENT_LENGTH);
  }

  const head = `${heading}\n\n`;
  const full = `${head}${cleanCaption}${tail}`;
  if (full.length <= MAX_ANNOUNCEMENT_LENGTH) return full;

  // Trim the caption only, so the essential "visit the office… Bring a valid
  // ID." footer always survives a long title, office name or caption.
  const budget = MAX_ANNOUNCEMENT_LENGTH - head.length - tail.length;
  const visibleCaption = budget > 0 ? truncate(cleanCaption, budget) : '';
  const draft = `${head}${visibleCaption}${tail}`;

  return draft.length <= MAX_ANNOUNCEMENT_LENGTH
    ? draft
    : truncate(draft, MAX_ANNOUNCEMENT_LENGTH);
}
