# The complete build (October 2026)

Everything agreed in the handover, built as one update on top of the working website. Nothing existing was redesigned
or removed: same pages, layout, navy and gold, fonts, logo, menu, animations, Admin design and working features.
Square stays in **Sandbox**, email stays in test mode, and the domain and DNS are untouched.

One database update is included: `migrations/0009_complete_build.sql`. It only ADDS tables and columns. The only
changes to existing rows: meditation download time 48 → 24 hours, and the Privacy Notice is replaced only if it was
still the website's own wording (the old wording is kept as a copy).

Automated checks: the original 475 (all still passing, with the meditation ones updated to 24 hours and device
protection) plus 225 new ones in `tests/features.test.mjs`, and 28 checks in a real Chromium browser on a phone-sized
screen (till taps, chat, payment total, table plan drop-downs). **None of this replaces testing on your own phone.**

## Living checklist

| | Item | State |
|---|---|---|
| A | *(Changed later: see `docs/CHANGES-one-download.md` — no codes, no 15-minute restart.)* Meditation: 24 hours to START the one download; email says so clearly; forwarded links protected (works on the buying device; another device needs a 6-digit code emailed to the buyer); one download, 15-minute restart, Admin reissue (now with an "any device" option), private R2, Android attachment download unchanged | Built, tested here. **Awaiting Gary's phone test** |
| B | Event pages `/events/ID`, Copy link / Share in Admin, Facebook/WhatsApp previews with the poster (a JPEG copy is made when a poster is saved), title, date, short information | Built, tested here. Real Facebook/WhatsApp previews **can only be checked by sharing** |
| C | Table planner: any number of round tables and seats, drop-down on each table (whole booking or one guest), no duplicates, no overfilling (also enforced by the database), split warnings, moves, meal/dessert per guest, totals per table and event, separate Mediums' table (catering only, not paid places), printable plan (one table per page + catering totals; save as PDF from Chrome), CSV | Built, tested here. **Awaiting Gary's phone test** |
| D | Wednesday door till: prominent tile, big repeat-tap buttons, quantities, Undo, Clear, Scan QR, itemised GRAND TOTAL before cash/card, editable labels/prices/order/on-off, prices copied into each sale, Close night with cash count, reports and CSV, live totals on several phones, no double counting | Built, tested here. **Awaiting Gary and Julie's test** |
| D | Square app card handoff | Built but **switched off and NOT tested**: it only works with the real (Production) Square app |
| E | Optional advance payment on Who's On, exact wording "No booking required. Everyone is welcome to come along and pay at the door.", email only, same products and prices as the till, Square Sandbox, one confirmation with QR and quantities | Built, tested here (Sandbox stand-in). **Awaiting Gary's phone test** |
| F | Wednesday QR check-in from the door screen: all quantities, Let 1 in / CHECK IN EVERYONE, GIVE 3 RAFFLE STRIPS and RAFFLES GIVEN ✓, repeat scans, undo | Built, tested here. **Awaiting test** |
| G | 6pm Wednesday email (that evening's QR again, once, not for closed nights, refunds or late payers) | Built, tested here with fixed times. **Awaiting a real Wednesday** |
| H | Emergency closure: per date, public reason, blocks advance payments, records kept, email everyone who paid (once), refunds stay manual in Square | Built, tested here. **Awaiting test** |
| I | Julie full Admin with her own sign-in (only adding/removing full Admins is kept for Gary); check-in helpers unchanged | Built, tested here. **Gary must add Julie** |
| J | Second notification address (Julie) for readings, meditations and payment problems; optionally event tickets; nothing for door sales | Built, tested here. **Gary must enter the address** |
| K | Native live chat: anonymous, server-kept, same-browser return, Julie replies in Admin, truthful Online/Away, anti-spam, deleted after 90 days (adjustable), phone notifications (Web Push, free) | Built, tested here (including notification encryption). **Starts switched OFF**. Notifications **not yet tested on a real Android phone** |
| L | "Stay Connected with New Way's" and JOIN OUR MAILING LIST on Home and in every footer (same Join page and list) | Built, tested here |
| M | Updated Privacy Notice covering everything; go-live checks in System status | Built. **Gary to read it through** (it is not legal advice) |
| N | Background music | The code already had a visible tap-to-play Music button. It only shows when a track is uploaded AND "Music on the website" is ticked. Admin now says clearly when it is switched off, and warns if the track looks like the paid meditation. **Gary to check Admin > Background music** |
| O | Footer year | Already automatic (nothing to change) |
| P | Available Sundays calendar | Already done by the website's own booking calendar. No Square Bookings integration added (it would compete) |
| Q | Virtual tour | Built. Shows nothing until Gary adds **genuine photos** (Admin > Virtual tour) |

## First things to do in Admin (one at a time)

1. **Admin team** → give Julie full Admin (her email address). She then signs in with her own password.
2. **Private Readings → Booking rules** → "Second notification email address" → Julie's address.
3. **Wednesday Door → Buttons & prices** → check the prices (Entry £5, Development £3, Raffle strip £1, Gift Shop).
4. **Background music** → if you want music, tick "Music on the website" and Save.
5. **Live chat** → when Julie is ready: on her phone, "Turn on notifications on this phone", then tick "Show the Chat
   button on the website" and Save. Use "Online for 2 hours" when someone is watching.
6. **Pages and wording → Privacy Notice** → read it through.
7. **Virtual tour** → add real photos of the centre, in order, when you have them.

## Things to know

- While the email provider's test sender is used, emails only reach newwaysmediumship@gmail.com. Julie's copy, customers' Wednesday emails and download emails only reach other
  addresses once the domain is verified with Resend at go-live.
- Facebook and WhatsApp previews from the test address: allowed via robots.txt for preview services only; Google is
  still kept out. Share again from the real address after go-live.
- Posters saved before this update have no JPEG sharing copy: re-save the poster (Edit event) for the best WhatsApp
  preview. WhatsApp's support for WebP previews isn't guaranteed, which is why the JPEG copy is made.
- Download protection relies on the browser keeping a cookie. (Since the one-download update there are no codes: see
  `docs/CHANGES-one-download.md`.)
- Cloudflare free plan: the website now uses 3 Cron Triggers (daily, hourly, and Wednesday 6pm).
- Phone notifications are free (Chrome's own push service). They work best with Admin added to the home screen.
- Nothing refunds money automatically, anywhere. Refunds are always done by Gary in Square.
