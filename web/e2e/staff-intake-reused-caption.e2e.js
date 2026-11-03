import { test, expect, openRoute } from './fixtures.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const REPORT = {
  id: '22222222-2222-2222-2222-222222222222',
  ref_code: 'FR-0201',
  short_note: 'Black folding umbrella with a wooden handle',
  found_location: 'Malcolm Square, near the stage',
  found_date: '2026-09-30',
  finder_contact: '0917 000 0000',
  image_url: 'https://example.test/report-a.webp',
  created_at: '2026-09-30T08:00:00Z',
};

async function mockReport(page, onConvert = () => {}) {
  let converted = false;
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
    onConvert(route.request().postDataJSON());
    converted = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('BS-0201'),
    });
  });
  await page.route(REPORT.image_url, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );
}

async function fillRequiredFields(page) {
  await page.getByLabel('Category').selectOption('General');
  await page.getByLabel('Storage location').fill('Locker 2, Bin B');
}

test.describe('staff intake reused-photo caption', () => {
  test.use({ signedInAs: 'office' });

  test('captions a reused report photo and submits the accepted suggestion', async ({
    page,
  }) => {
    const suggestion = 'A black folding umbrella with a wooden handle.';
    const submissions = [];

    await mockReport(page, (body) => submissions.push(body));
    await page.route('**/caption/image', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ caption: suggestion }),
      }),
    );

    await openRoute(page, '/staff/intake');

    const captionRequest = page.waitForResponse('**/caption/image');
    await page.getByRole('button', { name: /FR-0201/ }).click();
    expect((await captionRequest).status()).toBe(200);

    await expect(
      page.getByText('Suggested description from the photo'),
    ).toBeVisible();
    await expect(page.locator('.caption-suggestion__text')).toHaveText(
      suggestion,
    );

    const notes = page.getByLabel('Private verification notes');
    await expect(notes).toHaveValue(REPORT.short_note);

    await page.getByRole('button', { name: 'Use this description' }).click();
    await expect(notes).toHaveValue(suggestion);

    await fillRequiredFields(page);
    await page.getByRole('button', { name: 'Take into custody' }).click();

    await expect(page.getByText('BS-0201')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      p_found_report_id: REPORT.id,
      p_ai_caption: suggestion,
    });
  });

  test('surfaces retry for a reused photo when the caption service fails', async ({
    page,
  }) => {
    const suggestion = 'A black folding umbrella with a wooden handle.';
    const submissions = [];
    let attempts = 0;

    await mockReport(page, (body) => submissions.push(body));
    await page.route('**/caption/image', (route) => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'model offline' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ caption: suggestion }),
      });
    });

    await openRoute(page, '/staff/intake');

    const firstRequest = page.waitForResponse('**/caption/image');
    await page.getByRole('button', { name: /FR-0201/ }).click();
    expect((await firstRequest).status()).toBe(503);

    await expect(page.getByText('We could not read this photo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('.form-error')).toHaveCount(0);
    await expect(page.getByLabel('Private verification notes')).toHaveValue(
      REPORT.short_note,
    );

    const retryRequest = page.waitForResponse('**/caption/image');
    await page.getByRole('button', { name: 'Try again' }).click();
    expect((await retryRequest).status()).toBe(200);

    await expect(page.locator('.caption-suggestion__text')).toHaveText(
      suggestion,
    );
    await expect(page.getByLabel('Private verification notes')).toHaveValue(
      REPORT.short_note,
    );

    await fillRequiredFields(page);
    await page.getByRole('button', { name: 'Take into custody' }).click();

    await expect(page.getByText('BS-0201')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      p_found_report_id: REPORT.id,
      p_ai_caption: suggestion,
    });
  });
});
