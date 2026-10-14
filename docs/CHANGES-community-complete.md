# New Way’s Community: complete build (Stages 4 to 9 and the Designer)

Built on the GitHub version with Stage 4 (commit a3885ec, uploaded 14 October 2026; checked identical to the Stage 4
build). Nothing has been uploaded, deployed or changed on Cloudflare by Claude; no new services are used.

## Start here: the Community launch switch (Admin › Community launch)

The Community starts **Off**. Nothing becomes public until Gary or Julie change it, and every change is recorded.

| Setting | What visitors get |
|---|---|
| **Off** (default) | Nothing of the Community is public: the Community page, every card link and every request answer “not found” or “not open”. Admin previews still work. |
| **Testing** | Everything works for anyone with the link, but it is **not** in the website’s menu or sitemap and Google is asked not to list it. |
| **Live** | “New Way’s Community” appears in the menu and sitemap and can be found on Google. |

Switching back to Off hides everything again straight away. The launch page also reminds you to add a Community
section to the Privacy Notice before going Live, with suggested wording; the notice is never changed for you.

## The Designer (Admin › Designer)

- Full 1733 × 910 drawing area that fits the phone screen. Two-finger pinch and rotate, large handles, snap guides.
- **Background:** the 9 original designs (unchanged), your own uploads, or a colour. Fill or Fit, zoom and move,
  brightness, contrast, saturation, warmth, blur, plus filter presets. Pictures are never stretched.
- **Text:** 26 free Google Fonts, curved text, outlines, shadows, gradients, glow, letter spacing, alignment.
- **Photos, stickers, shapes, stars, sparkles, frames (11 styles) and effects** (glow, rays, sparkle dust, bokeh,
  vignette, haze).
- **Official badge** on any background, movable and resizable, shimmer on or off (still for reduced motion).
- **Layers** (order, hide, lock), rotation, opacity, duplicate, delete, **Undo/Redo** (60 steps).
- **Projects:** drafts are saved and can be re-opened and edited, also after publishing. **Templates:** save any design.
- **Library:** upload backgrounds, photos, stickers and frames (shrunk on the phone first), folders and favourites.
  Uploads stop at 8 GB, well inside Cloudflare’s free 10 GB.
- **Download Facebook Image** (1733 × 910 JPEG, with the badge drawn in) and **Copy Facebook Link**.
- **Publish:** stores the finished artwork and a 1200 × 630 Facebook preview picture; the card’s page shows the artwork
  with the badge as a live, shimmering layer.
- The original Stage 3 card editor is unchanged and still works. Background removal was **not** built.
- Drawing library: Konva 9.3.22 (MIT licence, free), served from the website itself.

## Public Community (Stages 5 and 7)

- Community page and card pages with a welcome panel: **Install Our App** (the existing install button) and
  **Enable Wednesday Notifications**. Everything works without installing anything.
- Inside Facebook’s own browser: an “Open in Chrome” button on Android (with steps if it doesn’t work) and Safari steps on iPhone.
- **Like, Love and Thank You** reactions; named comments; one level of replies; comment likes; **Report**.
- No accounts. All Stage 4 protections apply to every comment, reply and name (blocked comments keep the wording in the
  box). Plus the “I’m human” check (Turnstile), a hidden spam trap, a minimum time on the page and rate limits.
- 3 reports from different visitors hide an ordinary comment until Gary or Julie look at it. Reports never hide an
  official comment or one Admin approved. Report uses rate limits and visitor codes, not Turnstile.
- Works without JavaScript (forms post normally).

## Verified Admin comments (Stage 6)

- “Admin Gary ✓” and “Admin Julie ✓” in green, posted only from Admin › Community cards › Comments and notify.
- Gary’s Admin login can only post as Gary; Julie’s (an Admin user named Julie) only as Julie. Visitors can’t use these names.
- Separate switches, both **off** to start: each can switch their own on or off; either can switch the other’s **off**, never on.

## Wednesday notifications (Stage 8)

- Visitors opt in with a tap; no account. Kept completely separate from Admin chat notifications.
- Sent **only** when Gary or Julie press “Send notification” on a card; never automatically. Each card can be sent once.
- Sent in batches of 10 from the Admin page; if the page is closed, the hourly job finishes the send.
- Phones that unsubscribed or whose browser removed them are deleted from the list. A tap opens the card.
- Uses the website’s existing free notification keys; no paid service.

## Statistics (Admin › Community launch › Visitor statistics)

Total visits, estimated different visitors, today, 7 and 30 days, from Facebook, and views per card. No cookies, no
IP addresses, no paid analytics. Admin pages and previews, search engines and link previews aren’t counted. Daily
scrambled codes are deleted after two days.

## Database updates (applied automatically by the upload)

- **0019_community_moderation.sql** (Stage 4): already on GitHub from your Stage 4 upload; not changed.
- **0021_community_report_networks.sql** (security review): one new column so reports also record a scrambled network code.
- **0020_community_launch.sql**: community_config (launch Off, both official switches off), reactions, comment likes,
  notification subscribers, sends, deliveries, statistics, daily codes, library, templates, and three new columns on
  community_posts (kind, design_json, art_key). Only adds; nothing existing is changed or deleted.

## Storage

- Each published Designer card: about 0.3–0.8 MB (artwork plus Facebook picture). Each library picture: usually
  0.1–0.6 MB. Database growth is small (comments, counts). Hundreds of cards fit easily in the free 10 GB.
- New website files: about 0.3 MB (mostly the drawing library).

## Tests

`npm test` now runs six suites: system 494, features 463, community 115, moderation 90, launch 102 and security 56:
1,320 checks, all passing. A phone-sized browser run also completed the whole flow (design, download, publish, launch to
Testing, react, blocked and good comments, like, reply, official comment, statistics, Facebook help) and a touch drag
in the Designer.

Not testable here: a real Samsung phone, Facebook’s own browser, real notification delivery by Google/Apple, and
Google Fonts loading (blocked in the test browser).

## Security review (14 October 2026)

Every Admin address (43 of them, including bookings, orders, Wednesday Door, settings, team, chat, backups and
status) was called directly by a signed-out visitor and by a signed-in check-in helper: all refused, and nothing in
the database changed. Forged requests (no token, wrong token, another website) are refused. See `tests/security.test.mjs`.

Fixed during the review:
1. **Off now really means off**: card links no longer work while the Community is Off (before, a published card’s
   own link still showed the card). Use Testing when you want to share links.
2. **Reports**: one person could hide a comment alone by reporting it from 3 browsers or private windows. Now 3
   reports must come from 3 different networks; all reports are still shown to Gary and Julie.
3. **Reactions and likes**: one connection can now add only a few to any one card or comment per day.
4. **Request size**: the size limit is now checked while reading, so a request without a stated size can’t be larger;
   files are never accepted at public Community addresses.
5. **Notification addresses**: the live website no longer accepts notification addresses on the same computer
   (only the test copy does), and the list is capped at 20,000 phones.
6. **Verified Julie**: if two active Admin team members are called Julie, neither gets the Julie badge.
7. **Statistics**: a visit is counted once per visitor, per page, per day, with a daily cap, so fake traffic can’t use
   up the free database allowance that bookings rely on.
8. **Designer library**: an error message can no longer be put into the page through its address.
