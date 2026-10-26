import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedText } = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedText: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./aiService.js', () => ({
  embedText,
  embedImage: vi.fn(),
  SearchError: class SearchError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SearchError';
      this.code = code;
    }
  },
}));

import { MATCH_THRESHOLD, searchItems } from './searchItems.js';

function resolvedRpc({ data = [], error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

describe('searchItems public listing', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedText.mockReset();
    embedText.mockResolvedValue({ embedding: [1, 0, 0] });
  });

  it('drops released rows and below-floor matches from the public results', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          { id: 'held-primary', status: 'held', similarity: 0.7 },
          { id: 'released', status: 'released', similarity: 0.95 },
          { id: 'held-secondary', status: 'held', similarity: 0.56 },
          { id: 'below-floor', status: 'held', similarity: 0.4 },
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.primary.map((item) => item.id)).toEqual(['held-primary']);
    expect(result.secondary.map((item) => item.id)).toEqual(['held-secondary']);
    expect(result.all.map((item) => item.id)).toEqual([
      'held-primary',
      'held-secondary',
    ]);
  });

  it('asks the RPC for held items at the shared match floor', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items',
      expect.objectContaining({
        match_threshold: MATCH_THRESHOLD,
        match_count: 15,
      }),
    );
  });

  it('passes office and receipt-date filters to the RPC', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await searchItems({
      text: 'wallet',
      office: 'BCPIO',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items',
      expect.objectContaining({
        filter_office: 'BCPIO',
        date_from: '2026-09-01',
        date_to: '2026-09-30',
      }),
    );
  });

  it('drops rows from another office even if a stale RPC ignores the filter', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          {
            id: 'kept',
            status: 'held',
            similarity: 0.7,
            holding_office_id: 'BCPIO',
          },
          {
            id: 'elsewhere',
            status: 'held',
            similarity: 0.7,
            holding_office_id: 'CITY_HALL_INFO',
          },
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      office: 'BCPIO',
      signal: new AbortController().signal,
    });

    expect(result.all.map((item) => item.id)).toEqual(['kept']);
  });

  it('surfaces an RPC failure as a SearchError', async () => {
    rpc.mockReturnValue(
      resolvedRpc({ error: { code: 'XX000', message: 'database offline' } }),
    );

    await expect(
      searchItems({ text: 'wallet', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: 'SearchError', code: 'db' });
  });
});
