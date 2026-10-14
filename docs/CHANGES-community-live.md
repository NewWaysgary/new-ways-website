# New Way's Community: live comments (14 October 2026)

Built on the GitHub version with the security review (commit 02df70f; checked identical). Nothing has been uploaded,
deployed or changed on Cloudflare by Claude. No paid services, subscriptions or emails. The Community stays in Testing.

## What's new

**Public card pages**
- New comments, replies, official Admin Gary ✓ / Admin Julie ✓ replies, reactions and likes appear by themselves.
- Hidden or deleted comments disappear by themselves (with their replies). A card taken down says so.
- Replies stay in their conversation, oldest first. Replying to a reply now works: it joins the same conversation and
  shows "↪ replying to Ann".
- Your own comment appears at once, without reloading the page.
- Nothing moves while you read or type: the comment box is never touched and the page keeps your place.
- A small line shows the state: "Live: new comments appear automatically", or "paused" with a Refresh comments button.

**Admin › View Live Comments** (Community cards › View Live Comments under each published card; also in the
original card editor and the Designer)
- The whole conversation, updating by itself, with replies in their threads.
- "Needs your review": held and hidden comments for this card with the reason, Approve/Restore, Reject and Delete.
- Reply officially to any comment or reply; Hide and Delete (with confirmation); all without leaving the page.
- Switch card (Newer, Older, or choose from the list).
- View Public Card is clearly labelled: comments posted there are ordinary public comments, not verified Admin comments.

**Phone notifications for Gary and Julie** (Admin › Community launch › Your Community notifications)
- Uses the Admin phones already set up for live chat notifications. Free; no email.
- Each person chooses: every new comment, only ones needing review, or none; and whether names and words show on the
  lock screen.
- Each comment is notified once. For each card, at most one notification every 2 minutes, then "3 more comments…".
  Tapping opens that card's View Live Comments.
- Official comments never notify. A one-off alert is sent if the daily live safety limit is reached.

## How it stays free (Cloudflare Free plan, checked in Cloudflare's documentation)

- **One Durable Object** (free on the Workers Free plan, SQLite-backed as the free plan requires) holds the live
  connections. It uses **hibernation**: between messages it sleeps and is not counted; keep-alive pings are answered
  automatically without waking it. On the free plan, if a Durable Object limit were ever reached it simply stops until
  midnight UTC: it never charges.
- New comments are **sent out** to phones; outgoing messages cost nothing. Phones never keep asking.
- Each live connection uses one of the 100,000 free daily website requests; reconnecting after the phone sleeps uses one more.
- Changes are **grouped**: one message per card per second (every 4 seconds when busy).
- Phones that can't connect live check gently: every 60 seconds (180 when busy), only while the page is on screen,
  and they try live again every 5 minutes. Catching up uses the database only when something has actually changed,
  and identical answers are kept briefly at Cloudflare's edge.
- **Safety settings** (Admin › Community launch › Live updates and safety; saved in the database, no upload needed):
  daily live connections (15,000), grouping more from 70%, per card (1,500) and total (4,000) at once, daily fallback
  checks (5,000) and their interval (60 s), plus an on/off switch. At the daily limit new live connections pause until
  midnight UTC: cards, comments and reactions keep working, phones already connected keep receiving updates, and Admin
  is never refused. With the standard settings the live features use at most about 20,000 of the 100,000 requests.
- **What is measured exactly:** the Community's own live connections, refusals, fallback checks and updates sent today,
  and how many phones are connected now. **What is not known to the website:** Cloudflare's total for the whole site;
  that is in the Cloudflare dashboard (Workers & Pages › new-ways-website › Metrics).

## Changes to files

- `wrangler.jsonc`: the `COMMUNITY_LIVE` Durable Object binding and its `new_sqlite_classes` migration.
- `migrations/0022_community_live.sql` (only adds): `community_posts.live_version`, `community_comments.reply_to_id`,
  `community_admin_prefs`, `community_alerts`.
- New: `src/community/live-do.js` (the Durable Object), `src/community/live.js`, `src/community/alerts.js`,
  `public/js/community-live-admin.js`, `dev/live-emulation.mjs` (local test copy only), `tests/live.test.mjs`,
  `tests/support/ws-client.mjs`.
- Changed: public Community routes and page, `community.js` (v=2), `community.css` (v=4), the Admin Community view,
  moderation (live updates), Community cards list, card editor and Designer buttons (`designer.js` v=2),
  `moderation.css` (v=4), backups and status (new tables), the hourly job (notification summaries).

## Tests

`npm test`: system 494, features 463, community 115, moderation 90, launch 102, security 56 (now also covering the new
Admin addresses) and live 81 (new): 1,401 checks, all passing. A phone-sized browser run also passed 18 checks: live
replies arriving under the right comment while someone types (words, cursor and position unchanged), official replies,
own comment without reload, hidden comments disappearing, reconnecting after going offline and catching up, and the
Admin page (new comments, review, approve, reply officially, delete, all without reloading).
