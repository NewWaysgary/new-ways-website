# Wednesday till: ADD EVENT BOOKING · Who’s On: Share to Facebook

## ADD EVENT BOOKING (Wednesday till)

The gold **ADD EVENT BOOKING** button is on the till screen, under the night's figures.

1. **Event**: every upcoming event, with its date, ticket price and places left. SOLD OUT events (and events with no ticket price) are shown greyed out and can't be chosen.
2. **Tickets**: tap 1 to 8 (more from the list), never more than the places left.
3. **Details**: the customer's name and email address (for the confirmation and QR codes), an optional phone number, the mailing-list tick, then each guest's name and the event's own questions (meal choices and so on). Required questions must be answered.
4. **Payment**: check the summary, then either:
   - **Cash**: tick “I have taken £… in cash”, then **CASH RECEIVED: COMPLETE BOOKING**.
   - **Card in the Square app** (Julie's Android phone, when the Square app is switched on for the till): **CARD: PAY IN THE SQUARE APP**. The places are held for 20 minutes, then the Square app opens for exactly the right amount. The booking is completed only when Square itself confirms the payment. If the card is cancelled or declined, or the amount is different, nothing is booked and the places are released.
   - **Card on the card reader without the app** (for example on the iPad): take the payment on the reader first, tick “The card reader shows £… APPROVED”, then **CARD PAYMENT TAKEN ✓**.
5. Julie goes straight back to the till: **BOOKING COMPLETE: EV-…**. The customer is emailed the normal confirmation with their QR codes.

**Using the existing systems:** each booking is an ordinary event booking, the same as Admin's “Add a booking”. It shows up everywhere bookings do: the places left, the guest list, payments, the table plan, meal totals, Julie's check-in and the iPad.

**Safeguards:**
- **Never twice:** pressing the button twice, refreshing, or Square coming back twice never makes two bookings.
- **Same customer:** the same email booking the same event again must be confirmed first.
- **Last places:** if two people sell the last places at the same moment, the second is refused. The database itself refuses to oversell.
- **Card:** a card booking is never confirmed unless Square confirms the payment. If Square can't confirm it (offline mode), Julie can complete it only after checking the Square app.

**Money:** event tickets are kept separate from the Wednesday night's totals.
- The till shows “Event tickets booked at the till today”.
- **Close night** and the night's report list them.
- Their cash is included in “Expected in the tin”, because it is in the tin.

Database: `migrations/0026_till_event_bookings.sql` only adds one table (`till_event_bookings`) and two columns (`till_card_requests.kind`, `.booking_id`). It changes no existing row.

## Who’s On: Share to Facebook

In **Admin › Who’s On**, each upcoming guest medium that's shown on the website has **Share to Facebook**, next to Edit and Hide. There is also **Copy link**.
- **Share to Facebook** opens Facebook's own share screen, with the medium's permanent link: `…/whos-on/<number>`.
- **The link** opens that medium's own page: photo, name, where they're from, the date, the description and the Wednesday details. Facebook shows the photo, name and date in its preview.
- **After the Wednesday** (or if the listing is hidden), the link takes people to the Who's On page, so old Facebook posts never show an error.

The Who's On page itself, and the automatic removal of past dates, are unchanged.

## The Square app on the iPad (and iPhone)

The till's **CARD** button now opens the Square Point of Sale app on an iPad or iPhone too, not only on Android.
- **How:** it uses Square's own iOS link (`square-commerce-v1://payment/create`, Point of Sale API version 1.3). It works for till sales and for ADD EVENT BOOKING.
- **When Square comes back:** the iPad returns its result differently from Android, but the website then runs exactly the same checks. It asks Square directly and records the payment only if Square's own records show it paid, for the right amount, once.
- **Cancelled, declined or a different amount:** nothing is recorded or booked.
- **Offline Mode:** recorded only after Julie checks the Square app.
- **iPad Safari reports itself as a Mac:** the till checks for a touch screen, so an iPad gets the Square app button and a real Mac gets the card reader option.

**Needed on the iPad:**
- the **Square Point of Sale** app (also listed as “Square POS”). Not Square for Retail or Square for Restaurants, which don't accept these links;
- signed in to New Way's Square account;
- the card reader paired with it.

The web callback address already registered with Square (`/admin/door/square-callback`) serves both Android and iPad.
