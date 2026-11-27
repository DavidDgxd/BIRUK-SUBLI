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
  officeName: 'University of Baguio Security Office',
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
      'Found item at University of Baguio Security Office: Brown leather wallet',
    );
    expect(draft).toContain(ITEM.aiCaption);
    expect(draft).toContain('Category: Bags & Wallets');
    expect(draft).not.toMatch(/BS-0115|991287|bus card|5000|Juan|0917/);
    expect(draft.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_LENGTH);
  });

  it('keeps cash generic so no monetary figure or finder detail reaches the post', () => {
    const draft = buildAnnouncementDraft({
      ...ITEM,
      title: 'Cash',
      category: 'Cash',
      isCash: true,
      cashAmount: 12500,
      finderName: 'Juan dela Cruz',
      finderContact: 'juan@example.com',
      rewardDate: '2026-07-15',
      aiCaption: 'Cash amounting to PHP 12,500 in an envelope.',
    });

    expect(draft).toContain('Found cash at University of Baguio Security Office');
    expect(draft).toContain('Cash has been handed in.');
    expect(draft).not.toMatch(
      /12,500|12500|php|Juan|juan@example|2026-07-15/i,
    );
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

  it('drops Filipino money and identifier sentences', () => {
    expect(
      sanitizeAnnouncementText(
        'Isang kayumangging pitaka. May 500 piso sa loob. Numero ng serye 991287. Ang lisensya numero A1234 ay nakalagay.',
      ),
    ).toBe('Isang kayumangging pitaka.');
  });

  it('keeps safe Filipino description text intact', () => {
    const text = 'Isang kayumangging pitaka sa mesa.';
    expect(sanitizeAnnouncementText(text)).toBe(text);
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
      officeName: 'University of Baguio Security Office '.repeat(4),
      aiCaption:
        'A brown leather wallet sitting on a wooden table. '.repeat(8),
    });

    expect(draft.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_LENGTH);
    expect(draft).toContain('Bring a valid ID.');
  });
});

const EN = 'Found item at UB_SECURITY.', TL = 'May nakitang bagay sa UB_SECURITY.';
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
    const photo = new Blob(['photo'], { type: 'image/png' });
    const photoCopy = await copyAnnouncement('photo', { photoBlob: photo, clipboard: plain, ClipboardItemCtor: class { constructor(parts) { this.parts = parts; } } });
    expect(photoCopy).toEqual({ mode: 'photo', photoIncluded: true });
    const fallback = clipboard();
    expect(await copyAnnouncement('both', { en: EN, tl: TL, clipboard: fallback })).toEqual({ mode: 'text', photoIncluded: false });
    expect(fallback.writeText.mock.calls[0][0]).toContain(TL);
  });
  it('uses the Filipino caption, never the raw English caption, for the tl draft', () => {
    const captionTl = 'Isang kayumangging pitaka sa mesa.';
    const drafts = buildAnnouncementDrafts({ ...ITEM, aiCaptionTl: captionTl });

    expect(drafts.en).toContain(ITEM.aiCaption);
    expect(drafts.tl).toContain(captionTl);
    expect(drafts.tl).not.toContain(ITEM.aiCaption);
  });
  it('keeps Filipino money and serial captions out of the tl draft', () => {
    const drafts = buildAnnouncementDrafts({
      ...ITEM,
      aiCaptionTl: 'May 500 piso sa loob. Numero ng serye 991287.',
    });

    expect(drafts.tl).not.toMatch(/500 piso|991287/);
    expect(drafts.tl).toContain('Tingnan ang larawan');
  });
});

describe('US-26 copy text and photo', () => {
  const clipboard = () => ({ writeText: vi.fn(), write: vi.fn() });
  const ClipboardItemStub = class { constructor(parts) { this.parts = parts; } };

  it('copies text without mixing in the photo', async () => {
    const plain = clipboard();
    const result = await copyAnnouncement('both', {
      en: EN, tl: TL, photoBlob: new Blob(['photo'], { type: 'image/png' }),
      clipboard: plain, ClipboardItemCtor: ClipboardItemStub,
    });
    expect(result).toEqual({ mode: 'text', photoIncluded: false });
    expect(plain.write).not.toHaveBeenCalled();
    expect(plain.writeText.mock.calls[0][0]).toContain(TL);
  });

  it('writes the pre-fetched photo as image/png on its own', async () => {
    const photo = new Blob(['photo'], { type: 'image/png' });
    const plain = clipboard();
    const result = await copyAnnouncement('photo', {
      photoBlob: photo, clipboard: plain, ClipboardItemCtor: ClipboardItemStub,
    });
    expect(result).toEqual({ mode: 'photo', photoIncluded: true });
    expect(plain.writeText).not.toHaveBeenCalled();
    expect(plain.write.mock.calls[0][0][0].parts['image/png']).toBe(photo);
  });

  it('refuses to copy a photo that is not ready', async () => {
    await expect(copyAnnouncement('photo', { clipboard: clipboard() })).rejects.toThrow('The photo is not ready yet.');
  });

  it('throws when there is no text to copy', async () => {
    await expect(copyAnnouncement('both', { en: '', tl: '', clipboard: clipboard() })).rejects.toThrow('There is nothing to copy yet.');
  });
});

describe('Cash and Documents / IDs announcements (#106)', () => {
  const DOC_ITEM = {
    ...ITEM,
    title: 'Juan Dela Cruz UB ID',
    aiCaption: 'A UB ID card showing Juan Dela Cruz.',
    aiCaptionTl: 'Isang UB ID card ni Juan Dela Cruz.',
  };

  it.each(['Documents / IDs', 'Document/ID', ' documents / ids '])(
    'masks the title and drops the photo caption for %s',
    (category) => {
      const drafts = buildAnnouncementDrafts({ ...DOC_ITEM, category });
      for (const text of [drafts.en, drafts.tl]) {
        expect(text).not.toMatch(/juan|dela cruz/i);
        expect(text).not.toMatch(/see the photo|tingnan ang larawan/i);
        // The category line names it once; the heading doesn't repeat it.
        expect(text.match(/documents \/ ids|document\/id/gi)).toHaveLength(1);
      }
      expect(drafts.en).toContain('Found a document or ID at University of Baguio Security Office');
      expect(drafts.en).toContain('A document or ID has been handed in.');
      expect(drafts.tl).toContain('May nakitang dokumento o ID sa University of Baguio Security Office');
      expect(drafts.tl).toContain('May isinuling dokumento o ID.');
    },
  );

  it.each([
    ['the cash flag', { category: 'General', isCash: true }],
    ['the Cash category', { category: ' cash ', isCash: false }],
  ])('posts cash by %s without a photo caption', (_, extra) => {
    const drafts = buildAnnouncementDrafts({
      ...ITEM, ...extra, title: 'Blue envelope',
      aiCaption: 'Three blue bills folded in a white envelope.',
      aiCaptionTl: 'Tatlong asul na papel na pera sa puting sobre.',
    });
    expect(drafts.en).toContain('Found cash at');
    expect(drafts.en).toContain('Cash has been handed in.');
    expect(drafts.tl).toContain('May isinuling pera.');
    for (const text of [drafts.en, drafts.tl]) {
      expect(text).not.toMatch(/blue|bills|envelope|asul|sobre/i);
    }
  });

  it('renders no photo preview or photo copy button', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: AnnouncementDraft } = await import('../components/AnnouncementDraft.jsx');
    const render = (category, isCash = false) => renderToStaticMarkup(createElement(AnnouncementDraft, {
      item: {
        ...DOC_ITEM, category, isCash,
        imageUrl: 'https://example.test/id.jpg', photoUrl: 'https://example.test/id.jpg',
      },
    }));

    for (const [category, isCash] of [['Documents / IDs'], ['Document/ID'], ['Cash', true], ['Cash'], ['General', true]]) {
      const html = render(category, isCash);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('id.jpg');
      expect(html).not.toContain('Copy photo');
      expect(html).not.toMatch(/juan|dela cruz/i);
      expect(html).toContain('posted without a photo');
    }
    const general = render('Bags & Wallets');
    expect(general).toContain('<img');
    expect(general).toContain('Copy photo');
  });
});
