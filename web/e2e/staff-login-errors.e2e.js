import { test, expect, openRoute } from './fixtures.js';

const EMAIL_ERROR = 'Enter the office email.';
const PASSWORD_ERROR = 'Enter the office password.';

test.describe('staff login credential errors', () => {
  test('shows and announces both errors when both fields are empty', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = page.locator('.field').filter({ has: email });
    const passwordField = page.locator('.field').filter({ has: password });

    await page.evaluate(() => {
      const input = document.querySelector('input[type="email"]');
      window.__loginFocusSnapshot = null;
      input.addEventListener(
        'focus',
        () => {
          window.__loginFocusSnapshot = {
            describedBy: input.getAttribute('aria-describedby'),
            invalid: input.getAttribute('aria-invalid'),
            errorCount: document.querySelectorAll('.form-error').length,
          };
        },
        { once: true },
      );
    });

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    const snapshot = await page.evaluate(() => window.__loginFocusSnapshot);
    expect(snapshot).toEqual(
      expect.objectContaining({ invalid: 'true', errorCount: 2 }),
    );
    expect(snapshot.describedBy).toBeTruthy();

    await expect(email).toBeFocused();
    await expect(
      emailField.getByText(EMAIL_ERROR, { exact: true }),
    ).toBeVisible();
    await expect(
      passwordField.getByText(PASSWORD_ERROR, { exact: true }),
    ).toBeVisible();
  });

  test('shows only the email error when the password is filled', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await password.fill('office-secret');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(EMAIL_ERROR, { exact: true })).toBeVisible();
    await expect(page.getByText(PASSWORD_ERROR, { exact: true })).toHaveCount(
      0,
    );
  });

  test('shows only the password error when the email is filled', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await email.fill('office@example.test');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(PASSWORD_ERROR, { exact: true })).toBeVisible();
    await expect(page.getByText(EMAIL_ERROR, { exact: true })).toHaveCount(0);
  });

  test('treats a whitespace-only email as empty', async ({ page }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await email.fill('   ');
    await password.fill('office-secret');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(EMAIL_ERROR, { exact: true })).toBeVisible();
    await expect(page.getByText(PASSWORD_ERROR, { exact: true })).toHaveCount(
      0,
    );
  });
});
