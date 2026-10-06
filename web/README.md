# Biruk-Subli (web)

Frontend for Biruk-Subli, the City of Baguio's centralized lost-and-found system.
Items are held and released at participating city office counters. The site helps
citizens find where an item is held and report lost or found items. It does not
support peer-to-peer exchange, in-app messaging, or online claims.

**Status:** landing page and search results are built. The report and staff routes render a placeholder.

## Getting started

Requires Node 20+.

```bash
npm install
npm run dev       # http://localhost:5173
npm run lint
npm run build     # outputs dist/
npm run preview   # serves dist/ on http://localhost:4173
```

## Project structure

```
index.html            fonts + Material Symbols (Google Fonts), theme-color meta
public/favicon.svg
src/
  main.jsx            router + theme.css + styles.css
  App.jsx             route table
  theme.css           SHARED Material 3 tokens, light + dark (team-agreed changes only)
  styles.css          app-wide styles, one section per area (tokens, base, layout, ...)
  pages/
    Landing.jsx
    RoutePlaceholder.jsx   temporary page for routes that are not built yet
  components/
    SiteHeader.jsx  MistHero.jsx  SearchPanel.jsx  ReportCard.jsx
    HowItWorks.jsx  SiteFooter.jsx  Icon.jsx
  assets/
```

## Theme

- All color, font and shape values live in `src/theme.css`. Components and
  `styles.css` only reference `var(--md-sys-color-*)`, `var(--bs-*)`, `--radius-*`
  and `--font-*`. No hex values outside `theme.css`.
- The role values are the guide's placeholders extended with the roles the page
  needs. Replace them with the Material Theme Builder export (seed `#2E6B4F`) when
  the team generates it, and keep the **Biruk-Subli extension tokens** block:
  `--bs-found-container`, `--bs-on-found-container` (ube Found accent) and the
  `--bs-mist-*` / `--bs-pine` illustration colors.
- Spacing, type scale, elevation and layout tokens are in section 1 of `styles.css`.
- Light and dark follow `prefers-color-scheme`.

## Environment

Copy `.env.example` to `.env` and set:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_AI_SERVICE_URL=http://localhost:8000
```

Restart `npm run dev` after changing `.env`. The AI service must allow CORS from the
web origin (for example `http://localhost:5173`).

## Search flow (`/search`)

`src/lib/searchItems.js` embeds the text and/or photo through the AI service, averages
the vectors if both are given, then calls the `match_items` RPC. `src/lib/aiService.js`
holds the assumed service contract:

- `POST /embed/text` with form field `text` returns `{ "vector": number[512] }`
- `POST /embed/image` with form field `file` returns `{ "vector": number[512] }`

The service does not translate Filipino yet. If `/embed/text` starts returning
`translated_text`, the results page shows it.

The color filter is prepended to the text before embedding. `MATCH_THRESHOLD` and
`MATCH_COUNT` live in `searchItems.js`. The page has loading, empty, error (with retry)
and no-query states.

## Routes and the search hand-off

| Path | Status |
|---|---|
| `/` | Landing page (built) |
| `/search` | Search results (built) |
| `/report/lost` | Placeholder |
| `/report/found` | Placeholder |
| `/staff/login` | Placeholder |
| `*` | Not-found placeholder |

`SearchPanel` navigates to `/search` with:

- `?q=<text>`: free text, English or Filipino. Translation and embedding happen
  server side; the results page should show the translated text back to the user.
- `?color=<color>`: optional lowercase color filter (`black`, `white`, `gray`,
  `brown`, `red`, `blue`, `green`, `yellow`).
- `location.state.photo`: optional `File` (JPG, PNG or WebP, 8 MB max). It is
  lost on a hard reload, so the results page should handle it being absent.

A search needs text or a photo. Otherwise the form shows an inline error.

## Notes

- Fonts (Roboto, Playfair Display) and Material Symbols Rounded load from Google
  Fonts in `index.html`. Icons keep a fixed 1em box so layout does not shift if
  the icon font is slow or blocked.
- The UI is plain semantic HTML styled to Material 3 and does not use
  `@material/web`, which is not in `package.json`.
- Deploying `dist/` to static hosting: add an SPA fallback so unknown paths serve
  `index.html` (for example a Netlify `_redirects` rule `/* /index.html 200`, or
  the equivalent rewrite on your host), otherwise refreshing `/search` will 404.

## Accessibility and QA checklist (landing page)

- [x] Text contrast at least 4.5:1, non-text at least 3:1, in light and dark
- [x] Tap targets at least 48x48px (color chips are 40px tall with a 48px hit area)
- [x] No horizontal scroll at 360, 768 and 1280px
- [x] Light and dark mode
- [x] Icon-only buttons have `aria-label`; the photo preview has `alt`
- [x] Error state (empty search, wrong file type, file too large)
- [x] Keyboard: skip link, Tab order, Enter to submit, focus returns to the field after Clear
- [x] Reduced-motion respected
- [ ] Loading and empty states: belong to the results page, which is not built yet
