# Reservations, Square checkout help and gift vouchers (15 October 2026)

Built on the GitHub version with the home page Community button (commit 43f699e). Nothing has been uploaded,
deployed or changed on Cloudflare or Square by Claude. No live payments or emails. No paid services.

## 1. Event reservations (Admin › Events › an event)

- **Reserve tickets**: any number (up to 100 at a time) for any event, even when it shows SOLD OUT. Three kinds:
  - *New reservation*: from the places still available (refused, with an explanation, if there aren't enough).
  - *Places allocated before the website*: takes them out of the event's "allocated before the website" figure, so
    they are never counted twice and no new places are created.
  - *Additional places (Admin Override)*: raises the maximum by exactly the number reserved. A reason is required
    and recorded. If the reservation is released or cancelled, those extra places are taken off the maximum again.
- The places are protected as soon as Reserve is pressed (the database's own capacity rules count them).
- **Private link and QR code**: the real New Way's booking form for exactly those tickets (every guest's name, meals
  and other questions, contact details), then the existing Square checkout. Copy, Share, Download the QR code, Email
  the link. The link can be completed once; after payment it only shows that it is paid.
- **Payment**: Square online, cash in person or card in person. For in person, the tickets are issued only when Gary
  or Julie press "Payment received" (and the confirmation and QR code can be emailed then).
- **Deadline**: change it at any time; automatic release at the deadline, or manual (the link closes at the deadline
  but the tickets stay reserved until you decide).
- **Make a new link** (the old link and any old Square payment page stop working at once), **Release to public
  sale**, **Cancel**. Square is always asked first, so a payment made at that moment is never lost.
- A payment that still arrives after a reservation was released is **flagged for Admin** (no tickets, nothing
  oversold). Payments can never confirm a reservation twice.
- Once paid, it is an ordinary booking: existing guest list, meal totals, table plan, confirmation email, QR code,
  door check-in (one QR per booking, guests checked in individually), reminders.
- **Reservations and places** page: maximum, allocated before the website, booked, reserved and unpaid, being paid
  for online, still available, and what the public sees; Outstanding, Paid, Released and Cancelled lists; a record of
  every change to the places.

### The charity night (7 November)

Nothing has been changed on the live event. After deploying:

1. Admin › Events › the charity night › **Reservations and places**.
2. **Places allocated before the website**: Maximum **100**, allocated before the website **98**, a reason. Save.
   (The 2 website places are already counted: 98 + 2 = 100. Available stays 0; SOLD OUT stays on.)
3. **Reserve tickets** › "Places allocated before the website", **16** tickets, the customer's name and email,
   Square online, a deadline, a reason. The 98 becomes 82 and the 16 are reserved: still 100 in total, never 116.
4. Share the private link or QR code. When they pay £240, the 16 guests join the guest list and get the normal email
   and QR code.

## 2. Square checkout

- Google Pay and Apple Pay are now requested on every Square checkout the website makes (cards stay as they are).
  Square decides whether each button appears for the customer's phone and browser.
- Payment help on the booking and payment pages (event tickets, reservations, private readings): open the banking
  app, try Google Pay or Apple Pay, try another card, contact the centre; how long the places or time are held.
- A warning in Facebook's / Messenger's / Instagram's own browser, with an Open in Chrome button on Android, shown
  from the details form onwards.
- The 15-minute hold is unchanged.

## 3. Private reading gift vouchers (Admin › Private Readings › Gift Vouchers / Reservation Codes)

- Make one or several vouchers: 30 minutes (£40) or 60 minutes (£65), optional expiry, note (e.g. Raffle Prize).
- Codes: GV- and 12 random characters in three groups of 4 (about 59 bits; no 0/O or 1/I/L). Copy code, search,
  statuses Available / Reserved / Redeemed / Expired / Cancelled, who redeemed it and the appointment, history, cancel
  an unused voucher, make a code usable again (only when Gary or Julie choose, e.g. after its booking was cancelled).
- The voucher itself uses the two approved designs (public/images/vouchers/, exactly as supplied, 1983 × 793). The
  real code (Caladea Bold, the designs' dark navy), the expiry date as DD/MM/YYYY (left empty if none) and a QR code
  for the live Private Readings page are placed inside the printed boxes (src/bookings/voucher-layout.js; the supplied
  coordinates sat to the left of the boxes, so they were fine-tuned to the boxes measured from the images).
  - PNG: drawn at the design's own size by the Admin phone's browser, shown as the preview, then saved against the
    voucher in private storage (Download PNG at any time; Make the picture again if needed).
  - PDF: A4 landscape for printing, made by the website from the same design and layout (sharp vector QR code and
    text; the font is embedded). Several vouchers: one PDF, one per page.
  - Send the picture… / Send the PDF… use the phone's Share menu.
  - Caladea Bold: SIL Open Font License (public/fonts/Caladea-OFL.txt).
- Customers book on the Private Readings page as normal. At the payment step: "Have a Gift Voucher or Reservation
  Code?". A valid code shows "Voucher Accepted. Your Private Reading Is Fully Covered. No Payment Required." and
  Confirm My Booking (with the cancellation policy and the spam check). No Square payment is made.
- Same calendar and rules as paying customers. The database refuses any overlapping appointment; a voucher never
  opens a closed date. Only one booking can ever use a code, even if two people try at the same moment.
- While someone confirms, the code is held for them for the hold time (15 minutes); if they don't finish, it becomes
  available again. A cancelled voucher booking does NOT bring the code back automatically.
- Normal confirmation email (Resend) and Admin email; Admin shows Payment method: Gift voucher, Amount due £0.00.

## Database update 0023 (applied by the deploy workflow)

Only adds: `events.legacy_places`; reservation columns on `event_bookings`; `event_allocation_log`;
`orders.payment_method` ('square' for every existing order) and `orders.voucher_id`; `gift_vouchers`,
`gift_voucher_log`. The three event capacity rules are replaced by the same rules that also count
`legacy_places` (0 for every event, so nothing changes until it is used). No existing row is changed.

## Other changes

- Website version 18 (styles and scripts, so phones fetch the new copies). Private reservation pages are never kept
  in the app's offline copy.
- New files: `src/events/reservations.js`, `src/admin/vouchers.js`, `src/bookings/vouchers.js`, `src/lib/pdf.js`,
  `src/lib/pdf-fonts.js`, `src/bookings/voucher-layout.js`, `src/views/admin-reservations.js`, `src/views/admin-vouchers.js`,
  `src/views/payment-help.js`, `tests/reservations.test.mjs`.

## Tests

`npm test` now also runs `tests/reservations.test.mjs` (134 checks). Everything runs on the local test copy with the
Square and email stand-ins. Not tested: real Square (Google Pay / Apple Pay buttons, bank approval), real email
delivery, a real phone's Facebook browser and printing.
