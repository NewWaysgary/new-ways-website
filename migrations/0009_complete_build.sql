-- New Way's: the complete build (meditation security, Julie's Admin, event sharing and table plans, the Wednesday door
-- till, Wednesday advance payments and check-in, live chat, the updated Privacy Notice and the virtual tour).
-- ADDITIVE ONLY: new tables and new columns. Nothing is deleted. The only changes to existing rows are listed here:
--   * meditation downloads: 24 hours to START the one download (was 48). Links already sent keep their own time.
--   * the Privacy Notice is replaced ONLY if it is still the original, unedited wording (the old wording is kept as
--     "privacy_notice_previous", so nothing is lost). An edited notice is left exactly as it is.

-- ---------- A. Meditation downloads ----------
UPDATE settings SET value = '24' WHERE key = 'download_expiry_hours' AND value = '48';
UPDATE settings SET value = replace(value, 'must be used within 48 hours', 'must be started within 24 hours')
  WHERE key = 'meditation_terms' AND value LIKE '%must be used within 48 hours%';

-- New purchases are protected against a forwarded link: the download works on the device used to buy, and on any
-- other device the customer confirms with a code emailed to the purchase address. Older purchases are unchanged.
ALTER TABLE orders ADD COLUMN device_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_entitlements ADD COLUMN any_device INTEGER NOT NULL DEFAULT 0;   -- set by Gary when reissuing, if needed

CREATE TABLE order_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  device_hash TEXT NOT NULL,                       -- a hash of the random value in the customer's security cookie
  how TEXT NOT NULL DEFAULT 'purchase' CHECK (how IN ('purchase', 'email_code')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, device_hash)
);

CREATE TABLE download_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  device_hash TEXT NOT NULL,                       -- the code only works on the device that asked for it
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX download_codes_order ON download_codes (order_id, created_at);

-- ---------- I. Full Admin users (such as Julie). Gary stays the owner; check-in helpers are unchanged ----------
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,                      -- lower case; the address they sign in with
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  workos_user_id TEXT,                             -- linked on their first sign-in
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_signin_at TEXT
);
ALTER TABLE admin_sessions ADD COLUMN admin_user_id INTEGER;

-- ---------- B. Event sharing: a JPEG copy of the poster for Facebook and WhatsApp previews ----------
ALTER TABLE events ADD COLUMN share_key TEXT NOT NULL DEFAULT '';

-- ---------- C. Table planner ----------
CREATE TABLE event_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 40),
  is_mediums INTEGER NOT NULL DEFAULT 0,           -- the separate Mediums' table (not paid tickets)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_tables_event ON event_tables (event_id, sort_order);

-- One row per seated guest: a guest can only ever be at ONE table (the primary key)
CREATE TABLE event_table_guests (
  guest_id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_table_guests_table ON event_table_guests (table_id);

-- The database itself refuses to put more guests at a table than it has seats
CREATE TRIGGER event_table_full_insert BEFORE INSERT ON event_table_guests
WHEN (SELECT COUNT(*) FROM event_table_guests t JOIN event_guests g ON g.id = t.guest_id JOIN event_bookings b ON b.id = g.booking_id
      WHERE t.table_id = NEW.table_id AND b.status = 'confirmed')
   + (SELECT COUNT(*) FROM event_medium_guests m WHERE m.table_id = NEW.table_id) + 1 > (SELECT seats FROM event_tables WHERE id = NEW.table_id)
BEGIN
  SELECT RAISE(ABORT, 'TABLE_FULL');
END;

CREATE TRIGGER event_table_full_update BEFORE UPDATE OF table_id ON event_table_guests
WHEN (SELECT COUNT(*) FROM event_table_guests t JOIN event_guests g ON g.id = t.guest_id JOIN event_bookings b ON b.id = g.booking_id
      WHERE t.table_id = NEW.table_id AND b.status = 'confirmed' AND t.guest_id != NEW.guest_id)
   + (SELECT COUNT(*) FROM event_medium_guests m WHERE m.table_id = NEW.table_id) + 1 > (SELECT seats FROM event_tables WHERE id = NEW.table_id)
BEGIN
  SELECT RAISE(ABORT, 'TABLE_FULL');
END;

-- Mediums at the Mediums' table, with their food choices (counted for catering, never for paid places)
CREATE TABLE event_medium_guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',         -- {"question id": "option id"} for the event's choice questions
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_medium_guests_event ON event_medium_guests (event_id);

CREATE TRIGGER event_mediums_table_full BEFORE INSERT ON event_medium_guests
WHEN (SELECT COUNT(*) FROM event_medium_guests m WHERE m.table_id = NEW.table_id) + 1 > (SELECT seats FROM event_tables WHERE id = NEW.table_id)
BEGIN
  SELECT RAISE(ABORT, 'TABLE_FULL');
END;

-- ---------- D. Wednesday door till ----------
-- The buttons on the till. Prices are copied into every sale, so changing a price never changes past nights.
CREATE TABLE till_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  price_pence INTEGER NOT NULL DEFAULT 0,
  custom_amount INTEGER NOT NULL DEFAULT 0,        -- 1 = the amount is typed in at the door (Gift Shop)
  category TEXT NOT NULL CHECK (category IN ('entry', 'development', 'raffle', 'gift', 'other')),
  enabled INTEGER NOT NULL DEFAULT 1,
  online INTEGER NOT NULL DEFAULT 0,               -- 1 = can also be paid for in advance online
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO till_items (label, price_pence, custom_amount, category, enabled, online, sort_order) VALUES
  ('Entry', 500, 0, 'entry', 1, 1, 1),
  ('Development', 300, 0, 'development', 1, 1, 2),
  ('Raffle strip', 100, 0, 'raffle', 1, 1, 3),
  ('Gift Shop', 0, 1, 'gift', 1, 0, 4);

-- One row per Wednesday that has been used or changed (till float and close-night count, emergency closure)
CREATE TABLE wed_nights (
  night_date TEXT PRIMARY KEY,                     -- YYYY-MM-DD (UK date)
  closed_for_public INTEGER NOT NULL DEFAULT 0,    -- H. emergency closure
  closure_reason TEXT NOT NULL DEFAULT '',
  closure_set_at TEXT,
  closure_set_by TEXT NOT NULL DEFAULT '',
  float_pence INTEGER NOT NULL DEFAULT 0,
  counted_cash_pence INTEGER,
  till_closed_at TEXT,
  till_closed_by TEXT NOT NULL DEFAULT '',
  close_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE till_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  night_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  total_pence INTEGER NOT NULL CHECK (total_pence >= 0),
  client_ref TEXT NOT NULL UNIQUE,                 -- made by the phone for each sale, so a double tap is recorded once
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  voided_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX till_sales_night ON till_sales (night_date, voided_at);

CREATE TABLE till_sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  item_id INTEGER,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_pence INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_pence INTEGER NOT NULL
);
CREATE INDEX till_sale_lines_sale ON till_sale_lines (sale_id);

-- Once a night has been closed (cash counted), no more sales can be added to it unless it is reopened
CREATE TRIGGER till_night_closed BEFORE INSERT ON till_sales
WHEN (SELECT till_closed_at FROM wed_nights WHERE night_date = NEW.night_date) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TILL_CLOSED');
END;

-- ---------- E. Wednesday optional advance payment (email address only) ----------
CREATE TABLE wed_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                  -- WN-XXXXXX
  night_date TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',                  -- lower case; the only customer detail asked for
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'needs_attention')),
  total_pence INTEGER NOT NULL,
  checkin_token TEXT NOT NULL UNIQUE,              -- random; the QR code holds only this
  access_hash TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  square_payment_link_id TEXT,
  square_payment_url TEXT NOT NULL DEFAULT '',
  square_order_id TEXT UNIQUE,
  square_payment_id TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  cancelled_at TEXT,
  first_scanned_at TEXT,
  raffles_given_at TEXT,
  raffles_given_by TEXT NOT NULL DEFAULT '',
  refunded_at TEXT,                                -- marked by Gary after refunding in Square (never automatic)
  personal_data_removed_at TEXT
);
CREATE INDEX wed_orders_night ON wed_orders (night_date, status);

CREATE TABLE wed_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_id INTEGER,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_pence INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_pence INTEGER NOT NULL,
  admitted INTEGER NOT NULL DEFAULT 0,             -- people let in on this line (entry and development)
  CHECK (admitted >= 0 AND admitted <= qty)
);
CREATE INDEX wed_order_lines_order ON wed_order_lines (order_id);

CREATE TABLE wed_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  provider_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, kind)
);

-- ---------- K. Live chat ----------
CREATE TABLE chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,                 -- the visitor's browser holds the token in a cookie; only its hash is here
  visitor_name TEXT NOT NULL DEFAULT '',           -- optional
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'blocked')),
  staff_unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_visitor_at TEXT,
  last_staff_at TEXT
);
CREATE INDEX chat_sessions_recent ON chat_sessions (last_message_at);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('visitor', 'staff')),
  staff_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX chat_messages_session ON chat_messages (session_id, id);

-- Phones that asked for chat notifications (Admin > Live chat > Notify this phone)
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,                               -- 'owner' or 'admin:ID'
  label TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_ok_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  failures INTEGER NOT NULL DEFAULT 0
);

-- ---------- Q. Virtual centre tour (genuine photos only, added by Gary) ----------
CREATE TABLE tour_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  thumb_key TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO content_blocks (key, title, body) VALUES ('tour_intro', 'Take a look around',
'Here is a look around New Way’s at Thomson Park, so you know what to expect before your first visit.');

-- ---------- M. The updated Privacy Notice ----------
-- Only when the notice is still exactly the wording the website last put in place (same length and its out-of-date event sentence)
INSERT OR IGNORE INTO content_blocks (key, title, body)
  SELECT 'privacy_notice_previous', title, body FROM content_blocks
  WHERE key = 'privacy_notice' AND length(body) = 2437 AND instr(body, 'Event tickets are bought through Square, which handles that information under its own privacy policy.') > 0;
UPDATE content_blocks SET body = 'This notice explains what information the New Way’s website and app collect, why, how long it is kept and your rights.

# Who we are
New Way’s Mediumship Development Centre, {Address}, is responsible for the information described here. You can contact us using the details on our Find Us page.

# Private readings
When you book a private reading we keep your name, email address, the mobile number you use for WhatsApp, the date and time of your reading, the price and the payment reference. We use them to hold your appointment, send your confirmation and a reminder, and contact you about your reading.

# Meditations
When you buy a meditation we keep your name, email address, what you bought, the payment reference and a record of your download (when it started). To stop a download link being used by someone else, the phone or computer you buy on is remembered with a small security cookie. If you download on a different device, we email a short code to the address you bought with, and that device is remembered too.

# Event tickets and table plans
When you book event tickets we keep your name, email address and phone number, the name of every guest, and the answers given to the event’s questions (for example meal and dessert choices, or anything else you choose to tell us, such as dietary needs). We use these for the guest list, catering, table planning, check-in at the door and to contact you about the event. Your booking has a QR code that only contains a random code.

# Wednesday evenings
No booking is needed on a Wednesday. If you choose to pay in advance online, we keep only your email address, what you paid for, the evening and the payment reference, so we can send your confirmation and QR code and a reminder at 6pm on the evening. If an evening has to be cancelled, we use your email address to tell you. Payments taken at the door are recorded as totals only, with no personal details.

# Live chat
If you use the chat on our website, we keep your messages, our replies and, only if you give one, your name. You don’t need to give your name, email address or phone number. A cookie lets you return to the same conversation in the same browser. Please don’t share sensitive personal details in the chat. Conversations are deleted {Chat kept} after the last message.

# Mailing list
We only add you to our mailing list if you ask to join (on our Join page, or by ticking the box when you book). We keep your name, email address, when and how you joined, and the wording you agreed to. Every email has an unsubscribe link and you can leave at any time. Unsubscribing does not affect any booking.

# Sharing your experience
If you share your experience of New Way’s, we keep the name you give, your star rating if you choose one, what you write, and whether you agree to it being shown publicly. Nothing is shown on the site until we have read and approved it, and only if you agreed. Experiences we decide not to publish are deleted within 30 days.

# Who else handles your information
Payments are made on Square’s secure checkout page. Square handles your card details under its own privacy policy, and New Way’s never sees them. Emails are sent for us by our email provider (Resend). The website runs on Cloudflare, which also provides our spam protection (Turnstile). We never sell your information or share it for anyone else’s marketing.

# Why we use your information
To provide what you have booked or bought (our contract with you). To send you news by email (your consent, which you can withdraw at any time). To keep the website, payments and downloads secure and to answer your chat messages (our legitimate interests).

# How long we keep it
Contact details for readings, meditations, event bookings and Wednesday payments are removed {Customer details kept} after the booking or purchase. The record of the payment itself (date, item, amount and payment reference) is kept for our accounts. Mailing list details are kept until you unsubscribe. Chat conversations are deleted {Chat kept} after the last message.

# Cookies and your device
We do not use advertising or tracking cookies. We only use cookies that are needed for the website to work: to keep your meditation download secure, to keep your chat conversation, and for our own staff to sign in. If you use the music control, your choice is remembered on your own device only.

# Technical information
Like all websites, the service that runs this site (Cloudflare) processes technical details such as your IP address to deliver pages securely and to block abuse. We keep short-lived technical records for the same reason.

# Videos and lettering
Teaching videos and livestreams play through YouTube, which may set its own cookies when you play a video. The lettering on the site is loaded from Google Fonts.

# Your rights
You can ask to see, correct or delete the information we hold about you, or object to how we use it, by contacting us. You also have the right to complain to the Information Commissioner’s Office at ico.org.uk.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE key = 'privacy_notice' AND length(body) = 2437 AND instr(body, 'Event tickets are bought through Square, which handles that information under its own privacy policy.') > 0;
