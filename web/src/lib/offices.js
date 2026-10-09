import { supabase } from './supabase.js';

/*
 * Central admin office provisioning (US-01).
 *
 * The directory is read straight from `offices` — every role can SELECT it
 * ("Offices are viewable by everyone"), so the admin list needs no special
 * auth. Creating an office is different: it must also mint the office's shared
 * Supabase Auth login, and only the service_role key can do that. The browser
 * runs on the anon key, so the insert + user creation happen in the
 * `provision-office` Edge Function (supabase/functions/provision-office), which
 * is invoked here the same way a PostgREST RPC would be.
 *
 * Columns map onto schema.sql's `offices` table: phone_number is the office's
 * contact line and counter_hours its opening hours. `auth_user_id` is set when
 * the shared login has been provisioned and drives the "Login" column.
 */

/** code: 'db' | 'provision' */
export class OfficeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OfficeError';
    this.code = code;
  }
}

/** Loads the participating-offices directory, ordered by name. */
export async function listOffices({ signal } = {}) {
  let query = supabase
    .from('offices')
    .select(
      'id, name, address, counter_hours, phone_number, map_pin, status, auth_user_id, created_at',
    )
    .order('name', { ascending: true });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new OfficeError('db', error.message);
  return data ?? [];
}

/**
 * Creates the shared Supabase Auth login and inserts the office row through the
 * provision-office Edge Function.
 *
 * Resolves to the created office ({ id, name, email }). Throws OfficeError with
 * code 'provision' carrying a human-readable message on failure.
 */
export async function provisionOffice({
  id,
  name,
  address,
  counterHours,
  phoneNumber,
  mapPin,
  status,
  email,
  password,
}) {
  const { data, error } = await supabase.functions.invoke('provision-office', {
    body: {
      id,
      name,
      address,
      counterHours,
      phoneNumber,
      mapPin,
      status,
      email,
      password,
    },
  });

  if (error) {
    // The function answers failures with { error } and a non-2xx status, which
    // supabase-js surfaces as a FunctionsHttpError whose context holds the
    // response. Fall back to a generic message when the body can't be read
    // (e.g. the function has not been deployed yet).
    let message = 'We could not create the office right now. Please try again.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new OfficeError('provision', message);
  }

  if (!data?.office || data.error) {
    throw new OfficeError(
      'provision',
      data?.error ??
        'We could not create the office right now. Please try again.',
    );
  }

  return data.office;
}
