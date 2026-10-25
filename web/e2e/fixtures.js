import { test as base, expect } from '@playwright/test';

/*
 * Network and storage fakes for the end-to-end suite.
 *
 * Nothing in the app is changed for tests. Supabase and the AI service are
 * answered at the network boundary, and a signed-in staff or admin visit is a
 * session placed where supabase-js stores it, so the real StaffGate and auth
 * context resolve it the same way they would after a sign-in.
 */

const PROJECT_REF = 'vwegcexuyznfsbgzurxa';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const OFFICE = {
  id: 'BCPIO',
  name: 'Baguio City Public Information Office',
  address: 'City Hall, Baguio City',
  counter_hours: 'Mon–Fri, 8:00–17:00',
  phone_number: '074 000 0000',
  map_pin: null,
  status: 'active',
  auth_user_id: 'user-office',
  created_at: '2026-10-01T00:00:00Z',
};

const USERS = {
  office: {
    id: 'user-office',
    email: 'bcpio@baguio.gov.ph',
    app_metadata: {},
  },
  admin: {
    id: 'user-admin',
    email: 'admin@baguio.gov.ph',
    app_metadata: { role: 'central_admin' },
  },
};

function storedSession(user) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24,
    expires_at: expiresAt,
    user: { aud: 'authenticated', role: 'authenticated', ...user },
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockBackends(page, role) {
  const user = role ? USERS[role] : null;

  await page.route(`https://${PROJECT_REF}.supabase.co/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const wantsObject = (request.headers().accept ?? '').includes(
      'vnd.pgrst.object',
    );

    if (url.pathname.startsWith('/auth/v1/user')) {
      return user ? json(route, user) : json(route, { msg: 'no session' }, 401);
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(route, {});

    if (url.pathname === '/rest/v1/offices') {
      const ownOffice =
        role === 'office' && url.searchParams.has('auth_user_id');
      if (url.searchParams.has('auth_user_id')) {
        if (wantsObject) return json(route, ownOffice ? OFFICE : null);
        return json(route, ownOffice ? [OFFICE] : []);
      }
      return json(route, [OFFICE]);
    }
    if (url.pathname === '/rest/v1/rpc/list_office_logins') {
      return json(route, [{ office_id: OFFICE.id, email: USERS.office.email }]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      return json(route, wantsObject ? null : []);
    }
    return json(route, {});
  });

  // The AI service resolves to the page's own host on port 8000.
  await page.route(/:8000\//, (route) =>
    json(route, { detail: 'Not available in tests' }, 503),
  );

  if (user) {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify(storedSession(user))],
    );
  }
}

/*
 * `signedInAs` is null for a public visit, or 'office' / 'admin'. Console
 * errors and uncaught page errors are collected for every test.
 */
export const test = base.extend({
  signedInAs: [null, { option: true }],
  // The fixture callback is named `provide`, not Playwright's usual `use`, so
  // the React hooks lint rule does not mistake it for a hook.
  pageErrors: async ({ page }, provide) => {
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await provide(errors);
  },
  page: async ({ page, signedInAs }, provide) => {
    await mockBackends(page, signedInAs);
    await provide(page);
  },
});

export { expect };

/** Every route under test, with the session it needs to render its content. */
export const ROUTES = [
  { path: '/', role: null },
  { path: '/search', role: null },
  { path: '/report/lost', role: null },
  { path: '/report/found', role: null },
  { path: '/staff/login', role: null },
  { path: '/staff/intake', role: 'office' },
  { path: '/admin/offices', role: 'admin' },
];

/** Opens a route and waits until the app has rendered and settled. */
export async function openRoute(page, path) {
  await page.goto(path);
  await page.locator('main').first().waitFor();
  await page.waitForLoadState('networkidle');
}
