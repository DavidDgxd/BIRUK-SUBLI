import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpc,
  embedText,
  embedImageOrNull,
  embedImageFromUrlOrNull,
  uploadItemImage,
  combineEmbeddings,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedText: vi.fn(),
  embedImageOrNull: vi.fn(),
  embedImageFromUrlOrNull: vi.fn(),
  uploadItemImage: vi.fn(),
  combineEmbeddings: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./storage.js', () => ({ uploadItemImage }));

vi.mock('./aiService.js', () => ({
  embedText,
  embedImageOrNull,
  embedImageFromUrlOrNull,
  MAX_EMBED_TEXT_LENGTH: 1000,
  SearchError: class SearchError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SearchError';
      this.code = code;
    }
  },
}));

vi.mock('./searchItems.js', () => ({ combineEmbeddings }));

import { submitStaffCustody } from './staffIntake.js';

function resolvedRpc({ data = 'BS-0115', error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

const baseIntake = {
  officeId: 'BCPIO',
  title: 'Black umbrella',
  description: 'Wooden handle, small tear near the canopy',
  category: 'General',
  storageLocation: 'Locker 2, Bin B',
  dateReceived: '2026-10-01',
  cashAmount: '',
  finderName: '',
  finderContact: '0917 000 0000',
  signal: new AbortController().signal,
};

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

describe('submitStaffCustody self-report prefill', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedText.mockReset();
    embedImageOrNull.mockReset();
    embedImageFromUrlOrNull.mockReset();
    uploadItemImage.mockReset();
    combineEmbeddings.mockReset();

    embedText.mockResolvedValue({ embedding: [1, 0, 0] });
    embedImageOrNull.mockResolvedValue([0, 1, 0]);
    embedImageFromUrlOrNull.mockResolvedValue([0, 1, 0]);
    uploadItemImage.mockResolvedValue(
      'https://example.test/staff-intake/new.webp',
    );
    combineEmbeddings.mockImplementation((vectors) => vectors[0]);
  });

  it('embeds the reused report photo and converts the report in the same RPC', async () => {
    rpc.mockReturnValue(resolvedRpc());
    combineEmbeddings.mockReturnValue([Math.SQRT1_2, Math.SQRT1_2, 0]);
    const photoUrl = 'https://example.test/found-reports/original.webp';
    const expectedEmbedding = [Math.SQRT1_2, Math.SQRT1_2, 0];

    const result = await submitStaffCustody({
      ...baseIntake,
      photo: null,
      photoUrl,
      foundReportId: '11111111-1111-1111-1111-111111111111',
    });

    expect(uploadItemImage).not.toHaveBeenCalled();
    expect(embedImageOrNull).not.toHaveBeenCalled();
    expect(embedImageFromUrlOrNull).toHaveBeenCalledWith(
      photoUrl,
      baseIntake.signal,
      expect.objectContaining({ label: 'staffIntake' }),
    );
    expect(combineEmbeddings).toHaveBeenCalledWith([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({
        p_image_url: photoUrl,
        p_found_report_id: '11111111-1111-1111-1111-111111111111',
        p_embedding: expectedEmbedding,
      }),
    );
    expect(result).toEqual({
      refCode: 'BS-0115',
      imageUrl: photoUrl,
      usedPhoto: true,
      reusedPhoto: true,
    });
  });

  it('falls back to the text embedding when the reused photo cannot be read', async () => {
    rpc.mockReturnValue(resolvedRpc());
    embedImageFromUrlOrNull.mockResolvedValue(null);
    const photoUrl = 'https://example.test/found-reports/original.webp';

    const result = await submitStaffCustody({
      ...baseIntake,
      photo: null,
      photoUrl,
      foundReportId: '11111111-1111-1111-1111-111111111111',
    });

    expect(embedImageFromUrlOrNull).toHaveBeenCalledWith(
      photoUrl,
      baseIntake.signal,
      expect.objectContaining({ label: 'staffIntake' }),
    );
    expect(combineEmbeddings).toHaveBeenCalledWith([[1, 0, 0]]);
    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({ p_embedding: [1, 0, 0] }),
    );
    expect(result.usedPhoto).toBe(false);
    expect(result.reusedPhoto).toBe(true);
  });

  it('uploads and embeds a replacement photo selected at the counter', async () => {
    rpc.mockReturnValue(resolvedRpc());
    const file = new File(['photo'], 'replacement.webp', {
      type: 'image/webp',
    });

    const result = await submitStaffCustody({
      ...baseIntake,
      photo: file,
      photoUrl: '',
      foundReportId: null,
    });

    expect(uploadItemImage).toHaveBeenCalledWith(
      file,
      baseIntake.signal,
      'staff-intake',
    );
    expect(embedImageOrNull).toHaveBeenCalledWith(
      file,
      baseIntake.signal,
      expect.objectContaining({ label: 'staffIntake' }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({
        p_image_url: 'https://example.test/staff-intake/new.webp',
        p_found_report_id: null,
      }),
    );
    expect(result.usedPhoto).toBe(true);
    expect(result.reusedPhoto).toBe(false);
  });

  it('reports a stale self-report so the counter can pick another', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: null,
        error: {
          code: 'P0002',
          message: 'That self-report is no longer pending.',
        },
      }),
    );

    await expect(
      submitStaffCustody({
        ...baseIntake,
        photo: null,
        photoUrl: 'https://example.test/found-reports/original.webp',
        foundReportId: '11111111-1111-1111-1111-111111111111',
      }),
    ).rejects.toMatchObject({ name: 'SearchError', code: 'report-taken' });
  });

  it('sends the report and caption parameters together', async () => {
    rpc.mockReturnValue(resolvedRpc({ data: 'BS-0116' }));

    await submitStaffCustody({
      ...baseIntake,
      photo: null,
      photoUrl: 'https://example.test/found-reports/original.webp',
      foundReportId: '11111111-1111-1111-1111-111111111111',
      aiCaption: 'A black umbrella with a wooden handle.',
    });

    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({
        p_found_report_id: '11111111-1111-1111-1111-111111111111',
        p_ai_caption: 'A black umbrella with a wooden handle.',
      }),
    );
  });
});

describe('submitStaffCustody AI caption', () => {
  beforeEach(() => {
    rpc.mockReset();
    uploadItemImage.mockReset();
    embedText.mockReset();
    embedImageOrNull.mockReset();
    embedImageFromUrlOrNull.mockReset();
    combineEmbeddings.mockReset();

    rpc.mockReturnValue(resolvedRpc({ data: 'BS-0001' }));
    uploadItemImage.mockResolvedValue('https://example.test/photo.webp');
    embedText.mockResolvedValue({ embedding: [1, 0] });
    embedImageOrNull.mockResolvedValue(null);
    combineEmbeddings.mockImplementation((vectors) => vectors[0]);
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
