import { supabase } from './supabase.js';

/** code: 'validation' | 'db' */
export class LostReportMatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LostReportMatchError';
    this.code = code;
  }
}

/*
 * Reverse matching at intake (US-16).
 *
 * When a found item is logged, the counter checks it against open lost-item
 * reports so the officer can call the person who reported the loss while the
 * handover is fresh. The match is advisory: nothing is sent to the reporter,
 * the item is not reserved, and a failed check never affects the custody
 * record.
 *
 * The RPC takes the new item's id and reads the item's stored embedding
 * server-side, so this module never sends a vector. It is authenticated-only;
 * `dismissLostReportMatch` records a reviewed pairing in `dismissed_matches`.
 *
 * The mapped rows hold lost-report contact detail, which is staff-visible PII.
 * Callers keep them in memory for the life of the receipt only, and errors
 * carry the failure reason without any row data.
 */

function mapMatch(row) {
  return {
    lostReportId: row.lost_report_id,
    refCode: row.ref_code,
    description: row.description,
    imageUrl: row.image_url,
    areaRoute: row.area_route,
    dateLost: row.date_lost,
    contactInfo: row.contact_info,
    similarity: Number(row.similarity) || 0,
  };
}

/** [FR-002|NFR-001] Request matching with the item id and no vector. */
export async function fetchLostReportMatches(itemId, { signal } = {}) {
  const cleanId = String(itemId ?? '').trim();
  if (!cleanId) {
    throw new LostReportMatchError('validation', 'An item id is required.');
  }

  let query = supabase.rpc('match_lost_reports', { item_id: cleanId });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new LostReportMatchError('db', error.message);

  return (data ?? []).map(mapMatch);
}

/** [FR-006|UR-002] Persist a dismissed pairing; a repeat is harmless. */
export async function dismissLostReportMatch(itemId, lostReportId) {
  const cleanItemId = String(itemId ?? '').trim();
  const cleanReportId = String(lostReportId ?? '').trim();
  if (!cleanItemId || !cleanReportId) {
    throw new LostReportMatchError('validation', 'A dismissal needs both ids.');
  }

  const { error } = await supabase.rpc('dismiss_lost_report_match', {
    p_item_id: cleanItemId,
    p_lost_report_id: cleanReportId,
  });
  if (error) throw new LostReportMatchError('db', error.message);
}
