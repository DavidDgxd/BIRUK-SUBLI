import { test, expect, openRoute } from './fixtures.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ signedInAs: 'office' });

test('cash intake requires finder details and shows the six-month reward date', async ({
  page,
}) => {
  const submits = [];
  await page.route('**/rest/v1/rpc/submit_staff_custody', (route) => {
    submits.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ref_code: 'BS-0401', item_id: 'e2e-cash-item' }]),
    });
  });
  await page.route('**/caption/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: 'A brown envelope on a counter.' }),
    }),
  );

  await openRoute(page, '/staff/intake');
  await page.getByLabel('Item title').fill('Brown envelope');
  await page.getByLabel('Category').selectOption('Cash');
  await page.getByLabel('Storage location').fill('Locker 1, Bin A');
  await page
    .getByLabel('Private verification notes')
    .fill('Brown envelope with a rubber band.');
  await page.getByLabel('Date received').fill('2026-01-15');
  await page.getByLabel('Cash amount').fill('1250.50');
  await page.locator('form input[type=file]').setInputFiles({
    name: 'envelope.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });

  const finderName = page.getByLabel(/Finder.s name/);
  const finderContact = page.getByLabel(/Finder.s contact/);
  await expect(finderName).toHaveAttribute('required', '');
  await expect(finderContact).toHaveAttribute('required', '');

  // Saving without the finder details is blocked with inline field messages.
  await page.getByRole('button', { name: 'Take into custody' }).click();
  await expect(page.getByText('Enter the finder’s name')).toBeVisible();
  await expect(
    page.getByText('Enter the finder’s phone number or email'),
  ).toBeVisible();
  expect(submits).toHaveLength(0);

  await finderName.fill('Juan dela Cruz');
  await finderContact.fill('0917 555 1234');
  await page.getByRole('button', { name: 'Take into custody' }).click();

  await expect(
    page.getByRole('heading', { name: 'Item taken into custody' }),
  ).toBeVisible();
  expect(submits).toHaveLength(1);
  expect(submits[0]).toMatchObject({
    p_category: 'Cash',
    p_date_received: '2026-01-15',
    p_cash_amount: 1250.5,
    p_finder_name: 'Juan dela Cruz',
    p_finder_contact: '0917 555 1234',
  });

  // The receipt shows the derived reward date, but not the finder or amount.
  const details = page.locator('.receipt-details');
  await expect(details).toContainText('Reward date');
  await expect(details).toContainText('2026-07-15');
  await expect(details).not.toContainText('Juan dela Cruz');
  await expect(details).not.toContainText('0917 555 1234');
  await expect(details).not.toContainText('1,250.50');

  const english = await page.getByLabel('English announcement').inputValue();
  expect(english).toContain('Found cash at');
  expect(english).toContain('Category: Cash');
  expect(english).not.toMatch(/1,?250|1250|Juan|0917|juan@/i);

  // #106: like public browse, the cash photo and its caption stay off the post.
  expect(english).not.toContain('brown envelope on a counter');
  const draft = page.getByRole('region', { name: 'Announcement draft' });
  await expect(draft.locator('img')).toHaveCount(0);
  await expect(draft.getByRole('button', { name: /Copy photo/ })).toHaveCount(0);
});
