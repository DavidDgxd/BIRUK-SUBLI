import { describe, expect, it } from 'vitest';
import {
  buildAnnouncementDraft,
  MAX_ANNOUNCEMENT_LENGTH,
  sanitizeAnnouncementText,
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
