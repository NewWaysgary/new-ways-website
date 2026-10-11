# Download tracking on Android, and Wednesday advance payment (October 2026)

Two fixes on top of the one-download update. Nothing else was changed. Square stays in **Sandbox**, the
workers.dev address is unchanged, and the meditation MP3 is not touched. The DEVELOPMENT button fix is kept.

One database update: `migrations/0011_parallel_downloads.sql`. It adds three columns and changes no existing rows.

## Fix 1: download tracking when a phone uses several connections

**Cause.** For a large file, Chrome for Android and Samsung Internet use two or three connections at once:

1. One connection asks for the whole file.
2. Other connections ask for later parts.
3. When the first connection reaches a part another connection is already fetching, the phone closes it on purpose.

The website did two things wrong with this. It only checked "has every byte been sent?" when a connection finished
normally, so if the deliberately closed connection was the last to end, the download was recorded as interrupted.
And its one-copy limit refused the phone's middle connection, which Admin then counted as a blocked attempt.

Your own records show exactly this:

| Connection | Bytes sent |
|---|---|
| First (whole file) | 32,526,336 |
| Second (from byte 29,082,478) | 14,541,240 |

**What changed:**

- **Checked every time.** The record is checked whenever any connection finishes or closes. It is also checked when
  the customer's page opens, and by the hourly job in case a connection's end was never reported.
- **Counting rule.** A connection that finished counts for everything it sent. A connection the phone closed counts
  only up to the byte where another request took over: another of the phone's own connections, or a resume after a
  dropped signal. A connection that stopped with nothing taking over counts for nothing, because bytes sent just
  before a drop may never have arrived. "Completed" is recorded only when the counted parts cover the whole file.
- **One-copy limit.** The limit is now kept as data is sent, across all connections together: permission to send
  is taken 1 MB at a time, in one all-or-nothing database step. The phone's extra connections work normally and are
  no longer recorded as blocked. However many requests arrive, the total sent can never be more than the file plus
  16 MB (about 60 MB for Feel It), so a second complete copy is still impossible. A request for the whole file again
  after a long part has already been sent is still refused straight away.
- **Confirmation email.** It is still sent once, only when the record says Completed. For a download over several
  connections it says so. "Data sent by our server" can be slightly more than the file, because some bytes are sent
  twice when the phone switches connections; the email explains this.
- **Admin.** Each request now says "closed by the phone; another request took over at byte …". A completed download
  says "over several connections" when that's how it was established.
- **Earlier records.** Downloads recorded as interrupted in the last 7 days are re-checked by the hourly job. Your
  test purchase will change to Completed within an hour of this update going live, and its confirmation email will
  be sent then.

**Still true:** "Completed" means the server sent every byte, as established above. The server can't see the phone,
so it can't prove the MP3 was saved, and nothing claims that.

## Fix 2: Wednesday advance payment

**Cause.** Turnstile and the Square connection were both working. The problem was the website's own security
settings: they only let its forms send their answer back to the website itself (`form-action 'self'`). The Wednesday
form was the only one that tried to jump straight to Square's page after Continue. Chrome blocked that jump without
showing anything, so the page seemed to do nothing. But the payment record had already been created and the one-use
Turnstile token had been used up, so pressing Continue again correctly got "The security check didn't complete".
Refreshing gave a new token, and the same thing happened again.

**What changed:**

- Continue now goes to the customer's own payment page on this website, which immediately opens Square's page.
  This is the same way readings and meditations already worked.
- The Pay button stays on that page in case the jump doesn't happen.
- If the customer comes back to that page later, it doesn't jump to Square again.
- The security policy and Turnstile are unchanged.

**Payments made while this was broken.** Nobody was charged. Each press created an unpaid "awaiting payment" record,
which closes by itself as usual.

**Card reader.** The Square card-reader handoff for walk-ins is separate (Admin → Wednesday Door till only) and
has not been switched on. It isn't involved in advance payments.

## Tests run here

- `npm test`: 486 checks in `tests/system.test.mjs` and 260 in `tests/features.test.mjs`, all passing. New checks:
  - Gary's real recorded numbers, now counted as Completed
  - two connections with the second finishing first (Gary's case), and with the first closing first
  - three connections finishing in a mixed order
  - a genuine drop part-way, recorded as interrupted with no email, which completes (one email) when the missing
    part is fetched
  - three whole-file requests at once: never more than one complete copy, and stopped at the limit
  - the hourly job settling a download whose first connection went silent
  - Wednesday: Continue goes to the website's own page, which opens Square, and doesn't jump again later
- Real Chromium with Android's parallel downloading switched on, at phone speed, using a file of exactly
  43,623,718 bytes:
  - the browser used three connections and the saved MP3 was identical
  - Completed, one email, and nothing recorded as blocked
  - before the fix, the same test recorded "interrupted" with one blocked request
- Real Chromium, the Wednesday journey (Turnstile replaced by a one-use stand-in, since it can't be reached from
  here):
  - 2 Entry, 1 Development, 5 Raffle strips = £18.00
  - Continue opens Square, and Square asks for £18.00
  - after paying: one paid record with the right lines, and one email
  - the emailed QR code decodes to that payment's own address
  - SCAN QR CODE shows VALID with GIVE 5 RAFFLE STRIPS, and CHECK IN EVERYONE records 3 people
  - scanning again says ALREADY CHECKED IN

## To check on your Samsung phone and the Cloudflare website

1. Buy Feel It in Sandbox and press Download once. The MP3 should be in My Files, and the page should say "Completed".
   One Download Transfer Confirmation email should arrive (in test mode, at the Resend test address).
2. On Who's On → Pay in advance, choose your £18 again and press Continue. Square's Sandbox page should open. Pay
   with Square's test card, then check the confirmation email and its QR code.
3. On the Wednesday Door, press SCAN QR CODE and scan that QR code with the phone's camera. Then scan it again.
