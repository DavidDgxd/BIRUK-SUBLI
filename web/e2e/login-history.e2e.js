import { readFile } from 'node:fs/promises';
import { test, expect, OFFICE, openRoute } from './fixtures.js';
import {
  accountColumn,
  captureAttempts,
  capturePrunes,
  HISTORY,
  mockHistory,
  mockOfficeSignIn,
  mockRejectedSignIn,
  rowFor,
} from './login-history.mocks.js';

/*
 * US-37: login history.
 *
 * Covers the append from /staff/login (success, rejection, inactive office, and
 * a failed audit write) and the central-admin view at /admin/login-history and
 * on the office directory's Login history tab.
 */

async function submitLogin(
  page,
  { email = 'security@ubaguio.edu.ph', password = 'counter-secret' } = {},
) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

function horizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe('staff sign-in recording', () => {
  test('records a successful office sign-in and lands on the counter', async ({
    page,
    pageErrors,
  }) => {
    await mockOfficeSignIn(page);
    const attempts = await captureAttempts(page);

    await openRoute(page, '/staff/login');
    await submitLogin(page);

    await page.waitForURL('**/staff/intake');
    await expect.poll(() => attempts.at(-1)?.p_status).toBe('success');

    const attempt = attempts.at(-1);
    expect(attempt.p_account).toBe(OFFICE.name);
    expect(attempt.p_failure_reason).toBeNull();
    expect(attempt.p_device_info).not.toBe('');
    expect(pageErrors).toEqual([]);
  });

  test('records a rejected attempt and keeps the same user-facing error', async ({
    page,
  }) => {
    await mockRejectedSignIn(page);
    const attempts = await captureAttempts(page);

    await openRoute(page, '/staff/login');
    await submitLogin(page, { password: 'wrong-password' });

    await expect(
      page.getByText('That email and password do not match a site login.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect.poll(() => attempts.at(-1)?.p_status).toBe('failed');
    expect(attempts.at(-1).p_account).toBe('security@ubaguio.edu.ph');
    expect(attempts.at(-1).p_failure_reason).toBe('invalid_credentials');
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test('records an inactive office and still shows the suspension message', async ({
    page,
  }) => {
    await mockOfficeSignIn(page);
    const suspended = { ...OFFICE, status: 'suspended' };
    await page.route('**/rest/v1/offices*', (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          url.searchParams.has('auth_user_id') ? suspended : [suspended],
        ),
      });
    });
    const attempts = await captureAttempts(page);

    await openRoute(page, '/staff/login');
    await submitLogin(page);

    await expect(
      page.getByText(/counter access is suspended/i),
    ).toBeVisible();
    await expect
      .poll(() => attempts.at(-1)?.p_failure_reason)
      .toBe('inactive_office');
    expect(attempts.at(-1).p_status).toBe('failed');
  });

  test('still redirects when the audit write fails', async ({ page }) => {
    await mockOfficeSignIn(page);
    const attempts = await captureAttempts(page, { status: 500 });

    await openRoute(page, '/staff/login');
    await submitLogin(page);

    await page.waitForURL('**/staff/intake');
    await expect.poll(() => attempts.length).toBeGreaterThan(0);
  });
});

test.describe('admin login history', () => {
  test.use({ signedInAs: 'admin' });

  test('lists the newest attempt first with role, status and device', async ({
    page,
    pageErrors,
  }) => {
    await mockHistory(page);
    await openRoute(page, '/admin/login-history');

    await expect(
      page.getByRole('table', { name: 'Login history, newest first' }),
    ).toBeVisible();
    await expect(accountColumn(page)).toHaveText([
      'unknown@example.test',
      'admin@ubaguio.edu.ph',
      OFFICE.name,
    ]);

    const failed = rowFor(page, 'unknown@example.test');
    await expect(failed).toContainText('Unknown');
    await expect(failed).toContainText('Failed');
    await expect(failed).toContainText('Invalid credentials');
    await expect(failed).toContainText('Firefox on Linux');

    const admin = rowFor(page, 'admin@ubaguio.edu.ph');
    await expect(admin).toContainText('Central admin');
    await expect(admin).toContainText('Safari on iOS');

    await expect(rowFor(page, OFFICE.name)).toContainText('Office staff');
    expect(pageErrors).toEqual([]);
  });

  test('filters by office, status and date', async ({ page }) => {
    const history = await mockHistory(page);
    await openRoute(page, '/admin/login-history');
    await expect(accountColumn(page)).toHaveCount(3);

    await page.getByLabel('Office or account').selectOption(OFFICE.id);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(accountColumn(page)).toHaveText([OFFICE.name]);
    expect(history.requests.at(-1).p_office_id).toBe(OFFICE.id);

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(accountColumn(page)).toHaveCount(3);

    await page.getByLabel('Status').selectOption('failed');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(accountColumn(page)).toHaveText(['unknown@example.test']);
    expect(history.requests.at(-1).p_status).toBe('failed');

    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByLabel('From', { exact: true }).fill('2026-11-21');
    await page.getByLabel('To', { exact: true }).fill('2026-11-21');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(accountColumn(page)).toHaveText(['admin@ubaguio.edu.ph']);
    const sent = history.requests.at(-1);
    expect(sent.p_date_from).toBe('2026-11-20T16:00:00.000Z');
    expect(sent.p_date_to).toBe('2026-11-21T15:59:59.999Z');
  });

  test('narrows to central admin accounts without an office filter', async ({
    page,
  }) => {
    const history = await mockHistory(page);
    await openRoute(page, '/admin/login-history');

    await page.getByLabel('Office or account').selectOption('central_admin');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(accountColumn(page)).toHaveText(['admin@ubaguio.edu.ph']);
    expect(history.requests.at(-1).p_office_id).toBeNull();
    expect(history.requests.at(-1).p_role).toBe('central_admin');
  });

  test('exports only the visible columns as a timestamped CSV', async ({ page }) => {
    const rows = [{ ...HISTORY[0], user_id: 'secret-user-id' }];
    await mockHistory(page, { rows });
    await openRoute(page, '/admin/login-history');
    await expect(accountColumn(page)).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^login-history-.*\.csv$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const csv = await readFile(path, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('When,Office or account,Role,Status,Failure reason,Device');
    expect(csv).toContain(OFFICE.name);
    expect(csv).toContain('Office staff');
    expect(csv).not.toContain('secret-user-id');
    expect(csv).not.toContain('UB_SECURITY');
  });

  test('prunes a confirmed retention window and reloads the log', async ({ page }) => {
    const history = await mockHistory(page);
    const prunes = await capturePrunes(page, { body: 4 });
    await openRoute(page, '/admin/login-history');
    await expect(accountColumn(page)).toHaveCount(3);
    const requestsBefore = history.requests.length;

    await page.getByLabel('Prune rows older than').selectOption('30');
    await page.getByRole('button', { name: 'Prune login history' }).click();
    await expect(page.getByText('Delete rows older than 30 days? This cannot be undone.')).toBeVisible();
    expect(prunes).toHaveLength(0);

    await page.getByRole('button', { name: 'Confirm prune' }).click();
    await expect.poll(() => prunes.at(-1)?.p_retain_days).toBe(30);
    await expect(page.getByText('Removed 4 rows older than 30 days.')).toBeVisible();
    await expect.poll(() => history.requests.length).toBeGreaterThan(requestsBefore);
  });

  test('searches the account label and rejects a reversed date range', async ({
    page,
  }) => {
    const history = await mockHistory(page);
    await openRoute(page, '/admin/login-history');

    await page.getByLabel('Account search').fill('  baguio  ');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(accountColumn(page)).toHaveCount(2);
    expect(history.requests.at(-1).p_search).toBe('baguio');

    await page.getByLabel('From', { exact: true }).fill('2026-11-22');
    await page.getByLabel('To', { exact: true }).fill('2026-11-21');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(
      page.getByText('The from date must be on or before the to date.'),
    ).toBeVisible();
    // The list is unchanged; no request went out for the invalid range.
    expect(history.requests.at(-1).p_date_from).toBeNull();
    await expect(accountColumn(page)).toHaveCount(2);
  });

  test('offers an empty state and recovers from a failed load', async ({
    page,
  }) => {
    const history = await mockHistory(page, { rows: [], failFirst: true });
    await openRoute(page, '/admin/login-history');

    await expect(
      page.getByRole('heading', { name: 'Could not load login history' }),
    ).toBeVisible();

    history.recover();
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(
      page.getByText('No sign-in activity matches these filters.'),
    ).toBeVisible();
  });

  test('renders without horizontal overflow at this viewport', async ({
    page,
  }) => {
    await mockHistory(page);
    await openRoute(page, '/admin/login-history');
    await expect(accountColumn(page)).toHaveCount(3);

    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe('login history tab on the office directory', () => {
  test.use({ signedInAs: 'admin' });

  test('opens the history without leaving the directory and fits the viewport', async ({
    page,
  }) => {
    await mockHistory(page);
    await openRoute(page, '/admin/offices');

    await page.getByRole('tab', { name: 'Login history' }).click();

    await expect(accountColumn(page)).toHaveText([
      'unknown@example.test',
      'admin@ubaguio.edu.ph',
      OFFICE.name,
    ]);
    expect(await horizontalOverflow(page)).toBe(0);

    await page.getByRole('tab', { name: 'Offices & logins' }).click();
    await expect(
      page.getByRole('button', { name: 'Add an office' }),
    ).toBeVisible();
  });
});

test.describe('login history access control', () => {
  test.use({ signedInAs: 'office' });

  test('blocks an office session and makes no history request', async ({
    page,
  }) => {
    const history = await mockHistory(page);
    await openRoute(page, '/admin/login-history');

    await expect(
      page.getByRole('heading', { name: 'Central admin only' }),
    ).toBeVisible();
    expect(history.requests).toHaveLength(0);
  });
});

test.describe('login history for a signed-out visitor', () => {
  test.use({ signedInAs: null });

  test('sends the visitor to the staff login', async ({ page }) => {
    await openRoute(page, '/admin/login-history');

    await expect(
      page.getByRole('heading', { name: 'Admin sign-in required' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Go to staff log in' }),
    ).toBeVisible();
  });
});
