# Gift Vouchers bought on the website (November 2026)

## New
- Public page `/gift-vouchers` (menu and desktop navigation; the bottom tab bar is unchanged). The WhatsApp and Home Visit
  travel conditions are shown, word for word, before anything is chosen or typed, and must be ticked.
- Purchase: 30 or 60 minute reading, purchaser name and email, delivery (A: to me, B: straight to the recipient),
  optional recipient name and message. The price appears only on the review, after the details are complete; the
  purchaser ticks to agree the total, then pays with Square (the existing integration).
- The voucher is made only when Square confirms the payment, once only (database rule: one voucher per purchase).
  Bought vouchers: `mileage_payable`, valid 12 months (Admin > Booking settings: "Gift vouchers bought on the website
  can be used for (months)").
- Emails (Resend, existing system, each recorded so never sent twice; failures retried hourly for a week):
  voucher email (A: purchaser, with receipt; B: recipient, with the message), receipt to the purchaser (B), sale
  notification to Gary (and the second notification address).
- Printable A4 PDF: the approved design unchanged, with who it is for, the message and what it covers printed
  underneath. Private link in the email; also on the purchaser's own page.
- Admin: travel cover options when making vouchers (Option 1 WhatsApp only, Option 2 mileage payable, Option 3 FREE
  mileage); change an existing voucher's cover (same code, recorded in its history); purchased/issued labels and
  filter; search by purchaser, recipient or NWV- reference; purchase details, email record and Resend button;
  website sales list (paid, awaiting payment, not paid).
- Redemption: vouchers can now be used for Home Visits when their cover allows it.
  FREE mileage: £0, booked at once. Mileage payable: Square collects only the travel charge; the voucher is kept for
  the booking and redeemed only when that payment is confirmed (released if the hold runs out).
  WhatsApp only: a Home Visit is refused with the reason.
- Gary's booking notification now includes, for voucher bookings: voucher code, mileage charged or waived,
  additional payment collected and "Booking status: Confirmed".
- Privacy Notice: a Gift vouchers section (Admin offers "Use the updated Privacy Notice").

## Database (migration 0029, additive only)
`gift_vouchers` + `travel_cover` (default `whatsapp_only`), `source` (default `admin`), `purchase_id`; new tables
`voucher_purchases`, `voucher_purchase_emails`. Existing vouchers keep their original terms.

## Changed existing behaviour
- Admin's "Make vouchers" form now requires choosing Option 1, 2 or 3.
- The gift voucher box is now offered on Home Visit bookings (previously "please contact Gary").
- ASSET_VERSION 25.

## Tests
`tests/giftvouchers.test.mjs` (100 checks) covers the 22 scenarios requested; existing suites updated where the
behaviour above intentionally changed.
