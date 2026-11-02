import { describe, expect, it } from 'vitest';
import { captionSource, shouldApplyCaption } from './captionSuggestion.js';

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
    expect(captionSource({ url: 'https://example.test/first.webp' })).not.toEqual(
      captionSource({ url: 'https://example.test/second.webp' }),
    );
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
