// provision-office
//
// Central-admin provisioning for US-01: mint a shared Supabase Auth login for a
// new participating office and insert its directory row. The browser runs on the
// anon key and can never create auth users, so this runs in an Edge Function
// with the service_role key. Deploy and set the secret with:
//
//   supabase functions deploy provision-office --project-ref vwegcexuyznfsbgzurxa
//   supabase secrets set SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key>
//
// The caller must carry the central-admin role claim (see
// _shared/adminAuth.ts). `verify_jwt = true` is not that check: the anon key is
// itself a signed JWT and ships in the public browser bundle, so without the
// role test any visitor could mint an office login.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, respond } from '../_shared/http.ts';
import { requireCentralAdmin } from '../_shared/adminAuth.ts';

const SITE_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/;
const MIN_PASSWORD = 8;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      return respond(500, {
        error: 'Provisioning is not configured on this deployment.',
      });
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Refuse before reading the body: an unauthorised caller should not even
    // get field validation back.
    const { response } = await requireCentralAdmin(req, admin);
    if (response) return response;

    const body = await req.json();

    const id = String(body.id ?? '')
      .trim()
      .toUpperCase();
    const name = String(body.name ?? '').trim();
    const address = String(body.address ?? '').trim();
    const counterHours = String(body.counterHours ?? '').trim();
    const phoneNumber = String(body.phoneNumber ?? '').trim();
    const mapPin = String(body.mapPin ?? '').trim();
    const status = body.status === 'suspended' ? 'suspended' : 'active';
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const password = String(body.password ?? '');

    if (!name || !id || !address || !counterHours || !email || !password) {
      return respond(400, { error: 'Fill in every required field.' });
    }
    if (!SITE_CODE_PATTERN.test(id)) {
      return respond(400, {
        error:
          'Site code must be 2–40 letters, numbers, underscores or hyphens.',
      });
    }
    if (password.length < MIN_PASSWORD) {
      return respond(400, {
        error: `The shared password must be at least ${MIN_PASSWORD} characters.`,
      });
    }

    const { data: existing } = await admin
      .from('offices')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existing) {
      return respond(409, {
        error: `An office with the site code "${id}" already exists.`,
      });
    }

    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { office_id: id, office_name: name },
    });
    if (userError || !user?.user) {
      return respond(400, {
        error: userError?.message ?? 'Could not create the shared login.',
      });
    }

    const { error: insertError } = await admin.from('offices').insert({
      id,
      name,
      address,
      counter_hours: counterHours,
      phone_number: phoneNumber || '(074) 442-1111',
      map_pin: mapPin || null,
      status,
      auth_user_id: user.user.id,
    });

    if (insertError) {
      // Roll back the auth user so a failed insert doesn't strand a login.
      try {
        await admin.auth.admin.deleteUser(user.user.id);
      } catch {
        // Best effort — surface the insert error below either way.
      }
      return respond(400, { error: insertError.message });
    }

    return respond(201, { office: { id, name, email } });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Unexpected error while provisioning the office.';
    return respond(400, { error: message });
  }
});
