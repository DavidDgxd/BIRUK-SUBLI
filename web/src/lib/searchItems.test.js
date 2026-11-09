import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedText, embedImage } = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedText: vi.fn(),
  embedImage: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./aiService.js', () => ({
  embedText,
  embedImage,
  SearchError: class SearchError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SearchError';
      this.code = code;
    }
  },
}));

import {
  BEST_DELTA,
  BEST_FLOOR,
  LEXICAL_CONFIDENCE,
  LEXICAL_WEIGHT,
  MATCH_THRESHOLD,
  POSSIBLE_DELTA,
  POSSIBLE_FLOOR,
  POSSIBLE_LIMIT,
  POSSIBLE_ONLY_LIMIT,
  PHOTO_BEST_FLOOR,
  STRONG_FLOOR,
  searchItems,
} from './searchItems.js';

function resolvedRpc({ data = [], error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

function row(id, similarity, extra = {}) {
  return { id, status: 'held', similarity, ...extra };
}

describe('searchItems confidence tiers', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedText.mockReset();
    embedImage.mockReset();
    embedText.mockResolvedValue({ embedding: [1, 0, 0] });
    embedImage.mockResolvedValue({ embedding: [0, 1, 0] });
  });

  it('splits best and possible matches and drops terminal rows', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('best-top', 0.7),
          row('released', 0.95, { status: 'released' }),
          row('resolved', 0.94, { status: 'resolved' }),
          row('transferred', 0.93, { status: 'transferred' }),
          row('disposed', 0.92, { status: 'disposed' }),
          row('best-next', 0.66),
          row('possible', 0.64),
          row('too-far', 0.62),
          row('below-floor', 0.4),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('results');
    expect(result.best.map((item) => item.id)).toEqual([
      'best-top',
      'best-next',
    ]);
    expect(result.possible.map((item) => item.id)).toEqual(['possible']);
  });

  it('treats a top score below BEST_FLOOR as possible, not best', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('top', 0.679, { lexical_score: 1 }),
          row('next', 0.63, { lexical_score: 1 }),
          row('far', 0.55, { lexical_score: 1 }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('possible');
    expect(result.best).toEqual([]);
    expect(result.possible.map((item) => item.id)).toEqual(['top', 'next']);
  });

  it('accepts a top score exactly at BEST_FLOOR as best', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('top', 0.68, { lexical_score: 1 }),
          row('next', 0.64, { lexical_score: 1 }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('results');
    expect(result.best.map((item) => item.id)).toEqual(['top']);
    expect(result.possible.map((item) => item.id)).toEqual(['next']);
  });

  it('caps possible at POSSIBLE_LIMIT when a best match exists', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('best', 0.7),
          row('one', 0.64),
          row('two', 0.638),
          row('three', 0.636),
          row('four', 0.634),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.possible).toHaveLength(POSSIBLE_LIMIT);
    expect(result.possible.map((item) => item.id)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('caps possible at POSSIBLE_ONLY_LIMIT when nothing is best', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('one', 0.639),
          row('two', 0.635),
          row('three', 0.63),
          row('four', 0.625),
          row('five', 0.62),
          row('six', 0.615),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('possible');
    expect(result.possible).toHaveLength(POSSIBLE_ONLY_LIMIT);
    expect(result.possible.map((item) => item.id)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
  });

  it('keeps an item on the float-rounded possible delta boundary', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [row('top', 0.664), row('edge', 0.594), row('below', 0.593)],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.possible.map((item) => item.id)).toEqual(['edge']);
  });

  it('returns the none state when every row is below the RPC floor', async () => {
    rpc.mockReturnValue(
      resolvedRpc({ data: [row('low', 0.54), row('lower', 0.5)] }),
    );

    const result = await searchItems({
      text: 'umbrella',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ best: [], possible: [], state: 'none' });
  });

  it('asks the RPC for held items at the shared match floor', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items_hybrid',
      expect.objectContaining({
        match_threshold: MATCH_THRESHOLD,
        match_count: 15,
        query_text: 'wallet',
      }),
    );
  });

  it('ranks a lexical hit above a higher-vector hub', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('hub', 0.73, { score: 0.73, lexical_score: 0 }),
          row('named', 0.64, { score: 0.79, lexical_score: 1 }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'ring',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual(['named']);
    expect(result.possible.map((item) => item.id)).toEqual(['hub']);
  });

  it('keeps a weak vector-only row out of the confident tier', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [row('hub', 0.797, { score: 0.814, lexical_score: 0.07 })],
      }),
    );

    const result = await searchItems({
      text: 'earbuds',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('possible');
    expect(result.best).toEqual([]);
    expect(result.possible.map((item) => item.id)).toEqual(['hub']);
  });

  it('keeps a photo-only match confident when the RPC reports no lexical score', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [row('photo-match', 0.66, { score: 0.66, lexical_score: null })],
      }),
    );

    const result = await searchItems({
      photo: new Blob(['x']),
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('results');
    expect(result.best.map((item) => item.id)).toEqual(['photo-match']);
    expect(rpc).toHaveBeenCalledWith(
      'match_items_hybrid',
      expect.objectContaining({ query_text: null }),
    );
  });

  it('sends the expanded words and the expansion flag to the service', async () => {
    rpc.mockReturnValue(resolvedRpc());
    embedText.mockResolvedValue({
      embedding: [1, 0, 0],
      expandedText: 'pitaka wallet purse',
      additions: ['wallet', 'purse'],
    });

    await searchItems({
      text: 'pitaka',
      expand: false,
      signal: new AbortController().signal,
    });

    expect(embedText).toHaveBeenCalledWith('pitaka', expect.anything(), {
      expand: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      'match_items_hybrid',
      expect.objectContaining({ query_text: 'pitaka wallet purse' }),
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
      'match_items_hybrid',
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
          row('kept', 0.7, { holding_office_id: 'BCPIO' }),
          row('elsewhere', 0.7, { holding_office_id: 'CITY_HALL_INFO' }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      office: 'BCPIO',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual(['kept']);
  });

  it('surfaces an RPC failure as a SearchError', async () => {
    rpc.mockReturnValue(
      resolvedRpc({ error: { code: 'XX000', message: 'database offline' } }),
    );

    await expect(
      searchItems({ text: 'wallet', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: 'SearchError', code: 'db' });
  });

  it('exports the tuned tier constants', () => {
    expect({
      BEST_FLOOR,
      PHOTO_BEST_FLOOR,
      BEST_DELTA,
      POSSIBLE_FLOOR,
      POSSIBLE_DELTA,
      POSSIBLE_LIMIT,
      POSSIBLE_ONLY_LIMIT,
      STRONG_FLOOR,
      LEXICAL_CONFIDENCE,
      LEXICAL_WEIGHT,
    }).toEqual({
      BEST_FLOOR: 0.68,
      PHOTO_BEST_FLOOR: 0.64,
      BEST_DELTA: 0.05,
      POSSIBLE_FLOOR: 0.55,
      POSSIBLE_DELTA: 0.07,
      POSSIBLE_LIMIT: 3,
      POSSIBLE_ONLY_LIMIT: 5,
      STRONG_FLOOR: 0.82,
      LEXICAL_CONFIDENCE: 0.5,
      LEXICAL_WEIGHT: 0.25,
    });
  });
});
