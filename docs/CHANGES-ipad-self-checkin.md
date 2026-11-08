# iPad self check-in (version 19)

Guests check themselves in on the iPad at the entrance. Gary and Julie control everything from Admin and see every arrival live.

---

## 1. Using it on the night (Admin)

All controls are in **Admin › Check in**. They appear in two places:

- on the event's own check-in screen, in the **iPad self check-in** panel near the top;
- on **Admin › Check in › iPad self check-in**.

Julie can use them as a check-in helper.

**Choose the event**
1. Admin › Check in, then tap the event. To see every event (any date), tap **Show every event (any date)**.
2. In the **iPad self check-in** panel, tap **Use the iPad for this event**.

The iPad then shows that event. It stays **closed** and in **TEST MODE** until you start it, so it never opens for real by accident.

**Start check-in**
- **Start TEST check-in**: for trying it out. Nothing real is recorded.
- **Start LIVE check-in…**: for the real night. A confirmation page opens. Tick the box, then tap **Start LIVE check-in**. If the event isn't today, the page warns you clearly.

**While it is running**

| Button | What the iPad does |
|---|---|
| **Pause** | Shows “Check-In Temporarily Paused. Please See Julie.” within about 5 seconds. Nothing can be checked in. |
| **Resume** | Opens again, in the same mode. |
| **Close check-in** | Shows “Check-In Closed. Please See Julie.” |
| **Disconnect** | Shows Check-In Closed. The iPad stays set up. |
| **Reconnect** | Ready again (closed) without a new setup code. Then start check-in. |
| **Switch to TEST / Switch to LIVE…** | Changes mode. LIVE always needs the tick. |

- None of these buttons ever deletes a booking, a guest or any attendance.
- The panel shows whether the iPad is **Online** or **Offline**, **Open / Paused / Closed / Disconnected**, **TEST MODE / LIVE MODE**, and whether it is **operational**.

**Julie's live screen** (the event's check-in screen) updates by itself every 4 seconds. It shows:
- **Expected**, **Arrived** and **Outstanding**;
- **Needs Julie**: duplicate names, names not found, unpaid or cancelled bookings, tickets for another event. Each has **Find**, **Open booking** and **Done**;
- **Same name**: guests who share exactly the same name, side by side with their booking reference and who booked, so she can check in the right one;
- **Groups partly arrived**, for example “2 of 6 arrived, still to come: …”;
- **Just arrived**, marked “on the iPad” or with who checked them in.

Search, **Check in** and **Undo** work as before.

## 2. Test Mode (any event, any time, permanently)

1. Choose any event, including one months away, then tap **Start TEST check-in**. The iPad shows an orange **TEST MODE** banner.
2. Scan real QR codes, type names, check in single guests and groups, choose just some of a group, check in the rest later, and try identical names, already-checked-in guests and unknown names.
3. Julie: tap the **Test Mode** tab on the event's check-in screen to see the test figures, Needs Julie and recent test check-ins. Manual test check-ins and Undo there also only affect the test records.
4. Try **Pause / Resume / Close / Start again** too.
5. **Reset test check-ins** (in the Test Mode tab) clears all practice check-ins and practice notes for that event. Repeat as often as you like.

Test check-ins are kept in a separate table (`checkin_test_attendance`). They never change real attendance, bookings or payments, and they don't count towards real figures.

To go live: tap **Start LIVE check-in…** (or **Switch to LIVE…**), tick, confirm.

## 3. Setting up the iPad (once)

1. Admin › Check in › iPad self check-in › **Add iPad and show setup code**.
2. On the iPad, open the **Camera** app and point it at the QR code on the screen, then tap the link. Or open Safari and go to `newwaysmediumshipdevelopmentcentre.com/self-checkin`.
3. Tap **Connect this iPad** (type the 8-digit code if it isn't filled in). The code works once, for 15 minutes.

After that, the iPad stays set up, even after a restart or after Safari is closed and reopened. Its private key lasts 60 days and is renewed automatically each day it is used (an iPad left unused for 60 days needs a new code).

- Use **Disconnect / Reconnect** between events: no new code is needed.
- Use **Remove iPad** only for a lost or replaced iPad. It would then need a new setup code.
- Don't use a Private tab, and don't clear Safari's history or website data on the iPad. Doing either removes its key, and it would need a new code.

## 4. Safari and Guided Access on the iPad

1. Settings › Display & Brightness › Auto-Lock › **Never**. Keep the iPad plugged in.
2. Open the check-in page in Safari. Tap **ᴀA** in the address bar › **Website Settings** › Camera › **Allow**.
3. Settings › Accessibility › **Guided Access** › On. Set a passcode that only Gary and Julie know. Turning off Touch ID / Face ID for ending it is optional.
4. **Start:** with the check-in page open, triple-click the **top button**, then tap **Start**. Guests can't leave the check-in screen.
5. **End:** triple-click the top button, enter the Guided Access passcode, then tap **End**.

Pausing or closing check-in in Admin doesn't end Guided Access. They are separate. Admin controls what the screen shows; Guided Access keeps the iPad on that screen.

## 5. What it reuses

- **Bookings and guest lists:** every booking's individual guests (`event_guests`), from online tickets, Admin bookings (cash, card, complimentary), paid reservations, paper imports and old Square-link registrations.
- **QR codes:** the same codes already sent to customers, unchanged.
- **Live check-in:** the existing single-step check-in (it can't count anyone twice), the same attendance records Admin always used, Julie's check-in screen, search, Undo, the helper role and the activity log.

## 6. What's new

- **iPad screens** (`/self-checkin`): Scan QR Code (front camera, jsQR), Enter Your Name, the Check In screens, success screen, Paused and Closed screens, and the TEST MODE banner.
- **Admin controls**: event selection (any date), TEST/LIVE with confirmation, pause, resume, close, disconnect, reconnect and remove.
- **Test Mode**: separate test attendance, reset, and the Test Mode tab.
- **Julie's screen**: Needs Julie, Same name, Groups partly arrived, Just arrived, iPad status, and updates by itself.
- **SCAN QR CODE on iPhones** (jsQR is used where the browser has no built-in QR reader).
- **Import a paper list** (Admin › Events › event). It shows a preview first and warns about names already booked and names listed twice; possible duplicates must be ticked before they can be added. **Change the list** lets you correct it. Either the whole list is added or none of it.

## 7. Reliability and privacy

- The iPad only receives names, never email addresses, phone numbers, payments, amounts or references.
- It can't list or search the guest list: only an exact full name, limited to 90 look-ups a minute.
- **Guests are sent to Julie, never checked in, for:** unpaid "pay at the door" bookings, cancelled bookings, tickets for another event, and identical names.
- **Offline check-in:** while check-in is open the iPad keeps an encrypted copy of the event's guest list, and carries on if the connection (Julie's hotspot) drops. Check-ins are saved on the iPad before the guest is told, shown clearly as “saved on this iPad”, and sent automatically when the connection returns, where each is checked again and recorded once. Details: docs/STAGING.md, Part 4.
- If there is no connection and no up-to-date copy, nothing is ever shown as checked in: the guest is asked to see Julie.
- After each check-in, and after about a minute without a touch, it returns to the welcome screen and clears names and typing.

## 8. Database

`migrations/0024_self_checkin_ipad.sql` adds four new tables only: `checkin_tablets`, `checkin_test_attendance`, `checkin_help` and `checkin_sync_log`. It doesn't alter, update or delete any existing table or record.

I tested the previous version of the website against a database that included these new tables, and it ran normally, so going back is safe.

## 9. Deploying, and going back

**Deploy** (only once Gary approves):
1. Upload the ZIP to GitHub as usual. The **Unpack New Way's project** workflow runs.
2. Run the **Deploy** workflow. It adds the four tables, then publishes the new version.

**Check afterwards:**
- Admin › Check in › iPad self check-in opens.
- The public website, events booking, private readings and payments look normal.

**Go back** (if ever needed):
1. Upload the previous ZIP (`new-ways-website-main.zip`, version 18).
2. Unpack, then Deploy.

The four new tables simply stay unused. **Don't delete them.** Existing bookings, attendance and payments aren't affected either way.

## 10. Testing first on the STAGING test copy

Before anything goes live, everything can be tested on the real iPad and phones on the separate test copy. See **docs/STAGING.md** for:
- setting it up;
- the hotspot;
- pairing;
- how offline check-in works;
- the test plan.
