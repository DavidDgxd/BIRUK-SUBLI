import { supabase } from './supabase.js';

/** code: 'validation' | 'forbidden' | 'duplicate' | 'db' */
export class ItemReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ItemReleaseError';
    this.code = code;
  }
}

/*
 * Staff counter release.
 *
 * A claimant presents an ID at the desk and the officer confirms the handover.
 * release_item_at_counter owns the state transition: it verifies that the
 * signed-in office is the current holder, requires a claimant name and ID
 * reference, locks the custody row, and stamps released_at/releasing_office_id.
 * Once status becomes 'released', both public read paths (match_items and
 * get_item_public) stop returning the item.
 *
 * The RPC is SECURITY DEFINER and granted to authenticated only, so the anon
 * key cannot release an item even if it guesses the id.
 */

const RELEASE_ERROR_CODES = {
  '22023': 'validation',
  '42501': 'forbidden',
  '55000': 'duplicate',
};

function releaseError(error) {
  const known = RELEASE_ERROR_CODES[error?.code];
  if (known) {
    return new ItemReleaseError(known, error.message);
  }

  const message = String(error?.message ?? '');

  if (/already been released|no longer held/i.test(message)) {
    return new ItemReleaseError('duplicate', message);
  }
  if (/required/i.test(message)) {
    return new ItemReleaseError('validation', message);
  }
  if (/not held by this office|signed-in office/i.test(message)) {
    return new ItemReleaseError('forbidden', message);
  }

  return new ItemReleaseError(
    'db',
    message || 'We could not release the item. Please try again.',
  );
}

/**
 * Records an in-person release for an item held by the caller's office.
 *
 * Resolves to { claimantName, claimantIdRef } after the RPC commits. Throws
 * ItemReleaseError with code 'validation' (empty name/ID), 'forbidden' (caller
 * is not the holding office), 'duplicate' (already released), or 'db'.
 * An abort propagates as-is so the caller can ignore it.
 */
export async function releaseItemAtCounter({
  itemId,
  officeId,
  claimantName,
  claimantIdRef,
  releaseNotes,
  signal,
} = {}) {
  const cleanItemId = (itemId ?? '').trim();
  const cleanOfficeId = (officeId ?? '').trim();
  const cleanName = (claimantName ?? '').trim();
  const cleanIdRef = (claimantIdRef ?? '').trim();
  const cleanNotes = (releaseNotes ?? '').trim();

  if (!cleanItemId) {
    throw new ItemReleaseError('validation', 'An item id is required.');
  }
  if (!cleanOfficeId) {
    throw new ItemReleaseError('validation', 'A releasing office is required.');
  }
  if (!cleanName) {
    throw new ItemReleaseError('validation', "Enter the claimant's name.");
  }
  if (!cleanIdRef) {
    throw new ItemReleaseError(
      'validation',
      'Enter the ID reference presented by the claimant.',
    );
  }

  let query = supabase.rpc('release_item_at_counter', {
    p_item_id: cleanItemId,
    p_releasing_office_id: cleanOfficeId,
    p_claimant_name: cleanName,
    p_claimant_id_ref: cleanIdRef,
    p_release_notes: cleanNotes || null,
  });
  if (signal) query = query.abortSignal(signal);

  const { error } = await query;
  if (error) throw releaseError(error);

  return { claimantName: cleanName, claimantIdRef: cleanIdRef };
}
