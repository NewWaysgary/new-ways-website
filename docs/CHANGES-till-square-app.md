# Wednesday till: card payments in the Square app (October 2026)

One fix. Nothing else was changed. The website's online payments stay in **Sandbox**, and the domain is unchanged.
Cash, "Card payment taken ✓" (for a card reader used without the app), Undo, Clear, Close night and reports all work
exactly as before.

One database update: `migrations/0012_till_square_app.sql`. It adds one table and two columns, and changes no
existing rows.

## What was wrong

- **No automatic recording.** The page Square came back to only said "Square says the card payment was taken. Go
  back and press Card payment taken ✓". The till never knew which sale Square was paying for, and nothing was checked
  with Square.
- **The three-minute delay.** Square's app has a setting, `AUTO_RETURN_TIMEOUT_MS`, that makes it come back by
  itself a few seconds after its Thank You screen. The till didn't use it. Without it, Square waits on that screen
  until someone taps **New Sale**, so the green page only appeared when that happened, minutes later.

## What it does now

1. **Registering the sale.** When CARD is pressed, the sale is first registered on the website. It is priced from
   the database and given a random reference. Only then can "Open the Square app" be pressed.
2. **Opening Square.** Square opens with exactly that total, the reference, the card reader's location, and
   "come back 3.2 seconds after Thank You" (the shortest time Square allows).
3. **Checking with Square.** When Square comes back, the website asks Square itself, using the Square transaction
   ID it was given. It never trusts the web address alone. Each payment must be:
   - COMPLETED
   - for exactly the sale's amount, in GBP
   - a card payment, and the only payment in that transaction
   - at the card reader's location
   - made after the sale was sent to Square
   - not already counted for anything else
4. **Recording the sale.** Only then is it recorded, in one all-or-nothing step: a green **PAYMENT SUCCESSFUL**
   shows, the basket is cleared, and the till is ready for the next customer. If someone switches back to the till
   before Square has come back, the till says it is waiting for Square and then completes by itself.
5. **When Square is slow.** If Square doesn't show the payment straight away, the page says **CHECKING WITH
   SQUARE…** and keeps asking for up to 2 minutes. It never shows success early.
6. **When it doesn't go through.** Cancelled, declined, a different amount, the wrong currency or location, an old
   payment, or a payment already used: **NOT PAID: NOTHING RECORDED**. The sale stays on the till to try again or
   take cash.
7. **When Square can't confirm it.** For example, a payment taken in Square's Offline Mode: **NOT CONFIRMED YET:
   NOT RECORDED**. After checking the Square app, Gary or Julie can tick a box to record it by hand, and this is
   marked in the records.
8. **No duplicates.** Square coming back twice, a refresh, several checks at once, or pressing "Card payment taken ✓"
   as well still records the sale only once. If the sale was already recorded another way, the page says so and
   asks you to refund the second payment in the Square app.

## One thing to set up: confirming payments with Square

Your card reader takes **real** payments, so they can only be confirmed with your Square **Production** account.
The website's online payments are separate and stay in Sandbox. Add two Cloudflare secrets (Workers & Pages → the
website → Settings → Variables and Secrets):

- `SQUARE_POS_ACCESS_TOKEN`: your Square Production access token. It is only used to look payments up and can't
  take or change one.
- `SQUARE_POS_LOCATION_ID`: the Production location your card reader is signed in to.

Until these are added, Square app payments can't be confirmed automatically. The till then shows NOT CONFIRMED YET
and you record each one by hand after checking the Square app. Admin › Wednesday Door › Buttons & prices shows
whether this is set up.

In the Square app, if a receipt question appears after payment, choose **No receipt**. The 3.2-second return starts
from Square's Thank You screen.

## Tests run here

- `npm test`: 486 + 294 checks, all passing. There are 35 new checks for the till: success, Square coming back
  twice, a refresh, five checks at once, cancelled, declined, wrong amount, wrong currency, wrong location, an old
  payment, a non-card payment, two payments, a faked transaction, Offline Mode, a slow Square, a payment still
  processing, an already-recorded sale, Square refusing access, not set up, and helper permissions.
- Real Chromium on an Android-sized screen, with a stand-in for Square:
  - £1 on the card goes to PAYMENT SUCCESSFUL by itself, returns to the till and clears the basket, with exactly
    one sale recorded
  - a cancelled payment keeps the basket
  - switching back before Square has finished shows a waiting message, then completes by itself

**Not tested here:** the real Square app and card reader, and Square's Production service. These can only be
tested on Julie's phone.
