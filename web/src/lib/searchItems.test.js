import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedQuery, embedText, embedImage } = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedQuery: vi.fn(),
  embedText: vi.fn(),
  embedImage: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./aiService.js', () => ({
  embedQuery,
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
  IMAGE_STRONG_FLOOR,
  LEGACY_BEST_FLOOR,
  LEGACY_STRONG_FLOOR,
  VECTOR_ONLY_BEST_FLOOR,
  LEXICAL_CONFIDENCE,
  LEXICAL_WEIGHT,
  TEXT_WEIGHT,
  IMAGE_WEIGHT,
  MATCH_THRESHOLD,
  POSSIBLE_DELTA,
  POSSIBLE_FLOOR,
  POSSIBLE_LIMIT,
  POSSIBLE_ONLY_LIMIT,
  TEXT_STRONG_FLOOR,
  calibrateMatchScore,
  matchSimilarityOf,
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
    embedText.mockReset();
    embedImage.mockReset();
    embedQuery.mockResolvedValue({
      embedding: [1, 0, 0],
      expandedText: 'wallet',
      additions: [],
    });
    embedText.mockResolvedValue({
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

  it('promotes a row that names the query past the best delta band', async () => {
    // Reproduces "wallet" against the demo inventory: both rows contain the
    // word, but the second trails by more than BEST_DELTA.
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('blue-wallet', 1.0519, {
            lexical_score: 1,
            text_similarity: 0.8019,
          }),
          // 0.7505 clears TEXT_STRONG_FLOOR by only 0.0005, so a re-embed
          // could drop this row back to the possible tier.
          row('yellow-wallet', 1.0005, {
            lexical_score: 1,
            text_similarity: 0.7505,
          }),
          row('gray-backpack', 0.7899, { lexical_score: 0.24 }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual([
      'blue-wallet',
      'yellow-wallet',
    ]);
    expect(result.possible).toEqual([]);
  });

  it('keeps a named row below BEST_FLOOR out of the best tier', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('top', 0.95, { lexical_score: 1 }),
          row('named', 0.7, { lexical_score: 1, text_similarity: 0.8 }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual(['top']);
    expect(result.possible).toEqual([]);
  });

  it('does not promote a row when only one token of a multi-word query matches', async () => {
    // "black wallet" gives every black row lexical_score 1.0. Only the rows
    // whose text tower is also strong may skip the best delta band.
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('blue-wallet', 0.95, {
            lexical_score: 1,
            text_similarity: 0.8,
          }),
          row('black-fan', 0.88, {
            lexical_score: 1,
            text_similarity: 0.62,
          }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'black wallet',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual(['blue-wallet']);
    expect(result.possible.map((item) => item.id)).toEqual(['black-fan']);
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
      office: 'UB_SECURITY',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items_two_tower',
      expect.objectContaining({
        filter_office: 'UB_SECURITY',
        date_from: '2026-09-01',
        date_to: '2026-09-30',
      }),
    );
  });

  it('drops rows from another office even if a stale RPC ignores the filter', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('kept', 0.8, { holding_office_id: 'UB_SECURITY', lexical_score: 1 }),
          row('elsewhere', 0.8, {
            holding_office_id: 'UB_INFO_DESK',
            lexical_score: 1,
          }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      office: 'UB_SECURITY',
      signal: new AbortController().signal,
    });

    expect(result.best.map((item) => item.id)).toEqual(['kept']);
  });

  it('surfaces an RPC failure as a SearchError when the legacy path also fails', async () => {
    rpc.mockReturnValue(
      resolvedRpc({ error: { code: 'XX000', message: 'database offline' } }),
    );
    embedText.mockRejectedValue(new Error('legacy text offline'));

    await expect(
      searchItems({ text: 'wallet', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: 'SearchError', code: 'db' });
  });

  it('falls back to the legacy RPC when the text tower is unavailable', async () => {
    embedQuery.mockRejectedValue(new Error('text tower offline'));
    embedText.mockResolvedValue({
      embedding: [1, 0, 0],
      expandedText: 'wallet',
      additions: [],
    });
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('legacy-best', 0.9, {
            score: 0.9,
            lexical_score: 1,
          }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items_hybrid',
      expect.objectContaining({ query_embedding: [1, 0, 0] }),
    );
    expect(result.best.map((item) => item.id)).toEqual(['legacy-best']);
  });

  it('keeps the #93 floor for rows from the legacy fallback', async () => {
    embedQuery.mockRejectedValue(new Error('text tower offline'));
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('legacy-borderline', 0.7, {
            lexical_score: 0.6,
            text_similarity: null,
            image_similarity: null,
          }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('results');
    expect(result.best.map((item) => item.id)).toEqual(['legacy-borderline']);
  });

  it('falls back to the legacy RPC when the two-tower RPC is missing', async () => {
    rpc
      .mockReturnValueOnce(
        resolvedRpc({
          error: {
            code: 'PGRST202',
            message: 'Could not find the function match_items_two_tower',
          },
        }),
      )
      .mockReturnValueOnce(
        resolvedRpc({
          data: [
            row('legacy-best', 0.9, {
              score: 0.9,
              lexical_score: 1,
            }),
          ],
        }),
      );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'match_items_hybrid',
      expect.objectContaining({ query_embedding: [1, 0, 0] }),
    );
    expect(result.best.map((item) => item.id)).toEqual(['legacy-best']);
  });

  it('falls back to the original match_items RPC when both hybrids are missing', async () => {
    rpc
      .mockReturnValueOnce(
        resolvedRpc({
          error: {
            code: 'PGRST202',
            message: 'Could not find the function match_items_two_tower',
          },
        }),
      )
      .mockReturnValueOnce(
        resolvedRpc({
          error: {
            code: 'PGRST202',
            message: 'Could not find the function match_items_hybrid',
          },
        }),
      )
      .mockReturnValueOnce(
        resolvedRpc({
          data: [
            // is_cash rows arrive as category 'Cash' after the SQL RPC masks them.
            { id: 'general', status: 'held', similarity: 0.7, title: 'Blue umbrella', category: 'General', image_url: 'u.jpg' },
            { id: 'cash', status: 'held', similarity: 0.7, title: 'Brown envelope', category: 'Cash', image_url: 'cash.jpg' },
            { id: 'cash-flag', status: 'held', similarity: 0.7, title: 'Wallet with cash', category: 'Cash', image_url: 'flag.jpg' },
            { id: 'doc', status: 'held', similarity: 0.7, title: 'Juan Dela Cruz ID', category: 'Documents / IDs', image_url: 'id.jpg' },
            { id: 'legacy', status: 'held', similarity: 0.7, title: 'Maria Santos passport', category: 'Document/ID', image_url: 'passport.jpg' },
          ],
        }),
      );

    const result = await searchItems({
      text: 'wallet',
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'match_items',
      expect.objectContaining({
        query_embedding: [1, 0, 0],
        query_text: 'wallet',
      }),
    );
    expect(result.best.map((item) => item.id)).toEqual([
      'general',
      'cash',
      'cash-flag',
      'doc',
      'legacy',
    ]);
    expect(result.best[0]).toMatchObject({ title: 'Blue umbrella', category: 'General', image_url: 'u.jpg' });
    expect(result.best[1]).toMatchObject({ title: 'Cash', category: 'Cash', image_url: null });
    expect(result.best[2]).toMatchObject({ title: 'Cash', category: 'Cash', image_url: null });
    expect(result.best[3]).toMatchObject({ title: 'Documents / IDs', category: 'Documents / IDs', image_url: null });
    expect(result.best[4]).toMatchObject({ title: 'Documents / IDs', category: 'Document/ID', image_url: null });
  });

  it('masks Cash and Documents / IDs from two-tower and hybrid responses', async () => {
    const signal = new AbortController().signal;
    rpc.mockReturnValueOnce(resolvedRpc({
      data: [
        row('cash', 0.9, { lexical_score: 1, title: 'Brown envelope', category: 'Cash', image_url: 'cash.jpg' }),
        row('doc', 0.9, { lexical_score: 1, title: 'Juan Dela Cruz ID', category: 'Documents / IDs', image_url: 'id.jpg' }),
      ],
    }));
    const twoTower = await searchItems({ text: 'wallet', signal });
    expect(twoTower.best[0]).toMatchObject({ title: 'Cash', category: 'Cash', image_url: null });
    expect(twoTower.best[1]).toMatchObject({ title: 'Documents / IDs', image_url: null });

    embedQuery.mockRejectedValue(new Error('text tower offline'));
    rpc.mockReturnValueOnce(resolvedRpc({
      data: [row('legacy', 0.9, { lexical_score: 1, title: 'Maria Santos passport', category: 'Document/ID', image_url: 'passport.jpg' })],
    }));
    const hybrid = await searchItems({ text: 'wallet', signal });
    expect(rpc).toHaveBeenLastCalledWith('match_items_hybrid', expect.anything());
    expect(hybrid.best[0]).toMatchObject({ title: 'Documents / IDs', image_url: null });
  });

  it('does not promote a masked row whose neutral score came from a hidden match', async () => {
    // The RPC returns a flat 0.55 for masked rows; only a public keyword hit
    // may lift one into the best tier.
    rpc.mockReturnValue(resolvedRpc({ data: [
      row('masked-neutral', 0.55, { lexical_score: 0, text_similarity: 0.55, image_similarity: null, category: 'Documents / IDs' }),
      row('masked-named', 0.8, { lexical_score: 1, text_similarity: 0.55, image_similarity: null, category: 'Documents / IDs' }),
    ] }));
    const result = await searchItems({ text: 'documents', signal: new AbortController().signal });
    expect(result.best.map((item) => item.id)).toEqual(['masked-named']);
  });

  it('drops masked neutral rows for an unrelated query', async () => {
    // A stale RPC can still return the fixed 0.55 for every held masked row.
    // Without a public keyword hit they must not fill the possible slots.
    rpc.mockReturnValue(resolvedRpc({ data: [
      row('masked-cash', 0.55, { lexical_score: 0, text_similarity: 0.55, image_similarity: null, category: 'Cash' }),
      row('masked-doc', 0.55, { lexical_score: 0, text_similarity: 0.55, image_similarity: null, category: 'Documents / IDs' }),
    ] }));
    const result = await searchItems({ text: 'zebra', signal: new AbortController().signal });
    expect(result).toMatchObject({ best: [], possible: [], state: 'none' });
  });

  it('keeps photo search alive when the text tower fails', async () => {
    embedQuery.mockRejectedValue(new Error('text tower offline'));
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          row('photo-match', 0.95, {
            score: 0.95,
            lexical_score: 0,
            text_similarity: null,
            image_similarity: 0.95,
          }),
        ],
      }),
    );

    const result = await searchItems({
      text: 'wallet',
      photo: new Blob(['photo'], { type: 'image/png' }),
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith(
      'match_items_two_tower',
      expect.objectContaining({
        query_text_embedding: null,
        query_image_embedding: [0, 1, 0],
      }),
    );
    expect(result.best.map((item) => item.id)).toEqual(['photo-match']);
  });

  it('exports the tuned tier constants', () => {
    expect({
      BEST_FLOOR,
      BEST_DELTA,
      POSSIBLE_FLOOR,
      POSSIBLE_DELTA,
      POSSIBLE_LIMIT,
      POSSIBLE_ONLY_LIMIT,
      TEXT_STRONG_FLOOR,
      IMAGE_STRONG_FLOOR,
      LEGACY_BEST_FLOOR,
      VECTOR_ONLY_BEST_FLOOR,
      LEGACY_STRONG_FLOOR,
      LEXICAL_CONFIDENCE,
      LEXICAL_WEIGHT,
      TEXT_WEIGHT,
      IMAGE_WEIGHT,
    }).toEqual({
      BEST_FLOOR: 0.72,
      BEST_DELTA: 0.05,
      POSSIBLE_FLOOR: 0.55,
      POSSIBLE_DELTA: 0.07,
      POSSIBLE_LIMIT: 3,
      POSSIBLE_ONLY_LIMIT: 5,
      TEXT_STRONG_FLOOR: 0.75,
      IMAGE_STRONG_FLOOR: 0.82,
      LEGACY_BEST_FLOOR: 0.68,
      VECTOR_ONLY_BEST_FLOOR: 0.64,
      LEGACY_STRONG_FLOOR: 0.82,
      LEXICAL_CONFIDENCE: 0.5,
      LEXICAL_WEIGHT: 0.25,
      TEXT_WEIGHT: 0.65,
      IMAGE_WEIGHT: 0.35,
    });
  });
});

describe('match score display', () => {
  it('rebuilds the vector similarity a two-tower row omits', () => {
    expect(
      matchSimilarityOf({
        score: 0.95,
        text_similarity: 0.7,
        image_similarity: null,
      }),
    ).toBe(0.7);
    expect(
      matchSimilarityOf({ text_similarity: 0.8, image_similarity: 0.6 }),
    ).toBeCloseTo(0.73);
    expect(matchSimilarityOf({ image_similarity: 0.9 })).toBe(0.9);
    expect(matchSimilarityOf({ similarity: 0.74, score: 0.9 })).toBe(0.74);
  });

  it('hides the percentage instead of returning NaN for a missing score', () => {
    expect(matchSimilarityOf({})).toBeNull();
    expect(calibrateMatchScore(undefined)).toEqual({
      percent: null,
      tier: 'none',
    });
    expect(calibrateMatchScore(null)).toEqual({ percent: null, tier: 'none' });
    expect(calibrateMatchScore(NaN)).toEqual({ percent: null, tier: 'none' });
  });

  it('still calibrates a finite score into a percentage tier', () => {
    expect(calibrateMatchScore(0.65)).toEqual({
      percent: 84,
      tier: 'moderate',
    });
    expect(calibrateMatchScore(0.7).percent).toBe(98);
    expect(calibrateMatchScore(0.69).percent).toBe(95);
    expect(calibrateMatchScore(0.64).percent).toBe(81);
  });
});
