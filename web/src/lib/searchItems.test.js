import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedQuery, embedImage } = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedQuery: vi.fn(),
  embedImage: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./aiService.js', () => ({
  embedQuery,
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
  IMAGE_STRONG_FLOOR,
  LEXICAL_CONFIDENCE,
  LEXICAL_WEIGHT,
  MATCH_THRESHOLD,
  POSSIBLE_DELTA,
  POSSIBLE_FLOOR,
  POSSIBLE_LIMIT,
  POSSIBLE_ONLY_LIMIT,
  PHOTO_BEST_FLOOR,
  TEXT_STRONG_FLOOR,
  searchItems,
} from './searchItems.js';

function resolvedRpc({ data = [], error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

function row(id, score, extra = {}) {
  return {
    id,
    status: 'held',
    score,
    lexical_score: 0,
    text_similarity: 0.6,
    ...extra,
  };
}

describe('searchItems confidence tiers', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedQuery.mockReset();
    embedImage.mockReset();
    embedQuery.mockResolvedValue({
      embedding: [1, 0, 0],
      expandedText: 'wallet',
      additions: [],
    });
    embedImage.mockResolvedValue({ embedding: [0, 1, 0] });
  });

  it('splits best and possible matches and drops terminal rows', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('best-top', 0.95, { lexical_score: 1, text_similarity: 0.7 }),
          row('released', 0.99, {
            status: 'released',
            lexical_score: 1,
          }),
          row('resolved', 0.98, { status: 'resolved', lexical_score: 1 }),
          row('transferred', 0.97, {
            status: 'transferred',
            lexical_score: 1,
          }),
          row('disposed', 0.96, { status: 'disposed', lexical_score: 1 }),
          row('best-next', 0.9, { lexical_score: 1 }),
          row('possible', 0.88),
          row('too-far', 0.85),
          row('below-floor', 0.5),
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
        data: [row('top', 0.71), row('next', 0.68), row('far', 0.55)],
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
        data: [row('top', 0.72, { lexical_score: 1 }), row('next', 0.68)],
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

  it('keeps a photo-only match confident when the RPC reports no lexical score', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('photo-match', 0.66, {
            lexical_score: null,
            text_similarity: null,
            image_similarity: 0.66,
          }),
        ],
      }),
    );

    const result = await searchItems({
      photo: new Blob(['x']),
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('results');
    expect(result.best.map((item) => item.id)).toEqual(['photo-match']);
    expect(rpc).toHaveBeenCalledWith(
      'match_items_two_tower',
      expect.objectContaining({ query_text: null }),
    );
  });

  it('caps possible at POSSIBLE_LIMIT when a best match exists', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('best', 0.82, { lexical_score: 1 }),
          row('one', 0.81),
          row('two', 0.8),
          row('three', 0.79),
          row('four', 0.78),
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
          row('one', 0.71),
          row('two', 0.7),
          row('three', 0.69),
          row('four', 0.68),
          row('five', 0.67),
          row('six', 0.66),
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
        data: [
          row('top', 0.864, { lexical_score: 1 }),
          row('edge', 0.794),
          row('below', 0.793),
        ],
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
      resolvedRpc({ data: [row('low', 0.29), row('lower', 0.25)] }),
    );

    const result = await searchItems({
      text: 'umbrella',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ best: [], possible: [], state: 'none' });
  });

  it('asks the two-tower RPC for held items at the shared floor', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items_two_tower',
      expect.objectContaining({
        match_threshold: MATCH_THRESHOLD,
        match_count: 15,
        query_text: 'wallet',
        query_text_embedding: [1, 0, 0],
        query_image_embedding: null,
      }),
    );
  });

  it('ranks a lexical hit above a higher-vector hub', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [row('hub', 0.73), row('named', 0.79, { lexical_score: 1 })],
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
        data: [
          row('hub', 0.814, {
            lexical_score: 0.07,
            text_similarity: 0.6,
          }),
        ],
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

  it('sends the expanded words and the expansion flag to the service', async () => {
    rpc.mockReturnValue(resolvedRpc());
    embedQuery.mockResolvedValue({
      embedding: [1, 0, 0],
      expandedText: 'pitaka wallet purse',
      additions: ['wallet', 'purse'],
    });

    await searchItems({
      text: 'pitaka',
      expand: false,
      signal: new AbortController().signal,
    });

    expect(embedQuery).toHaveBeenCalledWith('pitaka', expect.anything(), {
      expand: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      'match_items_two_tower',
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
      'match_items_two_tower',
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
          row('kept', 0.8, { holding_office_id: 'BCPIO', lexical_score: 1 }),
          row('elsewhere', 0.8, {
            holding_office_id: 'CITY_HALL_INFO',
            lexical_score: 1,
          }),
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
      TEXT_STRONG_FLOOR,
      IMAGE_STRONG_FLOOR,
      LEXICAL_CONFIDENCE,
      LEXICAL_WEIGHT,
    }).toEqual({
      BEST_FLOOR: 0.72,
      PHOTO_BEST_FLOOR: 0.64,
      BEST_DELTA: 0.05,
      POSSIBLE_FLOOR: 0.55,
      POSSIBLE_DELTA: 0.07,
      POSSIBLE_LIMIT: 3,
      POSSIBLE_ONLY_LIMIT: 5,
      TEXT_STRONG_FLOOR: 0.68,
      IMAGE_STRONG_FLOOR: 0.82,
      LEXICAL_CONFIDENCE: 0.5,
      LEXICAL_WEIGHT: 0.25,
    });
  });
});
