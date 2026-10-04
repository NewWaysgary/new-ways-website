# New Way’s: website, installable app and Admin

Stages 1 to 3 of the build: core architecture, public pages, database, Centre Settings, the Admin framework,
WorkOS AuthKit sign-in, Admin for Who’s On, Events, Announcements, Community & Charity, FAQs and Social links,
and Gallery, Visitor Experiences, Teaching Videos, Live and Background Music.
The approved app (New-Ways-App.zip) is the design source and stays untouched as the original backup.

## What runs where

- **Cloudflare Worker** (`src/index.js`): builds every page on the server at its own address (`/whos-on`, `/events`, ...), so Google can read each page. In the browser, `public/js/site.js` swaps pages without reloading, which keeps the `#persistent` area (background music, later) playing.
- **D1 database** (`migrations/`): Centre Settings, editable wording and every list (mediums, events, charity totals, FAQs, gallery, visitor experiences, announcements, live, teaching videos, social links, music).
- **R2 storage** (bucket `new-ways-media`, served from `/media/...`): photographs, posters, gallery images and background music only.
- **YouTube**: teaching videos and livestreams. Video files are never stored in R2.
- **Static files** (`public/`): styles (the approved stylesheet first, unchanged, then additions), scripts, logo, icons, manifest and service worker.

## Admin sign-in (WorkOS AuthKit)

Gary signs in on WorkOS’s hosted AuthKit page (email + password, password reset by email, optional authenticator-app 2FA,
attempt limits). The Worker then (`src/lib/auth.js`, `src/lib/workos.js`):

- exchanges the code on the server with PKCE and the secret API key, and checks the access token’s signature with WorkOS’s published keys,
- accepts only `OWNER_EMAIL` with a verified address, then binds Admin to that WorkOS account,
- keeps a server-side session (only a hash of the cookie token is stored; WorkOS’s refresh token is encrypted),
- re-confirms the session with WorkOS every 10 minutes, ends it after 30 days or 14 days unused,
- checks the session on every Admin page and change, plus a CSRF token and same-site check on every change,
- limits sign-in attempts to 20 per 10 minutes per connection.

Setup steps: `docs/workos-setup.md`. Admin stays locked until all four settings are present.

## Try it locally (Node.js 22.13 or newer, no internet needed)

The local copy uses Node's built-in SQLite as a stand-in for Cloudflare D1. Older Node versions (before 24.7.0, and
some 22.x releases) bind numbered SQL parameters such as `?1` incorrectly, so the stand-in converts them itself, exactly
as D1 binds them, and checks this at start-up. The test suite also runs the site under that older behaviour to prove it.
Deno and Bun are not supported for the local copy.

```
npm run dev                         # http://localhost:8787 with a local stand-in for WorkOS (dev/mock-workos.mjs)
TEST_FIXTURES=1 npm run dev         # adds clearly marked [Test] entries and test images
NO_SIGNIN=1 npm run dev             # sign-in not configured: Admin stays locked
npm test                            # automated checks: pages, SEO, security, sign-in, sessions, all Admin sections
```

## Photos

Admin resizes photos on the phone before upload (`public/js/admin.js`): portraits to 1600 pixels on the long edge, posters to 2000,
logos to 1000, saved as WebP. A 5.6 MB camera photo became a 212 KB image in testing. The server checks every file is really a
JPEG, PNG or WebP (by content), stores it in R2 under a new random address, and deletes the old file when a photo is replaced or
an entry is deleted. Video is never stored in R2 (YouTube only).

## Stage 3 features

- **Visitor Experiences**: the public form saves every experience as `pending`; nothing is shown until Gary approves it
  (Approve, Reject, Hide, Show, Feature on Home, Delete). Spam protection: `docs/turnstile-setup.md`.
- **Teaching Videos and Live**: YouTube links only, never video files. Players load nothing from YouTube until a visitor
  taps play (privacy-enhanced youtube-nocookie.com), and every video also has a Watch on YouTube button. When YouTube
  reports a video can’t be embedded (oEmbed 401), it is switched to button-only automatically. New videos start hidden.
  A finished livestream can be added to Teaching Videos from the Live screen.
- **Gallery**: photos resized on the phone, with a 600-pixel preview copy for fast pages and a full-screen viewer.
- **Background music**: one track in R2 (MP3, M4A or OGG, up to 20 MB, streamed straight into storage, served in byte
  ranges). It never autoplays: a small Music button; the visitor’s choice (and mute) is remembered on their device. It keeps
  playing between pages because only the page area is swapped, and it pauses when a video is played.
- **Daily housekeeping** (free Cron Trigger at 03:17 UTC): deletes rejected experiences after 30 days, old spam-limit
  records and expired Admin sessions.

## Content rules built into the system

- Anything dated before today (UK time) drops off Who’s On, Events and Bookings automatically.
- Empty Centre Settings details are not shown. The GET DIRECTIONS button appears only once the exact Google Maps link is entered.
- An FAQ whose answer comes out empty is hidden (for example “Is there parking?” until parking details are added).
- Wording formatting: a blank line starts a paragraph, `- ` makes a bullet, `# ` makes a small heading, and `{Entry price}`-style details are filled in from Centre Settings. Everything typed is shown as text, never run as code.
- The temporary test address is kept out of Google (noindex and a blocking robots.txt). Only the address in `SITE_URL` is indexable.

## When changing styles or scripts

Bump `ASSET_VERSION` in `src/lib/http.js`, and the matching `?v=` entries and `VERSION` in `public/sw.js`, so phones fetch the new files.

## Backups and recovery

- Admin → Backups: download a full backup (one JSON file: all content, settings, experiences, and the list of R2 files),
  save a copy now, and see storage used against R2's free 10 GB. A weekly copy is saved automatically in R2 (last 8 kept)
  by the daily Cron Trigger. Backups are never served publicly (`/media/` only serves `img/` and `audio/`).
- Rewind: D1 Time Travel keeps 7 days on the free plan:
  `npx wrangler d1 time-travel info new-ways` then `npx wrangler d1 time-travel restore new-ways --timestamp=<UTC time>`.
- Rebuild from a backup file: `node scripts/restore-from-backup.mjs backup.json > restore.sql`
  then `npx wrangler d1 execute new-ways --remote --file restore.sql` (sessions and security records untouched).

## Deploying to the temporary address (Cloudflare Workers Builds from GitHub)

1. Cloudflare account (free). R2: activate the free allowance (card on file, no charge within it; never Workers Paid,
   never Infrequent Access), create bucket `new-ways-media`.
2. D1: create database `new-ways`; put its id in `wrangler.jsonc`.
3. Private GitHub repository with these files. Cloudflare → Workers & Pages → Create → Import a repository.
   Name `new-ways`; build command empty; deploy command:
   `npx wrangler d1 migrations apply new-ways --remote && npx wrangler deploy`.
4. Secrets (dashboard → Settings → Variables and Secrets, type Secret): `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`,
   `OWNER_EMAIL`, `SESSION_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (see `docs/`). Optional:
   `GOOGLE_SITE_VERIFICATION`.
5. The site runs at `new-ways.<account>.workers.dev`, kept out of Google. The real domain stays on Google Sites until
   the owner approves a switch (a separate, later step).
