import AxeBuilder from '@axe-core/playwright';
import { test, expect, ROUTES, openRoute } from './fixtures.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const { path, role } of ROUTES) {
  test.describe(`a11y ${path}`, () => {
    test.use({ signedInAs: role });

    for (const theme of ['light', 'dark']) {
      test(`${theme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openRoute(page, path);

        if (role) {
          // The gate let the session through, so the real page is audited.
          await expect(
            page.getByRole('link', { name: 'Go to staff log in' }),
          ).toHaveCount(0);
        }

        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze();
        const summary = results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        );
        expect(summary).toEqual([]);

        // One h1, and no heading level skipped on the way down.
        const levels = await page
          .locator('h1, h2, h3, h4, h5, h6')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => node.checkVisibility())
              .map((node) => Number(node.tagName[1])),
          );
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
        levels.forEach((level, index) => {
          if (index > 0) expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
        });

        // Every form control a user can reach is named by a visible <label for>
        // pointing at its id. Controls in a closed dialog, or hidden from
        // assistive tech behind a labelled button, are not reachable.
        const unlabelled = await page
          .locator('input:not([type=hidden]):not([type=submit]), select, textarea')
          .evaluateAll((controls) =>
            controls
              .filter((control) => control.checkVisibility())
              .filter((control) => control.getAttribute('aria-hidden') !== 'true')
              .filter((control) => {
                const label = control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
                return !label || !label.checkVisibility();
              })
              .map((control) => control.outerHTML.slice(0, 80)),
          );
        expect(unlabelled).toEqual([]);
      });
    }
  });
}
