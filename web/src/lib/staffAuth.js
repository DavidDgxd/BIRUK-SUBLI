import { supabase } from './supabase.js';

/*
 * Shared office login (US-02) and central-admin session (US-03).
 *
 * An office signs in with one set of site credentials, never a personal
 * account: the provision-office Edge Function (US-01) mints a single Supabase
 * Auth user per office and records its id on the office row as `auth_user_id`.
 * Signing in is therefore two steps — authenticate the shared account, then
 * resolve which office it belongs to.
 *
 * The lookup is an ordinary read, since "Offices are viewable by everyone". An
 * account that authenticates but claims no office is not a counter login, so it
 * is signed straight back out rather than left holding a live session — with one
 * exception. The central admin manages every office and belongs to none, so a
 * caller carrying the `central_admin` role claim gets an office-less session
 * instead of the sign-out.
 */

/** code: 'credentials' | 'unlinked' | 'suspended' | 'db' | 'signout' */
export class StaffAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StaffAuthError';
    this.code = code;
  }
}

const OFFICE_COLUMNS = 'id, name, status, auth_user_id';

/**
 * The role claim that marks the central admin. It lives in `app_metadata`
 * because only the service_role can write that; `user_metadata` is editable by
 * the user themselves, so it could never gate anything.
 */
const ADMIN_ROLE = 'central_admin';

/** Whether a signed-in auth user carries the central-admin role claim. */
export function isCentralAdmin(user) {
  return user?.app_metadata?.role === ADMIN_ROLE;
}

/**
 * The session shape every counter page reads through useStaffAuth().
 *
 * `officeId`/`officeName` are null for a central-admin session: they run the
 * directory rather than file against one counter, and pages that need an office
 * check for it rather than assuming.
 */
function sessionFor(office, user) {
  return {
    staffEmail: user?.email,
    officeId: office?.id ?? null,
    officeName: office?.name ?? null,
    isAdmin: isCentralAdmin(user),
    isMock: false,
  };
}

/**
 * Turns a Supabase Auth failure into something the officer at the desk can act
 * on. GoTrue reports a stable `code` alongside the message, so the code is
 * checked first and the message kept only as a fallback.
 */
function credentialsError(error) {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');

  if (
    code === 'invalid_credentials' ||
    /invalid login credentials/i.test(message)
  ) {
    return new StaffAuthError(
      'credentials',
      'That email and password do not match a site login.',
    );
  }
  if (
    code === 'email_not_confirmed' ||
    /email not confirmed/i.test(message)
  ) {
    return new StaffAuthError(
      'credentials',
      'This site login has not been confirmed yet. Ask the central admin to check it.',
    );
  }
  if (
    code === 'over_request_rate_limit' ||
    error?.status === 429 ||
    /rate limit|too many requests/i.test(message)
  ) {
    return new StaffAuthError(
      'credentials',
      'Too many attempts just now. Wait a moment and try again.',
    );
  }
  return new StaffAuthError(
    'credentials',
    'We could not sign you in right now. Please try again.',
  );
}

/** The office a signed-in auth user belongs to, or null when none claims it. */
export async function resolveOfficeForUser(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('offices')
    .select(OFFICE_COLUMNS)
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (error) {
    throw new StaffAuthError(
      'db',
      'We could not load your office right now. Please try again.',
    );
  }

  return data ?? null;
}

/** Signs in with the office's shared credentials and resolves its counter session. */
export async function signInWithSiteCredentials(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw credentialsError(error);

  const user = data?.user;

  let office;
  try {
    office = await resolveOfficeForUser(user?.id);
  } catch (lookupError) {
    await supabase.auth.signOut();
    throw lookupError;
  }

  if (!office) {
    // The central admin has no office row of their own — they manage all of
    // them — so their session is legitimately office-less.
    if (isCentralAdmin(user)) return sessionFor(null, user);

    await supabase.auth.signOut();
    throw new StaffAuthError(
      'unlinked',
      'That login is not linked to an office yet. Ask the central admin to finish setting it up.',
    );
  }
  if (office.status === 'suspended') {
    await supabase.auth.signOut();
    throw new StaffAuthError(
      'suspended',
      'This office’s counter access is suspended. Contact the central admin.',
    );
  }

  return sessionFor(office, user);
}

/**
 * Resolves an already-stored Supabase session — a reload with the login still
 * held — into the counter session, or null when it no longer maps to an active
 * office.
 */
export async function loadStaffSession(user) {
  const office = await resolveOfficeForUser(user?.id);
  if (!office) return isCentralAdmin(user) ? sessionFor(null, user) : null;
  if (office.status === 'suspended') return null;
  return sessionFor(office, user);
}

/** Ends the shared session so the next shift starts from the login screen. */
export async function signOutOfSite() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new StaffAuthError(
      'signout',
      'We could not sign you out. Please try again.',
    );
  }
}
