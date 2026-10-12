// reset-office-credentials
//
// Central-admin credential reset for US-03: when an office reports its shared
// login lost or compromised, mint a fresh password for that office's Auth user
// and hand it back once for the admin to relay. Deploy with:
//
//   supabase functions deploy reset-office-credentials --project-ref vwegcexuyznfsbgzurxa
//
// The caller must carry the central-admin role claim (see _shared/adminAuth.ts).
// The password is generated here with a CSPRNG — never accepted from the client —
// and returned in the response body only; it is never logged or stored, so the
// admin is the only one who ever sees it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, respond } from '../_shared/http.ts';
import { requireCentralAdmin } from '../_shared/adminAuth.ts';

const SITE_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/;

// No I, O, l, o, 0 or 1: the credential gets read down a phone line to a
// counter, so every character has to be unambiguous when spoken and typed.
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_GROUPS = 4;
const PASSWORD_GROUP_SIZE = 4;

/**
 * Uniform random integer in [0, max). Bytes at or above the largest whole
 * multiple of `max` are rejected, so the modulo cannot favour low values.
 */
function randomInt(max: number): number {
  const limit = Math.floor(256 / max) * max;
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) return byte[0] % max;
  }
}

/** A fresh shared credential: four groups of four, about 93 bits of entropy. */
function generatePassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < PASSWORD_GROUPS; group += 1) {
    let chars = '';
    for (let i = 0; i < PASSWORD_GROUP_SIZE; i += 1) {
      chars += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    groups.push(chars);
  }
  return groups.join('-');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      return respond(500, {
        error: 'Credential reset is not configured on this deployment.',
      });
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { response } = await requireCentralAdmin(req, admin);
    if (response) return response;

    const body = await req.json();
    const officeId = String(body.officeId ?? '')
      .trim()
      .toUpperCase();
    if (!SITE_CODE_PATTERN.test(officeId)) {
      return respond(400, { error: 'Choose an office to reset.' });
    }

    const { data: office, error: officeError } = await admin
      .from('offices')
      .select('id, name, auth_user_id')
      .eq('id', officeId)
      .maybeSingle();
    if (officeError) {
      return respond(400, { error: officeError.message });
    }
    if (!office) {
      return respond(404, {
        error: `No office has the site code "${officeId}".`,
      });
    }
    if (!office.auth_user_id) {
      return respond(409, {
        error: `${office.name} has no shared login yet, so there is nothing to reset.`,
      });
    }

    const password = generatePassword();
    const { data: updated, error: updateError } =
      await admin.auth.admin.updateUserById(office.auth_user_id, { password });
    if (updateError || !updated?.user) {
      return respond(400, {
        error: updateError?.message ?? 'Could not reset the shared password.',
      });
    }

    // Changing the password ends the office's existing sessions, so anyone
    // signed in on the old credential is signed out. A token already issued
    // stays valid until it expires, which is why this is a deliberate,
    // confirmed action rather than a silent one.
    //
    // no-store: the body carries the only copy of the new password, so nothing
    // between here and the admin should keep it.
    return respond(
      200,
      {
        office: { id: office.id, name: office.name },
        credential: { email: updated.user.email, password },
      },
      { 'Cache-Control': 'no-store' },
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Unexpected error while resetting the credential.';
    return respond(400, { error: message });
  }
});
