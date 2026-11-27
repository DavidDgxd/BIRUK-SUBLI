import { OFFICE } from './fixtures.js';

/*
 * Network fakes for the US-37 specs.
 *
 * The sign-in form is exercised against a mocked GoTrue, and the admin view
 * against a mocked admin_list_login_history that applies the filters the RPC
 * receives — so the tests cover the payload as well as the rendering.
 */

const OFFICE_USER = {
  id: 'user-office',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'security@ubaguio.edu.ph',
  app_metadata: {},
  user_metadata: {},
};

export const HISTORY = [
  {
    id: '11111111-1111-1111-1111-111111111101',
    occurred_at: '2026-11-20T09:30:00Z',
    account_label: OFFICE.name,
    office_id: OFFICE.id,
    role: 'office_staff',
    status: 'success',
    failure_reason: null,
    device_info: 'Chrome on Windows',
  },
  {
    id: '11111111-1111-1111-1111-111111111102',
    occurred_at: '2026-11-21T10:15:00Z',
    account_label: 'admin@ubaguio.edu.ph',
    office_id: null,
    role: 'central_admin',
    status: 'success',
    failure_reason: null,
    device_info: 'Safari on iOS',
  },
  {
    id: '11111111-1111-1111-1111-111111111103',
    occurred_at: '2026-11-22T11:45:00Z',
    account_label: 'unknown@example.test',
    office_id: null,
    role: 'unknown',
    status: 'failed',
    failure_reason: 'invalid_credentials',
    device_info: 'Firefox on Linux',
  },
];

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Signs the browser in as the office account without a stored session. */
export async function mockOfficeSignIn(page) {
  await page.route('**/auth/v1/token*', (route) =>
    json(route, {
      access_token: 'e2e-access-token',
      refresh_token: 'e2e-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: OFFICE_USER,
    }),
  );
  await page.route('**/auth/v1/user', (route) => json(route, OFFICE_USER));
  await page.route('**/rest/v1/offices*', (route) => {
    const url = new URL(route.request().url());
    return json(route, url.searchParams.has('auth_user_id') ? OFFICE : [OFFICE]);
  });
}

/** Rejects the password grant the way GoTrue does. */
export async function mockRejectedSignIn(page) {
  await page.route('**/auth/v1/token*', (route) =>
    json(
      route,
      {
        code: 'invalid_credentials',
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
        message: 'Invalid login credentials',
      },
      400,
    ),
  );
}

/** Captures every attempt the form sends. */
export async function captureAttempts(page, { status = 200, body = null } = {}) {
  const attempts = [];
  await page.route('**/rest/v1/rpc/record_login_attempt', (route) => {
    attempts.push(route.request().postDataJSON());
    return json(route, body, status);
  });
  return attempts;
}

/** Applies the filter payload the page sends, then answers newest first. */
export async function mockHistory(
  page,
  { rows = HISTORY, failFirst = false } = {},
) {
  const requests = [];
  let fail = failFirst;

  await page.route('**/rest/v1/rpc/admin_list_login_history', (route) => {
    if (fail) return json(route, { message: 'database unavailable' }, 500);

    const body = route.request().postDataJSON();
    requests.push(body);

    let visible = [...rows].sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at),
    );
    if (body.p_office_id) {
      visible = visible.filter((row) => row.office_id === body.p_office_id);
    }
    if (body.p_role) {
      visible = visible.filter((row) => row.role === body.p_role);
    }
    if (body.p_search) {
      const needle = body.p_search.toLowerCase();
      visible = visible.filter((row) =>
        row.account_label.toLowerCase().includes(needle),
      );
    }
    if (body.p_status) {
      visible = visible.filter((row) => row.status === body.p_status);
    }
    if (body.p_date_from) {
      visible = visible.filter(
        (row) => Date.parse(row.occurred_at) >= Date.parse(body.p_date_from),
      );
    }
    if (body.p_date_to) {
      visible = visible.filter(
        (row) => Date.parse(row.occurred_at) <= Date.parse(body.p_date_to),
      );
    }
    return json(route, visible.slice(0, body.p_limit ?? 100));
  });

  return {
    requests,
    recover: () => {
      fail = false;
    },
  };
}

export function accountColumn(page) {
  return page.locator('.login-history__body .login-history__account');
}

export function rowFor(page, text) {
  return page.getByRole('row').filter({ hasText: text });
}
