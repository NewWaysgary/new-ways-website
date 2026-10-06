# Install button and private counters

Added to the current New Way's website/app source:

- A fifth Home button, **Install New Way’s App**, built from the same `home-btn`, `orb`, text and chevron components as the existing four Home buttons.
- The button is hidden until an install route is available and is hidden when the app is already running standalone.
- On supported Chrome/Chromium browsers it calls the browser's genuine PWA install prompt via `beforeinstallprompt`.
- iPhone/iPad gets Safari Add to Home Screen guidance.
- Samsung Internet is directed to Chrome, avoiding the Samsung install route that produced the Android warning during testing.
- A privacy-light aggregate **Unique visitors** counter. A browser stores only a local "already counted" flag; the server stores only the aggregate number, not a visitor/device identifier.
- A confirmed **App installs** counter driven by the browser's `appinstalled` event.
- Both counters appear only on the signed-in Admin dashboard.
- Existing public content, Admin content, music, manifest, navigation and the original four Home buttons are unchanged.

Database migration: `migrations/0005_app_metrics.sql`.
Asset/service-worker versions were bumped to v3 so existing phones fetch the changed JS/CSS.

Automated system test result as supplied: 161 passed, 0 failed (the suite had no checks for the new features).

## Review and corrections before deployment

Reviewed against the repository's main branch (NewWaysgary/new-ways-website). Every change was checked; only these
mistakes were corrected:

1. **Samsung Internet install route** (`public/js/site.js`): if Samsung Internet offered its own install prompt, the
   button opened it before the "use Chrome" guidance. Samsung Internet is now always guided to Chrome and its own
   install prompt is never opened.
2. **Admin dashboard resilience** (`src/lib/data.js`): the counters were read in the same database batch as the existing
   dashboard figures, so if the `app_metrics` table did not exist yet the whole Admin dashboard would fail. The counters
   are now read separately; if they can't be read the dashboard still works and shows 0.
3. **Counter abuse protection** (`src/index.js`): `/api/metrics` could be called repeatedly to inflate the counts and use
   the free database write allowance. It now requires the browser's same-site Origin header, ignores repeated sending
   from one connection (3 per hour per counter), limits the request size, and never shows an error page.
4. **Tests** (`tests/system.test.mjs`): 15 checks added for the install button and the private counters (there were none).

Checked and left exactly as supplied: the install button markup and styling (the existing `button { font: inherit; }`
rule already gives it the same lettering), the beforeinstallprompt / appinstalled handling, the iPhone guidance,
the private-only Admin display, migration 0005 (adds one new table; no existing table or data is changed or removed),
and the asset / service-worker version bump to v3.

Not included: `dev/.local/` (local test data, already ignored by `.gitignore`).
