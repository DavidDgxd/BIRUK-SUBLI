# Mobile-first and web-standards refactor plan

Branch: `refactor/mobile-first`
Baseline: `main` at `dcd0db5`
Scope: the `web/` Vite application (all pages, components, styles and `index.html`).

## Stack and inventory

- React 19 + React Router 7, built with Vite 6 (`npm run build`, `npm run preview`).
- Styling is plain CSS: `web/src/theme.css` (tokens, light/dark) and
  `web/src/styles.css` (all layout and component styles).
- Tests: Vitest (unit tests under `web/src/lib`).
- Lint: ESLint 9 (`npm run lint`).
- Entry points: `web/index.html`, `web/src/main.jsx`, `web/src/App.jsx`.
- Pages: `Landing`, `SearchResults`, `ItemDetails`, `ReportLost`, `ReportFound`,
  `StaffIntake`, `StaffLogin`, `AdminOffices`, `RoutePlaceholder`.
- Shared components: `SiteHeader`, `SiteFooter`, `MistHero`, `SearchPanel`,
  `ReportCard`, `HowItWorks`, `ResultCard`, `StaffBar`, `StaffGate`,
  `LostReportForm`, `FoundReportForm`, `StaffIntakeForm`, `AddOfficeDialog`,
  `ResetCredentialsDialog`, `OfficeActionsMenu`, `Icon`.

Default branch is `main`. The working tree had one pre-existing uncommitted
`.gitignore` edit; it was stashed as `pre-refactor: .gitignore tweak` before the
refactor branch was created.

## Violations by file

### web/index.html
- [x] Two separate Google Fonts stylesheets are render-blocking.
- [x] Font CSS is not loaded with a non-blocking strategy; consolidate and defer.

### web/src/theme.css
- [x] Shape radius tokens use fixed pixels (`28px`, `16px`, `999px`) rather than
      relative units.
- [x] No max-width query; `prefers-color-scheme` handling is already correct.

### web/src/styles.css
- [x] `@media (max-width: 379px)` is a desktop-first/max-width query; replace it
      with mobile-first base styles and a `min-width` enhancement.
- [x] Fixed px spacing/type/layout tokens (`--space-*`, `--tap-target`,
      `--page-max`, etc.) instead of relative units.
- [x] Fixed-pixel layout containers: `max-width: 1040px`, `640px`, `440px`,
      `width: min(560px, ...)`, `min-width: 200px`, and fixed control heights
      (`168px` equivalent values such as `56px`, `54px`, `40px`, `120px`).
- [x] Fixed px component boxes (`340px`, `280px`, `48px`, `56px`, icon sizes).
- [x] `--type-body-md: 0.875rem` (14px) and `--type-label: 0.75rem` (12px) are
      used for body copy and hints below the 16px body-text floor.
- [x] `!important` in the reduced-motion block (avoid unless unavoidable).
- [x] `body { overflow-x: hidden }` can mask horizontal overflow rather than
      fixing its cause.
- [x] Brand link has no guaranteed 44px touch target.
- [x] Receipt and reference strings have no `overflow-wrap`, risking overflow at
      320px with long codes.
- [x] No container-level `overflow-x` guard on the admin table at tablet widths.
- [x] Reduced-motion override is global/`!important` rather than targeting the
      few animated/transitioned selectors.

### web/src/components/SiteHeader.jsx
- [x] On every non-home page the brand renders as `<p>`, so the page has no
      `<h1>` and its first heading is `<h2>`.
- [x] Brand link is an inline text link with a height below 44px.
- [x] Staff link text is shown at the smallest widths by default and hidden with
      a max-width query (desktop-first).

### web/src/components/SearchPanel.jsx
- [x] `role="search"` form has no accessible name.
- [x] Photo preview `<img>` has no explicit `width`/`height` (layout shift).
- [x] Hints/help text rely on 14px body tokens.
- [x] Hidden file input is not associated with the visible upload control beyond
      the button label (acceptable, but the button name should stay explicit).

### web/src/components/ReportCard.jsx
- [x] Body copy uses 14px token.
- [x] No heading-level issue on the landing page (h2 under the brand h1).

### web/src/components/HowItWorks.jsx
- [x] Step/lead copy uses 14px tokens.
- [x] No heading-level issue (h2 then h3).

### web/src/components/ResultCard.jsx
- [x] Result image has no explicit `width`/`height` and no `decoding` hint
      (layout shift risk); `loading="lazy"` is already present.
- [x] Category/verification/office copy uses 14px tokens.

### web/src/components/StaffBar.jsx
- [x] Bar/meta copy uses 14px tokens.
- [x] Interactive targets already meet 44px.

### web/src/components/StaffGate.jsx
- [x] State-card heading is h3, which is valid only once the page has an h1/h2
      hierarchy (fixed by the header change).
- [x] State-card text uses 14px/16px tokens (check after token change).

### web/src/components/LostReportForm.jsx
- [x] Required fields are validated only in JS and do not expose `required`.
- [x] Photo preview `<img>` has no explicit `width`/`height`.
- [x] Help/hint text uses 14px token.
- [x] Receipt uses `aria-label` on a plain `<p>` (generic role), which is not a
      reliable accessible name.

### web/src/components/FoundReportForm.jsx
- [x] Required fields do not expose `required`.
- [x] Photo preview `<img>` has no explicit `width`/`height`.
- [x] Help/hint text uses 14px token.
- [x] Receipt uses `aria-label` on a plain `<p>`.

### web/src/components/StaffIntakeForm.jsx
- [x] Print receipt is generated with an inline `<style>` block and hardcoded
      colors (inline-style violation).
- [x] Required fields do not expose `required`.
- [x] Photo preview `<img>` has no explicit `width`/`height`.
- [x] Help/hint text uses 14px token.
- [x] Receipt uses `aria-label` on a plain `<p>`.

### web/src/components/AddOfficeDialog.jsx
- [x] Required fields do not expose `required`.
- [x] Site-code and password hints are not connected with `aria-describedby`.
- [x] Dialog width is a fixed pixel value in CSS.
- [x] Help text uses 14px token.

### web/src/components/ResetCredentialsDialog.jsx
- [x] Password/receipt uses `aria-label` on a plain `<p>`.
- [x] Help text uses 14px token.
- [x] Dialog width is a fixed pixel value in CSS.

### web/src/components/OfficeActionsMenu.jsx
- [x] Dynamic positioning is applied with an inline `style` attribute.
- [x] Tabbing out of the `role="menu"` unmounts it and can drop focus instead of
      moving to the next control.
- [x] Menu width is a fixed pixel value in CSS.

### web/src/components/MistHero.jsx
- [x] No violations: decorative, `aria-hidden`, no inline styles, SVG tokens.

### web/src/pages/Landing.jsx
- [x] Has a skip link and `<main id="main">`; heading hierarchy depends on the
      header fix.

### web/src/pages/SearchResults.jsx
- [x] No skip link; `<main>` has no id.
- [x] Search-result/state copy uses 14px tokens.
- [x] Result images inherit the ResultCard image issue.

### web/src/pages/ItemDetails.jsx
- [x] No skip link; `<main>` has no id.
- [x] Item image has no `width`/`height`, no `loading="lazy"`, no `decoding`
      hint (layout shift).
- [x] Release/transfer forms and notes use 14px tokens.

### web/src/pages/ReportLost.jsx
- [x] No skip link; `<main>` has no id.
- [x] Lead copy is 16px but form hints are 14px.

### web/src/pages/ReportFound.jsx
- [x] No skip link; `<main>` has no id.
- [x] Lead copy is 16px but form hints are 14px.

### web/src/pages/StaffIntake.jsx
- [x] No skip link; `<main>` has no id.
- [x] Inherits StaffBar and intake form issues.

### web/src/pages/StaffLogin.jsx
- [x] No skip link; `<main>` has no id.
- [x] Error/note copy uses 14px tokens.

### web/src/pages/AdminOffices.jsx
- [x] No skip link; `<main>` has no id.
- [x] Table has no `<caption>` (the surrounding section has an aria-label).
- [x] Table becomes stacked cards via `display` changes on table elements; add
      explicit table/rowgroup/row/columnheader/rowheader/cell roles so the
      semantics survive the display change.
- [x] Table/status/meta copy uses 14px tokens.

### web/src/pages/RoutePlaceholder.jsx
- [x] No skip link; `<main>` has no id.
- [x] Text uses inherited body size (no separate violation).

### Cross-cutting
- [x] Verify no horizontal overflow at 320, 360, 768 and 1280px.
- [x] Verify every interactive target is at least 44x44px.
- [x] Verify one h1 per page and no skipped heading levels.
- [x] Verify all form controls have labels and visible focus.
- [x] Verify no remaining `@media (max-width: ...)` queries.
- [x] Verify no remaining fixed-width layout containers (`width`/`max-width` in px
      on layout boxes).
- [x] Verify no inline `style` attributes remain.
- [x] Verify no `!important` remains.
- [x] Verify images have dimensions and lazy loading where appropriate.
- [x] Verify reduced-motion and color-scheme behavior.

## Verification plan (test branch only)

1. `npm run lint`, `npm run test`, `npm run build`.
2. Run the built app with `vite preview`.
3. Playwright at 320/360/768/1280: assert no horizontal overflow, one h1,
   no skipped heading levels, images with width/height, and basic keyboard focus.
4. axe-core scan on every reachable route at mobile and desktop widths.
5. HTML validation of the rendered DOM for every route.
6. Lighthouse was not installed; Playwright covered the requested viewport,
   accessibility and layout checks instead.

## Verification results (`test/mobile-first-verification`)

- `npm run lint`: pass.
- `npm run test` (Vitest): 17 tests pass.
- `npm run build`: pass.
- Playwright responsive/accessibility suite: 130 tests pass on the normal build
  (9 routes x 320/360/768/1280 plus semantics, touch targets, images, focus,
  axe, reduced motion and CLS checks).
- Mock staff build (`VITE_STAFF_DEV_SESSION=true`): 14 extra
  `staff-intake` checks pass with the full custody form rendered, because the
  default build only shows the sign-in gate.
- axe-core WCAG 2.0/2.1/2.2 A and AA scans: 0 violations.
- Nu HTML Checker (vnu.jar) on all 9 rendered routes: 0 errors, on both the
  normal and mock staff builds.
- Layout shift at 360px: CLS 0.037-0.043 across runs (target <= 0.1).
- No `@media (max-width: ...)` queries, no `!important`, no inline `style`
  attributes and no fixed-px layout widths remain.
- The authenticated `/admin/offices` table and action menu were not reachable
  without real central-admin credentials. Their CSS and markup were reviewed
  statically; the unauthenticated gate was scanned by axe and vnu.
- The data API exposes one image URL per item, so `srcset`/`sizes` variants are
  not available; images use intrinsic `width`/`height`, responsive CSS sizing,
  `loading="lazy"` on content images and `decoding="async"`.
