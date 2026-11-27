import AxeBuilder from '@axe-core/playwright';
import { test, expect, ROUTES, openRoute } from './fixtures.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function expectNoA11yViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

for (const { path, role } of ROUTES) {
  test.describe(`a11y ${path}`, () => {
    test.use({ signedInAs: role });

    for (const theme of ['light', 'dark']) {
      test(`${theme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openRoute(page, path);

        if (role) {
          // The gate let the session through, so the real page is audited.
          await expect(
            page.getByRole('link', { name: 'Go to staff log in' }),
          ).toHaveCount(0);
        }

        await expectNoA11yViolations(page);

        // One h1, and no heading level skipped on the way down.
        const levels = await page
          .locator('h1, h2, h3, h4, h5, h6')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => node.checkVisibility())
              .map((node) => Number(node.tagName[1])),
          );
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
        levels.forEach((level, index) => {
          if (index > 0)
            expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
        });

        // Every form control a user can reach is named by a visible <label for>
        // pointing at its id. Controls in a closed dialog, or hidden from
        // assistive tech behind a labelled button, are not reachable.
        const unlabelled = await page
          .locator(
            'input:not([type=hidden]):not([type=submit]), select, textarea',
          )
          .evaluateAll((controls) =>
            controls
              .filter((control) => control.checkVisibility())
              .filter(
                (control) => control.getAttribute('aria-hidden') !== 'true',
              )
              .filter((control) => {
                const label =
                  control.id &&
                  document.querySelector(
                    `label[for="${CSS.escape(control.id)}"]`,
                  );
                return !label || !label.checkVisibility();
              })
              .map((control) => control.outerHTML.slice(0, 80)),
          );
        expect(unlabelled).toEqual([]);
      });
    }
  });
}

test('browse masks Documents / IDs titles and photos', async ({ page }) => {
  await openRoute(page, '/browse');
  await expect(page.getByRole('heading', { name: 'Documents / IDs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Juan Dela Cruz ID' })).toHaveCount(0);
  await expect(page.locator('img[alt="Photo of Juan Dela Cruz ID"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
});

test.describe('a11y /staff/intake receipt with lost-report flags', () => {
  test.use({ signedInAs: 'office' });

  for (const theme of ['light', 'dark']) {
    test(`${theme} theme`, async ({ page }) => {
      // US-16 [REQ-008 -> FR-002, NFR-002, UR-003]: the flags panel only
      // exists on a completed receipt, so the audit runs after a real intake.
      await page.emulateMedia({ colorScheme: theme });
      await page.route('**/caption/image', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ caption: 'A black folding umbrella.' }),
        }),
      );
      await page.route('**/rest/v1/rpc/submit_staff_custody', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { ref_code: 'BS-0311', item_id: 'e2e-item-a11y' },
          ]),
        }),
      );
      await page.route('**/rest/v1/rpc/match_lost_reports', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
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
          ]),
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
        page.getByRole('heading', { name: 'Possible lost-item matches' }),
      ).toBeVisible();

      await expectNoA11yViolations(page);

      // One h1, and no heading level skipped on the way down (the receipt's
      // h2, the panel's h3, and the announcement draft's h3 all sit under it).
      const levels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.checkVisibility())
            .map((node) => Number(node.tagName[1])),
        );
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      levels.forEach((level, index) => {
        if (index > 0) expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
      });
    });
  }
});

test.describe('a11y /staff/intake receipt for Documents / IDs', () => {
  test.use({ signedInAs: 'office' });

  for (const theme of ['light', 'dark']) {
    test(`${theme} theme`, async ({ page }) => {
      // #106: this receipt's announcement draft has no photo or photo button.
      await page.emulateMedia({ colorScheme: theme });
      await page.route('**/caption/image', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ caption: 'A UB ID card.' }),
        }),
      );
      await page.route('**/rest/v1/rpc/submit_staff_custody', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { ref_code: 'BS-0312', item_id: 'e2e-item-a11y-document' },
          ]),
        }),
      );

      await openRoute(page, '/staff/intake');
      await page.locator('form input[type=file]').setInputFiles({
        name: 'id.png',
        mimeType: 'image/png',
        buffer: PNG_1PX,
      });
      await page.getByLabel('Item title').fill('Juan Dela Cruz UB ID');
      await page.getByLabel('Category').selectOption('Documents / IDs');
      await page.getByLabel('Storage location').fill('Locker 3, Bin C');
      await page.getByRole('button', { name: 'Take into custody' }).click();
      await expect(page.getByLabel('English announcement')).toHaveValue(
        /Found a document or ID at/,
      );

      await expectNoA11yViolations(page);
    });
  }
});

test.describe('a11y /staff/login errors', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openRoute(page, '/staff/login');

      await page.getByRole('button', { name: 'Sign in', exact: true }).click();

      const emailField = page.locator('.field').filter({
        has: page.getByLabel('Email', { exact: true }),
      });
      const passwordField = page.locator('.field').filter({
        has: page.getByLabel('Password', { exact: true }),
      });
      await expect(emailField.locator('.form-error')).toHaveText(
        'Enter the office email.',
      );
      await expect(passwordField.locator('.form-error')).toHaveText(
        'Enter the office password.',
      );

      await expectNoA11yViolations(page);
    });
  }
});
