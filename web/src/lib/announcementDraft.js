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

/* The Filipino caption is machine-translated, so the markers include the
 * Tagalog words the translation produces as well as the English originals. */
const MONEY_MARKER =
  /(?:₱|\bphp\s*\d|\bphp\b|\bpesos?\b|\b(?:usd|dollars?)\b|\$\s*\d|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:php|pesos?|dollars?|piso|sentimo)\b|\bcash\s+(?:amount|total)\b)/i;
const SENSITIVE_MARKER =
  /(?:\bserial(?:\s*(?:no\.?|number))?\b|\bs\/n\b|\bimei\b|\bimsi\b|\bmac\s+address\b|\baccount(?:\s*(?:no\.?|number))?\b|\bacct\b|\bpassport(?:\s*(?:no\.?|number))?\b|\bpasaporte\b|\bid(?:\s*(?:no\.?|number))?\b|\blicen[cs]e(?:\s*(?:no\.?|number))?\b|\blisensya\b|\bnumero\b|\bserye\b|\bresibo\b|\btseke\b|\bplaka\b|\bhalaga\b)/i;
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
    heading: (p, t, c) => c ? `Found cash at ${p}` : `Found item at ${p}${t ? `: ${t}` : ''}`,
    caption: (c) => c ? 'Cash has been handed in. Please describe it at the counter.' : 'See the photo for details.',
    category: (v) => `Category: ${v}`,
    hours: (v) => `Counter hours: ${v}`,
    closing: (p) => `If this belongs to you, visit ${p} and describe the item at the counter. Bring a valid ID.`,
  },
  tl: {
    place: 'isang kalahok na opisina',
    heading: (p, t, c) => c ? `May nakitang pera sa ${p}` : `May nakitang bagay sa ${p}${t ? `: ${t}` : ''}`,
    caption: (c) => c ? 'May isinuling pera. Pakilarawan ito sa counter.' : 'Tingnan ang larawan para sa detalye.',
    category: (v) => `Kategorya: ${v}`,
    hours: (v) => `Oras ng counter: ${v}`,
    closing: (p) => `Kung ito ay sa iyo, pumunta sa ${p} at ilarawan ang bagay sa counter. Magdala ng valid ID.`,
  },
};
/** Builds the ready-to-post draft; returns '' when there is nothing safe to post. */
export function buildAnnouncementDraft({
  title,
  category = 'General',
  aiCaption = '',
  aiCaptionTl = '',
  officeName = '',
  counterHours = '',
  isCash = false,
  language = 'en',
}) {
  const isFilipino = language === 'tl' || language === 'fil';
  const template = TEMPLATES[isFilipino ? 'tl' : 'en'];
  const cleanOffice = sanitizeAnnouncementText(officeName, { maxLength: 100 });
  const cleanTitle = sanitizeAnnouncementText(title, { maxLength: 120 });
  const cleanCategory =
    sanitizeAnnouncementText(category, { maxLength: 40 }) || 'General';
  const cleanCaption = sanitizeAnnouncementText(isFilipino ? aiCaptionTl : aiCaption);
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
export const buildAnnouncementDrafts = (input = {}) => ({
  en: buildAnnouncementDraft({ ...input, language: 'en' }),
  tl: buildAnnouncementDraft({ ...input, language: 'tl' }),
});
export const updateAnnouncementDraft = (draft, language, text) => ({
  en: '', tl: '', ...draft,
  [language === 'tl' || language === 'fil' ? 'tl' : 'en']: text,
});
const COPY_ACTIONS = ['en', 'tl', 'both', 'photo'];
export function combinedAnnouncementText({ en = '', tl = '' } = {}) {
  const english = String(en ?? '').trim();
  const filipino = String(tl ?? '').trim();
  return [english && `ENGLISH\n${english}`, filipino && `FILIPINO\n${filipino}`].filter(Boolean).join('\n\n');
}
function textFor(action, { en = '', tl = '' }) {
  if (action === 'en') return String(en ?? '').trim();
  if (action === 'tl') return String(tl ?? '').trim();
  return combinedAnnouncementText({ en, tl });
}
export async function copyAnnouncement(
  action,
  {
    en = '',
    tl = '',
    photoBlob = null,
    clipboard = globalThis.navigator?.clipboard,
    ClipboardItemCtor = globalThis.ClipboardItem,
  } = {},
) {
  if (!COPY_ACTIONS.includes(action)) throw new Error(`Unknown copy action: ${action}`);
  if (!clipboard?.writeText && !clipboard?.write) throw new Error('Clipboard access is unavailable.');
  if (action === 'photo') {
    // Paste targets like Facebook read one MIME format per paste, so the
    // photo travels on its own and the text is copied separately.
    if (!photoBlob) throw new Error('The photo is not ready yet.');
    if (typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
      throw new Error('Clipboard access is unavailable.');
    }
    // The PNG blob is prepared before the click, so write() runs inside the
    // transient activation window required by Safari/iOS.
    await clipboard.write([new ClipboardItemCtor({ 'image/png': photoBlob })]);
    return { mode: 'photo', photoIncluded: true };
  }
  const text = textFor(action, { en, tl });
  if (!text) throw new Error('There is nothing to copy yet.');
  if (typeof clipboard.writeText !== 'function') throw new Error('Clipboard access is unavailable.');
  await clipboard.writeText(text);
  return { mode: 'text', photoIncluded: false };
}
