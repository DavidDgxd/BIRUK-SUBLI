import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedText, embedImageOrNull, uploadItemImage, combineEmbeddings } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    embedText: vi.fn(),
    embedImageOrNull: vi.fn(),
    uploadItemImage: vi.fn(),
    combineEmbeddings: vi.fn(),
  }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

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

vi.mock('./storage.js', () => ({ uploadItemImage }));
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

describe('submitStaffCustody self-report prefill', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedText.mockReset();
    embedImageOrNull.mockReset();
    uploadItemImage.mockReset();
    combineEmbeddings.mockReset();

    embedText.mockResolvedValue({ embedding: [1, 0, 0] });
    embedImageOrNull.mockResolvedValue([0, 1, 0]);
    uploadItemImage.mockResolvedValue(
      'https://example.test/staff-intake/new.webp',
    );
    combineEmbeddings.mockImplementation((vectors) => vectors[0]);
  });

  it('reuses the report photo and converts the report in the same RPC', async () => {
    rpc.mockReturnValue(resolvedRpc());
    const photoUrl = 'https://example.test/found-reports/original.webp';

    const result = await submitStaffCustody({
      ...baseIntake,
      photo: null,
      photoUrl,
      foundReportId: '11111111-1111-1111-1111-111111111111',
    });

    expect(uploadItemImage).not.toHaveBeenCalled();
    expect(embedImageOrNull).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'submit_staff_custody',
      expect.objectContaining({
        p_image_url: photoUrl,
        p_found_report_id: '11111111-1111-1111-1111-111111111111',
      }),
    );
    expect(result).toEqual({
      refCode: 'BS-0115',
      imageUrl: photoUrl,
      usedPhoto: false,
      reusedPhoto: true,
    });
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
});
