import AxeBuilder from '@axe-core/playwright';
import { test, expect, openRoute } from './fixtures.js';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function seedRows() {
  return [
    {
      term: 'pitaka',
      synonyms: ['wallet', 'purse'],
      enabled: true,
      notes: 'Counter list',
      updated_by: 'admin@baguio.gov.ph',
      updated_at: '2026-11-07T00:00:00Z',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      term: 'payong',
      synonyms: ['umbrella'],
      enabled: true,
      notes: null,
      updated_by: null,
      updated_at: '2026-11-06T00:00:00Z',
      created_at: '2026-11-01T00:00:00Z',
    },
  ];
}

async function mockVocabulary(page) {
  const rows = seedRows();

  await page.route('**/rest/v1/rpc/list_search_synonyms', (route) =>
    json(route, rows),
  );

  await page.route('**/rest/v1/rpc/upsert_search_synonym', (route) => {
    const body = route.request().postDataJSON();
    const existing = rows.find((row) => row.term === body.p_term);
    if (existing) {
      existing.synonyms = body.p_synonyms;
      existing.enabled = body.p_enabled;
      existing.notes = body.p_notes;
      existing.updated_by = 'admin@baguio.gov.ph';
    } else {
      rows.push({
        term: body.p_term,
        synonyms: body.p_synonyms,
        enabled: body.p_enabled,
        notes: body.p_notes,
        updated_by: 'admin@baguio.gov.ph',
        updated_at: '2026-11-07T00:00:00Z',
        created_at: '2026-11-07T00:00:00Z',
      });
    }
    return json(route, null);
  });

  await page.route('**/rest/v1/rpc/delete_search_synonym', (route) => {
    const { p_term: term } = route.request().postDataJSON();
    const index = rows.findIndex((row) => row.term === term);
    if (index >= 0) rows.splice(index, 1);
    return json(route, null);
  });

  return rows;
}

test.use({ signedInAs: 'admin' });

test('adds, edits, filters and deletes a search term', async ({ page }) => {
  await mockVocabulary(page);

  await openRoute(page, '/admin/synonyms');

  await expect(
    page.getByRole('heading', { name: 'Search synonyms', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'pitaka' }),
  ).toContainText('wallet, purse');

  await page.getByLabel('Filipino term').fill('singsing');
  await page.getByLabel('English synonyms').fill('ring, jewellery');
  await page.getByLabel(/notes/i).fill('Jewellery counter list');
  await page.getByRole('button', { name: 'Add term' }).click();

  const newRow = page.getByRole('row').filter({ hasText: 'singsing' });
  await expect(newRow).toContainText('ring, jewellery');
  await expect(newRow).toContainText('Jewellery counter list');

  await page.getByRole('button', { name: 'Edit pitaka' }).click();
  await page.getByLabel('English synonyms').fill('wallet, billfold');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'pitaka' }),
  ).toContainText('wallet, billfold');

  await page.getByLabel('Filter terms').fill('payong');
  await expect(page.getByRole('row')).toHaveCount(2); // header + payong
  await expect(
    page.getByRole('row').filter({ hasText: 'singsing' }),
  ).toHaveCount(0);

  await page.getByLabel('Filter terms').fill('');
  await page.getByRole('button', { name: 'Delete singsing' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'singsing' }),
  ).toHaveCount(0);
});

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const theme of ['light', 'dark']) {
  test(`admin synonym editor passes axe in the ${theme} theme`, async ({
    page,
  }) => {
    await mockVocabulary(page);
    await page.emulateMedia({ colorScheme: theme });
    await openRoute(page, '/admin/synonyms');

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}
