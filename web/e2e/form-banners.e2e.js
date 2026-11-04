import { test, expect, openRoute } from './fixtures.js';

const BANNERS = [
  {
    path: '/report/lost',
    role: null,
    text: 'Fields marked * are required.',
  },
  {
    path: '/report/found',
    role: null,
    text: 'Fields marked * are required.',
  },
  {
    path: '/staff/intake',
    role: 'office',
    text: 'All fields are required unless marked optional.',
  },
];

for (const { path, role, text } of BANNERS) {
  test.describe(`required-field banner on ${path}`, () => {
    test.use({ signedInAs: role });

    test('is visible at the top of the form', async ({ page }) => {
      await openRoute(page, path);

      const banner = page.locator('form .form__legend--required');
      await expect(banner).toBeVisible();
      await expect(banner).toHaveText(text);
    });
  });
}
