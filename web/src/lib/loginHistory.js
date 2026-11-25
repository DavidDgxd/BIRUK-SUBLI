import { supabase } from './supabase.js';

/** code: 'forbidden' | 'db' */
export class LoginHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoginHistoryError';
    this.code = code;
  }
}

/*
 * Login history (US-37).
 *
 * Two calls: append an attempt from the sign-in form, and read the log back for
 * the central admin. The table itself has no client privileges — both RPCs are
 * SECURITY DEFINER — so this module is the whole browser surface.
 *
 * `recordLoginAttempt` is deliberately best-effort. An audit write that fails
 * must never keep an officer out of the counter, so every failure is swallowed
 * and reported as a boolean the caller is free to ignore.
 */

/** Matches the RPC's own truncation, so the payload is bounded before it ships. */
const MAX_TEXT = 200;
const MAX_DEVICE_LABEL = 120;

const ROLE_LABELS = {
  office_staff: 'Office staff',
  central_admin: 'Central admin',
  unknown: 'Unknown',
};

const STATUS_LABELS = { success: 'Success', failed: 'Failed' };

/**
 * Coarse reasons the UI understands. `inactive_office` is raised on this side
 * only: an unlinked or suspended account authenticated successfully, so naming
 * it cannot confirm whether an email address exists.
 */
const FAILURE_LABELS = {
  invalid_credentials: 'Invalid credentials',
  inactive_office: 'Inactive office',
  auth_error: 'Sign-in error',
};

/** Trims and bounds a free-text field before it leaves the browser. */
function clip(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

/** Ordered most specific first: Edge and Opera also claim Chrome and Safari. */
const BROWSERS = [
  ['Edg', 'Edge'],
  ['OPR', 'Opera'],
  ['SamsungBrowser', 'Samsung Internet'],
  ['CriOS', 'Chrome'],
  ['FxiOS', 'Firefox'],
  ['Chrome', 'Chrome'],
  ['Firefox', 'Firefox'],
  ['Safari', 'Safari'],
];

/** Android comes before Linux, iPhone/iPad before macOS, for the same reason. */
const SYSTEMS = [
  ['Windows', 'Windows'],
  ['CrOS', 'ChromeOS'],
  ['Android', 'Android'],
  ['iPhone', 'iOS'],
  ['iPad', 'iOS'],
  ['iPod', 'iOS'],
  ['Mac OS X', 'macOS'],
  ['Linux', 'Linux'],
];

function firstMatch(source, table) {
  const hit = table.find(([marker]) => source.includes(marker));
  return hit ? hit[1] : '';
}

/**
 * "Chrome on Windows", "Safari on iOS", or a short slice of the raw string when
 * neither half is recognisable. The raw user-agent is never sent unsliced.
 */
export function describeDevice(userAgent) {
  const source =
    userAgent ??
    (typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '');
  const value = String(source ?? '').trim();
  if (!value) return '';

  const browser = firstMatch(value, BROWSERS);
  const system = firstMatch(value, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  if (browser || system) return browser || system;
  return value.slice(0, MAX_DEVICE_LABEL);
}

/**
 * Turns a sign-in error into the coarse reason the log stores. Anything that is
 * not a credential mismatch or a signed-in-but-inactive account becomes
 * `auth_error`, so an unexpected failure never describes its cause.
 */
export function coarseFailureReason(error) {
  const code = error?.code ?? '';
  if (code === 'credentials') return 'invalid_credentials';
  if (code === 'suspended' || code === 'unlinked') return 'inactive_office';

  const message = String(error?.message ?? '');
  if (/invalid login credentials|do not match a site login/i.test(message)) {
    return 'invalid_credentials';
  }
  return 'auth_error';
}

/**
 * Appends one attempt to the server-side log. Resolves to true when the write
 * landed and false for any failure; it never throws, so a caller can await it
 * on the sign-in path without risking the user's session.
 */
export async function recordLoginAttempt({
  account,
  status = 'success',
  failureReason = null,
  deviceInfo,
} = {}) {
  const succeeded = status === 'success';

  try {
    const { error } = await supabase.rpc('record_login_attempt', {
      p_account: clip(account),
      p_status: succeeded ? 'success' : 'failed',
      p_failure_reason: succeeded
        ? null
        : clip(failureReason) || 'auth_error',
      p_device_info: clip(deviceInfo ?? describeDevice()),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[loginHistory]', error);
    return false;
  }
}

/** A date input value as local start-of-day, or as local end-of-day. */
function dateBoundary(value, endOfDay) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** Maps a row onto the labels the admin table renders. */
export function mapLoginHistoryRow(row) {
  const role = row.role ?? 'unknown';
  const status = row.status ?? 'failed';
  const failureReason = row.failure_reason ?? null;

  return {
    id: row.id,
    occurredAt: row.occurred_at,
    accountLabel: row.account_label || 'Unknown account',
    officeId: row.office_id ?? null,
    role,
    roleLabel: ROLE_LABELS[role] ?? ROLE_LABELS.unknown,
    status,
    statusLabel: STATUS_LABELS[status] ?? STATUS_LABELS.failed,
    failureReason,
    failureLabel: failureReason
      ? FAILURE_LABELS[failureReason] ?? FAILURE_LABELS.auth_error
      : null,
    deviceInfo: row.device_info || '',
    deviceLabel: row.device_info || 'Unknown device',
  };
}

/**
 * Newest-first page of the log for the central admin. The RPC re-checks the
 * role claim, so a 42501 here means the session is not an admin session.
 */
export async function fetchLoginHistory(
  {
    officeId = null,
    search = null,
    status = null,
    dateFrom = null,
    dateTo = null,
    limit = 100,
  } = {},
  { signal } = {},
) {
  const requested = Math.trunc(Number(limit));
  let query = supabase.rpc('admin_list_login_history', {
    p_office_id: officeId || null,
    p_search: clip(search) || null,
    // Only the two status values the table allows; "all" is a null filter.
    p_status: status === 'success' || status === 'failed' ? status : null,
    p_date_from: dateBoundary(dateFrom, false),
    p_date_to: dateBoundary(dateTo, true),
    p_limit: Math.min(Math.max(requested || 100, 1), 500),
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) {
    throw new LoginHistoryError(
      error.code === '42501' ? 'forbidden' : 'db',
      error.message,
    );
  }

  return (data ?? []).map(mapLoginHistoryRow);
}
