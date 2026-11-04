import { test, expect, openRoute } from './fixtures.js';

test.describe('staff login credential errors', () => {
  test('shows an error under each empty credential field', async ({ page }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = page.locator('.field').filter({ has: email });
    const passwordField = page.locator('.field').filter({ has: password });

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(email).toBeFocused();
    await expect(
      emailField.getByText('Enter the office email.', { exact: true }),
    ).toBeVisible();
    await expect(
      passwordField.getByText('Enter the office password.', { exact: true }),
    ).toBeVisible();
  });
});
