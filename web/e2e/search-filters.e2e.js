import { test, expect, openRoute } from './fixtures.js';

const EMBEDDING = Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0));

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ITEMS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    ref_code: 'BS-0001',
    title: 'Black Umbrella at BCPIO',
    category: 'General',
    status: 'held',
    image_url: null,
    holding_office_id: 'BCPIO',
    holding_office_name: 'Baguio City Public Information Office',
    counter_hours: 'Mon–Fri, 8:00–17:00',
    office_address: 'City Hall, Baguio City',
    created_at: '2026-09-10T00:00:00Z',
    similarity: 0.7,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    ref_code: 'BS-0002',
    title: 'Black Umbrella at City Hall Info',
    category: 'General',
    status: 'held',
    image_url: null,
    holding_office_id: 'CITY_HALL_INFO',
    holding_office_name: 'City Hall Information Desk',
    counter_hours: 'Mon–Fri, 8:00–17:00',
    office_address: 'City Hall, Baguio City',
    created_at: '2026-08-10T00:00:00Z',
    similarity: 0.68,
  },
];

test('filters results by holding office and receipt-date range', async ({
  page,
}) => {
  const rpcCalls = [];

  await page.route('**/embed/text', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );

  await page.route('**/rest/v1/rpc/match_items', (route) => {
    const body = route.request().postDataJSON();
    rpcCalls.push(body);

    const filtered = ITEMS.filter(
      (item) =>
        (!body.filter_office ||
          item.holding_office_id === body.filter_office) &&
        (!body.date_from || item.created_at.slice(0, 10) >= body.date_from) &&
        (!body.date_to || item.created_at.slice(0, 10) <= body.date_to),
    );

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filtered),
    });
  });

  await openRoute(page, '/search?q=umbrella');

  await expect(
    page.getByRole('heading', { name: 'Black Umbrella at BCPIO' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Black Umbrella at City Hall Info',
    }),
  ).toBeVisible();
  await expect(page.getByText('2 matches, best first')).toBeVisible();

  await page.getByLabel('Holding office').selectOption('BCPIO');
  await page.getByLabel('Received on or after').fill('2026-09-01');
  await page.getByLabel('Received on or before').fill('2026-09-30');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page.getByText('1 match, best first')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Black Umbrella at BCPIO' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Black Umbrella at City Hall Info',
    }),
  ).toHaveCount(0);

  const applied = rpcCalls.at(-1);
  expect(applied).toMatchObject({
    filter_office: 'BCPIO',
    date_from: '2026-09-01',
    date_to: '2026-09-30',
  });

  await page.getByRole('button', { name: 'Clear filters' }).click();

  await expect(page.getByText('2 matches, best first')).toBeVisible();
  expect(rpcCalls.at(-1)).toMatchObject({
    filter_office: null,
    date_from: null,
    date_to: null,
  });
});

test('rejects a date range whose start is after its end', async ({ page }) => {
  await page.route('**/embed/text', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/rest/v1/rpc/match_items', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ITEMS),
    }),
  );

  await openRoute(page, '/search?q=umbrella');

  await page.getByLabel('Received on or after').fill('2026-09-30');
  await page.getByLabel('Received on or before').fill('2026-09-01');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(
    page.getByText('The start date must be on or before the end date.'),
  ).toBeVisible();
  expect(page.url()).not.toContain('from=2026-09-30');
});

test('edits the search text from the results page and keeps filters', async ({
  page,
}) => {
  await page.route('**/embed/text', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/rest/v1/rpc/match_items', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ITEMS),
    }),
  );

  await openRoute(page, '/search?q=umbrella');

  await page.getByLabel('Holding office').selectOption('BCPIO');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/office=BCPIO/);

  await page
    .getByRole('searchbox', { name: 'Search held items' })
    .fill('wallet');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page).toHaveURL(/q=wallet/);
  await expect(page).toHaveURL(/office=BCPIO/);
});

test('adds a photo from the results page and keeps filters', async ({ page }) => {
  const rpcCalls = [];

  await page.route('**/embed/text', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/embed/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/rest/v1/rpc/match_items', (route) => {
    rpcCalls.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ITEMS),
    });
  });

  await openRoute(page, '/search?q=umbrella');

  await page.getByLabel('Holding office').selectOption('BCPIO');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/office=BCPIO/);

  await page.locator('.search-inline input[type=file]').setInputFiles({
    name: 'wallet.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await expect(page.getByText('wallet.png')).toBeVisible();

  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page).toHaveURL(/q=umbrella/);
  await expect(page).toHaveURL(/office=BCPIO/);
  await expect(page.getByText('Photo attached')).toBeVisible();
  expect(rpcCalls.at(-1)).toMatchObject({ filter_office: 'BCPIO' });
});
