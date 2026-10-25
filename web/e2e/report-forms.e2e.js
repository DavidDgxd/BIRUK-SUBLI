import { test, expect, ROUTES, openRoute } from './fixtures.js';

const REPORT_ROUTES = [
  {
    path: '/report/lost',
    labels: [
      'What did you lose?',
      'Where do you think you lost it?',
      'When did you lose it?',
      'Contact information',
      'Photo',
    ],
  },
  {
    path: '/report/found',
    labels: [
      'What did you find?',
      'Where did you find it?',
      'When did you find it?',
      'Contact information',
      'Photo',
    ],
  },
];

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function horizontalOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const { path, role } of ROUTES) {
  test.describe(`smoke ${path}`, () => {
    test.use({ signedInAs: role });

    test('renders with no console or page errors and no horizontal overflow', async ({
      page,
      pageErrors,
    }) => {
      await openRoute(page, path);
      expect(pageErrors).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  });
}

for (const { path, labels } of REPORT_ROUTES) {
  test.describe(`report form ${path}`, () => {
    test('shows every field in one flow, in order, with no disclosure', async ({
      page,
    }) => {
      await openRoute(page, path);
      await expect(page.locator('form details, form summary')).toHaveCount(0);

      const rendered = await page
        .locator('form .field__label')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.firstChild.textContent.trim()),
        );
      expect(rendered).toEqual(labels);

      for (const label of labels.slice(0, 3)) {
        await expect(page.getByLabel(label)).toHaveAttribute('required', '');
      }
      await expect(page.getByLabel('Contact information')).not.toHaveAttribute(
        'required',
      );
      await expect(page.locator('.field__optional').first()).toHaveText(
        '(optional)',
      );
      await expect(page.getByLabel(labels[2])).toHaveAttribute(
        'max',
        /^\d{4}-\d{2}-\d{2}$/,
      );
    });

    test('every interactive element is at least 44 by 44 px', async ({ page }) => {
      await openRoute(page, path);
      const small = await page
        .locator('a[href], button, input, select, textarea, summary, [tabindex="0"]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.checkVisibility() || node.type === 'file')
            .map((node) => {
              const box = node.getBoundingClientRect();
              return { node: node.outerHTML.slice(0, 80), w: box.width, h: box.height };
            })
            .filter(({ w, h }) => w < 44 || h < 44),
        );
      expect(small).toEqual([]);
    });

    test('text inputs use at least a 16px font', async ({ page }) => {
      await openRoute(page, path);
      const sizes = await page
        .locator('form input, form textarea')
        .evaluateAll((nodes) =>
          nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)),
        );
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
    });

    test.describe('at 360 x 400 with the submit dock', () => {
      test.use({ viewport: { width: 360, height: 400 } });

      test('a focused field is never hidden behind the dock', async ({ page }) => {
        await openRoute(page, path);
        await page.locator('h1').focus();

        const dock = page.locator('.form-actions');
        await expect(dock).toHaveCSS('position', 'fixed');

        const checked = [];
        for (let step = 0; step < 20; step += 1) {
          await page.keyboard.press('Tab');
          const state = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active?.closest('form')) return null;
            if (active.closest('.form-actions')) return { done: true };
            const target = active.closest('.dropzone') ?? active;
            const box = target.getBoundingClientRect();
            const dockTop = document
              .querySelector('.form-actions')
              .getBoundingClientRect().top;
            return {
              name: active.id || active.getAttribute('aria-label'),
              top: box.top,
              bottom: box.bottom,
              dockTop,
            };
          });
          if (!state) continue;
          if (state.done) break;
          checked.push(state.name);
          expect(state.top, state.name).toBeGreaterThanOrEqual(0);
          expect(state.bottom, state.name).toBeLessThanOrEqual(state.dockTop);
        }
        // Description, place, date, contact and the photo input.
        expect(checked.length).toBeGreaterThanOrEqual(5);
      });
    });

    test('photo dropzone works from the keyboard and reports the file', async ({
      page,
    }) => {
      await openRoute(page, path);
      const input = page.locator('form input[type=file]');
      const dropzone = page.locator('.dropzone');

      await expect(input).toHaveAttribute('type', 'file');
      await expect(dropzone).toContainText('Browse file or drag photo here');
      await expect(dropzone.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      expect((await dropzone.boundingBox()).height).toBeGreaterThanOrEqual(44);

      // Reach the input by Tab from the contact field: the ring shows on the zone.
      await page.getByLabel('Contact information').focus();
      await page.keyboard.press('Tab');
      await expect(input).toBeFocused();
      await expect(dropzone).not.toHaveCSS('outline-style', 'none');

      const longName = `${'a-very-long-photo-name-from-a-phone-camera-'.repeat(4)}.png`;
      await input.setInputFiles({ name: longName, mimeType: 'image/png', buffer: PNG_1PX });

      const live = page.locator('[aria-live="polite"]').filter({ has: page.locator('.photo-chip') });
      await expect(live).toContainText(longName);

      const file = page.locator('.photo-chip__file');
      await expect(file).toHaveCSS('text-overflow', 'ellipsis');
      expect(
        await file.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      expect(await horizontalOverflow(page)).toBe(0);

      await page.getByRole('button', { name: 'Remove photo' }).click();
      await expect(page.locator('.photo-chip')).toHaveCount(0);
      await expect(input).toBeFocused();
    });

    test('an empty submit marks the first field invalid and announces why', async ({
      page,
    }) => {
      await openRoute(page, path);
      await page.locator('form [type=submit]').click();

      const description = page.getByLabel(REPORT_ROUTES.find((r) => r.path === path).labels[0]);
      await expect(description).toBeFocused();
      await expect(description).toHaveAttribute('aria-invalid', 'true');
      const error = page.locator('[aria-live="polite"] .form-error');
      await expect(error).toBeVisible();
      const errorId = await error.getAttribute('id');
      const describedBy = await description.getAttribute('aria-describedby');
      expect(describedBy.split(' ')).toContain(errorId);
    });
  });
}
