import { test, expect, openRoute } from './fixtures.js';

/*
 * US-16: possible lost-item matches on the custody receipt.
 *
 * Every flow completes a real intake first, because the panel only exists on
 * the receipt of a submitted item. The submit mock returns the one-row array
 * PostgREST sends for `returns table (ref_code, item_id)`, and the match and
 * dismiss RPCs are mocked per test. The advisory rule under test throughout:
 * a failed or refused match never blocks or undoes a completed intake.
 *
 * The dev-mock session's unavailable copy needs VITE_STAFF_DEV_SESSION baked
 * into the build, which the preview server never sets, so the unavailable
 * phase is covered through its other trigger: a receipt without an item id.
 */

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ITEM_ID = 'e2e-item-flags';

const MATCHES = [
  {
    lost_report_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1',
    ref_code: 'LR-0301',
    description: 'Black folding umbrella with a wooden handle',
    image_url: null,
    area_route: 'Session Road',
    date_lost: '2026-09-28',
    contact_info: '0918 111 1111',
    similarity: 0.82,
  },
  {
    lost_report_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2',
    ref_code: 'LR-0302',
    description: 'Foldable umbrella, dark fabric',
    image_url: null,
    area_route: 'Burnham Park',
    date_lost: '2026-09-30',
    contact_info: null,
    similarity: 0.61,
  },
];

function submitRoute(page, row = { ref_code: 'BS-0301', item_id: ITEM_ID }) {
  return page.route('**/rest/v1/rpc/submit_staff_custody', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([row]),
    }),
  );
}

function matchRoute(page, handler) {
  return page.route('**/rest/v1/rpc/match_lost_reports', (route) =>
    handler(route),
  );
}

/** Completes an intake so the receipt (and its flags panel) renders. */
async function completeIntake(page) {
  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: 'A black folding umbrella.' }),
    }),
  );
  await openRoute(page, '/staff/intake');
  await page.locator('form input[type=file]').setInputFiles({
    name: 'umbrella.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await page.getByLabel('Item title').fill('Black folding umbrella');
  await page.getByLabel('Category').selectOption('General');
  await page.getByLabel('Storage location').fill('Locker 3, Bin A');
  await page.getByRole('button', { name: 'Take into custody' }).click();
  await expect(
    page.getByRole('heading', { name: 'Item taken into custody' }),
  ).toBeVisible();
}

test.describe('staff intake lost-report flags (US-16)', () => {
  test.use({ signedInAs: 'office' });

  test('lists flagged open lost reports with every field the staffer needs', async ({
    page,
  }) => {
    // [REQ-008 -> FR-002, NFR-002, UR-003 | REQ-010 -> FR-005, UR-001]
    const matchCalls = [];
    matchRoute(page, (route) => {
      matchCalls.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MATCHES),
      });
    });
    submitRoute(page);

    await completeIntake(page);

    await expect(
      page.getByRole('heading', { name: 'Possible lost-item matches' }),
    ).toBeVisible();
    await expect(page.getByText('Advisory check only')).toBeVisible();
    await expect(page.getByText('nothing has been sent')).toBeVisible();

    const rows = page.locator('.lost-report-flags .staff-item');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('LR-0301');
    await expect(rows.nth(0)).toContainText('Session Road');
    await expect(rows.nth(0)).toContainText('Contact: 0918 111 1111');
    await expect(rows.nth(0)).toContainText('Lost 28 Sept 2026');
    await expect(rows.nth(0)).toContainText('82% match');
    await expect(rows.nth(1)).toContainText('No contact provided');
    await expect(rows.nth(1)).toContainText('61% match');

    // The panel asks with the item id only: no threshold, count, or vector.
    expect(matchCalls).toHaveLength(1);
    expect(matchCalls[0]).toEqual({ item_id: ITEM_ID });
  });

  test('dismiss removes the row; a failed dismiss keeps it with inline copy', async ({
    page,
  }) => {
    // [REQ-011 -> FR-006, UR-002, NFR-005 | REQ-012 -> FR-008, UR-004]
    let dismissals = 0;
    await page.route('**/rest/v1/rpc/dismiss_lost_report_match', (route) => {
      dismissals += 1;
      if (dismissals === 2) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST123', message: 'refused' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '',
      });
    });
    matchRoute(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MATCHES),
      }),
    );
    submitRoute(page);

    await completeIntake(page);

    await page
      .getByRole('button', { name: 'Dismiss the flag for LR-0301' })
      .click();
    const rows = page.locator('.lost-report-flags .staff-item');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('LR-0302');

    await page
      .getByRole('button', { name: 'Dismiss the flag for LR-0302' })
      .click();
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('LR-0302');
    // The copy also feeds the polite live region, so the assertion reads the
    // inline row error, not every matching text node.
    await expect(page.locator('.lost-report-flags .form-error')).toContainText(
      'We could not dismiss this flag. It is still listed',
    );
  });

  test('no-match state lists nothing and offers no dismiss control', async ({
    page,
  }) => {
    // [REQ-013 -> FR-009, UR-003]
    matchRoute(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      }),
    );
    submitRoute(page);

    await completeIntake(page);

    await expect(
      page.getByText('No close lost-item reports were found for this item.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Dismiss the flag for/ }),
    ).toHaveCount(0);
  });

  test('a failed match never blocks the receipt; retry re-requests matching', async ({
    page,
  }) => {
    // [REQ-012 -> FR-008, UR-004 | REQ-014 -> NFR-004 | REQ-005 -> FR-010]
    let submits = 0;
    await page.route('**/rest/v1/rpc/submit_staff_custody', (route) => {
      submits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ref_code: 'BS-0303', item_id: ITEM_ID }]),
      });
    });
    let matchCalls = 0;
    matchRoute(page, (route) => {
      matchCalls += 1;
      if (matchCalls === 1) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST123', message: 'unavailable' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MATCHES),
      });
    });

    await completeIntake(page);

    // The copy also feeds the polite live region, so the assertion reads the
    // visible hint, not every matching text node.
    await expect(
      page
        .locator('.lost-report-flags .field__hint')
        .filter({ hasText: 'We could not check the lost-item reports' }),
    ).toBeVisible();
    // The intake itself completed: the receipt stands.
    await expect(page.getByText('BS-0303')).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.lost-report-flags .staff-item')).toHaveCount(2);

    // Retry re-runs matching only; custody is never resubmitted.
    expect(matchCalls).toBe(2);
    expect(submits).toBe(1);
  });

  test('a receipt without an item id shows the unavailable state and makes no call', async ({
    page,
  }) => {
    // [REQ-015 -> NFR-003, BR-002, UR-004] The dev-mock copy needs
    // VITE_STAFF_DEV_SESSION baked into the build, which `vite preview` never
    // sets, so the unavailable phase is covered via its no-item-id trigger.
    let matchCalls = 0;
    matchRoute(page, (route) => {
      matchCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });
    submitRoute(page, { ref_code: 'BS-0304' });

    await completeIntake(page);

    // The announcement carries the same sentence in the live region, so the
    // assertion reads the visible hint instead.
    await expect(
      page
        .locator('.lost-report-flags .field__hint')
        .filter({
          hasText: 'Lost-item matching is unavailable for this receipt',
        }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(
      0,
    );
    expect(matchCalls).toBe(0);
  });
});
