# Launch preparation: what changed

Nothing in this update launches the website, changes the domain or DNS, or turns on real online payments. Online
payments (tickets, readings, meditations, donations) stay in Square **Sandbox**. The Wednesday till's Square app card
reader is untouched and keeps working exactly as before.

## Database change

One new migration, **`migrations/0013_launch.sql`**. It only adds things; nothing existing is changed or removed:

- `donations`: one row per donation (amount, donor name and email, public or anonymous, Square payment).
- `donation_email_log`: makes sure each donor gets exactly one thank-you email.
- `cleanup_log`: a record (with a full copy of what was removed) every time test data is cleared.
- Two editable wording blocks: the introduction and the thank-you on the Support page.
- The Privacy Notice gains a short "Donations" section (only added if it isn't there already).

It runs automatically when the ZIP is deployed, as before.

## Cloudflare settings and secrets

Nothing new is needed now. One optional new setting is for launch day only:

| Setting | Now | At launch |
|---|---|---|
| `REDIRECT_TEST_ADDRESS` (variable) | not set | `1`: the temporary workers.dev address then forwards to the real address |

Everything else (Square, WorkOS, Turnstile, Resend) is unchanged. The Square keys stay as Cloudflare secrets and never
appear in the website's pages or scripts.

## What changed

1. **Donations.** A new **Support New Way’s** page (`/support`) and a small **Make a Donation** link in the footer of
   every page. The donor types any amount (£1 to £5,000; no suggested amounts), their name and email, and chooses to be
   shown on the Supporters list or to stay anonymous. They pay on Square's checkout page. Only when Square confirms
   the payment (amount, currency and location all checked) does the donation count as paid; public donors then
   appear on the list straight away, with the thank-you from everyone at New Way’s beneath it. Every donor, anonymous
   or not, gets one personal thank-you email. Square's coupon, loyalty and tipping options are switched off on all
   online checkouts, so no unwanted discounts can be applied; prices are unchanged.
   **Admin → Donations** lists every donation and can take a supporter off the public list (and put them back)
   without touching the payment record.
2. **Home page.** The large "Stay Connected with New Way’s" card is removed. The footer mailing-list section and
   button, Explore and everything else are unchanged.
3. **Admin → Clear test data.** Lists events that have bookings, private-reading bookings and the counters. Each
   clear-up shows exactly what will be removed and needs a tick plus typing REMOVE. Before removing anything it saves a
   full copy in the clean-up log and an audit entry. Events with cash/card bookings need an extra tick. While online
   payments are Sandbox, removing test online payments is allowed; once Production is switched on it refuses to
   remove online-paid bookings. Clearing reading bookings frees their slots. Counters reset to 0. Nothing is removed
   automatically.
4. **Guests who already paid through old Square ticket links.** On each event: **Already paid on Square**. It adds
   the guest(s) as paid ("Square online"), charges nothing, counts towards the event's places, gives each guest a QR
   ticket and sends the usual confirmation email if ticked. The Square receipt number can be entered so the same
   payment can't be added twice; the same email twice for one event needs a tick. Event descriptions, dates, prices
   and posters are not touched.
5. **The real £1 till payment.** **Wednesday door → Sales tonight → Match it up with Square** lists that day's card
   payments straight from Square, showing which are already in the till. Choose the one not recorded, say what it
   was for (must add up to the exact amount), and it's added to the till once. Nothing is charged, and the same
   Square payment can never be recorded twice.
6. **Emails.** Admin → System status now has "Emails to real customers": it warns while the test sender is in use and
   checks with Resend that the sending domain is verified. Existing booking, ticket and meditation emails are
   unchanged.
7. **Domain readiness.** www.newwaysmediumshipdevelopmentcentre.com always forwards to the main address. The temporary
   address forwards only once `REDIRECT_TEST_ADDRESS` is `1`. The sitemap includes the Support page.
   The seven old Google Sites pages (`/home`, `/contact-location`, `/about-new-ways`, `/psychic-suppers`,
   `/charity-nights`, `/this-weeks-medium`, `/development-class`) go permanently to the matching new page, so Google
   results and old bookmarks keep working after the switch.
8. **Floating Chat and Music buttons on phones.** They are now smaller round buttons, slide away while scrolling down
   or typing, come back when scrolling up or at the end of the page, and never sit on top of a link, button or field.
   The footer has extra room under them. They are not removed.

Checked and already correct (no change needed): the copyright year is automatic; the sharing picture is the New
Way’s logo at 1200×630; canonical addresses and sharing addresses already use the real domain; the Install App
button works from whichever address the site is opened on; payment returns, booking links and sign-in all follow the
address in use. The Help for Kids charity page and its records are untouched.

## Tested here

- Automated suites: 486 system checks and 353 feature checks, all passing.
- Real browser (Chromium) at phone widths 360/390/412 and desktop: home page, footer, a full donation through the
  Square stand-in, Supporters list, Admin pages fitting the screen, floating buttons never covering anything, the
  till, the Wednesday advance payment, and the one-download meditation.

## Not tested (needs real payments, real devices or the real domain)

- Real Square Production payments online (tickets, readings, meditations, donations): only Sandbox and a stand-in
  were used.
- A real donation on a real phone, and the real thank-you email arriving.
- The real £1 match-up against Square's actual records (tested against a stand-in of Square).
- Real email delivery from your own domain (Resend domain not yet verified).
- Facebook, WhatsApp and YouTube previews (these can only be checked on the live address).
- The domain switch itself, WorkOS sign-in on the domain, Turnstile on the domain, the Square app returning to the
  domain, and installing the app from the domain.
- Floating buttons on a real Samsung (checked in a phone-sized browser only).

# Moving online payments from Sandbox to Production (audit)

Only with Gary's approval. No code change is needed: the website switches by its settings.

1. Cloudflare secret `SQUARE_ACCESS_TOKEN` → the **Production** access token.
2. `SQUARE_LOCATION_ID` → the Production location ID.
3. Square Developer Dashboard → Production → Webhooks → new subscription to
   `https://newwaysmediumshipdevelopmentcentre.com/webhooks/square`, events `payment.created` and `payment.updated`.
   Its signature key → secret `SQUARE_WEBHOOK_SIGNATURE_KEY`. (The signature includes the web address, so the
   subscription must be for the address actually in use.)
4. `SQUARE_ENVIRONMENT` → `production`.
5. Leave `SQUARE_POS_ACCESS_TOKEN` and `SQUARE_POS_LOCATION_ID` exactly as they are (the till already uses Production).
6. Admin → System status: Square payments GREEN "REAL payments (Production)".
7. One £1 real payment each for a ticket and a donation, then refund in Square.

# Launch checklist (permanent domain)

Do these one at a time, only after Gary says go. Full detail is in `docs/go-live-checklist.md`.

1. **Admin → Backups → Download a backup now.**
2. **Admin → Clear test data**: remove the 15 Oct test event, the four test reading bookings, and reset the counters.
3. Cloudflare → the domain's DNS on Cloudflare (copy any MX email records first).
4. Workers & Pages → new-ways-website → Domains & Routes → add Custom domain
   `newwaysmediumshipdevelopmentcentre.com`, and again for `www.newwaysmediumshipdevelopmentcentre.com`.
5. WorkOS → Redirects: add `https://newwaysmediumshipdevelopmentcentre.com/admin/callback` and sign-out redirect
   `https://newwaysmediumshipdevelopmentcentre.com/admin/signed-out`. Sign in to Admin on the domain.
6. Turnstile → the widget → Hostnames: add `newwaysmediumshipdevelopmentcentre.com` (and www).
7. Square Developer Dashboard → Point of Sale API → web callback URLs: add
   `https://newwaysmediumshipdevelopmentcentre.com/admin/door/square-callback` (keep the workers.dev one too).
8. Resend → Domains → add the domain, add its DNS records, wait for Verified. Set `EMAIL_FROM` to e.g.
   `New Way’s <bookings@newwaysmediumshipdevelopmentcentre.com>`. Admin → System status → Send test email to me.
9. Square webhook for the domain (Sandbox now; Production only with approval, see above).
10. Set `REDIRECT_TEST_ADDRESS` = `1` so the temporary address forwards to the domain.
11. On Julie's and Gary's phones: remove the old installed app, open the domain, tap **Install App** again. Turn on
    chat notifications again in Admin.
12. Test: a £1 Wednesday till card payment with the Square app returns to the domain and records automatically; a
    Sandbox ticket, reading, meditation and donation; a QR check-in.
13. Facebook Sharing Debugger (developers.facebook.com/tools/debug): paste the home page and an event link, press
    **Scrape Again**. Send an event link on WhatsApp to check the preview. Update the YouTube channel link.
14. Only with approval: switch online payments to Production (above).

# The safe way to move from Google Sites (no gap, easy to undo)

The domain's DNS is currently run by Google (`ns-cloud-b1…b4.googledomains.com`), and the old site is on
`www.newwaysmediumshipdevelopmentcentre.com`.

- **Stage A, no visible change:** add the domain to Cloudflare (Free plan). Cloudflare copies the existing records,
  including the Google Sites ones and any email records. Check the copy, then change the nameservers at the
  registrar. The old Google Site keeps showing throughout.
- **Stage B, the switch (only with Gary's approval):** add the Custom domains to the Worker. Undo = remove them.
- **Stage C, after the switch:** Google Search Console (Domain property, TXT record in Cloudflare), submit
  `https://newwaysmediumshipdevelopmentcentre.com/sitemap.xml`, request indexing of the home page.

# Private readings: booking assistant (12 Oct 2026)

- The reading choices and the calendar no longer show prices.
- After a time is chosen, a chat-style booking assistant asks for full name, WhatsApp mobile and email, one at a time.
- Only when all three are valid does the website send the price of the chosen reading (from the database, as before),
  with the cancellation policy, the spam check and a "Proceed to Secure Payment" button. That button uses the existing
  booking step, hold, Square checkout, return page and emails unchanged. A reading is still only confirmed once Square
  confirms the payment.
- Files: src/bookings/public.js, src/views/booking.js, public/js/site.js, public/css/site.css, tests.
