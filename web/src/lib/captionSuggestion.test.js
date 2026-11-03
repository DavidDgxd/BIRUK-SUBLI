import { describe, expect, it } from 'vitest';
import {
  captionForSubmission,
  captionSource,
  shouldApplyCaption,
  truncateAtWordBoundary,
} from './captionSuggestion.js';

describe('captionSource', () => {
  it('captions a reused report photo by URL when no new file is picked', () => {
    const url = 'https://example.test/found-reports/original.webp';
    expect(captionSource({ file: null, url })).toEqual({ url });
  });

  it('prefers a replacement file over the reused report URL', () => {
    const file = new Blob(['photo'], { type: 'image/webp' });
    const photo = { file, url: 'https://example.test/original.webp' };
    expect(captionSource(photo)).toEqual({ file });
  });

  it('resets when the photo is removed or the selected report changes', () => {
    expect(captionSource(null)).toBeNull();
    expect(captionSource({ file: null, url: '' })).toBeNull();
    expect(
      captionSource({ url: 'https://example.test/first.webp' }),
    ).not.toEqual(captionSource({ url: 'https://example.test/second.webp' }));
  });
});

describe('shouldApplyCaption', () => {
  it('fills empty or whitespace-only notes', () => {
    expect(shouldApplyCaption('', '')).toBe(true);
    expect(shouldApplyCaption('   ', 'A black umbrella.')).toBe(true);
  });

  it('replaces the previous suggestion', () => {
    expect(shouldApplyCaption('A black umbrella.', 'A black umbrella.')).toBe(
      true,
    );
  });

  it('never overwrites notes the staffer typed or the report prefilled', () => {
    expect(shouldApplyCaption('Serial number 1234 on the handle.', '')).toBe(
      false,
    );
    expect(
      shouldApplyCaption('Black folding umbrella', 'A black umbrella.'),
    ).toBe(false);
  });
});

describe('truncateAtWordBoundary', () => {
  it('leaves text that already fits unchanged', () => {
    expect(truncateAtWordBoundary('A black umbrella.', 100)).toBe(
      'A black umbrella.',
    );
  });

  it('cuts at a space instead of through the next word', () => {
    expect(truncateAtWordBoundary('A black umbrella with a handle', 20)).toBe(
      'A black umbrella',
    );
  });

  it('returns nothing when no complete word fits', () => {
    expect(truncateAtWordBoundary('umbrella', 4)).toBe('');
  });
});

describe('captionForSubmission', () => {
  const ready = { status: 'ready', text: 'A black umbrella.' };

  it('submits an explicitly accepted suggestion', () => {
    expect(captionForSubmission(ready, true)).toBe('A black umbrella.');
  });

  it('does not submit a suggestion the staffer ignored', () => {
    expect(captionForSubmission(ready, false)).toBeNull();
  });

  // "Accept, then edit the notes" is covered by the staff-intake-reused-caption
  // e2e, which submits the form and asserts p_ai_caption stays the accepted
  // suggestion while p_description carries the edit.

  it('does not submit after the suggestion is dismissed', () => {
    expect(captionForSubmission(null, false)).toBeNull();
  });

  it('does not submit after the photo is removed', () => {
    expect(captionForSubmission(null, false)).toBeNull();
    expect(captionForSubmission({ status: 'loading' }, true)).toBeNull();
  });
});
