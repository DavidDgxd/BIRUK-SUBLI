import { supabase } from '../lib/supabaseClient';

/**
 * Provisions a new campus office account via the 'create-office' Edge Function.
 * Enforces central_admin JWT token verification on the backend.
 * 
 * @param {Object} payload
 * @param {string} payload.office_name
 * @param {string} payload.email
 * @param {string} payload.password
 */
export async function provisionOfficeAccount({ office_name, email, password }) {
  const { data, error } = await supabase.functions.invoke('create-office', {
    body: { office_name, email, password },
  });

  if (error) {
    throw new Error(error.message || 'Failed to provision office account.');
  }

  return data;
}