import { test, expect, openRoute } from './fixtures.js';

const EMAIL_ERROR = 'Enter the office email.';
const PASSWORD_ERROR = 'Enter the office password.';

function fieldFor(page, label) {
  return page.locator('.field').filter({
    has: page.getByLabel(label, { exact: true }),
  });
}

function announcement(field) {
  return field.locator('[aria-live="polite"]');
}

test.describe('staff login credential errors', () => {
  test('shows and announces both errors when both fields are empty', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');

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

    await expect(announcement(emailField)).toHaveCount(1);
    await expect(announcement(emailField)).toHaveText('');
    await expect(announcement(passwordField)).toHaveCount(1);
    await expect(announcement(passwordField)).toHaveText('');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    const snapshot = await page.evaluate(() => window.__loginFocusSnapshot);
    expect(snapshot).toEqual(
      expect.objectContaining({ invalid: 'true', errorCount: 2 }),
    );
    expect(snapshot.describedBy).toBeTruthy();

    await expect(email).toBeFocused();
    await expect(emailField.locator('.form-error')).toHaveText(EMAIL_ERROR);
    await expect(passwordField.locator('.form-error')).toHaveText(
      PASSWORD_ERROR,
    );
    await expect(announcement(emailField)).toHaveText(EMAIL_ERROR);
    await expect(announcement(passwordField)).toHaveText(PASSWORD_ERROR);
    await expect(
      emailField.getByText(EMAIL_ERROR, { exact: true }),
    ).toHaveCount(1);
    await expect(
      passwordField.getByText(PASSWORD_ERROR, { exact: true }),
    ).toHaveCount(1);

    const emailErrorId = await emailField
      .locator('.form-error')
      .getAttribute('id');
    const passwordErrorId = await passwordField
      .locator('.form-error')
      .getAttribute('id');
    await expect(email).toHaveAttribute('aria-describedby', emailErrorId);
    await expect(password).toHaveAttribute('aria-describedby', passwordErrorId);
  });

  test('announces both errors when submitting from the email field', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');

    await email.focus();
    await page.keyboard.press('Enter');

    await expect(email).toBeFocused();
    await expect(emailField.locator('.form-error')).toHaveText(EMAIL_ERROR);
    await expect(passwordField.locator('.form-error')).toHaveText(
      PASSWORD_ERROR,
    );
    await expect(announcement(emailField)).toHaveText(EMAIL_ERROR);
    await expect(announcement(passwordField)).toHaveText(PASSWORD_ERROR);
  });

  test('announces the password error when submitting from the password field', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');

    await email.fill('office@example.test');
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(password).toBeFocused();
    await expect(passwordField.locator('.form-error')).toHaveText(
      PASSWORD_ERROR,
    );
    await expect(emailField.locator('.form-error')).toHaveCount(0);
    await expect(announcement(emailField)).toHaveText('');
    await expect(announcement(passwordField)).toHaveText(PASSWORD_ERROR);
  });

  test('shows only the email error when the password is filled', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');
    await password.fill('office-secret');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField.locator('.form-error')).toHaveText(EMAIL_ERROR);
    await expect(passwordField.locator('.form-error')).toHaveCount(0);
    await expect(announcement(emailField)).toHaveText(EMAIL_ERROR);
    await expect(announcement(passwordField)).toHaveText('');
  });

  test('shows only the password error when the email is filled', async ({
    page,
  }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');
    await email.fill('office@example.test');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(passwordField.locator('.form-error')).toHaveText(
      PASSWORD_ERROR,
    );
    await expect(emailField.locator('.form-error')).toHaveCount(0);
    await expect(announcement(emailField)).toHaveText('');
    await expect(announcement(passwordField)).toHaveText(PASSWORD_ERROR);
  });

  test('treats a whitespace-only email as empty', async ({ page }) => {
    await openRoute(page, '/staff/login');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const emailField = fieldFor(page, 'Email');
    const passwordField = fieldFor(page, 'Password');
    await email.fill('   ');
    await password.fill('office-secret');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField.locator('.form-error')).toHaveText(EMAIL_ERROR);
    await expect(passwordField.locator('.form-error')).toHaveCount(0);
    await expect(announcement(emailField)).toHaveText(EMAIL_ERROR);
    await expect(announcement(passwordField)).toHaveText('');
  });
});
