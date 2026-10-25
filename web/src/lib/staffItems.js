import { supabase } from './supabase.js';

/** code: 'db' */
export class StaffItemsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StaffItemsError';
    this.code = code;
  }
}

/**
 * Every item currently held by one office (US-31). Staff sessions can read the
 * items table directly; anonymous visitors cannot, so this list stays behind
 * the counter gate. Storage location is deliberately included because this is
 * the officer's own working view, not the public catalogue.
 */
export async function listHeldItems({ officeId, signal }) {
  let query = supabase
    .from('items')
    .select('id, ref_code, title, category, date_received, storage_location')
    .eq('holding_office_id', officeId)
    .eq('status', 'held')
    .order('date_received', { ascending: false })
    .order('ref_code', { ascending: false });

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new StaffItemsError('db', error.message);

  return data ?? [];
}
