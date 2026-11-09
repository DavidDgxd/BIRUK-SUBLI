import { test, expect, openRoute } from './fixtures.js';

const EMBEDDING = Array.from({ length: 512 }, (_, index) =>
  index === 0 ? 1 : 0,
);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function item(id, title, similarity, extra = {}) {
  return {
    id,
    ref_code: id.toUpperCase(),
    title,
    category: 'General',
    status: 'held',
    image_url: null,
    holding_office_id: 'BCPIO',
    holding_office_name: 'Baguio City Public Information Office',
    counter_hours: 'Mon–Fri, 8:00–17:00',
    office_address: 'City Hall, Baguio City',
    created_at: '2026-09-10T00:00:00Z',
    similarity,
    ...extra,
  };
}

async function mockScores(page, items) {
  await page.route('**/embed/text', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/rest/v1/rpc/match_items_hybrid', (route) => {
    const body = route.request().postDataJSON();
    const filtered = body.date_from === '2030-01-01' ? [] : items;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filtered),
    });
  });
}

test('shows best matches with a collapsed possible drawer', async ({
  page,
}) => {
  await mockScores(page, [
    item('11111111-1111-1111-1111-111111111111', 'Black Umbrella', 0.7),
    item('22222222-2222-2222-2222-222222222222', 'Navy Umbrella', 0.69),
    item('33333333-3333-3333-3333-333333333333', 'Folding Umbrella', 0.64),
  ]);

  await openRoute(page, '/search?q=umbrella');

  await expect(
    page.getByRole('heading', { name: 'Best matches' }),
  ).toBeVisible();
  await expect(page.getByText('2 matches, best first')).toBeVisible();
  await expect(page.getByText('98% match')).toBeVisible();
  await expect(page.getByText('95% match')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    '2 best matches and 1 possible match found.',
  );

  const summary = page.getByText('Other possible matches (1)');
  await expect(summary).toBeVisible();
  await expect(page.getByText('Folding Umbrella')).toBeHidden();

  await summary.click();

  await expect(page.getByText('Folding Umbrella')).toBeVisible();
  await expect(page.getByText('81% match')).toHaveCount(0);

  // The office/date filters re-run the RPC; an empty range must show the
  // filter-specific state and recover when cleared.
  await page.getByLabel('Received on or after').fill('2030-01-01');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No items in that range')).toBeVisible();
  const clearButton = page
    .locator('.state__actions')
    .getByRole('button', { name: 'Clear filters' });
  await expect(clearButton).toBeVisible();

  await clearButton.click();
  await expect(
    page.getByRole('heading', { name: 'Best matches' }),
  ).toBeVisible();
});

test('shows close-but-not-confident items in the possible state', async ({
  page,
}) => {
  const detailId = '11111111-1111-1111-1111-111111111111';
  const detailItem = item(detailId, 'Possible One', 0.62);

  await page.route('**/rest/v1/rpc/get_item_public', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([detailItem]),
    }),
  );

  await mockScores(page, [
    detailItem,
    item('22222222-2222-2222-2222-222222222222', 'Possible Two', 0.61),
    item('33333333-3333-3333-3333-333333333333', 'Possible Three', 0.6),
    item('44444444-4444-4444-4444-444444444444', 'Possible Four', 0.59),
    item('55555555-5555-5555-5555-555555555555', 'Possible Five', 0.58),
    item('66666666-6666-6666-6666-666666666666', 'Possible Six', 0.57),
  ]);

  await openRoute(page, '/search?q=umbrella');

  await expect(
    page.getByRole('heading', { name: 'Possible matches' }),
  ).toBeVisible();
  await expect(
    page.getByText(/We couldn't find a confident match in the held items/),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'No confident match. Showing 5 possible matches.',
  );

  await expect(page.locator('.result')).toHaveCount(5);
  await expect(page.getByText('Possible Six')).toHaveCount(0);
  await expect(page.getByText(/\d+% match/)).toHaveCount(0);

  await page.getByRole('link', { name: 'Possible One' }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${detailId}$`));
  await expect(page.getByText(/\d+% match/)).toHaveCount(0);
});

test('shows the no-close-match state for a query that only returns noise', async ({
  page,
}) => {
  // Below the 0.55 RPC floor: the client drops these even if a stale RPC
  // returns them. "Umbrella" is a none query in the evaluation set.
  await mockScores(page, [
    item('11111111-1111-1111-1111-111111111111', 'Sheet of Paper', 0.546),
    item('22222222-2222-2222-2222-222222222222', 'Jisulife Fan', 0.543),
  ]);

  await openRoute(page, '/search?q=umbrella');

  await expect(
    page.getByRole('heading', { name: 'No close match' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Nothing in the held inventory is close to that description/,
    ),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('No close match found.');
  await expect(page.getByText('Sheet of Paper')).toHaveCount(0);

  await page.getByRole('button', { name: 'Search again' }).click();
  const searchbox = page.getByRole('searchbox', {
    name: 'Search held items',
  });
  await expect(searchbox).toBeFocused();
  expect(
    await searchbox.evaluate((element) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 8]);
  await expect(
    page.getByRole('link', { name: 'Report it lost' }),
  ).toBeVisible();
});

test('shows a photo-only exact match as a best match', async ({ page }) => {
  await page.route('**/embed/image', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vector: EMBEDDING }),
    }),
  );
  await page.route('**/rest/v1/rpc/match_items_hybrid', (route) => {
    const body = route.request().postDataJSON();
    expect(body.query_text).toBeNull();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        item('11111111-1111-1111-1111-111111111111', 'Black Umbrella', 0.68, {
          lexical_score: null,
          score: 0.68,
        }),
      ]),
    });
  });

  await openRoute(page, '/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'umbrella.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });

  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'Best matches' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Black Umbrella' }),
  ).toBeVisible();
});
