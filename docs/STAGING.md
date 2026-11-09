# The STAGING test copy: setting it up and testing the iPad

The test copy lives at its own address:

**https://new-ways-staging.newwaysmediumship.workers.dev**

It is completely separate from the live website.

| | Live website | Test copy |
|---|---|---|
| Worker | `new-ways-website` | `new-ways-staging` |
| Address | newwaysmediumshipdevelopmentcentre.com | new-ways-staging.newwaysmediumship.workers.dev |
| Database | `new-ways` (real bookings and attendance) | `new-ways-staging` (made-up test bookings only) |
| File storage | `new-ways-media` | `new-ways-staging-media` |
| Square | connected | **not connected**: no payments can be taken |
| Email | connected | **not connected**: nothing is ever sent |
| Scheduled jobs | 3 | **none** |
| Admin sign-in | WorkOS (New Way’s Admin) | the same WorkOS sign-in, with its own sessions |
| iPad set-up | its own | its own (set up separately) |

- Every page on the test copy shows an orange **STAGING · TEST COPY** strip.
- It is kept out of Google.
- It costs nothing: everything is within Cloudflare’s free allowances.
- The deploy button for it refuses to run if anything points at the live website.
- The live Deploy refuses to run from any branch except main.

---

## Part 1: setting it up (once)

- **Already done by Claude:**
  - created the test database and file storage;
  - added the test copy's sign-in and sign-out addresses to WorkOS (the live addresses are unchanged);
  - put the complete new version on the **`staging`** branch on GitHub. The **main** branch, and so the live website, is unchanged.

**How the test copy is deployed:**
- The **Deploy STAGING (test copy)** workflow runs only on the staging branch, and only when the file `staging/DEPLOY-STAGING.txt` is changed to say **DEPLOY STAGING: YES**.
- It starts at **NO**, so uploading the branch deployed nothing.
- It refuses to run if anything points at the live website.
- On the staging branch, the live Deploy workflow refuses to run at all.

**Deploying:** done by Claude. Each deployment ends with an automatic end-to-end check of the test copy, run from GitHub's servers. The check then puts the made-up bookings back to nobody checked in, so **deploying again resets the test bookings**.

**Your one step: a WorkOS key, so the test copy's Admin can sign you in.**
1. In the WorkOS dashboard (Staging environment), open **API Keys**.
2. Create a key called "New Ways staging test copy" and copy it.
3. In Cloudflare, go to **Workers & Pages › new-ways-staging › Settings › Variables and Secrets › Add**.
4. Choose type **Secret**, name `WORKOS_API_KEY`, and paste the key as the value. Save, then **Deploy**.
5. Add it to **new-ways-staging** only. Don't touch new-ways-website.

The owner email for the test copy's Admin is already set: the centre's public address, newwaysmediumship@gmail.com, the same as the live Admin.

To deploy the test copy again later (after changes), keep `YES` and change the "Last requested" line in the same file.

---

## Part 2: connecting the iPad through Julie’s phone hotspot

**On Julie’s phone (Samsung or other Android):**
1. Settings › Connections › **Mobile Hotspot and Tethering** › **Mobile Hotspot**. Turn it **on**.
2. Note the network name and password.
3. Optional but helpful: in the hotspot’s settings, set **“Turn off when no device connected”** (or a timeout) to **Never**. Then the hotspot doesn’t switch itself off between guests.

On an iPhone, the equivalent is Settings › Personal Hotspot › **Allow Others to Join**. Keep the Personal Hotspot screen open while the iPad first joins.

**On the iPad:**
1. Settings › **Wi-Fi**: choose Julie’s hotspot and enter the password. The iPad remembers it, so next time it rejoins by itself when the hotspot is on.
2. Settings › Display & Brightness › Auto-Lock › **Never**. Keep the iPad plugged in.

**Data use:** small. The iPad checks in with the website every few seconds, which is roughly 1 to 3 MB an hour. The guest list copy is a few kilobytes. The camera picture never leaves the iPad.

If the hotspot drops, check-in carries on (see Part 4).

---

## Part 3: the locked full-screen kiosk (set up once per website)

Two things lock the iPad.
- **The Home Screen app:** it shows the check-in screens full screen, with no address bar, tabs or Safari buttons. It can only show the check-in screens.
- **Guided Access:** this is built into the iPad. It stops anyone leaving the app: the Home gesture, Control Centre, notifications, the app switcher and the buttons are all switched off until the passcode is entered.

The app on its own is not a lock: someone could still swipe up to leave it. Guided Access is the lock.

**A. Add the check-in app to the Home Screen**
1. On the iPad, open Safari and go to `https://new-ways-staging.newwaysmediumship.workers.dev/self-checkin`.
2. Tap the **Share** button (the square with an arrow, top right), then **Add to Home Screen**.
3. Leave the name as **New Way’s Check-in** (or shorten it) and tap **Add**.
4. Close Safari. From now on, always open **New Way’s Check-in** from the Home Screen.

**B. Set it up inside the app.** The app keeps its own storage, separate from Safari, so it needs its own setup code.
1. On your phone: Admin › Check in › iPad self check-in. Tap **Set up again (new code)** next to Entrance iPad. The old Safari tab then stops working, which is what you want.
2. On the iPad, open **New Way’s Check-in** from the Home Screen and **type** the 8-digit code. Don’t scan the QR with the Camera app: that opens Safari, not the app.
3. Tap **Connect this iPad**.
4. The first time you tap **Scan QR Code**, the iPad asks to use the camera. Tap **Allow**.
5. Check Admin: under iPad self check-in it should say **Showing as: Full-screen app (Home Screen)**. If it says “In a Safari tab”, the iPad is not locked full screen.

**C. Switch on Guided Access (once)**
1. Settings › Accessibility › **Guided Access** › turn **On**.
2. **Passcode Settings › Set Guided Access Passcode**: choose a 6-digit passcode that only you and Julie know (not the iPad’s own passcode).
3. In Passcode Settings, turn **Face ID** off, so only the passcode ends it.
4. Turn **Accessibility Shortcut** on, with Guided Access ticked, so triple-clicking the top button starts it.

**D. Lock the iPad into check-in (each event)**
1. Open **New Way’s Check-in** from the Home Screen.
2. Triple-click the **top button** (the power button). The Guided Access screen opens.
3. Tap **Options** (bottom left) and set:
   - **Top Button: off**
   - **Volume Buttons: off**
   - **Motion: off** (keeps the screen the way it is on the stand)
   - **Keyboards: on** (guests need it to type their name)
   - **Touch: on**
   - **Time Limit: off**
   - **Dictionary Lookup: off**

   Tap **Done**. The iPad remembers these.
4. Tap **Start** (top right). “Guided Access Started” appears briefly.

**E. Ending Guided Access** (Gary or Julie only): triple-click the top button, enter the Guided Access passcode, then tap **End** (top left).

**What to try once it’s locked:**
- Swipe up from the bottom.
- Swipe down from the top corners.
- Press the top button and the volume buttons.
- Press and hold names and the logo.
- Pinch to zoom.

The iPad should stay on the check-in screen every time.

**Other notes:**
- Admin’s **Pause / Close / Disconnect** control what the screen says. They don’t end Guided Access, and Guided Access doesn’t stop Admin’s controls.
- The iPad’s key lasts 60 days and renews itself each day it is used. **Disconnect / Reconnect** in Admin need no new code. **Remove iPad** does.
- Don’t delete the Home Screen app or clear Safari’s website data. Doing either removes the key, and any check-ins waiting to be sent.

---

## Part 4: if the connection drops (offline check-in)

**While check-in is open**, the iPad keeps an up-to-date copy of the event’s guest list:
- what it holds: names, whether each guest has arrived, and each QR code in scrambled form only;
- what it doesn’t hold: no emails, phone numbers, payments or references;
- it is encrypted on the iPad.

**If the hotspot drops:**
- A red bar shows **“Offline: check-ins are being saved on this iPad (N waiting to be sent)”**.
- Guests can still type their name and scan their QR code. Two guests with the same name are still sent to Julie.
- Each check-in is saved (encrypted) on the iPad **before** the guest is told. The success screen then says it is *“Saved on this iPad… added to Julie’s list automatically as soon as the connection returns.”*
- If Safari is closed or the iPad restarts while offline, the check-in screens still open and nothing saved is lost.
- A QR code the copy can’t confirm (another event, unknown) is **never accepted offline**: the guest is asked to see Julie.

**When the connection returns:**
- The saved check-ins are sent by themselves, and the website checks each one again.
- A guest Julie had already checked in meanwhile is counted once, and shown under **Needs Julie** as an offline duplicate.
- A booking cancelled meanwhile is not accepted, and Julie is warned.
- Julie’s screen shows any check-ins still waiting on the iPad, and how many offline check-ins arrived.

**Afterwards:** when check-in is closed, the iPad deletes its copy, but only after everything has been sent. Admin warns before an iPad that still holds unsent check-ins is removed.

**The copy is valid for 12 hours.** After that, offline check-in stops until the iPad is back online.

**TEST and LIVE:** a TEST copy can only ever add test records. The website signs whether a copy is TEST or LIVE, and the iPad can’t change it.

---

## Part 5: the test plan (on the real iPad and your phones)

**Getting ready:**
- Admin › Check in › **Staging Test Night** (or tap **Show every event** for **Spring Supper (staging)**, three months ahead).
- Tap **Use the iPad for this event**, then **Start TEST check-in**. You can also start LIVE: everything here is made up.

**Test QR codes** (open on a phone and hold it up to the iPad; put the address above in front of each):

| Link | Booking | What should happen |
|---|---|---|
| `/c/StagingGroupOfSix00000` | Group of six (Smiths) | Choose some, check in, then the rest later |
| `/c/StagingLindaAndSam0000` | Linda Brown and Sam Grey | Shows both |
| `/c/StagingLindaSecond0000` | The second Linda Brown | Shows her only |
| `/c/StagingCardBooking0000` | Anne-Marie O’Neill (card) | Checks in |
| `/c/StagingPayAtDoor000000` | Pat Doyle (to pay at the door) | Sent to Julie |
| `/c/StagingCancelled000000` | Carl Gone (cancelled) | Sent to Julie |
| `/c/StagingReservation0000` | Rhona and Ross Reserve | Paid reservation: checks in |
| `/c/StagingJaneSingle00000` | Jane Single | Checks in |
| `/c/StagingPeterSingle0000` | Peter Single | Complimentary: checks in |
| `/c/StagingSpringSupper000` | Fiona and Frank Future | Another event: sent to Julie |

**Names to type:**
- `Mary Smith`: one guest, checks in.
- `Mary` on its own: asks for the full name.
- `linda brown`: two guests, sent to Julie.
- `anne marie oneill`: found.
- `Nobody Here`: not found.

**Checklist:**
- [ ] Single, group, and partial group (then the rest later, by QR code and by name)
- [ ] Several guests one after another
- [ ] Scanning the same QR code twice, and a guest who is already checked in
- [ ] Same name, cancelled, complimentary, paid, reservation, pay at the door, another event
- [ ] Pause, Resume, Close, Disconnect, Reconnect from Admin: the iPad changes within about 5 seconds
- [ ] Turn off Julie’s hotspot, then check in by name and by QR code. Close Safari and reopen it. Turn the hotspot back on and watch them arrive on Julie’s phone
- [ ] Julie checks a guest in on her phone while the iPad is offline, and the iPad checks them in too: one record, and an offline duplicate note
- [ ] Restart the iPad: it goes straight back to check-in
- [ ] Remove the iPad in Admin, then set it up again with a new code
- [ ] TEST MODE, then Reset test check-ins; then LIVE (with the tick)
- [ ] Portrait and landscape on the stand; the camera under the entrance lighting

You can add more test bookings in the test copy’s Admin (Add a booking, Import a paper list). Running Deploy STAGING again never removes or doubles them.

---

## Afterwards

- **Going live** (only after Gary approves): upload the same ZIP to **main**, then run **Deploy New Way’s Website**. The iPad is then paired with the live website separately.
- **The test copy can stay** for future testing. To remove it: Cloudflare › delete `new-ways-staging` (Worker), `new-ways-staging` (D1) and `new-ways-staging-media` (R2); delete the WorkOS staging key; delete the `staging` branch.
