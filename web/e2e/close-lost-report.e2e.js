import { test, expect, openRoute } from './fixtures.js';

const CLOSE_MESSAGE = 'Report not found or invalid close link.';
const RETRY_MESSAGE = 'Unable to reach the server right now. Please try again.';

/**
 * Answer one Supabase RPC before the fixture's catch-all sees it, recording the
 * exact JSON body so a test can assert what the app sent, not just how often.
 */
async function mockRpc(page, name, handler) {
  const calls = [];
  await page.route(`**/rest/v1/rpc/${name}`, async (route) => {
    const request = route.request();
    calls.push(request.postDataJSON());
    const body = await handler(request);
    await route.fulfill({
      status: body.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(body.json),
    });
  });
  return calls;
}

function ok(json) {
  return { json };
}

function failure(code, message, status = 400) {
  return { status, json: { code, message } };
}

test.describe('lost report submission receipt', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('shows the reference code and copies the private close link', async ({
    page,
  }) => {
    const calls = await mockRpc(page, 'submit_lost_report', () =>
      ok([{ ref_code: 'LR-0100', close_key: 'secret-close-key' }]),
    );

    await openRoute(page, '/report/lost');
    await page.getByLabel('What did you lose?').fill('Blue backpack with a logo');
    await page
      .getByLabel('Where do you think you lost it?')
      .fill('Session Road');
    await page.locator('form [type=submit]').click();

    await expect(
      page.getByRole('heading', { name: 'Save your receipt' }),
    ).toBeVisible();
    await expect(page.locator('.receipt')).toHaveText('LR-0100');

    const closeLink = page.getByLabel('Private close link');
    await expect(closeLink).toHaveValue(
      /\/close-report\?ref=LR-0100&key=secret-close-key$/,
    );
    await expect(page.getByText(/shown only once/i)).toBeVisible();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      p_description: 'Blue backpack with a logo',
      p_area_route: 'Session Road',
      p_contact_info: null,
      p_image_url: null,
    });
    expect(calls[0].p_date_lost).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls[0].p_embedding).toHaveLength(512);

    await page.getByRole('button', { name: 'Copy close link' }).click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    await expect(
      page.getByText('Private close link copied.'),
    ).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('/close-report?ref=LR-0100&key=secret-close-key');
  });

  test('selects the link when the clipboard is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error('clipboard blocked')),
          readText: () => Promise.resolve(''),
        },
      });
    });
    await mockRpc(page, 'submit_lost_report', () =>
      ok([{ ref_code: 'LR-0100', close_key: 'secret-close-key' }]),
    );

    await openRoute(page, '/report/lost');
    await page.getByLabel('What did you lose?').fill('Blue backpack');
    await page.getByLabel('Where do you think you lost it?').fill('Session Road');
    await page.locator('form [type=submit]').click();

    await page.getByRole('button', { name: 'Copy close link' }).click();

    await expect(
      page.getByText(/Copy is blocked here.*Ctrl\+C/),
    ).toBeVisible();
    const closeLink = page.getByLabel('Private close link');
    await expect(closeLink).toBeFocused();
    const [start, end, length] = await closeLink.evaluate((input) => [
      input.selectionStart,
      input.selectionEnd,
      input.value.length,
    ]);
    expect([start, end]).toEqual([0, length]);
  });
});

test.describe('public self-close page', () => {
  test('never closes on load and sends both secrets only after confirmation', async ({
    page,
  }) => {
    const calls = await mockRpc(page, 'close_lost_report_by_key', () =>
      ok([
        {
          ref_code: 'LR-0100',
          status: 'closed',
          closed_at: '2026-11-15T08:00:00Z',
        },
      ]),
    );

    await openRoute(page, '/close-report?ref=LR-0100&key=secret-close-key');

    await expect(
      page.getByRole('heading', { name: 'Close your lost report' }),
    ).toBeVisible();
    await expect(page.getByLabel('Reference code')).toHaveValue('LR-0100');
    await expect(page.getByLabel('Private close key')).toHaveValue(
      'secret-close-key',
    );
    expect(calls).toHaveLength(0);

    await page.getByRole('button', { name: 'Confirm Close Report' }).click();

    await expect(
      page.getByRole('heading', { name: 'Report closed' }),
    ).toBeVisible();
    await expect(page.getByText(/Offices will no longer match/i)).toBeVisible();
    expect(calls).toEqual([
      { p_ref_code: 'LR-0100', p_close_key: 'secret-close-key' },
    ]);
  });

  test('is idempotent when the report was already closed', async ({ page }) => {
    const calls = await mockRpc(page, 'close_lost_report_by_key', () =>
      ok([
        {
          ref_code: 'LR-0100',
          status: 'closed',
          closed_at: '2026-11-01T00:00:00Z',
        },
      ]),
    );

    await openRoute(page, '/close-report?ref=LR-0100&key=secret-close-key');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();

    await expect(
      page.getByRole('heading', { name: 'Report closed' }),
    ).toBeVisible();
    await expect(
      page.getByText('Opening this link again will not change anything.'),
    ).toBeVisible();
    // No error and no second write: the RPC returned the existing closure.
    await expect(page.locator('.form-error')).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });

  test('shows the identical error for a wrong key, a missing key and an unknown ref', async ({
    page,
  }) => {
    const calls = await mockRpc(page, 'close_lost_report_by_key', () =>
      failure('P0002', CLOSE_MESSAGE),
    );

    const messages = [];

    await openRoute(page, '/close-report?ref=LR-0100&key=wrong-key');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();
    await expect(page.locator('.form-error')).toBeVisible();
    messages.push((await page.locator('.form-error').innerText()).trim());

    await openRoute(page, '/close-report?ref=LR-9999&key=any-key');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();
    await expect(page.locator('.form-error')).toBeVisible();
    messages.push((await page.locator('.form-error').innerText()).trim());

    // Missing key: the page refuses before touching the network.
    await openRoute(page, '/close-report?ref=LR-0100');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();
    await expect(page.locator('.form-error')).toBeVisible();
    messages.push((await page.locator('.form-error').innerText()).trim());

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      p_ref_code: 'LR-0100',
      p_close_key: 'wrong-key',
    });
    expect(messages[0]).toBe(CLOSE_MESSAGE);
    expect(new Set(messages).size).toBe(1);
  });

  test('moves focus to the error alert on the first failure', async ({
    page,
  }) => {
    await mockRpc(page, 'close_lost_report_by_key', () =>
      failure('P0002', CLOSE_MESSAGE),
    );

    await openRoute(page, '/close-report?ref=LR-0100&key=wrong-key');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(alert).toHaveText(CLOSE_MESSAGE);

    // The inputs point at the alert so a screen reader reads it with the field.
    await expect(page.getByLabel('Reference code')).toHaveAttribute(
      'aria-describedby',
      /.+/,
    );
    await expect(page.getByLabel('Reference code')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('offers a retry instead of calling an outage an invalid link', async ({
    page,
  }) => {
    await mockRpc(page, 'close_lost_report_by_key', () =>
      failure('500', 'Internal Server Error', 500),
    );

    await openRoute(page, '/close-report?ref=LR-0100&key=secret-close-key');
    await page.getByRole('button', { name: 'Confirm Close Report' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(RETRY_MESSAGE);
    await expect(alert).not.toHaveText(CLOSE_MESSAGE);
  });
});

test.describe('staff counter lookup', () => {
  test.use({ signedInAs: 'office' });

  // An over-sharing row: the UI must not render the extra fields even when a
  // stale deployment still sends them.
  const foundReport = {
    ref_code: 'LR-0100',
    description: 'Blue backpack with a logo',
    area_route: 'Session Road',
    date_lost: '2026-11-10',
    status: 'open',
    contact_info: '0917 000 0000',
    close_key: 'secret-close-key',
    created_at: '2026-11-10T08:00:00Z',
  };

  test('looks up a ref code and closes only after confirmation', async ({
    page,
  }) => {
    const lookups = await mockRpc(
      page,
      'staff_lookup_lost_report',
      () => ok([foundReport]),
    );
    const closes = await mockRpc(page, 'staff_close_lost_report', () =>
      ok([
        {
          ref_code: 'LR-0100',
          status: 'closed',
          closed_at: '2026-11-15T08:00:00Z',
        },
      ]),
    );

    await openRoute(page, '/staff/items');
    await expect(
      page.getByRole('heading', { name: 'Close Lost Report (Counter Lookup)' }),
    ).toBeVisible();

    await page.getByLabel('Citizen reference code').fill('lr-0100');
    await page.getByRole('button', { name: 'Look Up' }).click();

    await expect(page.getByText('Blue backpack with a logo')).toBeVisible();
    await expect(page.getByText('Session Road')).toBeVisible();
    await expect(page.getByText('open', { exact: true })).toBeVisible();
    expect(closes).toHaveLength(0);

    expect(lookups).toEqual([{ p_ref_code: 'LR-0100' }]);

    // PII and the bearer secret must never reach the DOM.
    const panel = page.locator('.counter-close');
    await expect(panel.getByText('0917 000 0000')).toHaveCount(0);
    await expect(panel.getByText('secret-close-key')).toHaveCount(0);
    expect(await panel.innerText()).not.toMatch(/close_key|contact_info/i);

    await page.getByRole('button', { name: 'Close Report' }).click();
    await expect(
      page.getByText('Close this report for the citizen?'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Yes, close report' }).click();

    await expect(
      page.getByText(/Report closed\. Offices will no longer match/i),
    ).toBeVisible();
    expect(closes).toEqual([{ p_ref_code: 'LR-0100' }]);
  });

  test('leaves a report that is not open untouched', async ({ page }) => {
    const lookups = await mockRpc(page, 'staff_lookup_lost_report', () =>
      ok([{ ...foundReport, status: 'resolved' }]),
    );
    const closes = await mockRpc(page, 'staff_close_lost_report', () =>
      ok([{ ref_code: 'LR-0100', status: 'resolved', closed_at: null }]),
    );

    await openRoute(page, '/staff/items');
    await page.getByLabel('Citizen reference code').fill('LR-0100');
    await page.getByRole('button', { name: 'Look Up' }).click();

    await expect(
      page.getByText('This report is resolved; there is nothing to close.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close Report' }),
    ).toHaveCount(0);
    expect(lookups).toHaveLength(1);
    expect(closes).toHaveLength(0);
  });

  test('reports a ref code that does not exist', async ({ page }) => {
    const lookups = await mockRpc(page, 'staff_lookup_lost_report', () =>
      ok([]),
    );

    await openRoute(page, '/staff/items');
    await page.getByLabel('Citizen reference code').fill('LR-9999');
    await page.getByRole('button', { name: 'Look Up' }).click();

    await expect(
      page.getByText('No lost report found for that reference code.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close Report' }),
    ).toHaveCount(0);
    expect(lookups).toEqual([{ p_ref_code: 'LR-9999' }]);
  });
});
