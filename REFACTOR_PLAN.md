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
- [ ] Two separate Google Fonts stylesheets are render-blocking.
- [ ] Font CSS is not loaded with a non-blocking strategy; consolidate and defer.

### web/src/theme.css
- [ ] Shape radius tokens use fixed pixels (`28px`, `16px`, `999px`) rather than
      relative units.
- [ ] No max-width query; `prefers-color-scheme` handling is already correct.

### web/src/styles.css
- [ ] `@media (max-width: 379px)` is a desktop-first/max-width query; replace it
      with mobile-first base styles and a `min-width` enhancement.
- [ ] Fixed px spacing/type/layout tokens (`--space-*`, `--tap-target`,
      `--page-max`, etc.) instead of relative units.
- [ ] Fixed-pixel layout containers: `max-width: 1040px`, `640px`, `440px`,
      `width: min(560px, ...)`, `min-width: 200px`, and fixed control heights
      (`168px` equivalent values such as `56px`, `54px`, `40px`, `120px`).
- [ ] Fixed px component boxes (`340px`, `280px`, `48px`, `56px`, icon sizes).
- [ ] `--type-body-md: 0.875rem` (14px) and `--type-label: 0.75rem` (12px) are
      used for body copy and hints below the 16px body-text floor.
- [ ] `!important` in the reduced-motion block (avoid unless unavoidable).
- [ ] `body { overflow-x: hidden }` can mask horizontal overflow rather than
      fixing its cause.
- [ ] Brand link has no guaranteed 44px touch target.
- [ ] Receipt and reference strings have no `overflow-wrap`, risking overflow at
      320px with long codes.
- [ ] No container-level `overflow-x` guard on the admin table at tablet widths.
- [ ] Reduced-motion override is global/`!important` rather than targeting the
      few animated/transitioned selectors.

### web/src/components/SiteHeader.jsx
- [ ] On every non-home page the brand renders as `<p>`, so the page has no
      `<h1>` and its first heading is `<h2>`.
- [ ] Brand link is an inline text link with a height below 44px.
- [ ] Staff link text is shown at the smallest widths by default and hidden with
      a max-width query (desktop-first).

### web/src/components/SearchPanel.jsx
- [ ] `role="search"` form has no accessible name.
- [ ] Photo preview `<img>` has no explicit `width`/`height` (layout shift).
- [ ] Hints/help text rely on 14px body tokens.
- [ ] Hidden file input is not associated with the visible upload control beyond
      the button label (acceptable, but the button name should stay explicit).

### web/src/components/ReportCard.jsx
- [ ] Body copy uses 14px token.
- [ ] No heading-level issue on the landing page (h2 under the brand h1).

### web/src/components/HowItWorks.jsx
- [ ] Step/lead copy uses 14px tokens.
- [ ] No heading-level issue (h2 then h3).

### web/src/components/ResultCard.jsx
- [ ] Result image has no explicit `width`/`height` and no `decoding` hint
      (layout shift risk); `loading="lazy"` is already present.
- [ ] Category/verification/office copy uses 14px tokens.

### web/src/components/StaffBar.jsx
- [ ] Bar/meta copy uses 14px tokens.
- [ ] Interactive targets already meet 44px.

### web/src/components/StaffGate.jsx
- [ ] State-card heading is h3, which is valid only once the page has an h1/h2
      hierarchy (fixed by the header change).
- [ ] State-card text uses 14px/16px tokens (check after token change).

### web/src/components/LostReportForm.jsx
- [ ] Required fields are validated only in JS and do not expose `required`.
- [ ] Photo preview `<img>` has no explicit `width`/`height`.
- [ ] Help/hint text uses 14px token.
- [ ] Receipt uses `aria-label` on a plain `<p>` (generic role), which is not a
      reliable accessible name.

### web/src/components/FoundReportForm.jsx
- [ ] Required fields do not expose `required`.
- [ ] Photo preview `<img>` has no explicit `width`/`height`.
- [ ] Help/hint text uses 14px token.
- [ ] Receipt uses `aria-label` on a plain `<p>`.

### web/src/components/StaffIntakeForm.jsx
- [ ] Print receipt is generated with an inline `<style>` block and hardcoded
      colors (inline-style violation).
- [ ] Required fields do not expose `required`.
- [ ] Photo preview `<img>` has no explicit `width`/`height`.
- [ ] Help/hint text uses 14px token.
- [ ] Receipt uses `aria-label` on a plain `<p>`.

### web/src/components/AddOfficeDialog.jsx
- [ ] Required fields do not expose `required`.
- [ ] Site-code and password hints are not connected with `aria-describedby`.
- [ ] Dialog width is a fixed pixel value in CSS.
- [ ] Help text uses 14px token.

### web/src/components/ResetCredentialsDialog.jsx
- [ ] Password/receipt uses `aria-label` on a plain `<p>`.
- [ ] Help text uses 14px token.
- [ ] Dialog width is a fixed pixel value in CSS.

### web/src/components/OfficeActionsMenu.jsx
- [ ] Dynamic positioning is applied with an inline `style` attribute.
- [ ] Tabbing out of the `role="menu"` unmounts it and can drop focus instead of
      moving to the next control.
- [ ] Menu width is a fixed pixel value in CSS.

### web/src/components/MistHero.jsx
- [ ] No violations: decorative, `aria-hidden`, no inline styles, SVG tokens.

### web/src/pages/Landing.jsx
- [ ] Has a skip link and `<main id="main">`; heading hierarchy depends on the
      header fix.

### web/src/pages/SearchResults.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Search-result/state copy uses 14px tokens.
- [ ] Result images inherit the ResultCard image issue.

### web/src/pages/ItemDetails.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Item image has no `width`/`height`, no `loading="lazy"`, no `decoding`
      hint (layout shift).
- [ ] Release/transfer forms and notes use 14px tokens.

### web/src/pages/ReportLost.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Lead copy is 16px but form hints are 14px.

### web/src/pages/ReportFound.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Lead copy is 16px but form hints are 14px.

### web/src/pages/StaffIntake.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Inherits StaffBar and intake form issues.

### web/src/pages/StaffLogin.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Error/note copy uses 14px tokens.

### web/src/pages/AdminOffices.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Table has no `<caption>` (the surrounding section has an aria-label).
- [ ] Table becomes stacked cards via `display` changes on table elements; keep
      native roles and verify semantics in axe.
- [ ] Table/status/meta copy uses 14px tokens.

### web/src/pages/RoutePlaceholder.jsx
- [ ] No skip link; `<main>` has no id.
- [ ] Text uses inherited body size (no separate violation).

### Cross-cutting
- [ ] Verify no horizontal overflow at 320, 360, 480, 768, 1024 and 1280px.
- [ ] Verify every interactive target is at least 44x44px.
- [ ] Verify one h1 per page and no skipped heading levels.
- [ ] Verify all form controls have labels and visible focus.
- [ ] Verify no remaining `@media (max-width: ...)` queries.
- [ ] Verify no remaining fixed-width layout containers (`width`/`max-width` in px
      on layout boxes).
- [ ] Verify no inline `style` attributes remain.
- [ ] Verify no `!important` remains.
- [ ] Verify images have dimensions and lazy loading where appropriate.
- [ ] Verify reduced-motion and color-scheme behavior.

## Verification plan (test branch only)

1. `npm run lint`, `npm run test`, `npm run build`.
2. Run the built app with `vite preview`.
3. Playwright at 320/360/768/1280: assert no horizontal overflow, one h1,
   no skipped heading levels, images with width/height, and basic keyboard focus.
4. axe-core scan on every reachable route at mobile and desktop widths.
5. HTML validation of the rendered DOM for every route.
6. Lighthouse (if available) at 360px and 1280px.
