import { test, expect, OFFICE, openRoute } from './fixtures.js';

const SECOND_OFFICE = {
  ...OFFICE,
  id: 'CITY_HALL_INFO',
  name: 'City Hall Information Desk',
  auth_user_id: 'user-office-2',
};

const OFFICES = [OFFICE, SECOND_OFFICE];

const HELD_COUNTS = [
  {
    office_id: OFFICE.id,
    office_name: OFFICE.name,
    items_currently_held: 3,
  },
  {
    office_id: SECOND_OFFICE.id,
    office_name: SECOND_OFFICE.name,
    items_currently_held: 0,
  },
];

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function mockOffices(page) {
  return page.route('**/rest/v1/offices*', (route) => {
    const url = new URL(route.request().url());
    // The admin has no office of their own, so the session lookup is empty.
    return json(route, url.searchParams.has('auth_user_id') ? null : OFFICES);
  });
}

test.describe('admin held-item overview', () => {
  test.use({ signedInAs: 'admin' });

  test('shows the active held count for each office', async ({ page }) => {
    await mockOffices(page);
    await page.route('**/rest/v1/rpc/get_usage_report', (route) =>
      json(route, HELD_COUNTS),
    );

    await openRoute(page, '/admin/offices');

    await expect(
      page.getByRole('row').filter({ hasText: OFFICE.name }),
    ).toContainText('3 items');
    await expect(
      page.getByRole('row').filter({ hasText: SECOND_OFFICE.name }),
    ).toContainText('0 items');
  });

  test('keeps the directory usable when counts cannot load', async ({ page }) => {
    await mockOffices(page);
    await page.route('**/rest/v1/rpc/get_usage_report', (route) =>
      json(route, { message: 'database unavailable' }, 500),
    );

    await openRoute(page, '/admin/offices');

    await expect(
      page.getByRole('row').filter({ hasText: OFFICE.name }),
    ).toContainText('Unavailable');
    await expect(
      page.getByRole('button', { name: 'Add an office' }),
    ).toBeVisible();
  });
});
