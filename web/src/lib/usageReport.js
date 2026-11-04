import { supabase } from './supabase.js';

/** code: 'forbidden' | 'db' */
export class UsageReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UsageReportError';
    this.code = code;
  }
}

/** Calendar date for the report's required date bounds. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Current item count for every office (US-29).
 *
 * `get_usage_report` is a central-admin-only RPC. Its date window only affects
 * the logged/released columns; `items_currently_held` is always the current
 * custody snapshot, so a single-day window is enough for the admin overview.
 *
 * Resolves to a Map of office id → held item count.
 */
export async function listOfficeHeldCounts({ signal } = {}) {
  const today = todayIso();
  let query = supabase.rpc('get_usage_report', {
    p_start_date: today,
    p_end_date: today,
    p_office_id: null,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) {
    throw new UsageReportError(
      error.code === '42501' ? 'forbidden' : 'db',
      error.message,
    );
  }

  return new Map(
    (data ?? []).map((row) => [
      row.office_id,
      Number(row.items_currently_held) || 0,
    ]),
  );
}
