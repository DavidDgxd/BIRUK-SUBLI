import AxeBuilder from '@axe-core/playwright';
import { test, expect, openRoute, OFFICE } from './fixtures.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const DUE_ID = '33333333-3333-3333-3333-333333333333';
const DUE_TODAY_ID = '44444444-4444-4444-4444-444444444444';
const SOON_ID = '55555555-5555-5555-5555-555555555555';

// What staff_reminders_view returns: one row per item, already scoped to the
// signed-in office and classified by the campus date.
const REMINDERS = [
  {
    id: DUE_ID,
    ref_code: 'BS-0101',
    title: 'Envelope of cash',
    reminder_type: 'due',
    reward_date: '2026-11-20',
    days_until_reward: -7,
    cash_amount: 1500,
    finder_name: 'Ana Reyes',
    finder_contact: '0917 555 0101',
  },
  {
    id: DUE_TODAY_ID,
    ref_code: 'BS-0102',
    title: 'Wallet with bills',
    reminder_type: 'due',
    reward_date: '2026-11-27',
    days_until_reward: 0,
    cash_amount: 800,
    finder_name: 'Ben Cruz',
    finder_contact: 'ben@example.com',
  },
  {
    id: SOON_ID,
    ref_code: 'BS-0103',
    title: 'Coin purse',
    reminder_type: 'approaching',
    reward_date: '2026-12-08',
    days_until_reward: 11,
    cash_amount: 250,
    finder_name: 'Carla Dizon',
    finder_contact: '0918 555 0103',
  },
];

async function mockReminders(page, handler) {
  const calls = [];
  await page.route('**/rest/v1/staff_reminders_view**', async (route) => {
    calls.push(new URL(route.request().url()));
    const { status = 200, body } = await handler(calls.length);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  return calls;
}

function reminders(page) {
  return page.getByRole('region', { name: 'Cash reminders' });
}

test.describe('cash reminders on /staff/items', () => {
  test.use({ signedInAs: 'office' });

  test('lists due and approaching cash once each, with finder details', async ({
    page,
    pageErrors,
  }) => {
    const calls = await mockReminders(page, () => ({ body: REMINDERS }));
    await openRoute(page, '/staff/items');

    const panel = reminders(page);
    const due = panel.getByRole('heading', { name: 'Due now (2)' });
    const soon = panel.getByRole('heading', { name: 'Approaching (1)' });
    await expect(due).toBeVisible();
    await expect(soon).toBeVisible();

    // Every item appears exactly once.
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(panel.getByText('BS-0102', { exact: true })).toHaveCount(1);

    const dueToday = panel
      .getByRole('listitem')
      .filter({ hasText: 'Wallet with bills' });
    await expect(dueToday).toContainText('Due today');
    await expect(dueToday).toContainText('27 Nov 2026');
    await expect(dueToday).toContainText('Ben Cruz');
    await expect(dueToday).toContainText('ben@example.com');

    const approaching = panel
      .getByRole('listitem')
      .filter({ hasText: 'Coin purse' });
    await expect(approaching).toContainText('Due in 11 days');
    await expect(approaching).toContainText('Carla Dizon');
    await expect(approaching).toContainText('0918 555 0103');

    await expect(
      panel.getByRole('link', { name: 'Envelope of cash' }),
    ).toHaveAttribute('href', `/items/${DUE_ID}`);

    // The view does the office scoping; the client asks for the finder fields.
    const select = calls[0].searchParams.get('select');
    expect(select).toContain('finder_name');
    expect(select).toContain('finder_contact');
    expect(pageErrors).toEqual([]);
  });

  test('says so when nothing is due in the next 14 days', async ({ page }) => {
    await mockReminders(page, () => ({ body: [] }));
    await openRoute(page, '/staff/items');

    await expect(
      reminders(page).getByText(
        'No cash is due for the finder in the next 14 days.',
      ),
    ).toBeVisible();
    await expect(reminders(page).getByRole('listitem')).toHaveCount(0);
  });

  test('recovers from a failed load', async ({ page }) => {
    await mockReminders(page, (n) =>
      n === 1
        ? { status: 500, body: { message: 'boom' } }
        : { body: REMINDERS.slice(2) },
    );
    await openRoute(page, '/staff/items');

    const panel = reminders(page);
    await expect(panel.getByRole('alert')).toContainText(
      'We could not load cash reminders right now.',
    );
    await panel.getByRole('button', { name: 'Try again' }).click();
    await expect(panel.getByRole('heading', { name: 'Approaching (1)' }))
      .toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });

  for (const theme of ['light', 'dark']) {
    test(`has no axe violations with reminders listed (${theme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await mockReminders(page, () => ({ body: REMINDERS }));
      await openRoute(page, '/staff/items');
      await expect(reminders(page).getByRole('listitem')).toHaveCount(3);

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        ),
      ).toEqual([]);
    });
  }
});

test.describe('cash release note (Art. 720)', () => {
  test.use({ signedInAs: 'office' });

  async function openHeldItem(page, { isCash, cashAmount, cashStatus = 200 }) {
    await page.route('**/rest/v1/rpc/get_item_public', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: DUE_ID,
            ref_code: 'BS-0101',
            title: 'Envelope of cash',
            category: 'Cash',
            status: 'held',
            image_url: null,
            date_received: '2026-05-20',
            holding_office_id: OFFICE.id,
            holding_office_name: OFFICE.name,
          },
        ]),
      }),
    );
    await page.route('**/rest/v1/items?**', (route) =>
      route.fulfill({
        status: cashStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          cashStatus === 200
            ? { is_cash: isCash, cash_amount: cashAmount }
            : { message: 'boom' },
        ),
      }),
    );
    await openRoute(page, `/items/${DUE_ID}`);
    return page.getByRole('form', { name: 'Release item to claimant' });
  }

  test('tells staff the owner owes the finder one-tenth', async ({ page }) => {
    const form = await openHeldItem(page, { isCash: true, cashAmount: 1500 });

    await expect(form).toContainText('Civil Code Art. 720');
    await expect(form).toContainText(/150\.00 of .*1,500\.00/);
  });

  test('records the Art. 720 reward in the release notes', async ({ page }) => {
    const calls = [];
    await page.route('**/rest/v1/rpc/release_item_at_counter', (route) => {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', body: 'null' });
    });
    const form = await openHeldItem(page, { isCash: true, cashAmount: 1500 });
    await expect(form).toContainText('added to the release notes');

    await form.getByLabel('Claimant name').fill('Maria Santos');
    await form.getByLabel('ID reference').fill('UBID-4921');
    await form.getByLabel(/Release notes/).fill('Letter on file.');
    await form.getByRole('button', { name: 'Confirm release' }).click();

    await expect.poll(() => calls.length).toBe(1);
    const notes = calls[0].p_release_notes.split('\n');
    expect(notes[0]).toBe('Letter on file.');
    expect(notes[1]).toMatch(/150\.00, one-tenth of .*1,500\.00/);
    expect(notes[1]).toContain('Civil Code Art. 720');
  });

  test('tells staff about Art. 720 when the cash check fails', async ({
    page,
  }) => {
    const form = await openHeldItem(page, { cashStatus: 500 });

    await expect(form.getByRole('status')).toContainText(
      'We could not check whether this item is cash.',
    );
    await expect(form).toContainText('Civil Code Art. 720');
  });

  test('shows no note for an item that is not cash', async ({ page }) => {
    const form = await openHeldItem(page, { isCash: false, cashAmount: null });

    await expect(form).toBeVisible();
    await expect(form).not.toContainText('Art. 720');
  });
});
