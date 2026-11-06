import { describe, expect, it, vi } from 'vitest';
import {
  buildAnnouncementDraft,
  buildAnnouncementDrafts,
  copyAnnouncement,
  MAX_ANNOUNCEMENT_LENGTH,
  sanitizeAnnouncementText,
  updateAnnouncementDraft,
} from './announcementDraft.js';

const ITEM = {
  title: 'Brown leather wallet',
  category: 'Bags & Wallets',
  aiCaption: 'A brown leather wallet sitting on a wooden table.',
  officeName: 'Baguio City Public Information Office',
  refCode: 'BS-0115',
};

describe('buildAnnouncementDraft', () => {
  it('builds from public fields and ignores private records', () => {
    const draft = buildAnnouncementDraft({
      ...ITEM,
      description: 'Serial 991287 on the inner flap. Contains a bus card.',
      cashAmount: 5000,
      finderName: 'Juan dela Cruz',
      finderContact: '0917 555 1234',
    });

    expect(draft).toContain(
      'Found item at Baguio City Public Information Office: Brown leather wallet',
    );
    expect(draft).toContain(ITEM.aiCaption);
    expect(draft).toContain('Category: Bags & Wallets');
    expect(draft).not.toMatch(/BS-0115|991287|bus card|5000|Juan|0917/);
    expect(draft.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_LENGTH);
  });

  it('keeps cash generic so no monetary figure reaches the post', () => {
    const draft = buildAnnouncementDraft({
      ...ITEM,
      title: 'Cash',
      category: 'Cash',
      isCash: true,
      cashAmount: 12500,
      aiCaption: 'Cash amounting to PHP 12,500 in an envelope.',
    });

    expect(draft).toContain('Found cash at Baguio City Public Information Office');
    expect(draft).toContain('Cash has been handed in.');
    expect(draft).not.toMatch(/12,500|12500|php/i);
  });

  it('returns an empty draft when there is no safe text to publish', () => {
    expect(buildAnnouncementDraft({ title: '', officeName: '' })).toBe('');
  });
});

describe('sanitizeAnnouncementText', () => {
  it('drops money, serial, phone and link sentences whole', () => {
    expect(
      sanitizeAnnouncementText(
        'A brown wallet. It held PHP 1,500. Serial 991287 is inside. Call 0917 555 1234. See example.com/found. The clasp is scratched.',
      ),
    ).toBe('A brown wallet. The clasp is scratched.');
  });

  it('keeps ordinary descriptive text intact', () => {
    expect(
      sanitizeAnnouncementText(
        'A black folding umbrella with a wooden handle and a small tear.',
      ),
    ).toBe('A black folding umbrella with a wooden handle and a small tear.');
  });

  it.each([
    'A Student ID card was found.',
    'A UB ID card was handed in.',
    'A passport was found.',
    "A driver's license was handed in.",
    'A bank account card was found.',
  ])('keeps a public title without a number: %s', (text) => {
    expect(sanitizeAnnouncementText(text)).toBe(text);
  });

  it.each([
    'Serial no. A1234 is printed on the flap.',
    'ID no. 2021-12345 is visible on the card.',
    'Acct. 12345 belongs to the owner.',
  ])('drops an identifier without leaving an orphan fragment: %s', (text) => {
    const draft = buildAnnouncementDraft({
      ...ITEM,
      title: 'Found document',
      aiCaption: text,
    });

    expect(sanitizeAnnouncementText(text)).toBe('');
    expect(draft).not.toMatch(/\d/);
  });
});

describe('buildAnnouncementDraft length budget', () => {
  it('truncates the caption before the office footer', () => {
    const draft = buildAnnouncementDraft({
      ...ITEM,
      title: 'Brown leather wallet with a long description'.repeat(4),
      officeName: 'Baguio City Public Information Office '.repeat(4),
      aiCaption:
        'A brown leather wallet sitting on a wooden table. '.repeat(8),
    });

    expect(draft.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_LENGTH);
    expect(draft).toContain('Bring a valid ID.');
  });
});

const EN = 'Found item at BCPIO.', TL = 'May nakitang bagay sa BCPIO.';
describe('US-25 bilingual drafts and copy', () => {
  it('builds, edits and copies both languages privately', async () => {
    const original = buildAnnouncementDrafts({
      ...ITEM, counterHours: 'Mon-Fri, 8am-5pm', description: 'Serial 991287. PHP 5,000.', finderName: 'Juan',
    });
    expect(original.en).toContain('Counter hours: Mon-Fri, 8am-5pm');
    expect(original.tl).toContain('Oras ng counter: Mon-Fri, 8am-5pm');
    expect(`${original.en}${original.tl}`).not.toMatch(/991287|5,000|Juan/i);
    expect(updateAnnouncementDraft(original, 'tl', 'TL').en).toBe(original.en);
    const clipboard = () => ({ writeText: vi.fn(), write: vi.fn() });
    const plain = clipboard();
    await copyAnnouncement('en', { en: EN, tl: TL, clipboard: plain });
    await copyAnnouncement('tl', { en: EN, tl: TL, clipboard: plain });
    expect(plain.writeText.mock.calls).toEqual([[EN], [TL]]);
    const photo = new Blob(['photo'], { type: 'image/webp' });
    const rich = await copyAnnouncement('both', { en: EN, tl: TL, photoUrl: 'u', clipboard: plain, ClipboardItemCtor: class { constructor(parts) { this.parts = parts; } }, fetchImpl: async () => ({ ok: true, blob: async () => photo }) });
    expect(rich).toEqual({ mode: 'rich', photoIncluded: true });
    const fallback = clipboard();
    expect(await copyAnnouncement('both', { en: EN, tl: TL, clipboard: fallback })).toEqual({ mode: 'text', photoIncluded: false });
    expect(fallback.writeText.mock.calls[0][0]).toContain(TL);
  });

  describe('US-26 facebook copy', () => {
    const clipboard = () => ({ writeText: vi.fn(), write: vi.fn() });
    const plain = clipboard();

    it('copies both versions + photo via ClipboardItem when available', async () => {
      const photo = new Blob(['photo'], { type: 'image/webp' });
      const rich = await copyAnnouncement('facebook', {
        en: EN,
        tl: TL,
        photoUrl: 'u',
        clipboard: plain,
        ClipboardItemCtor: class { constructor(parts) { this.parts = parts; } },
        fetchImpl: async () => ({ ok: true, blob: async () => photo }),
      });
      expect(rich).toEqual({ mode: 'rich', photoIncluded: true });
    });

    it('falls back to writeText when ClipboardItem unavailable', async () => {
      const fallback = clipboard();
      expect(await copyAnnouncement('facebook', { en: EN, tl: TL, clipboard: fallback })).toEqual({ mode: 'text', photoIncluded: false });
      expect(fallback.writeText.mock.calls[0][0]).toContain(TL);
    });

    it('throws when there is no text to copy', async () => {
      await expect(copyAnnouncement('facebook', { en: '', tl: '', clipboard: plain })).rejects.toThrow('There is nothing to copy yet.');
    });
  });
});
