# Private Reading bookings, Square payments and the Meditation Shop

This explains how the new parts work and what has to be set up in the dashboards. None of the private keys are
in this code or in GitHub. Each one is added in Cloudflare as a **secret** (Workers & Pages → new-ways-website →
Settings → Variables and Secrets → Add → type *Secret*). Gary does this himself, one step at a time; nobody needs
him to paste a key into a chat, an email or GitHub.

## What the website does

- **Private Readings**: customers choose a 30- or 60-minute reading, a date and a start time on the website's
  own calendar, give their name, email and WhatsApp mobile number, read the cancellation policy and tick to
  accept it, then pay on Square's secure checkout page. The time is held for 15 minutes while they pay.
- **No double booking**: every half hour of an appointment is a row in the database that can only exist once,
  so the database itself refuses an overlapping booking, even if two people press the button at the same moment.
- **Payment confirmation**: only Square's signed notification (the webhook) or a direct question to Square's
  API confirms a payment. Coming back from the Square page proves nothing on its own.
- **Holds that run out**: every hour (and whenever the calendar is used) holds older than 15 minutes are checked
  with Square and, if unpaid, released, and their Square payment page is closed. A payment that still arrives
  later is booked if the time is free and still offered; otherwise it is flagged for Gary ("Needs attention").
- **Nothing automatic for cancellations or refunds**: customers contact Gary. In Admin → Bookings Gary can cancel
  a booking (this frees the time); any refund is Gary's own decision, made in Square.
- **Emails**: a confirmation to the customer, a separate notification to Gary (address set in Admin → Private
  Readings → Booking rules), a reminder about 24 hours before, and an email to Gary if a payment needs attention.
  A failed email is retried automatically by the hourly job (for 3 days) and can be resent from Admin.
- **Meditation Shop** (Admin → Meditations): any number of meditations, each with its own title, by-line,
  narration line, descriptions, price, cover, public preview (MP3, **1 minute or less**, checked on the server)
  and private full recording (MP3, up to 95 MB). Drafts are hidden; a meditation can only be published once its
  full recording is uploaded. After payment the customer gets a private download link for **ONE download**, which
  they must start within 24 hours (the time is changeable in Admin). The MP3 is sent as a real file (saved to Downloads,
  named e.g. "Feel It - Awaken the Spirit Within - Medium Gary Findlay.mp3"), not played in the browser. ONE PURCHASE,
  ONE CLICK, ONE DOWNLOAD: pressing the button uses the download; afterwards the page shows DOWNLOAD USED. Only Gary
  or a full Admin can authorise a replacement, with a reason (Admin > the order). Details: `docs/CHANGES-one-download.md`.
- **Email addresses** are stored trimmed and in lower case everywhere (customers, the notification address).
- **Visitor Experiences ON/OFF**: Admin → Visitor experiences → Open sharing / Close sharing.
- **Customer details** (name, email, phone) are removed from orders after 2 years (changeable). The payment record
  itself (date, item, amount, Square reference) is never deleted.

## Cloudflare secrets and settings

| Name | What it is | Secret? |
|---|---|---|
| `SQUARE_ENVIRONMENT` | `sandbox` while testing. Only the exact word `production` takes real money. | plain text is fine |
| `SQUARE_ACCESS_TOKEN` | Square access token (Sandbox token while testing) | **secret** |
| `SQUARE_LOCATION_ID` | Square location ID (Sandbox location while testing) | secret |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | from the Square webhook subscription | **secret** |
| `RESEND_API_KEY` | Resend API key | **secret** |
| `EMAIL_FROM` | sending address, e.g. `New Way’s <bookings@newwaysmediumshipdevelopmentcentre.com>` | plain text is fine |
| `EMAIL_PROVIDER` | optional; `resend` is the default | plain text |

Until the Square keys and Turnstile are present, the website says "Online booking will open here soon" and
nothing can be booked or bought.

## Square (Sandbox first)

1. Square Developer Dashboard → your application → **Sandbox** → Credentials: copy the *Sandbox access token*
   into the Cloudflare secret `SQUARE_ACCESS_TOKEN`; Locations: copy the Sandbox location ID into
   `SQUARE_LOCATION_ID`; set `SQUARE_ENVIRONMENT` to `sandbox`.
2. Webhooks → Subscriptions (Sandbox) → Add subscription: URL
   `https://new-ways-website.newwaysmediumship.workers.dev/webhooks/square`, events **payment.created** and
   **payment.updated**. Copy its *signature key* into `SQUARE_WEBHOOK_SIGNATURE_KEY`.
   (Admin → Private Readings shows this address too, under "Online booking".)
3. Test with Square's Sandbox test card on the temporary address. Admin shows **TEST MODE** throughout.

**Switching to real payments (Production) needs Gary's approval first.** It is the same three steps with the
*Production* token, location ID and a Production webhook subscription, then setting `SQUARE_ENVIRONMENT` to
`production`. Bookings made in Sandbox remain as test records.

## Emails (Resend, free up to 3,000 a month)

1. Create a Resend account, add the domain, and add the DNS records Resend shows at the domain's registrar
   (these only add email records; the website and the Google Site are not affected).
2. When Resend shows the domain as verified, create an API key and add it as the secret `RESEND_API_KEY`, and set
   `EMAIL_FROM`.
Until then bookings still work; Admin shows which emails were not sent, and they are sent automatically once
email is set up (within 3 days of the payment) or can be resent from Admin.

## Event tickets, check-in and the mailing list

See `docs/events-tickets-and-check-in.md`.

## Moving from the temporary address to the real domain

The full step-by-step list is `docs/go-live-checklist.md`. In short:


- Links in emails and the Square return page use the address the customer booked on, so nothing in the code changes.
- Add a new webhook subscription in Square for `https://<real domain>/webhooks/square` (and copy its new signature
  key into the secret), then remove the temporary-address subscription.

## Scheduled jobs (free Cron Triggers)

- `7 * * * *` (hourly): release unpaid holds (readings and event tickets), close abandoned meditation orders, send
  reading and event reminders, retry failed emails.
- `17 3 * * *` (daily): the existing housekeeping and weekly backup, plus removing old customer contact details
  and old replaced recordings that no download link needs any more.

## Database changes

- `migrations/0006_bookings_and_shop.sql`: new tables only (no existing table or row is changed). Starts with the
  two readings at £40 and £65, Sundays 12 noon to 5pm, and "Feel It – Awaken the Spirit Within" as a draft at £9.99.
- `migrations/0008_events_checkin_mailing.sql`: event tickets, guests, answers, check-in, mailing list and check-in
  helpers (new tables and columns only; existing events keep their Square ticket links). See
  `docs/events-tickets-and-check-in.md`.
- `migrations/0007_booking_wording.sql`: updates the Private Readings wording and the Privacy Notice section about
  bookings **only if** they are still the original starting text. If Gary has edited either, it is left alone and
  Admin home shows a reminder to update the Privacy Notice.

Both are applied automatically by the existing deploy command (`wrangler d1 migrations apply new-ways --remote`).
