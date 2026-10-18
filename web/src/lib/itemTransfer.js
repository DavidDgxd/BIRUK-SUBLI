import { supabase } from './supabase.js';

/** code: 'forbidden' | 'db' */
export class ItemTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ItemTransferError';
    this.code = code;
  }
}

/**
 * Moves an item's current holding office through transfer_item_custody (US-6).
 *
 * The RPC is callable only by an authenticated office and checks that the
 * caller's office is the current holder, so this is not a public write.
 */
export async function transferItemCustody({ itemId, newOfficeId, signal }) {
  let query = supabase.rpc('transfer_item_custody', {
    p_item_id: itemId,
    p_new_office_id: newOfficeId,
  });
  if (signal) query = query.abortSignal(signal);

  const { error } = await query;
  if (error) {
    const code = error.code === '42501' ? 'forbidden' : 'db';
    throw new ItemTransferError(code, error.message);
  }
}
