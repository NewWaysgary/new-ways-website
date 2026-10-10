# Go-live checklist (real domain, real payments, real emails)

**Do none of this until Gary approves going live.** Until then the website stays on the temporary address, Square
stays in Sandbox (no real money) and the email provider stays in test mode. Nothing in the code needs changing to go
live: every step below is a setting in a dashboard. Do the steps in order, one at a time, and check **Admin → System
status** after each part.

The website reads these settings (Cloudflare → Workers & Pages → **new-ways-website** → Settings → Variables and
Secrets). Never paste a secret into a chat, an email or GitHub.

| Setting | Now (testing) | When live |
|---|---|---|
| `SITE_URL` (in `wrangler.jsonc`) | `https://newwaysmediumshipdevelopmentcentre.com` (already the real address) | unchanged |
| `SQUARE_ENVIRONMENT` | `sandbox` | `production` |
| `SQUARE_ACCESS_TOKEN` (secret) | Sandbox token | Production token |
| `SQUARE_LOCATION_ID` | Sandbox location | Production location |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` (secret) | Sandbox subscription's key | Production subscription's key |
| `EMAIL_FROM` | `New Way’s <onboarding@resend.dev>` (test sender) | e.g. `New Way’s <bookings@newwaysmediumshipdevelopmentcentre.com>` |
| `RESEND_API_KEY` (secret) | test key | can stay the same key |

## 0. Before starting

- [ ] Everything has been tested on the temporary address in Sandbox: a private reading, a meditation (download on an
      Android phone, found in Downloads, plays later), an event booking with guests and meal choices, a cash booking,
      check-in by QR and by search (two phones), the reminder, the Join page, unsubscribing.
- [ ] The complete-build features have been tested too (see `docs/CHANGES-complete-build.md`): meditation download on
      the buying phone and on a second phone with the emailed code, Julie's own sign-in, the Wednesday door till
      (cash, card, undo, close night), a Wednesday advance payment and its QR check-in with RAFFLES GIVEN, the 6pm
      email, an emergency closure, live chat with a notification on Julie's phone, the table plan and its PDF.
- [ ] **Admin → Pages and wording → Privacy Notice**: the updated notice is in place and has been read through.
- [ ] **Admin → Backups → Download a backup now**, and keep the file safe.
- [ ] Choose a quiet time. Keep the existing public Square event links exactly as they are throughout.

## 1. Connect the real domain to the existing website

The same Worker, database, storage and Admin are used: nothing is rebuilt.

- [ ] The domain must be using Cloudflare for its DNS (Cloudflare → Add a site → Free plan, then change the
      nameservers at the domain registrar to the two Cloudflare shows). Copy any existing email (MX) records first.
- [ ] Cloudflare → Workers & Pages → **new-ways-website** → Settings → **Domains & Routes** → Add → **Custom domain** →
      `newwaysmediumshipdevelopmentcentre.com`, then again for `www.newwaysmediumshipdevelopmentcentre.com`.
      (At this moment the Google Site stops showing on that address.)
- [ ] Open the real address: the home page loads, and **Admin → System status** shows "Address in use now" as the real
      address.

## 2. Sign-in, spam protection and email on the new address

- [ ] **WorkOS** dashboard → Redirects: add `https://newwaysmediumshipdevelopmentcentre.com/admin/callback` as a
      redirect URI, and `https://newwaysmediumshipdevelopmentcentre.com/admin/signed-out` as a sign-out redirect.
      Sign in to Admin on the real address.
- [ ] **Turnstile** (Cloudflare → Turnstile → the widget → Hostnames): add the real domain.
- [ ] **Resend** → Domains → Add domain → add the DNS records it shows (in Cloudflare DNS) → wait for **Verified**.
- [ ] Change `EMAIL_FROM` to an address on the verified domain, e.g. `New Way’s <bookings@newwaysmediumshipdevelopmentcentre.com>`.
- [ ] **Admin → System status → SEND TEST EMAIL TO ME**. It arrives (check spam the first time). Email sending is GREEN.

## 3. Square Production

- [ ] Square Developer Dashboard → the application → **Production** → Credentials: copy the Production access token
      into the Cloudflare secret `SQUARE_ACCESS_TOKEN`.
- [ ] Production → Locations: copy the Production location ID into `SQUARE_LOCATION_ID`.
- [ ] Production → Webhooks → Add subscription: URL `https://newwaysmediumshipdevelopmentcentre.com/webhooks/square`,
      events **payment.created** and **payment.updated**. Copy its signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- [ ] Set `SQUARE_ENVIRONMENT` to `production`.
- [ ] **Admin → System status**: Square payments GREEN "REAL payments (Production)", connected to your location.
      If it says the location doesn't belong to the token, the token and location are from different accounts or
      environments.

## 4. One small real payment, checked end to end

- [ ] Admin → Events → Add an event "Go-live test", online tickets, price **£1**, maximum places **1**.
- [ ] On a phone, book 1 ticket with a guest name and pay £1 with a real card.
- [ ] **System status**: Square payment notifications GREEN, with the time of the notification just received.
- [ ] Admin → the event → Guest list: the booking is BOOKED and PAID.
- [ ] The customer confirmation email arrived, with the QR code.
- [ ] Gary's notification email arrived.
- [ ] Admin → Check in → scan the QR code from the email: the guest checks in; scanning again says ALREADY CHECKED IN.
- [ ] Cancel the test booking in Admin and refund the £1 in the Square Dashboard. Untick "Published" on the test event.
- [ ] Optional: the same with a private reading and a meditation (refund afterwards).

## 4b. The complete-build parts on the real address

- [ ] Event links shared before go-live point at the test address. Share events again from **Admin → the event → Share
      this event** once the real address is live, so Facebook and WhatsApp previews use the real address.
- [ ] **Live chat**: on Julie's phone, open Admin on the real address and tap **Turn on notifications on this phone**
      again (notifications belong to each web address), then **Send a test notification**.
- [ ] **Wednesday advance payments**: pay £1-worth (for example one raffle strip) for the coming Wednesday with a real
      card, check it in from the Wednesday door screen, then mark it as refunded and refund it in Square.
- [ ] Optional, card handoff to the Square app: only now can **Wednesday door → Buttons & prices → Square app
      handoff** be tried (it needs the Production application ID and the callback address
      `https://newwaysmediumshipdevelopmentcentre.com/admin/door/square-callback` registered in the Square Developer
      Dashboard). If it doesn't work on the phone, leave it switched off: the till works fully without it.

## 5. Only then: switch events over

- [ ] For each future event, decide when to change **How are tickets sold?** from "Square ticket link (as now)" to
      "Online tickets on this website". Bookings already made through the old Square links can be added with
      **Add a booking** (payment method "Square online"), so the guest list is complete.
- [ ] Only after that, remove or replace the old public Square event links (in Square, and anywhere they are posted).
- [ ] Print the table QR code (Admin → Mailing list → Join page and table QR code): it now points to the live address.
- [ ] In Square → Sandbox webhooks, the old test subscription can be deleted.

## If something goes wrong

- To stop taking real payments at once: set every event back to "Square ticket link (as now)", and in Private Readings
  set no availability (or remove `SQUARE_ACCESS_TOKEN`, which closes online booking and buying everywhere).
- Database changes can be rewound to any minute in the last 7 days (Cloudflare D1 Time Travel); backups are under
  Admin → Backups.
- Removing the custom domain from the Worker (step 1) gives the address back to whatever DNS points to it.
