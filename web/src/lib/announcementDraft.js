/*
 * Public announcement drafts (US-24, US-25).
 *
 * Only public-safe fields are accepted. The private verification `description`,
 * `cash_amount`, finder and claimant details are not parameters at all, and the
 * internal `ref_code` stays off the public notice. The sanitiser is a second
 * line of defence for staff-typed titles and the caption model's text:
 * sentences with money, serial/ID references, phone numbers, emails or links
 * are dropped whole. Cash is announced by category, never by value.
 *
 * US-25 adds local English and Filipino templates, so an unreachable caption
 * service still produces usable drafts.
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

const TEMPLATES = {
  en: {
    place: 'a participating office',
    heading: (p, t, cash) =>
      cash ? `Found cash at ${p}` : `Found item at ${p}${t ? `: ${t}` : ''}`,
    caption: (cash) =>
      cash
        ? 'Cash has been handed in. Please describe it at the counter.'
        : 'See the photo for details.',
    category: (v) => `Category: ${v}`,
    hours: (v) => `Counter hours: ${v}`,
    closing: (p) =>
      `If this belongs to you, visit ${p} and describe the item at the counter. Bring a valid ID.`,
  },
  tl: {
    place: 'isang kalahok na opisina',
    heading: (p, t, cash) =>
      cash ? `May nakitang pera sa ${p}` : `May nakitang bagay sa ${p}${t ? `: ${t}` : ''}`,
    caption: (cash) =>
      cash
        ? 'May isinuling pera. Pakilarawan ito sa counter.'
        : 'Tingnan ang larawan para sa detalye.',
    category: (v) => `Kategorya: ${v}`,
    hours: (v) => `Oras ng counter: ${v}`,
    closing: (p) =>
      `Kung ito ay sa iyo, pumunta sa ${p} at ilarawan ang bagay sa counter. Magdala ng valid ID.`,
  },
};
/** Builds the ready-to-post draft; returns '' when there is nothing safe to post. */
export function buildAnnouncementDraft({
  title,
  category = 'General',
  aiCaption = '',
  officeName = '',
  counterHours = '',
  isCash = false,
  language = 'en',
}) {
  const template = TEMPLATES[language === 'tl' || language === 'fil' ? 'tl' : 'en'];
  const cleanOffice = sanitizeAnnouncementText(officeName, { maxLength: 100 });
  const cleanTitle = sanitizeAnnouncementText(title, { maxLength: 120 });
  const cleanCategory =
    sanitizeAnnouncementText(category, { maxLength: 40 }) || 'General';
  const cleanCaption = sanitizeAnnouncementText(aiCaption);
  const cleanHours = sanitizeAnnouncementText(counterHours, { maxLength: 100 });
  if (!cleanOffice && !cleanTitle) return '';
  const place = cleanOffice || template.place;
  const heading = template.heading(place, cleanTitle, isCash);
  const tail = [
    '',
    template.category(cleanCategory),
    ...(cleanHours ? [template.hours(cleanHours)] : []),
    '',
    template.closing(place),
  ].join('\n');
  if (!cleanCaption) {
    return truncate(
      `${heading}\n\n${template.caption(isCash)}${tail}`,
      MAX_ANNOUNCEMENT_LENGTH,
    );
  }
  const head = `${heading}\n\n`;
  const full = `${head}${cleanCaption}${tail}`;
  if (full.length <= MAX_ANNOUNCEMENT_LENGTH) return full;
  // Trim the caption only, so the essential footer always survives a long
  // title, office name or caption.
  const budget = MAX_ANNOUNCEMENT_LENGTH - head.length - tail.length;
  const visibleCaption = budget > 0 ? truncate(cleanCaption, budget) : '';
  const draft = `${head}${visibleCaption}${tail}`;
  return draft.length <= MAX_ANNOUNCEMENT_LENGTH
    ? draft
    : truncate(draft, MAX_ANNOUNCEMENT_LENGTH);
}
/** English + Filipino drafts from the same public metadata (US-25). */
export function buildAnnouncementDrafts(input = {}) {
  return {
    en: buildAnnouncementDraft({ ...input, language: 'en' }),
    tl: buildAnnouncementDraft({ ...input, language: 'tl' }),
  };
}
/** Edits one language without touching the other (US-25). */
export function updateAnnouncementDraft(draft, language, text) {
  const key = language === 'tl' || language === 'fil' ? 'tl' : 'en';
  return { en: '', tl: '', ...draft, [key]: text };
}
const COPY_ACTIONS = ['en', 'tl', 'both'];
/** Both drafts in one plain-text clipboard payload. */
export function combinedAnnouncementText({ en = '', tl = '' } = {}) {
  const english = String(en ?? '').trim();
  const filipino = String(tl ?? '').trim();
  return [
    english && `ENGLISH\n${english}`,
    filipino && `FILIPINO\n${filipino}`,
  ].filter(Boolean).join('\n\n');
}
function textFor(action, { en = '', tl = '' }) {
  if (action === 'en') return String(en ?? '').trim();
  if (action === 'tl') return String(tl ?? '').trim();
  return combinedAnnouncementText({ en, tl });
}
async function photoPart(photoUrl, fetchImpl) {
  if (!photoUrl || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(photoUrl);
    if (!response?.ok) return null;
    const blob = await response.blob();
    return blob ? { [blob.type || 'image/png']: blob } : null;
  } catch {
    return null;
  }
}
/** Copies one draft, or both with the photo, in one action (writeText fallback). */
export async function copyAnnouncement(
  action,
  {
    en = '',
    tl = '',
    photoUrl = '',
    clipboard = globalThis.navigator?.clipboard,
    ClipboardItemCtor = globalThis.ClipboardItem,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!COPY_ACTIONS.includes(action)) throw new Error(`Unknown copy action: ${action}`);
  const text = textFor(action, { en, tl });
  if (!text) throw new Error('There is nothing to copy yet.');
  if (!clipboard?.writeText && !clipboard?.write) {
    throw new Error('Clipboard access is unavailable.');
  }
  if (
    action === 'both' &&
    typeof clipboard.write === 'function' &&
    typeof ClipboardItemCtor === 'function'
  ) {
    const media = await photoPart(photoUrl, fetchImpl);
    const parts = {
      'text/plain': new Blob([text], { type: 'text/plain' }),
      ...(media ?? {}),
    };
    try {
      await clipboard.write([new ClipboardItemCtor(parts)]);
      return { mode: 'rich', photoIncluded: Boolean(media) };
    } catch {
      // Some browsers accept writeText but not write; use the plain fallback.
    }
  }
  if (typeof clipboard.writeText !== 'function') {
    throw new Error('Clipboard access is unavailable.');
  }
  await clipboard.writeText(text);
  return { mode: 'text', photoIncluded: false };
}
