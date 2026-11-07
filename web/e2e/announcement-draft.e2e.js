import { test, expect, openRoute } from './fixtures.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/* Every upload is re-encoded to WebP by the bucket (web/src/lib/storage.js), so
 * the photo the clipboard action receives is WebP in production. */
const WEBP_PHOTO = Buffer.from(
  'UklGRhYCAABXRUJQVlA4WAoAAAAgAAAAAQAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggKAAAAJABAJ0BKgIAAgABQCYlmAJ0ugADmAD+8NcD/gN18W0y/1XiDM9ZAAA=',
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
      contentType: 'image/webp',
      body: WEBP_PHOTO,
    }),
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.__copiedPhoto = { types: [], blobType: null };
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    Object.defineProperty(clipboard, 'write', {
      configurable: true,
      value: async (items) => {
        window.__copiedPhoto.types.push(...items.flatMap((item) => item.types));
        // The declared MIME key is always image/png, so read the blob itself to
        // prove the WebP source was actually re-encoded.
        const blob = await items[0].getType('image/png');
        window.__copiedPhoto.blobType = blob?.type ?? null;
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

  // The clicked button keeps focus while the copy completes.
  await expect(
    page.locator('.announcement-draft__actions button:focus'),
  ).toHaveText(/Photo copied/);

  const copied = await page.evaluate(() => window.__copiedPhoto);
  expect(copied.types).toContain('image/png');
  expect(copied.blobType).toBe('image/png');
});
