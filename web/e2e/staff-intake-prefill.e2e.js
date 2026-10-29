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
});
