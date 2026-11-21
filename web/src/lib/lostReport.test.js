import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, embedText, embedImageOrNull } = vi.hoisted(() => ({
  rpc: vi.fn(),
  embedText: vi.fn(),
  embedImageOrNull: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

vi.mock('./aiService.js', () => ({
  MAX_EMBED_TEXT_LENGTH: 1000,
  embedText,
  embedImageOrNull,
  SearchError: class SearchError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SearchError';
      this.code = code;
    }
  },
}));

import {
  CLOSE_REPORT_NOT_FOUND_MESSAGE,
  CLOSE_REPORT_RETRY_MESSAGE,
  LostReportError,
  buildCloseLink,
  closeLostReport,
  staffCloseLostReport,
  staffLookupLostReport,
  submitLostReport,
} from './lostReport.js';

function unitVector(dim = 512) {
  return Array.from({ length: dim }, (_, index) => (index === 0 ? 1 : 0));
}

function rpcResult(data = null, error = null) {
  // Supabase's rpc() returns a thenable builder. Resolve it directly when no
  // signal is passed, and expose abortSignal for the paths that do pass one.
  const result = Promise.resolve({ data, error });
  result.abortSignal = vi.fn().mockResolvedValue({ data, error });
  return result;
}

/** A fetch-level failure: supabase-js rejects instead of returning { error }. */
function rpcRejection(thrown) {
  const result = Promise.reject(thrown);
  result.catch(() => {}); // keep the test runner quiet about the same promise
  result.abortSignal = vi.fn().mockRejectedValue(thrown);
  return result;
}

function abortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

const baseReport = {
  description: 'Blue backpack with a white logo',
  areaRoute: 'Session Road',
  dateLost: '2026-11-10',
  contactInfo: ' 0917 000 0000 ',
  photo: null,
  signal: new AbortController().signal,
};

describe('buildCloseLink', () => {
  it('builds an encoded private close URL from the receipt', () => {
    const link = buildCloseLink({
      refCode: ' LR-0100 ',
      closeKey: 'a+b/c=d',
      origin: 'https://biruk.example',
    });

    expect(link).toBe(
      'https://biruk.example/close-report?ref=LR-0100&key=a%2Bb%2Fc%3Dd',
    );
  });

  it('keeps a missing value empty rather than printing undefined', () => {
    expect(
      buildCloseLink({ refCode: 'LR-0100', origin: 'https://biruk.example' }),
    ).toBe('https://biruk.example/close-report?ref=LR-0100&key=');
  });
});

describe('submitLostReport', () => {
  beforeEach(() => {
    rpc.mockReset();
    embedText.mockReset();
    embedImageOrNull.mockReset();
  });

  it('returns the ref_code and close_key from the submission receipt', async () => {
    embedText.mockResolvedValue({ embedding: unitVector() });
    rpc.mockReturnValue(
      rpcResult([{ ref_code: 'LR-0100', close_key: 'secret-close-key' }]),
    );

    await expect(submitLostReport(baseReport)).resolves.toEqual({
      refCode: 'LR-0100',
      closeKey: 'secret-close-key',
      usedPhoto: false,
    });

    expect(rpc).toHaveBeenCalledWith('submit_lost_report', {
      p_description: 'Blue backpack with a white logo',
      p_area_route: 'Session Road',
      p_date_lost: '2026-11-10',
      p_contact_info: '0917 000 0000',
      p_image_url: null,
      p_embedding: unitVector(),
    });
  });

  it('rejects an incomplete receipt instead of showing a blank key', async () => {
    embedText.mockResolvedValue({ embedding: unitVector() });
    rpc.mockReturnValue(rpcResult([{ ref_code: 'LR-0100', close_key: null }]));

    await expect(submitLostReport(baseReport)).rejects.toMatchObject({
      name: 'SearchError',
      code: 'db',
    });
  });
});

describe('closeLostReport', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('normalizes the ref code and sends both secrets to the close RPC', async () => {
    rpc.mockReturnValue(
      rpcResult([
        {
          ref_code: 'LR-0100',
          status: 'closed',
          closed_at: '2026-11-15T08:00:00Z',
        },
      ]),
    );

    await expect(
      closeLostReport({ refCode: ' lr-0100 ', closeKey: ' key ' }),
    ).resolves.toEqual({
      refCode: 'LR-0100',
      status: 'closed',
      closedAt: '2026-11-15T08:00:00Z',
    });

    expect(rpc).toHaveBeenCalledWith('close_lost_report_by_key', {
      p_ref_code: 'LR-0100',
      p_close_key: 'key',
    });
  });

  it('does not call the RPC when the key is missing', async () => {
    await expect(
      closeLostReport({ refCode: 'LR-0100', closeKey: '   ' }),
    ).rejects.toMatchObject({
      name: 'LostReportError',
      code: 'not-found',
      message: CLOSE_REPORT_NOT_FOUND_MESSAGE,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps wrong key and unknown ref_code P0002 rejections to identical client copy', async () => {
    // The uniformity lives on the server (one P0002 for every miss); this test
    // proves the client does not add a distinguishing branch of its own.
    const notFound = {
      code: 'P0002',
      message: 'Report not found or invalid close link.',
    };

    rpc.mockReturnValueOnce(rpcResult(null, notFound));
    const wrongKey = await closeLostReport({
      refCode: 'LR-0100',
      closeKey: 'wrong',
    }).catch((error) => error);

    rpc.mockReturnValueOnce(rpcResult(null, notFound));
    const unknownRef = await closeLostReport({
      refCode: 'LR-9999',
      closeKey: 'anything',
    }).catch((error) => error);

    expect(wrongKey).toBeInstanceOf(LostReportError);
    expect(unknownRef).toBeInstanceOf(LostReportError);
    expect(wrongKey.code).toBe('not-found');
    expect(unknownRef.code).toBe('not-found');
    expect(wrongKey.message).toBe(unknownRef.message);
    expect(wrongKey.message).toBe(CLOSE_REPORT_NOT_FOUND_MESSAGE);
  });

  it('reports a 5xx as a retry instead of an invalid link', async () => {
    rpc.mockReturnValue(
      rpcResult(null, {
        code: '500',
        status: 500,
        message: 'Internal Server Error',
      }),
    );

    await expect(
      closeLostReport({ refCode: 'LR-0100', closeKey: 'key' }),
    ).rejects.toMatchObject({
      code: 'network',
      message: CLOSE_REPORT_RETRY_MESSAGE,
    });
  });

  it('reports a network rejection as a retry instead of an invalid link', async () => {
    rpc.mockReturnValue(rpcRejection(new TypeError('Failed to fetch')));

    await expect(
      closeLostReport({ refCode: 'LR-0100', closeKey: 'key' }),
    ).rejects.toMatchObject({
      name: 'LostReportError',
      code: 'network',
      message: CLOSE_REPORT_RETRY_MESSAGE,
    });
  });

  it('rethrows an abort untouched so the caller can ignore it', async () => {
    const aborted = abortError();
    rpc.mockReturnValue(rpcRejection(aborted));

    await expect(
      closeLostReport({ refCode: 'LR-0100', closeKey: 'key' }),
    ).rejects.toBe(aborted);
  });

  it('forwards the AbortSignal to the RPC builder', async () => {
    const probe = rpcResult([{ ref_code: 'LR-0100', status: 'closed' }]);
    rpc.mockReturnValue(probe);
    const controller = new AbortController();

    await closeLostReport({
      refCode: 'LR-0100',
      closeKey: 'key',
      signal: controller.signal,
    });

    expect(probe.abortSignal).toHaveBeenCalledWith(controller.signal);
  });
});

describe('staffLookupLostReport', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('maps only the counter summary and drops contact_info and created_at', async () => {
    rpc.mockReturnValue(
      rpcResult([
        {
          ref_code: 'LR-0100',
          description: 'Blue backpack',
          area_route: 'Session Road',
          date_lost: '2026-11-10',
          status: 'open',
          // Still present if an older database answers, so the mapping is what
          // keeps them out of the UI.
          contact_info: '0917 000 0000',
          created_at: '2026-11-10T08:00:00Z',
          close_key: 'secret-close-key',
        },
      ]),
    );

    const summary = await staffLookupLostReport({ refCode: ' lr-0100 ' });

    expect(summary).toEqual({
      refCode: 'LR-0100',
      description: 'Blue backpack',
      areaRoute: 'Session Road',
      dateLost: '2026-11-10',
      status: 'open',
    });
    expect(summary).not.toHaveProperty('contactInfo');
    expect(summary).not.toHaveProperty('createdAt');
    expect(summary).not.toHaveProperty('closeKey');
    expect(rpc).toHaveBeenCalledWith('staff_lookup_lost_report', {
      p_ref_code: 'LR-0100',
    });
  });

  it('resolves to null when no report carries that ref code', async () => {
    rpc.mockReturnValue(rpcResult([]));

    await expect(
      staffLookupLostReport({ refCode: 'LR-9999' }),
    ).resolves.toBeNull();
  });

  it('forwards the AbortSignal to the RPC builder', async () => {
    const probe = rpcResult([]);
    rpc.mockReturnValue(probe);
    const controller = new AbortController();

    await staffLookupLostReport({
      refCode: 'LR-0100',
      signal: controller.signal,
    });

    expect(probe.abortSignal).toHaveBeenCalledWith(controller.signal);
  });
});

describe('staffCloseLostReport', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('closes the report by ref code and returns the closed status', async () => {
    rpc.mockReturnValue(
      rpcResult([{ ref_code: 'LR-0100', status: 'closed', closed_at: 'now' }]),
    );

    await expect(
      staffCloseLostReport({ refCode: 'lr-0100' }),
    ).resolves.toEqual({
      refCode: 'LR-0100',
      status: 'closed',
      closedAt: 'now',
    });

    expect(rpc).toHaveBeenCalledWith('staff_close_lost_report', {
      p_ref_code: 'LR-0100',
    });
  });

  it('rejects a blank ref code before the RPC', async () => {
    await expect(
      staffCloseLostReport({ refCode: '   ' }),
    ).rejects.toMatchObject({
      name: 'LostReportError',
      code: 'validation',
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a missing report in counter language', async () => {
    rpc.mockReturnValue(
      rpcResult(null, {
        code: 'P0002',
        message: 'No lost report found for that reference code.',
      }),
    );

    await expect(
      staffCloseLostReport({ refCode: 'LR-9999' }),
    ).rejects.toMatchObject({
      name: 'LostReportError',
      code: 'not-found',
      message: 'No lost report found for that reference code.',
    });
  });

  it('shows the counter a generic failure when the RPC denies the session', async () => {
    rpc.mockReturnValue(
      rpcResult(null, {
        code: '42501',
        message: 'Only signed-in counter staff can close lost reports.',
      }),
    );

    await expect(
      staffCloseLostReport({ refCode: 'LR-0100' }),
    ).rejects.toMatchObject({
      name: 'LostReportError',
      code: 'db',
      message: 'We could not close that report right now.',
    });
  });

  it('does not surface a raw fetch error to the counter', async () => {
    rpc.mockReturnValue(rpcRejection(new TypeError('Failed to fetch')));

    const failure = await staffCloseLostReport({ refCode: 'LR-0100' }).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(LostReportError);
    expect(failure.code).toBe('db');
    expect(failure.message).not.toContain('fetch');
  });
});
