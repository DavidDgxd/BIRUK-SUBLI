import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import {
  coarseFailureReason,
  describeDevice,
  fetchLoginHistory,
  LoginHistoryError,
  mapLoginHistoryRow,
  recordLoginAttempt,
} from './loginHistory.js';

/**
 * A PostgREST builder stand-in: awaitable on its own, and also awaitable after
 * `.abortSignal(signal)`, the way supabase-js chains the two.
 */
function resolved({ data = null, error = null } = {}) {
  const payload = { data, error };
  return {
    abortSignal: vi.fn().mockResolvedValue(payload),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(payload).then(onFulfilled, onRejected),
  };
}

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 ' +
  'Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CHROME_MACOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('describeDevice', () => {
  it('names the browser and the system', () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe('Chrome on Windows');
    expect(describeDevice(SAFARI_IOS)).toBe('Safari on iOS');
    expect(describeDevice(CHROME_ANDROID)).toBe('Chrome on Android');
    expect(describeDevice(CHROME_MACOS)).toBe('Chrome on macOS');
  });

  it('recognises Edge before the Chrome token it carries', () => {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    expect(describeDevice(userAgent)).toBe('Edge on Windows');
  });

  it('does not mistake an iPhone for a desktop Mac', () => {
    expect(describeDevice(SAFARI_IOS)).not.toContain('macOS');
  });

  it('returns an empty label for an empty user agent', () => {
    expect(describeDevice('')).toBe('');
    expect(describeDevice(null)).not.toBeUndefined();
  });

  it('falls back to a bounded slice of an unrecognised user agent', () => {
    expect(describeDevice('HeadlessBot/1.0 (custom)')).toBe(
      'HeadlessBot/1.0 (custom)',
    );

    const long = 'X'.repeat(400);
    expect(describeDevice(long)).toHaveLength(120);
  });
});

describe('coarseFailureReason', () => {
  it('maps a credential mismatch', () => {
    expect(coarseFailureReason({ code: 'credentials' })).toBe(
      'invalid_credentials',
    );
  });

  it('maps an authenticated but unusable office account', () => {
    expect(coarseFailureReason({ code: 'suspended' })).toBe('inactive_office');
    expect(coarseFailureReason({ code: 'unlinked' })).toBe('inactive_office');
  });

  it('maps everything else to the generic bucket', () => {
    expect(coarseFailureReason({ code: 'db' })).toBe('auth_error');
    expect(coarseFailureReason(undefined)).toBe('auth_error');
    expect(coarseFailureReason(new Error('socket hang up'))).toBe('auth_error');
  });

  it('recognises the GoTrue message when no code is attached', () => {
    expect(
      coarseFailureReason(new Error('Invalid login credentials')),
    ).toBe('invalid_credentials');
  });
});

describe('recordLoginAttempt', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sends a successful attempt with the device summary', async () => {
    rpc.mockReturnValue(resolved());

    await expect(
      recordLoginAttempt({
        account: '  security@ubaguio.edu.ph ',
        status: 'success',
        deviceInfo: 'Chrome on Windows',
      }),
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('record_login_attempt', {
      p_account: 'security@ubaguio.edu.ph',
      p_status: 'success',
      p_failure_reason: null,
      p_device_info: 'Chrome on Windows',
    });
  });

  it('sends a failed attempt with the coarse reason', async () => {
    rpc.mockReturnValue(resolved());

    await recordLoginAttempt({
      account: 'someone@example.test',
      status: 'failed',
      failureReason: 'invalid_credentials',
      deviceInfo: 'Safari on iOS',
    });

    expect(rpc).toHaveBeenCalledWith('record_login_attempt', {
      p_account: 'someone@example.test',
      p_status: 'failed',
      p_failure_reason: 'invalid_credentials',
      p_device_info: 'Safari on iOS',
    });
  });

  it('defaults a failure with no reason to auth_error', async () => {
    rpc.mockReturnValue(resolved());

    await recordLoginAttempt({ account: 'someone@example.test', status: 'failed' });

    expect(rpc).toHaveBeenCalledWith(
      'record_login_attempt',
      expect.objectContaining({
        p_status: 'failed',
        p_failure_reason: 'auth_error',
      }),
    );
  });

  it('bounds the account and device fields before sending', async () => {
    rpc.mockReturnValue(resolved());

    await recordLoginAttempt({
      account: 'a'.repeat(300),
      deviceInfo: 'd'.repeat(300),
    });

    const [, payload] = rpc.mock.calls[0];
    expect(payload.p_account).toHaveLength(200);
    expect(payload.p_device_info).toHaveLength(200);
  });

  it('swallows an RPC error so sign-in never depends on the audit write', async () => {
    rpc.mockReturnValue(resolved({ error: { message: 'database unavailable' } }));

    await expect(
      recordLoginAttempt({ account: 'security@ubaguio.edu.ph' }),
    ).resolves.toBe(false);
  });

  it('swallows a transport failure', async () => {
    rpc.mockImplementation(() => {
      throw new Error('offline');
    });

    await expect(
      recordLoginAttempt({ account: 'security@ubaguio.edu.ph' }),
    ).resolves.toBe(false);
  });
});

describe('fetchLoginHistory', () => {
  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    occurred_at: '2026-11-20T08:15:00Z',
    account_label: 'University of Baguio Security Office',
    office_id: 'UB_SECURITY',
    role: 'office_staff',
    status: 'success',
    failure_reason: null,
    device_info: 'Chrome on Windows',
  };

  beforeEach(() => {
    rpc.mockReset();
  });

  it('sends every filter to the admin RPC', async () => {
    rpc.mockReturnValue(resolved({ data: [row] }));

    await fetchLoginHistory({
      officeId: 'UB_SECURITY',
      search: '  public information  ',
      status: 'failed',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      limit: 25,
    });

    const from = new Date('2026-11-01T00:00:00');
    const to = new Date('2026-11-30T00:00:00');
    to.setHours(23, 59, 59, 999);

    expect(rpc).toHaveBeenCalledWith('admin_list_login_history', {
      p_office_id: 'UB_SECURITY',
      p_search: 'public information',
      p_status: 'failed',
      p_date_from: from.toISOString(),
      p_date_to: to.toISOString(),
      p_limit: 25,
    });
  });

  it('treats an empty office, search and status as unfiltered', async () => {
    rpc.mockReturnValue(resolved({ data: [] }));

    await fetchLoginHistory({ officeId: '', search: '   ', status: 'all' });

    expect(rpc).toHaveBeenCalledWith('admin_list_login_history', {
      p_office_id: null,
      p_search: null,
      p_status: null,
      p_date_from: null,
      p_date_to: null,
      p_limit: 100,
    });
  });

  it('clamps an out-of-range limit', async () => {
    rpc.mockReturnValue(resolved({ data: [] }));

    await fetchLoginHistory({ limit: 9000 });
    expect(rpc.mock.calls[0][1].p_limit).toBe(500);

    await fetchLoginHistory({ limit: -4 });
    expect(rpc.mock.calls[1][1].p_limit).toBe(1);
  });

  it('maps a row onto display labels', async () => {
    rpc.mockReturnValue(resolved({ data: [row] }));

    const [mapped] = await fetchLoginHistory();

    expect(mapped).toMatchObject({
      id: row.id,
      occurredAt: row.occurred_at,
      accountLabel: row.account_label,
      officeId: 'UB_SECURITY',
      roleLabel: 'Office staff',
      statusLabel: 'Success',
      failureLabel: null,
      deviceLabel: 'Chrome on Windows',
    });
  });

  it('labels a coarse failure reason and a missing device', async () => {
    rpc.mockReturnValue(
      resolved({
        data: [
          {
            ...row,
            role: 'unknown',
            status: 'failed',
            failure_reason: 'invalid_credentials',
            device_info: '',
          },
        ],
      }),
    );

    const [mapped] = await fetchLoginHistory();

    expect(mapped.roleLabel).toBe('Unknown');
    expect(mapped.statusLabel).toBe('Failed');
    expect(mapped.failureLabel).toBe('Invalid credentials');
    expect(mapped.deviceLabel).toBe('Unknown device');
  });

  it('passes an abort signal through when one is given', async () => {
    const pending = resolved({ data: [] });
    rpc.mockReturnValue(pending);
    const controller = new AbortController();

    await fetchLoginHistory({}, { signal: controller.signal });

    expect(pending.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it('reports a 42501 as a forbidden error and anything else as db', async () => {
    rpc.mockReturnValue(
      resolved({ error: { code: '42501', message: 'admin only' } }),
    );
    await expect(fetchLoginHistory()).rejects.toMatchObject({
      name: 'LoginHistoryError',
      code: 'forbidden',
    });

    rpc.mockReturnValue(
      resolved({ error: { code: 'XX000', message: 'boom' } }),
    );
    await expect(fetchLoginHistory()).rejects.toBeInstanceOf(
      LoginHistoryError,
    );
  });

  it('falls back to unknown for a reason the UI does not know', () => {
    const mapped = mapLoginHistoryRow({
      ...row,
      role: 'central_admin',
      status: 'failed',
      failure_reason: 'something_new',
    });

    expect(mapped.roleLabel).toBe('Central admin');
    expect(mapped.failureLabel).toBe('Sign-in error');
  });
});
