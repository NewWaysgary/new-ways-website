# New Way’s Community: Stage 3 (the thank-you card editor)

Built on the GitHub version with Stage 2 (commit 6543fd9, 13 October 2026). The Community stays hidden from the
website’s menu, tab bar and sitemap, and Google is still asked not to list its pages.

## What is new

**Admin › Community cards** (`/admin/community`, Gary and Julie only; check-in helpers cannot open it):

- **New thank-you card** makes a *draft*. The guest medium’s name and Wednesday date come from Who’s On (the most
  recent Wednesday up to today, otherwise the next one), and the background is the next design in the nine-design
  rotation. Everything can be changed.
- **The card editor** (phone first): the card stays at the top of the screen and redraws as soon as anything changes.
  - Tap the wording or the badge on the card, then drag it with a finger, or use the arrow, **Centre**, **A−** and **A+** buttons.
  - Guest medium: choose from Who’s On, or type the name and date. The date line follows the date unless it has been retyped.
  - Background: any of the nine designs (thumbnails), **Next Design**, and the rotation’s next suggestion.
  - Wording: Heading, Medium’s name, Message (up to 4 lines) and Date line, each with its own lettering (Cinzel,
    Jost, Cormorant or Great Vibes), thickness, size, colour (gold, light gold, white, soft blue, electric blue, navy
    or any colour), lining up, and position. Leaving a line empty leaves it off the card.
  - Official badge: show or hide, size and position.
  - Effects: **Animate Logo** (gold shimmer on the website and app) and **Soft text shadow**.
  - A warning appears if wording goes past the edge of the card.
- **Save draft** (nothing is ever published automatically), **Publish** (asks first), **Save and update published
  card** (asks first), **Move back to drafts**, and **Delete draft**.
- **Download Facebook Image**: the finished card (background, all the wording and the badge, still) as a
  **1733 × 910 JPEG** (the backgrounds’ own sharpness, ≈1.9:1), made on the phone from exactly what is on screen,
  saved to the phone’s Downloads.
- **Copy Facebook Link** (once published): copies the card’s own Community address.
- When a card is published or updated, the phone also sends a **1200 × 630** picture of the finished card, which the
  website keeps with its photos (R2) and uses as the card’s Facebook link preview. The server checks it is really a
  JPEG of exactly that size. A card’s address is fixed when it is first published, so shared links keep working.

**One set of drawing rules**: `public/js/community-card.js` draws the card for the website (on the server), the
editor’s live card and the Facebook pictures, so they match. `public/js/community-editor.js` is the editor.

## Files

New: `public/js/community-card.js`, `public/js/community-editor.js`, `src/views/admin-community.js`,
`public/images/community/bg-NN-thumb.webp` (9 small thumbnails, 6–12 KB each), three small test pictures in
`tests/fixtures/`, and this note.
Changed: `src/community/card.js` (now uses the shared drawing file; the card markup is the same as Stage 2 plus
`data-role` labels), `src/community/model.js`, `src/community/public.js` (loads the card lettering), `src/admin/community.js`,
`public/css/community.css` (editor styles; version 2), `src/views/admin.js` (the Admin home button is now
**Community cards**), `tests/community.test.mjs`.

**No database update.** Stage 3 uses the tables added in Stage 2 (`community_posts`, `community_rotation`).

Not changed: the website’s menu, tab bar, sitemap, styles and scripts (`site.css`, `site.js`, `admin.js`, versions stay
at 17), the service worker, both app manifests, sign-in, payments, bookings, Wednesday door, chat and notifications.

## Tests

`npm test`: 494 + 463 existing checks and 114 Community checks (64 from Stage 2, updated for Stage 3, plus 50 new), all passing.
