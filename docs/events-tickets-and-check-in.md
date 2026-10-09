# Event tickets, guest lists, check-in, the mailing list and System status

Everything here is part of the existing website, Admin, database and Square/Resend set-up. Nothing new needs to be
installed, and **no new Cloudflare secrets or variables are needed**.

## Events: how tickets are sold

Each event in **Admin → Events** now has **How are tickets sold?**

| Choice | What visitors see |
|---|---|
| **Square ticket link (as now)** | The BOOK / BUY TICKETS button opens your existing Square link, exactly as before. Every existing event is set to this, so nothing changes until you choose otherwise. |
| **Online tickets on this website** | A **Book tickets** button. Customers choose the number of tickets, give each guest's name and your questions, check everything on **REVIEW YOUR BOOKING**, then press **CONFIRM & PAY SECURELY** and pay on Square's checkout page. |
| **No tickets to buy** | No ticket button. |

Online tickets need a **start time**, a **price** (at least £1) and a **maximum number of places**. Optional: doors-open
time, venue and address (otherwise the Centre Settings ones are used), when sales open and close, information for
guests (included in the confirmation and the reminder) and booking terms (customers tick to agree).
**Published** (untick to keep an event as a draft only you can see) is the old "Show on the website" tick.

When every place is taken, the website shows **SOLD OUT** and stops online sales automatically.

## Each event's own page: Admin → Events → *Guests, tickets & check-in*

- **Capacity, booked, being paid for, remaining** and how many guests have arrived.
- **Check in** (see below).
- **Guest list**: every booking and every guest, with payment method and status, answers and check-in state. Search by
  name, email or reference; filter by booking status, payment, arrived / not arrived, or any answer (e.g. *Meal choice:
  Vegetarian*). **Open booking** for the details. **Download** it as a spreadsheet (CSV).
- **Add a booking**: for cash, card / in person, complimentary, Square online or other. Email is optional. You can
  enter guest names and answers (questions can be left empty if not known yet), a private note, a different total, and
  tick **Email the confirmation and QR code** if there's an email address. These bookings count towards the places.
- **Questions for guests**: add any questions the event needs: short answer, longer answer, drop-down, multiple
  choice, or tick box; must be answered or optional; asked for each guest or once per booking. Example for a Psychic
  Supper: *Meal choice* (drop-down: Steak Pie, Chicken, Vegetarian), must be answered, for each guest. A question
  already answered can't be deleted (tap **Stop asking** instead) and its type can't be changed. **Copy questions from
  another event** saves typing for repeat events.
- **Meal and option totals**: for every drop-down, multiple-choice and tick-box question, how many chose each option,
  and (tap a total) exactly who.
- **Edit event**.

### A booking's page

Purchaser, guests and answers, payment, **What the customer confirmed** (the exact REVIEW YOUR BOOKING record, never
changed), emails sent, and the **Change history**. Actions: **Change names or answers** (the customer's original choice
is always kept and shown, with who changed it and when), **Mark as paid**, **Send the confirmation email** (again),
**Cancel this booking** (frees the places; nothing is refunded automatically), and for a payment that needs attention:
**Confirm this booking** or **Mark as dealt with**. An event with bookings can't be deleted.

## Payments (same rules as Private Readings)

- The website decides the event, price, number of places, guests and answers. Square only takes the payment.
- The places are **held for 15 minutes** (Booking rules setting) while the customer pays. The database itself refuses a
  booking that would go over the maximum, even when two people press CONFIRM at the same moment.
- Only Square's signed webhook, or asking Square directly, confirms a booking. Coming back from Square proves nothing.
- A hold that runs out is released after asking Square; a payment that still arrives later is booked if places are
  free, otherwise marked **Needs attention** for you (no automatic refunds).
- Square stays in **Sandbox** (TEST MODE) until `SQUARE_ENVIRONMENT` is set to `production`, which you approve separately.

## Emails (all transactional, sent whatever the mailing-list choice)

- **To the purchaser after payment**: event, date, time, doors, venue, tickets, each guest and their choices,
  payment, reference, "No physical ticket is required. Your confirmed names are on the New Way's guest list", and the
  **QR code** (in the email and attached as a picture).
- **To you** (your notification address): event, purchaser, email, phone, tickets, guests, meal choices and answers,
  amount, reference, and a link to the booking.
- **Reminder about 24 hours before** (UK time, summer time handled), once per booking, with arrival information and the
  same QR code. It is recorded on the booking. Bookings made less than 30 hours before the event don't get one (their
  confirmation has just arrived), and Admin bookings only get one if their confirmation email was sent.
- Failed emails are retried by the hourly job for 3 days.

## The QR code and check-in

The QR code holds only a long random code (128 bits). No names, emails or meal choices are in it. Scanning it with a
normal phone camera opens a ticket page that shows the event, date, number of tickets and reference, but nothing
personal.

**Admin → Check in → choose the event**, or **Events → the event → Check in**:

- **SCAN QR CODE** uses the phone's camera inside the page (Chrome on Android; nothing to install). The booking is
  found on the server and each guest is shown with **Check in** buttons.
- Guests are checked in **one by one**: e.g. Gary and Julie arrive first, John and Jane later. **Check in all N not yet
  arrived** does the rest of a party in one go.
- A guest already checked in shows **ALREADY CHECKED IN** with the time (and who checked them in).
- **SEARCH GUEST** finds anyone by guest name, purchaser or reference (for lost emails, flat phones, cash bookings).
- **All / Arrived / Not arrived** views, and live totals (booked / checked in / still to arrive) that refresh by
  themselves on every phone.
- Several phones can check in at once: each check-in is one all-or-nothing database step, so the same guest can never be
  checked in twice. **Undo** is there for a mistake.
- If a browser can't scan inside the page (for example some iPhones), use the phone's Camera app: the QR code opens
  the ticket page, with a link **New Way's team: open check-in** that opens the booking in Admin.

### Check-in helpers (e.g. Julie)

**Admin → Check in → Check-in helpers**: add the helper's name and email address. They sign in on the normal Admin
sign-in page with that address (it must be a verified email address in WorkOS). The first time:

- if sign-ups are allowed in WorkOS AuthKit, they choose **Sign up** and create their own password; otherwise
- in the WorkOS dashboard → **Users** → **Invite user**, enter their email; they accept the invitation and set a password.

Helpers can **only** choose an event, scan, search the guest list, see names / arrival state / totals, and check guests
in. They can't open anything else (payments, settings, mailing list, private readings, meditation sales, customer
emails or phone numbers). For a booking still to be paid they see "Still to pay: please check with Gary", not the
amount. **Switch off** signs them out everywhere straight away. Your own Admin access is unchanged.

## Mailing list

**Admin → Mailing list**: only people who chose to join.

- At event checkout there is an **optional, unticked** box: "Keep me updated by email about future New Way's events and
  activities." Only the purchaser's own email address can be added; other guests are never added.
- The permanent **Join page** (`/join`) for the table QR code: name, email and a clear consent box. Change its
  heading, message, button and consent wording in **Admin → Mailing list → Join page and table QR code** at any time;
  the address never changes, so printed QR codes keep working. Print the QR code from that page **after** the real
  domain is connected (the page warns you until then).
- One record per email address (stored in lower case): joining again never makes a duplicate.
- Search, unsubscribe, subscribe again (only if they ask), delete, and download (CSV). Unsubscribing or deleting never
  changes bookings.
- **Unsubscribe** links (`/unsubscribe/…`) ask the person to confirm. Every future promotional email must include the
  person's unsubscribe link (and the matching List-Unsubscribe header): `src/mailing.js` provides both. Booking
  confirmations, payment confirmations, reminders and QR codes are not marketing and are not affected.

## Privacy Notice

Admin home reminds Gary to add event bookings and the mailing list to the Privacy Notice (Admin → Pages and wording →
Privacy Notice). Suggested wording, to adapt:

> **Event bookings.** When you book event tickets we keep your name, email address and phone number, the name of each
> guest and any answers you give (for example meal choices), so we can run the event and check guests in. Payment is
> taken by Square; we never see your card details. These details are removed after the period set by New Way's.
>
> **Mailing list.** We only email you news if you have chosen to join our mailing list. We keep your name, email address,
> when you joined and how. Every email has an unsubscribe link, and unsubscribing doesn't affect any booking.

## System status and the test email

**Admin → System status** shows GREEN / WARNING / RED for: the website and Admin, sign-in, the database (and whether
every update has been applied), storage, Square (it asks Square whether the token and location belong together, and
says Sandbox or real payments), Square payment notifications (and when the last one arrived), email sending (and the
last email's result; a WARNING while the email provider's test sender is used), your notification address, spam
protection, meditation downloads (every published meditation's private recording exists), events and tickets, and the
hourly job. Secret keys are never shown, only whether they are set and working.

**SEND TEST EMAIL TO ME** sends a test email to your notification address (up to 5 an hour).

## Database changes (migration 0008)

`migrations/0008_events_checkin_mailing.sql` only **adds** tables and columns:
new columns on `events` (ticket settings; every existing event keeps `sales_mode = 'link'`), and new tables
`event_questions`, `event_question_options`, `event_bookings`, `event_guests`, `event_answers`, `event_changes`,
`event_email_log`, `mailing_list`, `checkin_helpers`, plus two columns on `admin_sessions` (role). The only changes to
existing rows: existing customer email addresses and the notification address are stored in lower case, and the
meditation download time is set to 48 hours (as agreed). Nothing is deleted. It is applied by the normal deploy command.
