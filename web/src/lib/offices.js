import { supabase } from './supabase.js';

/*
 * Central admin office management (US-01, US-03).
 *
 * The directory is read straight from `offices` — every role can SELECT it
 * ("Offices are viewable by everyone"), so the admin list needs no special
 * auth. Writing is different: creating an office must also mint its shared
 * Supabase Auth login, and resetting one must rewrite that user's password.
 * Only the service_role key can do either. The browser runs on the anon key, so
 * both live in Edge Functions (supabase/functions/provision-office and
 * reset-office-credentials), invoked here the same way a PostgREST RPC would be.
 * Both re-check the caller's central-admin role server-side.
 *
 * Columns map onto schema.sql's `offices` table: phone_number is the office's
 * contact line and counter_hours its opening hours. `auth_user_id` is set when
 * the shared login has been provisioned and drives the "Login" column.
 */

/** code: 'db' | 'provision' | 'reset' */
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
 * Loads each office's login email through the admin-only `list_office_logins`
 * RPC. The address lives in auth.users, not on the public `offices` table.
 *
 * Resolves to a Map of office id → email.
 */
export async function listOfficeLogins({ signal } = {}) {
  let query = supabase.rpc('list_office_logins');
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new OfficeError('db', error.message);
  return new Map((data ?? []).map((row) => [row.office_id, row.email]));
}

/**
 * Calls an office-management Edge Function and unwraps its answer.
 *
 * The functions report failures as `{ error }` with a non-2xx status, which
 * supabase-js surfaces as a FunctionsHttpError whose context holds the response.
 * Fall back to the generic message when the body cannot be read — a function
 * that has not been deployed yet, or a platform-level refusal that never
 * reached the handler.
 */
async function invokeOfficeFunction({ name, body, code, fallbackMessage }) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    let message = fallbackMessage;
    try {
      const payload = await error.context?.json?.();
      if (payload?.error) message = payload.error;
    } catch {
      // keep the generic message
    }
    throw new OfficeError(code, message);
  }

  if (!data || data.error) {
    throw new OfficeError(code, data?.error ?? fallbackMessage);
  }

  return data;
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
  const data = await invokeOfficeFunction({
    name: 'provision-office',
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
    code: 'provision',
    fallbackMessage:
      'We could not create the office right now. Please try again.',
  });

  if (!data.office) {
    throw new OfficeError(
      'provision',
      'We could not create the office right now. Please try again.',
    );
  }

  return data.office;
}

/**
 * Issues a new shared password for an office through the
 * reset-office-credentials Edge Function (US-03).
 *
 * Resolves to `{ office: { id, name }, credential: { email, password } }`.
 * That credential is the only copy — nothing stores it — so the caller has to
 * put it in front of the admin before the dialog closes.
 *
 * Throws OfficeError with code 'reset'.
 */
export async function resetOfficeCredentials(officeId) {
  const data = await invokeOfficeFunction({
    name: 'reset-office-credentials',
    body: { officeId },
    code: 'reset',
    fallbackMessage:
      'We could not reset the login right now. Please try again.',
  });

  if (!data.credential?.password) {
    throw new OfficeError(
      'reset',
      'We could not reset the login right now. Please try again.',
    );
  }

  return data;
}
