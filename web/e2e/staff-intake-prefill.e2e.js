import { test, expect, openRoute } from './fixtures.js';

const REPORT = {
  id: '11111111-1111-1111-1111-111111111111',
  ref_code: 'FR-0101',
  short_note: 'Black folding umbrella with a wooden handle',
  found_location: 'Malcolm Square, near the stage',
  found_date: '2026-09-30',
  finder_contact: '0917 000 0000',
  image_url: 'https://example.test/found-report.webp',
  created_at: '2026-09-30T08:00:00Z',
};

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('staff intake prefill (US-10)', () => {
  test.use({ signedInAs: 'office' });

  test('selecting a pending self-report copies its photo and note, then converts it', async ({
    page,
  }) => {
    let converted = false;
    const submissions = [];

    await page.route('https://example.test/found-report.webp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PNG_1PX,
      }),
    );

    await page.route('**/rest/v1/found_reports**', (route) => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(converted ? [] : [REPORT]),
      });
    });

    await page.route('**/rest/v1/rpc/submit_staff_custody', (route) => {
      submissions.push(route.request().postDataJSON());
      converted = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify('BS-0115'),
      });
    });

    await page.route('**/embed/text', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ vector: Array.from({ length: 512 }, () => 0) }),
      }),
    );

    await openRoute(page, '/staff/intake');

    await expect(
      page.getByRole('heading', { name: 'Pending self-reports' }),
    ).toBeVisible();
    await expect(page.getByText('FR-0101')).toBeVisible();

    await page
      .getByRole('button', { name: /FR-0101/ })
      .click();

    await expect(
      page.getByText('Pre-filled from self-report FR-0101'),
    ).toBeVisible();
    await expect(page.getByLabel('Item title')).toHaveValue(REPORT.short_note);
    await expect(page.getByLabel('Private verification notes')).toHaveValue(
      REPORT.short_note,
    );
    await expect(page.locator('.photo-chip__img')).toHaveAttribute(
      'src',
      REPORT.image_url,
    );

    await page.getByLabel('Category').selectOption('General');
    await page.getByLabel('Storage location').fill('Locker 2, Bin B');
    await page.getByRole('button', { name: 'Take into custody' }).click();

    await expect(page.getByText('BS-0115')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      p_found_report_id: REPORT.id,
      p_image_url: REPORT.image_url,
      p_title: REPORT.short_note,
    });

    await expect(
      page.getByText('No pending self-reports. Start the intake form below.'),
    ).toBeVisible();
  });

  test('keeps fields already entered when a report is selected', async ({
    page,
  }) => {
    await page.route('**/rest/v1/found_reports**', (route) => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ...REPORT, image_url: null }]),
      });
    });

    await openRoute(page, '/staff/intake');

    await page.getByLabel('Category').selectOption('Electronics');
    await page.getByLabel('Storage location').fill('Locker 9');
    await page.getByLabel('Date received').fill('2026-09-29');

    await page.getByRole('button', { name: /FR-0101/ }).click();

    await expect(page.getByLabel('Item title')).toHaveValue(REPORT.short_note);
    await expect(page.getByLabel('Category')).toHaveValue('Electronics');
    await expect(page.getByLabel('Storage location')).toHaveValue('Locker 9');
    await expect(page.getByLabel('Date received')).toHaveValue('2026-09-29');

    await page.getByLabel('Storage location').fill('Locker 10');
    await page.getByRole('button', { name: /FR-0101/ }).click();

    await expect(page.getByLabel('Storage location')).toHaveValue('Locker 10');
  });

  test('loads pending self-reports a page at a time', async ({ page }) => {
    const reports = Array.from({ length: 25 }, (_, index) => ({
      id: `report-${index + 1}`,
      ref_code: `FR-${String(index + 1).padStart(4, '0')}`,
      short_note: `Pending report ${index + 1}`,
      found_location: 'City Hall',
      found_date: '2026-09-30',
      finder_contact: '0917 000 0000',
      image_url: null,
      created_at: '2026-09-30T08:00:00Z',
    }));

    await page.route('**/rest/v1/found_reports**', (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const pageReports = reports.slice(offset, offset + limit);
      const end = pageReports.length ? offset + pageReports.length - 1 : 0;

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
          'content-range': `${offset}-${end}/${reports.length}`,
        },
        body: JSON.stringify(pageReports),
      });
    });

    await openRoute(page, '/staff/intake');

    await expect(page.getByText('25 waiting')).toBeVisible();
    await expect(page.locator('.pending-report')).toHaveCount(20);
    await expect(page.getByText('FR-0021')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show 5 more' }).click();

    await expect(page.locator('.pending-report')).toHaveCount(25);
    await expect(page.getByText('FR-0025')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Show .* more/ }),
    ).toHaveCount(0);
  });
});
