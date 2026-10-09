-- Event tickets, check-in, mailing list, and tidy-ups.
-- ADDITIVE: new tables and new columns only. The only changes to existing rows are listed here, and none deletes anything:
--   * email addresses are stored in lower case from now on, so existing ones are lower-cased to match;
--   * meditation download links: customers have 48 hours to start their ONE download (as agreed).

UPDATE orders SET customer_email = lower(trim(customer_email)) WHERE customer_email != lower(trim(customer_email));
UPDATE settings SET value = lower(trim(value)) WHERE key = 'notification_email';
UPDATE settings SET value = '48' WHERE key = 'download_expiry_hours';

-- ---------- Event tickets (added to the EXISTING events; every existing event keeps its Square link exactly as now) ----------
-- sales_mode: 'link' = the Square ticket link as now (the default), 'online' = tickets booked on this website, 'none'
ALTER TABLE events ADD COLUMN sales_mode TEXT NOT NULL DEFAULT 'link';
ALTER TABLE events ADD COLUMN start_time TEXT NOT NULL DEFAULT '';        -- HH:MM, UK time
ALTER TABLE events ADD COLUMN doors_time TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN venue TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN price_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN capacity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN max_per_booking INTEGER NOT NULL DEFAULT 10;
ALTER TABLE events ADD COLUMN sales_open_at TEXT;                         -- UTC, optional
ALTER TABLE events ADD COLUMN sales_close_at TEXT;                        -- UTC, optional
ALTER TABLE events ADD COLUMN instructions TEXT NOT NULL DEFAULT '';      -- arrival information etc.
ALTER TABLE events ADD COLUMN booking_terms TEXT NOT NULL DEFAULT '';     -- optional; must be ticked before paying

-- Questions Gary adds to an event (asked once per guest, or once per booking)
CREATE TABLE event_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  help TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('short_text', 'long_text', 'select', 'choice', 'checkbox')),
  scope TEXT NOT NULL DEFAULT 'guest' CHECK (scope IN ('guest', 'booking')),
  required INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_questions_event ON event_questions (event_id, sort_order);

CREATE TABLE event_question_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX event_question_options_q ON event_question_options (question_id, sort_order);

-- One booking: a purchaser and a number of tickets, paid online (Square) or recorded by Gary (cash, card, free...)
CREATE TABLE event_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'admin')),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired', 'needs_attention')),
  payment_method TEXT NOT NULL DEFAULT 'square_online' CHECK (payment_method IN ('square_online', 'cash', 'card', 'complimentary', 'other')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'unpaid', 'free')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_pence INTEGER NOT NULL DEFAULT 0,      -- copied from the event when booked
  total_pence INTEGER NOT NULL DEFAULT 0,
  purchaser_name TEXT NOT NULL DEFAULT '',
  purchaser_email TEXT NOT NULL DEFAULT '',          -- lower case; optional for bookings made in Admin
  purchaser_phone TEXT NOT NULL DEFAULT '',
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  terms_text TEXT NOT NULL DEFAULT '',
  terms_accepted_at TEXT,
  confirmed_snapshot TEXT NOT NULL DEFAULT '',       -- exactly what the customer reviewed and confirmed (JSON)
  checkin_token TEXT NOT NULL UNIQUE,                -- random; the QR code holds only this
  access_hash TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  square_payment_link_id TEXT,
  square_payment_url TEXT NOT NULL DEFAULT '',
  square_order_id TEXT UNIQUE,
  square_payment_id TEXT UNIQUE,
  hold_expires_at TEXT,
  note TEXT NOT NULL DEFAULT '',                     -- private Admin note
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  cancelled_at TEXT,
  personal_data_removed_at TEXT
);
CREATE INDEX event_bookings_event ON event_bookings (event_id, status);

-- The database itself refuses a booking that would take an event over its capacity (held + confirmed places),
-- even when two people pay for the last places at the same moment. Capacity 0 means "no limit set".
CREATE TRIGGER event_capacity_insert BEFORE INSERT ON event_bookings
WHEN NEW.status IN ('held', 'confirmed')
  AND (SELECT capacity FROM events WHERE id = NEW.event_id) > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.event_id AND status IN ('held', 'confirmed'))
      + NEW.quantity > (SELECT capacity FROM events WHERE id = NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_FULL');
END;

CREATE TRIGGER event_capacity_update BEFORE UPDATE OF status, quantity ON event_bookings
WHEN NEW.status IN ('held', 'confirmed')
  AND (SELECT capacity FROM events WHERE id = NEW.event_id) > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.event_id AND status IN ('held', 'confirmed') AND id != NEW.id)
      + NEW.quantity > (SELECT capacity FROM events WHERE id = NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_FULL');
END;

-- ...and the maximum can't be set below the places already taken
CREATE TRIGGER event_capacity_lowered BEFORE UPDATE OF capacity ON events
WHEN NEW.capacity > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.id AND status IN ('held', 'confirmed')) > NEW.capacity
BEGIN
  SELECT RAISE(ABORT, 'EVENT_CAPACITY_BELOW_TAKEN');
END;

-- Each guest on a booking, checked in individually
CREATE TABLE event_guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  checked_in_at TEXT,
  checked_in_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (booking_id, position)
);
CREATE INDEX event_guests_event ON event_guests (event_id, checked_in_at);

-- Answers (guest_id 0 = an answer for the whole booking). The question wording is copied as it was when answered,
-- and original_value keeps what the customer first chose, whatever is changed later.
CREATE TABLE event_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  guest_id INTEGER NOT NULL DEFAULT 0,
  question_id INTEGER NOT NULL,
  question_label TEXT NOT NULL,
  option_id INTEGER,
  value TEXT NOT NULL DEFAULT '',
  original_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (booking_id, guest_id, question_id)
);
CREATE INDEX event_answers_question ON event_answers (question_id, option_id);

-- Every change made in Admin to an answer or a guest name
CREATE TABLE event_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  guest_id INTEGER NOT NULL DEFAULT 0,
  what TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_changes_booking ON event_changes (booking_id);

-- Emails for event bookings (each sent once; failed ones can be retried)
CREATE TABLE event_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  provider_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (booking_id, kind)
);

-- ---------- Mailing list (separate from bookings; only people who chose to join) ----------
CREATE TABLE mailing_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,                        -- lower case
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'unsubscribed')),
  source TEXT NOT NULL DEFAULT '',
  consent_text TEXT NOT NULL DEFAULT '',
  unsubscribe_token TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unsubscribed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------- Check-in helpers (check-in only; Gary's owner access is unchanged) ----------
CREATE TABLE checkin_helpers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,                        -- lower case; the address they sign in with
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  workos_user_id TEXT,                               -- linked on their first sign-in
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_signin_at TEXT
);
ALTER TABLE admin_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE admin_sessions ADD COLUMN helper_id INTEGER;
