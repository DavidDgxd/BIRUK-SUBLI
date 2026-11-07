import AxeBuilder from '@axe-core/playwright';
import { test, expect, openRoute } from './fixtures.js';

// One-hot vectors so the faked RPC can tell which wording was embedded.
const vector = (hot) =>
  Array.from({ length: 512 }, (_, i) => (i === hot ? 1 : 0));
const EXPANDED_VECTOR = vector(0);
const EXACT_VECTOR = vector(1);

const item = (id, title) => ({
  id,
  ref_code: `BS-${id.slice(0, 4)}`,
  title,
  category: 'General',
  status: 'held',
  image_url: null,
  holding_office_id: 'BCPIO',
  holding_office_name: 'Baguio City Public Information Office',
  counter_hours: 'Mon–Fri, 8:00–17:00',
  office_address: 'City Hall, Baguio City',
  created_at: '2026-09-10T00:00:00Z',
  similarity: 0.7,
  lexical_score: 1,
  score: 0.7,
});

const WALLET = item('11111111-1111-1111-1111-111111111111', 'Black Wallet');
const POUCH = item('22222222-2222-2222-2222-222222222222', 'Woven Pouch');

const EXPANDED_LINE = 'Also matching:';
const EXACT_LINE = 'Searched using your own words, without adding synonyms.';

async function fakeServices(page) {
  const embedRequests = [];

  await page.route('**/embed/text', (route) => {
    const body = route.request().postData() ?? '';
    embedRequests.push(body);
    const exact = /name="expand"\r?\n\r?\nfalse/.test(body);
    const filipino = body.includes('itim na pitaka');
    const additions = filipino && !exact ? ['black', 'wallet', 'purse'] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        vector: exact ? EXACT_VECTOR : EXPANDED_VECTOR,
        dim: 512,
        expanded_text: filipino
          ? exact
            ? 'itim na pitaka'
            : 'itim na pitaka black wallet purse'
          : 'black wallet',
        additions,
      }),
    });
  });

  await page.route('**/rest/v1/rpc/match_items_hybrid', (route) => {
    const { query_embedding: embedding } = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(embedding[1] === 1 ? [POUCH] : [WALLET]),
    });
  });

  return embedRequests;
}

test('shows the expanded synonyms and switches to the exact words and back', async ({
  page,
}) => {
  const embedRequests = await fakeServices(page);

  await openRoute(page, '/search?q=itim+na+pitaka');

  await expect(page.getByText(EXPANDED_LINE)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Black Wallet' }),
  ).toBeVisible();
  const useExact = page.getByRole('link', {
    name: 'Search my exact words',
  });
  await expect(useExact).toBeVisible();

  await useExact.click();

  await expect(page).toHaveURL(/exact=itim\+na\+pitaka/);
  await expect(page.getByText(EXACT_LINE)).toBeVisible();
  // The clicked link unmounts; focus moves to the heading, not <body>.
  await expect(
    page.getByRole('heading', { name: 'Search results', level: 1 }),
  ).toBeFocused();
  await expect(page.getByText(EXPANDED_LINE)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Woven Pouch' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Black Wallet' })).toHaveCount(
    0,
  );
  expect(embedRequests.at(-1)).toMatch(/name="expand"\r?\n\r?\nfalse/);

  // The mode lives in the URL, so a reload keeps it.
  await page.reload();
  await expect(page.getByText(EXACT_LINE)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Woven Pouch' }),
  ).toBeVisible();

  // Back returns to the expanded search; Forward to the exact one.
  await page.goBack();
  await expect(page).not.toHaveURL(/exact=/);
  await expect(page.getByText(EXPANDED_LINE)).toBeVisible();
  await page.goForward();
  await expect(page.getByText(EXACT_LINE)).toBeVisible();

  await page
    .getByRole('link', { name: 'Add Filipino synonyms instead' })
    .click();

  await expect(page).not.toHaveURL(/exact=/);
  await expect(page.getByText(EXPANDED_LINE)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Black Wallet' }),
  ).toBeVisible();
  expect(embedRequests.at(-1)).not.toContain('name="expand"');
});

test('a new search from the results page drops the exact-words mode', async ({
  page,
}) => {
  await fakeServices(page);

  await openRoute(page, '/search?q=itim+na+pitaka&exact=itim+na+pitaka');
  await expect(page.getByText(EXACT_LINE)).toBeVisible();

  await page
    .getByRole('searchbox', { name: 'Search held items' })
    .fill('black wallet');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page).toHaveURL(/q=black\+wallet/);
  await expect(page).not.toHaveURL(/exact=/);
  await expect(
    page.getByRole('heading', { name: 'Black Wallet' }),
  ).toBeVisible();
  await expect(page.getByText(EXACT_LINE)).toHaveCount(0);

  // Searching the original phrase again must not revive exact mode.
  await page
    .getByRole('searchbox', { name: 'Search held items' })
    .fill('itim na pitaka');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=itim\+na\+pitaka/);
  await expect(page.getByText(EXPANDED_LINE)).toBeVisible();
  await expect(page.getByText(EXACT_LINE)).toHaveCount(0);
});

test('an English query shows neither wording line', async ({ page }) => {
  await fakeServices(page);

  await openRoute(page, '/search?q=black+wallet');

  await expect(
    page.getByRole('heading', { name: 'Black Wallet' }),
  ).toBeVisible();
  await expect(page.getByText(EXPANDED_LINE)).toHaveCount(0);
  await expect(page.getByText(EXACT_LINE)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /instead/ })).toHaveCount(0);
});

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const theme of ['light', 'dark']) {
  test(`both wording lines pass axe in the ${theme} theme`, async ({
    page,
  }) => {
    await fakeServices(page);
    await page.emulateMedia({ colorScheme: theme });

    for (const [path, line] of [
      ['/search?q=itim+na+pitaka', EXPANDED_LINE],
      ['/search?q=itim+na+pitaka&exact=itim+na+pitaka', EXACT_LINE],
    ]) {
      await openRoute(page, path);
      await expect(page.getByText(line)).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    }
  });
}
