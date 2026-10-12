// _shared/adminAuth
//
// Central-admin authorization for the office-management functions.
//
// `verify_jwt = true` in supabase/config.toml only proves the caller sent *a*
// project JWT. The anon key is itself a signed JWT and ships in the public
// browser bundle, so that check alone lets anyone who reads the bundle mint or
// rewrite an office login. Every function that touches credentials re-checks
// the caller here instead, so the rule lives in one place and cannot drift
// between functions.
//
// The role is read from `app_metadata`, which only the service_role can write.
// `user_metadata` is editable by the user themselves through
// supabase.auth.updateUser(), so it must never gate anything.

import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';
import { respond } from './http.ts';

export const CENTRAL_ADMIN_ROLE = 'central_admin';

/** The caller, or the refusal to send back in their place. */
export interface CentralAdminCheck {
  user?: User;
  response?: Response;
}

/** The caller's role claim, or '' when they carry none. */
export function roleOf(user: User | null | undefined): string {
  const role = user?.app_metadata?.role;
  return typeof role === 'string' ? role : '';
}

/**
 * Verifies the request's bearer token and requires the central-admin role.
 *
 * Usage: `const { response } = await requireCentralAdmin(req, admin);`
 * `if (response) return response;`
 */
export async function requireCentralAdmin(
  req: Request,
  admin: SupabaseClient,
): Promise<CentralAdminCheck> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      response: respond(401, {
        error: 'Sign in as the central admin to manage office logins.',
      }),
    };
  }

  // Verified against the Auth server rather than decoded locally, so an expired
  // or forged token is rejected here rather than trusted.
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    return {
      response: respond(401, {
        error: 'Your session has expired. Sign in again to continue.',
      }),
    };
  }

  if (roleOf(user) !== CENTRAL_ADMIN_ROLE) {
    return {
      response: respond(403, {
        error: 'Only the central admin can manage office logins.',
      }),
    };
  }

  return { user };
}
