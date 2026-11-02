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
