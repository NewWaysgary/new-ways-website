# One download, and the till button (October 2026)

Two fixes on top of the complete build. Nothing else was changed. Square stays in **Sandbox**, the domain is untouched,
and the meditation MP3 is not touched.

One database update: `migrations/0010_one_download.sql`. It adds tables and columns. It changes only two existing
sentences that described the emailed codes (the personal-use terms and one Privacy Notice sentence), and only where
that exact sentence is still there.

## Fix 1: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD

What the customer sees:

1. After paying on Square they come back to the order page (or open the link in their email).
2. A box says **IMPORTANT: ONE-TIME DOWNLOAD**, with the file size. They tick "I understand this is a one-time
   download" and press **DOWNLOAD YOUR MEDITATION**.
3. The MP3 saves to Downloads. The button can't be pressed twice.
4. From then on, the order page and the emailed link only show **DOWNLOAD USED** and the record. There's no button.

What the server does:

- Pressing the button uses the purchase's one download in a single all-or-nothing database step **before any of
  the file is sent**. If several presses arrive at once, only one succeeds. The others are refused and recorded.
- Only the browser that pressed the button can then receive the file. It gets a private address and a matching
  private cookie, and a link copied to another phone gets nothing.
- If the signal drops part-way, the phone can resume from where it stopped. However many requests arrive, the
  server never sends more than the file plus a small allowance (at most 16 MB, and always less than half the file).
  **A second complete copy can't be sent.** Once every byte has been sent, the address stops working for good.
- The emailed six-digit codes have gone completely, along with the 15-minute restart. A phone that was added with
  a code before this update no longer counts.
- The **Download Transfer Confirmation** email goes to the customer **once**. It is sent only after the server has
  sent every byte of the file, never when the button is pressed. It shows the title, the purchase reference, the
  file size, the data sent, the date and time, Status: Completed, and that the one-time download has been used.

**What "Completed" means:** the website's server sent every byte to the customer's browser. The server can't see
the phone, so it can't prove the phone saved the file. The email and Admin say exactly that.

**Replacements** (Admin → Meditation sales → the order → Authorise replacement download):

- Only Gary or a full Admin (Julie) can do this. Check-in helpers are refused.
- A written reason is required.
- It gives ONE new download and switches the old one off.
- It is recorded with who authorised it, why and when, and also goes in the activity log.
- Leave "any phone or computer" unticked unless the customer needs a different device.

**Admin → Meditation sales** shows, for each sale:

- the customer's name and email
- the website reference and the Square payment ID
- the price and the date paid
- the exact file size, read from R2 each time the page opens, in bytes, MB and MiB (phones use MB, as in 43.62 MB)
- when the button was pressed
- the download status: Available / Used / Expired / Replaced
- the bytes sent, Completed / Interrupted / In progress, and the completion time
- the number of blocked repeat attempts
- the number of replacements

Open the order to see every individual request, each refused attempt and each replacement with its reason.

## Fix 2: DEVELOPMENT on the door till

The button names were drawn at a fixed 20px in Cinzel. On phones narrower than about 412px, "DEVELOPMENT" was
wider than its button. Now, any name that doesn't fit is made just small enough to fit on one line. This is
re-checked when the font arrives and when the phone is turned. Names that already fit keep their normal size.
Colours, prices, layout and how the till works are unchanged.

This was checked in Chromium with the real Cinzel font at 320, 360, 390, 412, 480, 560 and 768px wide, for both
"Development" and "DEVELOPMENT".

## Still to check on a real phone (not possible here)

- Buy "Feel It" in Sandbox on your Android phone, press the button once, and check the MP3 is in Downloads and plays.
  Refresh: it should say DOWNLOAD USED. Then open the email link on a second phone: it should show nothing to download.
- The door till on your phone: DEVELOPMENT should sit inside its button.

## Tests run here

- `npm test`: 487 checks in `tests/system.test.mjs` and 242 in `tests/features.test.mjs`, all passing. They cover:
  - repeat presses
  - five presses at the same moment (only one gets through)
  - two file requests at the same moment
  - the email link after use
  - another phone or browser
  - old code addresses
  - an interruption and resume on a 40 MB file
  - the confirmation email being sent once only
  - replacement permissions (Gary, Julie, a check-in helper, not signed in, a forged form, no reason)
  - the database update on an existing database
- Real Chromium on a phone-sized screen:
  - one press saves the MP3 with the right name and exact size, then DOWNLOAD USED and one email (11 checks)
  - the door till with real Cinzel (30 checks)
  - the earlier phone checks (28)
