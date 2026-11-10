# Private readings: WhatsApp video call or Home Visit (In Person)

**The booking sequence is unchanged:**
1. Duration.
2. Calendar.
3. Date and time.
4. The booking assistant asks for details.
5. Price.
6. Square.

**What's new in step 4:** the booking assistant first asks **How would you like your reading?**: **WhatsApp Video Call** or **Home Visit (In Person)** (Gary comes to your home).
- **WhatsApp:** name, WhatsApp number and email, exactly as before.
- **Home visit:** full name, contact mobile, email, then the address in separate boxes, all required: house or flat number (or property name), street name, town or city, postcode. Without the house number or name the booking can't continue or be paid for.

**Travel charge (home visits only):**
- **Postcode:** checked with postcodes.io (free UK government open data).
- **Route:** the driving route from Gary's home is found by OpenRouteService if its free key (`ORS_API_KEY`) is set; otherwise by the free OpenStreetMap routing service. It is never a straight line.
- **Charge:** one-way road miles × 2, rounded UP to a whole mile, × 60p. For example, 17.6 → 35.2 → 36 miles → £21.60.
- **20-mile limit:** more than 20 road miles each way can't be booked as a home visit. The assistant offers to switch to a WhatsApp reading, keeping the duration, date, time and details. NO cancels; nothing is booked.
- **No route:** if the postcode can't be found or no route can be worked out, no figure is made up and the customer is asked to check their address.

**Prices stay hidden:** nothing is priced until every detail is given (for home visits, the address and postcode too).
- **The booking review shows:** the reading price, the return miles, the travel charge at £0.60 a mile, and the total.
- **Payment:** Square is asked for exactly that total.
- **Tampering:** the travel charge is signed by the website, so it can't be altered in the page.

**Diary:**
- **Kept clear:** a home visit keeps Gary's journey there (rounded up to whole half hours, with a 20% margin), the reading, the journey back and his usual break.
- **Within his hours:** the reading itself must be within his appointment hours that day. His journeys may start before them and end after them.
- **If a time doesn't suit:** the customer is shown other times that do suit a home visit to their address, with their details kept.
- **No clashes:** nothing may overlap another appointment. WhatsApp readings can't be booked while he is travelling.

**Gary's home:** a private server setting, `READING_HOME_LOCATION` (his postcode, or "latitude,longitude"). It is never shown, emailed, stored with a booking or sent to the browser.
- **To set it:** Cloudflare › Workers & Pages › new-ways-website › Settings › Variables and Secrets › Add › type **Secret**, then **Deploy**.
- **Until it is set:** home visits aren't offered, and everything works as before.

**Other changes:**
- **Emails:** confirmations, reminders and Gary's notifications say WhatsApp or Home Visit. For a home visit they include the customer's address, the miles and the travel charge.
- **Admin:** the order page, bookings list, diary and Incomplete Bookings show WhatsApp Video Call or Home Visit (In Person), with the address, mileage and travel charge.
- **Incomplete Bookings:** the retention, notification and deletion rules are unchanged.
- **Gift vouchers:** still used online for WhatsApp readings. For a home visit with a voucher, the customer is asked to contact Gary.
- **Privacy Notice:** an updated version mentions home visits. Admin › Pages and wording › Privacy Notice › **Use the updated Privacy Notice**.

Database: `migrations/0028_home_visits.sql` only adds columns, with defaults that make every existing booking a WhatsApp reading.
