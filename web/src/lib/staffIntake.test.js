import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpc,
  embedText,
  embedItemText,
  embedImageOrNull,
  embedImageFromUrlOrNull,
  uploadItemImage,
  combineEmbeddings,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedText: vi.fn(),
  embedItemText: vi.fn(),
  embedImageOrNull: vi.fn(),
  embedImageFromUrlOrNull: vi.fn(),
  uploadItemImage: vi.fn(),
  combineEmbeddings: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./storage.js', () => ({ uploadItemImage }));

vi.mock('./aiService.js', () => ({
  embedText,
  embedItemText,
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

function resolvedRpc({
  data = [
    {
      ref_code: 'BS-0115',
      item_id: '4c0d09b6-84d1-4b2f-8f0e-57b1d95c3a21',
    },
  ],
  error = null,
} = {}) {
  // The builder is awaited both directly and through `.abortSignal(signal)`,
  // so the mock is a thenable whose settled promise both paths resolve.
  const settled = Promise.resolve({ data, error });
  return {
    abortSignal: vi.fn(() => settled),
    then: settled.then.bind(settled),
  };
}

const baseIntake = {
  officeId: 'UB_SECURITY',
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
  officeId: 'UB_SECURITY',
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
    embedItemText.mockReset();
    embedImageOrNull.mockReset();
    embedImageFromUrlOrNull.mockReset();
    uploadItemImage.mockReset();
    combineEmbeddings.mockReset();

    embedText.mockResolvedValue({ embedding: [1, 0, 0] });
    embedItemText.mockResolvedValue({ embedding: [2, 0, 0] });
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
        p_text_embedding: [2, 0, 0],
        p_image_embedding: [0, 1, 0],
      }),
    );
    expect(result).toEqual({
      refCode: 'BS-0115',
      itemId: '4c0d09b6-84d1-4b2f-8f0e-57b1d95c3a21',
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
      expect.objectContaining({
        p_embedding: [1, 0, 0],
        p_text_embedding: [2, 0, 0],
        p_image_embedding: null,
      }),
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
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          {
            ref_code: 'BS-0116',
            item_id: '5a1e10c7-95e2-4c30-9a1f-68c2e06d4b32',
          },
        ],
      }),
    );

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
    embedItemText.mockReset();
    embedImageOrNull.mockReset();
    embedImageFromUrlOrNull.mockReset();
    combineEmbeddings.mockReset();

    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          {
            ref_code: 'BS-0001',
            item_id: '6b2f21d8-a6f3-4d41-8b20-79d3f17e5c43',
          },
        ],
      }),
    );
    uploadItemImage.mockResolvedValue('https://example.test/photo.webp');
    embedText.mockResolvedValue({ embedding: [1, 0] });
    embedItemText.mockResolvedValue({ embedding: [2, 0] });
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

describe('submitStaffCustody submit result', () => {
  beforeEach(() => {
    rpc.mockReset();
    uploadItemImage.mockReset();
    embedText.mockReset();
    embedItemText.mockReset();
    embedImageOrNull.mockReset();
    embedImageFromUrlOrNull.mockReset();
    combineEmbeddings.mockReset();

    uploadItemImage.mockResolvedValue('https://example.test/photo.webp');
    embedText.mockResolvedValue({ embedding: [1, 0] });
    embedItemText.mockResolvedValue({ embedding: [2, 0] });
    embedImageOrNull.mockResolvedValue(null);
    combineEmbeddings.mockImplementation((vectors) => vectors[0]);
  });

  it('reads the first row of the returns-table array for ref_code and item_id', async () => {
    // [REQ-002 | FR-001 | UR-001] Valid: PostgREST returns a returns-table
    // function as an array of rows; the submit produces exactly one row and
    // both values are resolved from that first row.
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          {
            ref_code: 'BS-0200',
            item_id: '7c3a32e9-b7a4-4e52-9c31-8ae4028f6d54',
          },
        ],
      }),
    );

    const result = await submitStaffCustody(CUSTODY);

    expect(result.refCode).toBe('BS-0200');
    expect(result.itemId).toBe('7c3a32e9-b7a4-4e52-9c31-8ae4028f6d54');
  });

  it('accepts the legacy bare-string reference from an unmigrated RPC', async () => {
    // [REQ-002 | FR-001] Boundary: while the web deploy and the migration are
    // rolled out separately, the old signature returns text. The receipt still
    // shows the reference; no item id exists, so the match panel stays
    // unavailable rather than requesting a match with an invalid id.
    rpc.mockReturnValue(resolvedRpc({ data: 'BS-0201' }));

    const result = await submitStaffCustody(CUSTODY);

    expect(result.refCode).toBe('BS-0201');
    expect(result.itemId).toBeNull();
  });

  it('resolves null ids when the RPC returns an empty array', async () => {
    // [REQ-002 | FR-001] Boundary: no row means no receipt reference and no
    // item id to match with; the panel then shows its unavailable state.
    rpc.mockReturnValue(resolvedRpc({ data: [] }));

    const result = await submitStaffCustody(CUSTODY);

    expect(result.refCode).toBeNull();
    expect(result.itemId).toBeNull();
  });

  it('returns neither value when the submit fails', async () => {
    // [REQ-002 | FR-001] Invalid: a failed submit throws instead of resolving,
    // so no ref_code and no item id are ever handed to the caller, and no
    // match request is made for an item that was never logged.
    rpc.mockReturnValue(
      resolvedRpc({
        data: null,
        error: { code: '22023', message: 'An intake office is required.' },
      }),
    );

    await expect(submitStaffCustody(CUSTODY)).rejects.toMatchObject({
      name: 'SearchError',
      code: 'db',
    });
  });
});
