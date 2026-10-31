import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, uploadItemImage, embedText, embedImageOrNull } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    uploadItemImage: vi.fn(),
    embedText: vi.fn(),
    embedImageOrNull: vi.fn(),
  }),
);

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./storage.js', () => ({ uploadItemImage }));

vi.mock('./aiService.js', () => ({
  embedText,
  embedImageOrNull,
  MAX_EMBED_TEXT_LENGTH: 1000,
  SearchError: class SearchError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SearchError';
      this.code = code;
    }
  },
}));

vi.mock('./searchItems.js', () => ({
  combineEmbeddings: vi.fn((vectors) => vectors[0]),
}));

import { submitStaffCustody } from './staffIntake.js';

const CUSTODY = {
  officeId: 'BCPIO',
  title: 'Brown wallet',
  description: 'Brown leather bifold with a torn lining.',
  category: 'Bags & Wallets',
  storageLocation: 'Locker 2, Bin B',
  dateReceived: '2026-10-30',
  cashAmount: '',
  finderName: '',
  finderContact: '',
  photo: new Blob(['photo'], { type: 'image/png' }),
  aiCaption: 'A brown leather wallet on a table.',
};

describe('submitStaffCustody AI caption', () => {
  beforeEach(() => {
    rpc.mockReset();
    uploadItemImage.mockReset();
    embedText.mockReset();
    embedImageOrNull.mockReset();

    rpc.mockReturnValue({
      abortSignal: vi.fn().mockResolvedValue({ data: 'BS-0001', error: null }),
    });
    uploadItemImage.mockResolvedValue('https://example.test/photo.webp');
    embedText.mockResolvedValue({ embedding: [1, 0] });
    embedImageOrNull.mockResolvedValue(null);
  });

  it('stores the raw AI suggestion separately from the confirmed notes', async () => {
    await submitStaffCustody(CUSTODY);

    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({
        p_description: 'Brown leather bifold with a torn lining.',
        p_ai_caption: 'A brown leather wallet on a table.',
      }),
    );
  });

  it('sends a null caption when none was suggested', async () => {
    await submitStaffCustody({ ...CUSTODY, aiCaption: '   ' });

    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({ p_ai_caption: null }),
    );
  });
});
