import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, storageWrites } = vi.hoisted(() => ({
  rpc: vi.fn(),
  storageWrites: { setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import {
  LostReportMatchError,
  dismissLostReportMatch,
  fetchLostReportMatches,
} from './lostReportMatches.js';

/*
 * Black-box tests for the US-16 client match module.
 *
 * The contract: fetchLostReportMatches calls the match RPC with the new item's
 * id only (no threshold, no count, no vector) and maps rows to the eight
 * camelCase fields; dismissLostReportMatch posts the dismissed pair and both
 * functions throw a typed error carrying the reason and no lost-report data
 * when the RPC fails. Errors never carry lost-report contact detail.
 */

const ITEM_ID = '9e2f5a90-1f2e-4a4f-9a01-6f9d1a2b3c4d';
const REPORT_ID = 'b1d4c7a2-3e5f-4a6b-8c9d-0e1f2a3b4c5d';

const RAW_ROW = {
  lost_report_id: REPORT_ID,
  ref_code: 'LR-0042',
  description: 'Navy Jansport backpack, broken zip pull',
  image_url: 'https://example.test/lost/backpack.webp',
  area_route: 'Session Road to Malcolm Square',
  date_lost: '2026-11-02',
  contact_info: '0917 555 0142',
  similarity: 0.834,
};

function rpcResult({ data = null, error = null } = {}) {
  // The supabase-js builder is awaited both directly (`await supabase.rpc(...)`)
  // and through `.abortSignal(signal)`, so the mock is a thenable whose settled
  // promise both paths resolve.
  const settled = Promise.resolve({ data, error });
  return {
    abortSignal: vi.fn(() => settled),
    then: settled.then.bind(settled),
  };
}

function watchClientStorage() {
  // The vitest run uses the node environment, so install a fake localStorage
  // and record every writer the module (or anything it reaches) might touch.
  const storage = {
    getItem: vi.fn(() => null),
    setItem: storageWrites.setItem,
    removeItem: storageWrites.removeItem,
    clear: storageWrites.clear,
    key: vi.fn(() => null),
    get length() {
      return 0;
    },
  };
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  return () => {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  };
}

describe('fetchLostReportMatches', () => {
  beforeEach(() => {
    rpc.mockReset();
    storageWrites.setItem.mockClear();
    storageWrites.removeItem.mockClear();
    storageWrites.clear.mockClear();
  });

  it('maps every row onto the eight camelCase fields', async () => {
    // [REQ-007 | FR-002 | NFR-001] Valid: the row projection survives mapping.
    rpc.mockReturnValue(rpcResult({ data: [RAW_ROW] }));

    const rows = await fetchLostReportMatches(ITEM_ID);

    expect(rows).toEqual([
      {
        lostReportId: REPORT_ID,
        refCode: 'LR-0042',
        description: 'Navy Jansport backpack, broken zip pull',
        imageUrl: 'https://example.test/lost/backpack.webp',
        areaRoute: 'Session Road to Malcolm Square',
        dateLost: '2026-11-02',
        contactInfo: '0917 555 0142',
        similarity: 0.834,
      },
    ]);
  });

  it('maps several rows in server order and coerces a non-numeric similarity to 0', async () => {
    // [REQ-007 | FR-002] Boundary: multiple rows keep server order; a null or
    // malformed similarity field must not crash mapping.
    rpc.mockReturnValue(
      rpcResult({
        data: [
          { ...RAW_ROW, similarity: 0.91 },
          { ...RAW_ROW, lost_report_id: 'c2a3-aa', similarity: null },
          { ...RAW_ROW, lost_report_id: 'c2a3-bb', similarity: 'high' },
        ],
      }),
    );

    const rows = await fetchLostReportMatches(ITEM_ID);

    expect(rows.map((row) => row.similarity)).toEqual([0.91, 0, 0]);
    expect(rows.map((row) => row.lostReportId)).toEqual([
      REPORT_ID,
      'c2a3-aa',
      'c2a3-bb',
    ]);
  });

  it('calls match_lost_reports with only the item id and no vector or floor arguments', async () => {
    // [REQ-007 | FR-002 | NFR-001] Valid: the request carries the item id and
    // nothing else. The 0.55 floor and limit 5 are server defaults, so passing
    // them here would be a contract violation.
    rpc.mockReturnValue(rpcResult({ data: [] }));

    await fetchLostReportMatches(ITEM_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('match_lost_reports', {
      item_id: ITEM_ID,
    });
    const call = rpc.mock.calls[0];
    const args = call[1];
    expect(Object.keys(args)).toEqual(['item_id']);
    expect(JSON.stringify(args)).not.toMatch(
      /embedding|vector|threshold|count/,
    );
  });

  it('passes the abort signal through to the RPC builder', async () => {
    // [REQ-008 | FR-002 | NFR-002] Valid: an aborted match request is torn
    // down through the same signal the caller holds.
    const signal = new AbortController().signal;
    rpc.mockReturnValue(rpcResult({ data: [] }));

    await fetchLostReportMatches(ITEM_ID, { signal });

    expect(rpc.mock.results[0].value.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('returns an empty list when the RPC yields no rows', async () => {
    // [REQ-001 | FR-003] Valid/empty: no close reports is data, not an error.
    rpc.mockReturnValue(rpcResult({ data: [] }));
    await expect(fetchLostReportMatches(ITEM_ID)).resolves.toEqual([]);

    rpc.mockReturnValue(rpcResult({ data: null }));
    await expect(fetchLostReportMatches(ITEM_ID)).resolves.toEqual([]);
  });

  it('rejects an empty, whitespace, or null item id with the validation code', async () => {
    // [REQ-007 | FR-002] Invalid: the RPC is never called without an id.
    for (const bad of ['', '   ', null, undefined]) {
      await expect(fetchLostReportMatches(bad)).rejects.toMatchObject({
        name: 'LostReportMatchError',
        code: 'validation',
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws the typed db error with the reason and no lost-report data on RPC failure', async () => {
    // [REQ-007 | FR-002 | NFR-003] Invalid: a failing match produces a typed
    // error whose message is the failure reason only. None of the mapped row
    // fields (contact detail, ref code, description) may ride along.
    const reason = 'permission denied for table lost_reports';
    rpc.mockReturnValue(
      rpcResult({
        data: [RAW_ROW],
        error: { message: reason },
      }),
    );

    let thrown;
    await fetchLostReportMatches(ITEM_ID).catch((error) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(LostReportMatchError);
    expect(thrown.code).toBe('db');
    expect(thrown.message).toBe(reason);
    const own = Object.keys(thrown).join(' ');
    expect(own).not.toMatch(/lostReport|refCode|contact|description|rows/);
    expect(own).not.toContain(REPORT_ID);
  });

  it('writes nothing to client storage while matching runs', async () => {
    // [REQ-015 | NFR-003 | BR-002 | UR-004] Security-adjacent: flags and
    // contact detail live in memory for the life of the receipt only.
    const restore = watchClientStorage();
    try {
      rpc.mockReturnValue(rpcResult({ data: [RAW_ROW] }));
      await fetchLostReportMatches(ITEM_ID);
      expect(storageWrites.setItem).not.toHaveBeenCalled();
      expect(storageWrites.removeItem).not.toHaveBeenCalled();
      expect(storageWrites.clear).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe('dismissLostReportMatch', () => {
  beforeEach(() => {
    rpc.mockReset();
    storageWrites.setItem.mockClear();
  });

  it('posts the dismissed pair with the RPC parameter names', async () => {
    // [REQ-011 | FR-006 | UR-002] Valid: the dismissal write carries both ids.
    rpc.mockReturnValue(rpcResult());

    await dismissLostReportMatch(ITEM_ID, REPORT_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('dismiss_lost_report_match', {
      p_item_id: ITEM_ID,
      p_lost_report_id: REPORT_ID,
    });
  });

  it('resolves when the write succeeds and returns nothing', async () => {
    // [REQ-011 | FR-006] Valid: a repeat dismissal is harmless and yields no
    // value the panel could misread as row data.
    rpc.mockReturnValue(rpcResult());
    await expect(
      dismissLostReportMatch(ITEM_ID, REPORT_ID),
    ).resolves.toBeUndefined();
  });

  it('rejects when either id is missing and never calls the RPC', async () => {
    // [REQ-011 | FR-006] Invalid: a dismissal needs both ids; unknown ids are
    // rejected server-side on the foreign key, so an empty local id must not
    // even reach the network.
    for (const [itemId, reportId] of [
      ['', REPORT_ID],
      [ITEM_ID, '  '],
      [null, REPORT_ID],
      [ITEM_ID, null],
    ]) {
      await expect(
        dismissLostReportMatch(itemId, reportId),
      ).rejects.toMatchObject({
        name: 'LostReportMatchError',
        code: 'validation',
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws the typed db error with the reason and no pair data on write failure', async () => {
    // [REQ-011 | FR-006 | NFR-003] Invalid: a failed dismissal keeps the row
    // visible in the panel, so the error must carry only the reason.
    const reason = 'insert violates foreign key constraint';
    rpc.mockReturnValue(rpcResult({ error: { message: reason } }));

    let thrown;
    await dismissLostReportMatch(ITEM_ID, REPORT_ID).catch((error) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(LostReportMatchError);
    expect(thrown.code).toBe('db');
    expect(thrown.message).toBe(reason);
    expect(JSON.stringify(Object.keys(thrown))).not.toMatch(/item|report|rows/);
  });

  it('writes nothing to client storage while dismissing runs', async () => {
    // [REQ-015 | NFR-003 | UR-004] The dismissed pair is persisted server-side
    // only; the client keeps no copy.
    const restore = watchClientStorage();
    try {
      rpc.mockReturnValue(rpcResult());
      await dismissLostReportMatch(ITEM_ID, REPORT_ID);
      expect(storageWrites.setItem).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
