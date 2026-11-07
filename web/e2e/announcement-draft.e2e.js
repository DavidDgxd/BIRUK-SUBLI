import { test, expect, openRoute } from './fixtures.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const CAPTION = 'A brown leather wallet sitting on a wooden table.';

test.use({ signedInAs: 'office' });

test('drafts, edits and copies a public announcement without private notes', async ({
  page,
}) => {
  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: CAPTION }),
    }),
  );
  await page.route('**/rest/v1/rpc/submit_staff_custody', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('BS-0123'),
    }),
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openRoute(page, '/staff/intake');

  await page.locator('form input[type=file]').setInputFiles({
    name: 'wallet.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await expect(
    page.getByText('Suggested description from the photo'),
  ).toBeVisible();

  await page.getByLabel('Item title').fill('Brown leather wallet');
  await page.getByLabel('Category').selectOption('Bags & Wallets');
  await page.getByLabel('Storage location').fill('Locker 2, Bin B');
  await page
    .getByLabel('Private verification notes')
    .fill('Serial 991287 on the inner flap. Contains a bus card and PHP 500.');
  await page.getByRole('button', { name: 'Take into custody' }).click();

  await expect(
    page.getByRole('heading', { name: 'Item taken into custody' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Announcement draft' }),
  ).toBeVisible();
  const previewPhoto = page.locator('.announcement-draft__photo');
  await expect(previewPhoto).toBeVisible();
  await expect(previewPhoto).toHaveAttribute(
    'alt',
    'Photo of Brown leather wallet',
  );

  const textarea = page.getByLabel('English announcement');
  await expect(textarea).toHaveValue(
    /Found item at Baguio City Public Information Office: Brown leather wallet/,
  );
  await expect(page.getByLabel('Filipino announcement')).toHaveValue(
    /May nakitang bagay sa Baguio City Public Information Office/,
  );

  const draft = await textarea.inputValue();
  expect(draft).toContain(CAPTION);
  expect(draft).not.toMatch(/BS-0123|991287|bus card|PHP 500/);

  const readClipboard = () => page.evaluate(() =>
    navigator.clipboard.readText().then((text) => text.replace(/\r\n/g, '\n')));

  await page.getByRole('button', { name: 'Copy English' }).click();
  await expect(page.getByRole('button', { name: 'English copied' })).toBeVisible();
  await expect.poll(readClipboard).toBe(draft);

  const edited = 'Brown wallet found near Malcolm Square. Ask at the counter.';
  await textarea.fill(edited);
  await page.getByRole('button', { name: 'Copy English' }).click();
  await expect.poll(readClipboard).toBe(edited);
  await expect(page.getByLabel('Filipino announcement')).toHaveValue(
    /May nakitang bagay sa/,
  );
});

test('copies the photo separately as a PNG for Facebook', async ({ page }) => {
  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: CAPTION }),
    }),
  );
  await page.route('**/rest/v1/rpc/submit_staff_custody', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify('BS-0123'),
    }),
  );
  await page.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_1PX,
    }),
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.__copiedPhotoTypes = [];
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    Object.defineProperty(clipboard, 'write', {
      configurable: true,
      value: async (items) => {
        window.__copiedPhotoTypes.push(...items.flatMap((item) => item.types));
      },
    });
  });

  await openRoute(page, '/staff/intake');
  await page.locator('form input[type=file]').setInputFiles({
    name: 'wallet.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await expect(
    page.getByText('Suggested description from the photo'),
  ).toBeVisible();
  await page.getByLabel('Item title').fill('Brown leather wallet');
  await page.getByLabel('Category').selectOption('Bags & Wallets');
  await page.getByLabel('Storage location').fill('Locker 2, Bin B');
  await page.getByRole('button', { name: 'Take into custody' }).click();
  await expect(
    page.getByRole('heading', { name: 'Announcement draft' }),
  ).toBeVisible();

  const photoButton = page.getByRole('button', { name: 'Copy photo (PNG)' });
  await expect(photoButton).toHaveAttribute('aria-disabled', 'false');
  await photoButton.focus();
  await page.keyboard.press('Enter');

  // Focus must stay on the clicked button while the write is in flight.
  await expect(
    page.locator('.announcement-draft__actions button:focus'),
  ).toHaveText(/Photo copied/);

  const types = await page.evaluate(() => window.__copiedPhotoTypes);
  expect(types).toContain('image/png');
  expect(types).not.toContain('image/webp');
});
