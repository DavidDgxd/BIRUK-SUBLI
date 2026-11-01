import { test, expect, openRoute } from './fixtures.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ signedInAs: 'office' });

test('suggests a description from a newly logged photo and lets staff edit it', async ({
  page,
}) => {
  const suggestion = 'A brown leather wallet sitting on a table.';

  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: suggestion }),
    }),
  );

  await openRoute(page, '/staff/intake');

  const notes = page.getByLabel('Private verification notes');
  const input = page.locator('form input[type=file]');

  await input.setInputFiles({
    name: 'wallet.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });

  await expect(
    page.getByText('Suggested description from the photo'),
  ).toBeVisible();
  await expect(page.locator('.caption-suggestion__text')).toHaveText(suggestion);
  await expect(notes).toHaveValue(suggestion);

  await notes.fill('Brown wallet with a torn inner lining.');

  await expect(notes).toHaveValue('Brown wallet with a torn inner lining.');
  await expect(
    page.getByRole('button', { name: 'Use this description' }),
  ).toBeVisible();
});

test('does not overwrite notes the staffer already typed', async ({ page }) => {
  const suggestion = 'A black umbrella.';

  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: suggestion }),
    }),
  );

  await openRoute(page, '/staff/intake');

  const notes = page.getByLabel('Private verification notes');
  await notes.fill('Serial number 1234 on the handle.');

  await page.locator('form input[type=file]').setInputFiles({
    name: 'umbrella.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });

  await expect(page.locator('.caption-suggestion__text')).toHaveText(suggestion);
  await expect(notes).toHaveValue('Serial number 1234 on the handle.');

  await page.getByRole('button', { name: 'Use this description' }).click();
  await expect(notes).toHaveValue(suggestion);
});
