/*
 * Caption suggestion helpers for staff intake (US-5).
 *
 * The photo to describe is either a newly selected file, or the photo reused
 * from a pending self-report the officer picked (US-10). In both cases the
 * caption is only a starting point for the private verification notes.
 */

/** The photo to caption. A newly picked file wins over a reused report URL. */
export function captionSource(photo) {
  if (photo?.file) return { file: photo.file };
  if (photo?.url) return { url: photo.url };
  return null;
}

/**
 * A suggestion may replace the notes only when the staffer has not written
 * anything yet: the field is empty, or still holds the last suggestion applied.
 * Prefilled report notes count as the staffer's own words and are kept.
 */
export function shouldApplyCaption(current, autoFilled) {
  const trimmed = String(current ?? '').trim();
  return !trimmed || trimmed === String(autoFilled ?? '');
}

/** Cap text at the last word that fits, never in the middle of a word. */
export function truncateAtWordBoundary(text, maxLength) {
  const clean = String(text ?? '').trim();
  if (maxLength <= 0) return '';
  if (clean.length <= maxLength) return clean;

  const window = clean.slice(0, maxLength + 1);
  const boundary = window.lastIndexOf(' ');
  if (boundary <= 0) return '';

  return window.slice(0, boundary).trimEnd();
}

/**
 * The caption saved with the item. Only an explicitly accepted, ready
 * suggestion qualifies; ignoring, dismissing or removing the photo leaves it
 * null even if the suggested text was copied into the notes automatically.
 */
export function captionForSubmission(suggestion, accepted) {
  if (!accepted || suggestion?.status !== 'ready') return null;
  return suggestion.text || null;
}
