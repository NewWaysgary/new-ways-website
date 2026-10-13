# New Way’s Community: Stage 2 (hidden Community page and Admin preview)

Built on the GitHub version saved on 13 October 2026 at 18:30 (commit 92e06cc). Nothing is public in this stage.

## What is new

- **Nine approved backgrounds** (designs 01–06, 08, 09, 10) as lighter website copies in `public/images/community/`:
  `bg-NN-800.webp`, `bg-NN-1200.webp` and `bg-NN-full.webp` (the original width, never enlarged). 27 files, about 6.4 MB
  in total; a phone normally loads one 1200-wide copy of about 130–280 KB. The original PNG artwork is not in the
  website or this ZIP and was not changed.
- **The thank-you card** (`src/community/card.js`, styles in `public/css/community.css`):
  - the background picture, with the wording as real text and the official New Way’s badge as a separate layer on top;
  - the badge is the existing logo shown as a circle, with a soft gold halo and, when **Animate Logo** is on, a gentle
    band of gold light that passes across it continuously; visitors whose phone is set to reduce motion see it still;
  - an optional **soft text shadow** behind the wording;
  - positions are numbers in a 1200 × 630 space (the size of the Facebook picture), so the Facebook picture in Stage 3
    can be drawn from exactly the same layout. No inline styles are used, so the website’s security rules are unchanged.
- **The public card page** `/community/<number>-<name>` (`src/community/public.js`): shows only *published* cards
  (anything else is “not found”), has its own Facebook title, address and picture details, and asks Google not to
  list it while the Community is hidden. Publishing is added in Stage 3, so nothing can appear yet.
- **Admin › Community preview** (`/admin/community/preview`, Gary and Julie only; check-in helpers cannot open it):
  a clearly marked sample card on each of the nine designs, with **Animate Logo: On/Off** and **Text shadow: On/Off**.
- **The nine-design rotation** (`src/community/model.js`): each design is used once before any repeats, a design
  picked by hand counts as used, and a new round never starts with the design just used.
- **Database update `0018_community_cards.sql`**: adds two new tables (`community_posts`, `community_rotation`). No
  existing table or record is changed or removed. It is applied automatically by the existing deploy workflow.

## Small changes to existing files

- `src/index.js`: sends `/community/...` addresses to the new Community page.
- `src/views/layout.js`: pages can now ask Google not to list them (used only by Community pages).
- `src/admin/router.js` and `src/views/admin.js`: the Community preview screen and its Admin home button.
- `src/lib/backups.js`, `scripts/restore-from-backup.mjs`, `src/admin/status.js`: the two new tables are included in
  backups and restores, and System status checks they exist.
- `package.json`: `npm test` also runs `tests/community.test.mjs`.

Not changed: the public menu, tab bar and sitemap, the website’s styles and scripts (`site.css`, `site.js`, versions
stay at 17), the service worker, both app manifests, sign-in, payments, bookings, Wednesday door, chat and notifications.

## Tests

`npm test`: 494 + 463 existing checks and 65 new Community checks, all passing (1,022 in total).
