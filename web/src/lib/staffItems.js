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
 * Every item currently held by one office, for the staff held-items page
 * (US-31). Reads the items table directly because authenticated staff have
 * SELECT there; anon does not, so this list is office-session only.
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
