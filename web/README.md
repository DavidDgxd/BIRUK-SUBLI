# Biruk-Subli (web)

Frontend for Biruk-Subli, the City of Baguio's centralized lost-and-found system.
Items are held and released at participating city office counters. The site helps
citizens find where an item is held and report lost or found items. It does not
support peer-to-peer exchange, in-app messaging, or online claims.

**Status:** landing page, search results, the lost- and found-item reports, office
provisioning, and the shared office login with the staff intake counter are built.

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

Create `.env` (untracked) and set:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_AI_SERVICE_URL=http://localhost:8000
```

The Supabase client is created at import time, so the app needs the two
`VITE_SUPABASE_*` values to start at all.

Optional, for working on the counter pages without a credential:

```
VITE_STAFF_DEV_SESSION=true      # acts as BCPIO; labelled "not real auth"
VITE_STAFF_OFFICE_ID=BCPIO       # office to act as
VITE_STAFF_OFFICE_NAME=...
```

The mock session is only ever handed out when `VITE_STAFF_DEV_SESSION` is
explicitly set to `true` — a normal `npm run dev` shows the real login screen.

It covers the counter pages only. `/admin/offices` needs a real central-admin
sign-in in every build, because the provision and reset Edge Functions verify
the caller's role server-side and the mock holds no Supabase session to verify.

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
| `/report/lost` | Lost-item report form (built) |
| `/report/found` | Found-item report form (built) |
| `/admin/offices` | Central admin — participating offices, logins & credential reset (built) |
| `/staff/login` | Shared office login, and the central admin's sign-in (built) |
| `/staff/intake` | Staff counter intake (built) |
| `*` | Not-found placeholder |

`SearchPanel` navigates to `/search` with:

- `?q=<text>`: free text, English or Filipino. Translation and embedding happen
  server side; the results page should show the translated text back to the user.
- `?color=<color>`: optional lowercase color filter (`black`, `white`, `gray`,
  `brown`, `red`, `blue`, `green`, `yellow`).
- `location.state.photo`: optional `File` (JPG, PNG or WebP, 8 MB max). It is
  lost on a hard reload, so the results page should handle it being absent.

A search needs text or a photo. Otherwise the form shows an inline error.

## Lost-item reports (`/report/lost`)

`LostReportForm` submits through `src/lib/lostReport.js`. It embeds the description
and an optional photo concurrently with `Promise.all`, averages the two 512-dim
vectors using the same `combineEmbeddings` the search flow uses, then calls the
`submit_lost_report` RPC and shows the returned `ref_code` as the receipt.

The RPC exists because `lost_reports` has an INSERT policy for `anon` but **no
SELECT policy** (`contact_info` is staff-visible PII, so an anon SELECT policy
would leak every report). Without SELECT, PostgREST cannot return the inserted
row, so a plain insert can never hand back the `ref_code`. The SECURITY DEFINER
function inserts and returns only that code.

The photo is used for matching only — it is never uploaded and `image_url` is
inserted as null. If the photo cannot be embedded within 8 seconds, the report is
filed on text alone rather than failing.

## Found-item reports (`/report/found`)

`FoundReportForm` submits through `src/lib/foundReport.js`. Unlike a lost report,
the photo is **required and stored**: `src/lib/storage.js` re-encodes it to WebP
(downscaling until it fits) and uploads it to the public `item-photos` bucket,
which accepts WebP only, up to 2 MB. The bucket already has an `anon` INSERT
policy and a public SELECT policy, so no account is needed and the resulting
public URL is stored on the report.

The note and found location, plus the photo, are embedded concurrently with
`Promise.all`; the 512-dim vectors are averaged with `combineEmbeddings` and
stored in `found_reports.embedding`, so a find can later be reverse-matched
against open lost reports. The row is written through the `submit_found_report`
RPC, which exists for the same reason as `submit_lost_report`: anon can INSERT but
cannot SELECT (`finder_contact` is PII), so a plain insert could not return the
`ref_code`. If the photo cannot be embedded within 8 seconds the report is still
filed and the photo still stored — it simply matches on text alone.

`found_reports.embedding` is nullable, so rows logged by hand without a vector
remain valid.

## Office provisioning (`/admin/offices`)

US-01: the central admin creates a participating office and its shared login.
The page lists `offices` (the table is readable by everyone) and the
"+ ADD AN OFFICE" dialog submits to the `provision-office` Edge Function, which
mints the shared Supabase Auth user with the service_role key and inserts the
`offices` row (`auth_user_id` = the new user). The browser never sees the
service_role key.

Deploy both office-management functions and set the secret they share:

```bash
supabase functions deploy provision-office reset-office-credentials \
  --project-ref vwegcexuyznfsbgzurxa
supabase secrets set SUPABASE_URL=https://vwegcexuyznfsbgzurxa.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
```

Both functions are at `supabase/functions/`, with the shared caller check in
`supabase/functions/_shared/adminAuth.ts`.

## Credential reset (`/admin/offices`)

US-03: when an office reports its shared login lost or compromised, the admin
issues a new one from the office's row in the directory. The
`reset-office-credentials` Edge Function generates the password server-side — 16
characters in four hyphenated groups, drawn from an alphabet with no `I`, `O`,
`l`, `o`, `0` or `1` so it survives being read down a phone line — writes it to
the office's Auth user, and returns it once. Nothing stores it, so the admin has
to hand it over before closing the dialog; a second reset is the only recovery.

The old password stops working immediately and the office's sessions are ended.
A token already issued stays valid until it expires (an hour by default), so an
office that was actually compromised is locked out within the hour rather than
instantly.

### Making an account the central admin

Both functions refuse anyone without the `central_admin` role claim, and nothing
in the app can grant it — the claim lives in `app_metadata`, which only the
service_role can write. `user_metadata` is *not* a substitute: it is editable by
the user themselves through `supabase.auth.updateUser()`, so a role kept there
could be granted by anyone to themselves.

Create the account in the Dashboard (Authentication → Users), then stamp the
role:

```sql
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                         || '{"role":"central_admin"}'::jsonb
 where email = '<admin email>';
```

The claim is copied into the access token when it is issued, so sign in **after**
stamping — or sign out and back in — or the session will not carry it yet. The
admin signs in at `/staff/login` like everyone else; having no office of their
own, they land on the directory instead of a counter.

## Shared office login (`/staff/login`)

US-02: counter staff sign in with their office's shared credentials and land on
the intake screen — no personal account. `src/lib/staffAuth.js` owns the flow:
`signInWithPassword` against the shared Auth user, then resolve which office
claims it through `offices.auth_user_id` (an ordinary read — the table is
readable by everyone). A login that authenticates but maps to no office, or to a
`suspended` one, is signed straight back out rather than left holding a session.

`src/context/StaffAuthContext.jsx` follows `supabase.auth.onAuthStateChange`, so
a stored login survives a reload and a sign-out in another tab clears this one.
`StaffGate` keeps the counter pages behind the login and holds the page while
the stored session resolves; `StaffBar` shows the office being filed against and
ends the shared session at the end of a shift.

The central admin is the one exception to the office mapping: they carry the
`central_admin` claim instead of an `offices` row, so their session has no
office and `StaffGate`'s `requireAdmin` mode is what admits them to
`/admin/offices`. Default mode now requires an office as well as a session,
which keeps an office-less admin out of the counter pages — intake files items
against an office id and cannot work without one. Both checks are UI only; the
role is re-verified server-side on every admin action.

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
- [x] Loading and empty states (results page: skeleton, empty, error with retry, no-query)
