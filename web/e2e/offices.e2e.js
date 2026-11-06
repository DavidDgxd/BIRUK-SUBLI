import AxeBuilder from '@axe-core/playwright';
import { test, expect, OFFICE, openRoute } from './fixtures.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Fails with the offending rule ids and selectors, not just a bare diff. */
async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('opens the public directory and lists each office address and hours', async ({
  page,
}) => {
  await openRoute(page, '/');
  await page.getByRole('link', { name: 'Offices' }).click();
  await expect(page).toHaveURL(/\/offices$/);
  await expect(
    page.getByRole('heading', { name: 'Drop-off offices' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: OFFICE.name }),
  ).toBeVisible();
  await expect(page.getByText(OFFICE.address)).toBeVisible();
  await expect(page.getByText(OFFICE.counter_hours)).toBeVisible();
});

test('shows an empty state when no offices are published', async ({ page }) => {
  await page.route('**/rest/v1/offices*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    }),
  );
  await openRoute(page, '/offices');
  await expect(
    page.getByRole('heading', { name: 'No offices listed yet' }),
  ).toBeVisible();
});

test('offers a retry when the directory cannot load', async ({ page }) => {
  let attempts = 0;
  await page.route('**/rest/v1/offices*', (route) => {
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'database unavailable' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([OFFICE]),
    });
  });

  await openRoute(page, '/offices');
  await expect(
    page.getByRole('heading', { name: 'Could not load offices' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: OFFICE.name })).toBeVisible();
});

test('lists drop-off offices on the found-report receipt', async ({ page }) => {
  await page.route('**/rest/v1/rpc/submit_found_report', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('FR-0100'),
    }),
  );

  await openRoute(page, '/report/found');
  await page.getByLabel('What did you find?').fill('Black leather wallet');
  await page.getByLabel('Where did you find it?').fill('Session Road');
  await page
    .locator('form input[type=file]')
    .setInputFiles({ name: 'wallet.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByRole('heading', { name: 'Report received' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('FR-0100')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where to hand it in' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: OFFICE.name }),
  ).toBeVisible();
  await expect(page.getByText(OFFICE.address)).toBeVisible();
  await expect(page.getByText(OFFICE.counter_hours)).toBeVisible();
});

/*
 * The shared /offices route audit in a11y.e2e.js only ever sees the populated
 * directory. These cover the two states a visitor can land in when the table is
 * empty or the read fails, in both themes.
 */
for (const theme of ['light', 'dark']) {
  test.describe(`offices states in the ${theme} theme`, () => {
    test('empty directory passes the axe audit', async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.route('**/rest/v1/offices*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        }),
      );

      await openRoute(page, '/offices');
      await expect(
        page.getByRole('heading', { name: 'No offices listed yet' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('error state and its retry action pass the axe audit', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.route('**/rest/v1/offices*', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'database unavailable' }),
        }),
      );

      await openRoute(page, '/offices');
      await expect(
        page.getByRole('heading', { name: 'Could not load offices' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Try again' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
