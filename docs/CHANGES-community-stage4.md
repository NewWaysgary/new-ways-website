# New Way’s Community: Stage 4 (comment protection and moderation)

Built on the GitHub version with Stage 3 (commit c387ccc, 13 October 2026). Public comments, replies, reactions and
the Report button are **not** switched on (that is Stage 5). The Community stays out of the menu and sitemap, and the
Stage 3 card editor and Facebook image download are unchanged.

## The protections (`src/community/moderation.js`, `src/community/comments.js`)

Every comment, reply and display name gets one of three results, always decided on the server:
**ALLOW** (published straight away), **HOLD** (kept privately until Gary or Julie approve it) or **BLOCK** (not
published and not stored; the visitor sees a friendly message and keeps their wording to change).

- **Language:** the editable word lists, after undoing disguises: capitals, accents, look-alike letters from other
  alphabets, numbers and symbols for letters (sh1t, $hit, sh!te), spaced, dotted or split letters (f u c k, f.u.c.k,
  fu ck), stretched letters (fuuuuck), hidden characters and masked words (f**k). Strong words are also caught inside
  longer words. Innocent words are never caught (Scunthorpe, cocktail, snigger, Essex, blue tit, Dickens, assessment);
  30 realistic thank-you messages are in the tests and all are allowed.
- **Links:** web addresses (also “dot com”, “(dot)” and “ . com” spellings), short and payment links, email addresses,
  phone numbers (10+ digits), pictures and page code. Times, dates, prices and a missing space after a full stop are not
  mistaken for links; something that only might be an address (evening.it) is held.
- **Scams and advertising:** spare, sold or passed-on tickets; priced or advertised readings and services; requests
  for money and payment services; moving the conversation to WhatsApp, DMs and similar; pretending to be New Way’s.
  Clear cases are blocked; unclear ones are held. Ordinary questions (“Are there any tickets left for Friday?”) are allowed.
- **Names:** no Admin, Official, Staff, Moderator, Team or New Way’s names, no “Gary Findlay” or “Medium Gary”, and no
  tick or badge symbols (also when disguised). People simply called Gary or Julie are fine. Names matching a guest
  medium in Who’s On (last 400 days) are held. Names can’t contain swearing or links; 40 characters at most.
- **Repeats:** the same visitor posting the same wording again is stopped; the same wording from other visitors in
  the last 14 days is held. Comments over 1,000 characters are refused.
- **Repeat offenders:** 3 blocked comments within a day hold that visitor’s comments for 7 days. Never a permanent ban.
- **Visitor code:** a scrambled code (HMAC with the website’s existing secret) made from the first part of the IP
  address, the browser type and, from Stage 5, a random code kept by the visitor’s own browser. The IP address is never stored.
- **Reports (ready for Stage 5):** one report per visitor per comment; 3 reports from different visitor codes hide an
  ordinary published comment pending review; reports never hide a verified Admin comment or one Admin has approved or
  restored; people can’t report their own comment; Admin can make a visitor’s reports stop counting.

A full check takes about 1 millisecond, well within Cloudflare’s free allowance. No outside or paid service is used.

## Admin › Community moderation (Gary and Julie; check-in helpers cannot open it)

- **Comments:** Held for review, Hidden, Published and Rejected, each with the reasons; Approve, Reject, Hide,
  Approve and restore, and Delete (removes replies too). Empty until Stage 5.
- **Test a Comment:** type any wording (and optionally a name) to see ALLOW, HOLD or BLOCK, the reasons and the
  message the visitor would see, plus 14 one-tap examples. It uses exactly the same checks, and stores, publishes and
  sends nothing (the tests confirm no table changes at all).
- **Word lists:** add a word or phrase (Block, Hold for review or Allow), choose its type, find a word, remove a word.
  The lists open only when tapped, because they contain offensive words. Changes take effect immediately.
- **Repeat visitors:** hold all of a visitor’s comments, ignore their reports, or clear their record.
- Every moderation action and word-list change is recorded in the audit log.

## Database update `0019_community_moderation.sql`

Adds four new tables (`community_words` with 338 starter entries, `community_comments`, `community_reports`,
`community_visitors`). No existing table or record is changed or removed. Applied automatically by the deploy workflow.

## Small changes to existing files

`src/admin/router.js` (connects the moderation screens), `src/views/admin.js` (Admin home button **Community
moderation**), `src/lib/backups.js`, `scripts/restore-from-backup.mjs`, `src/admin/status.js` (the new tables in backups,
restores and System status), `package.json` (`npm test` also runs `tests/moderation.test.mjs`), `tests/community.test.mjs`
(one check now allows later database updates). New styles are in their own file, `public/css/moderation.css`.

## Tests

`npm test`: 494 + 463 existing checks, 114 Community checks and 90 new moderation checks, all passing.
