-- New Way's: event bookings taken at the Wednesday till (ADD EVENT BOOKING).
-- ADDITIVE ONLY: one new table and two new columns. Nothing is deleted and no existing row is changed.
-- The booking itself is an ordinary event booking (event_bookings, event_guests, event_answers), made by the same
-- code as Admin's "Add a booking". This table only records that it was taken at the till, how it was paid there, and
-- the till's own reference, so the same tap or the same Square payment can never make two bookings.

CREATE TABLE till_event_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref TEXT NOT NULL UNIQUE,                 -- the till's own reference for this booking: one booking per reference
  night_date TEXT NOT NULL,                        -- the till night it was taken on
  event_id INTEGER NOT NULL,
  booking_id INTEGER,
  reference TEXT NOT NULL DEFAULT '',              -- the booking's EV-XXXXXX reference
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  qty INTEGER NOT NULL DEFAULT 0,
  total_pence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('waiting', 'paid', 'released')),
  card_request_id INTEGER,                         -- the Square app payment, when card was taken in the Square app
  square_payment_id TEXT UNIQUE,                   -- each Square payment can only ever pay for one booking
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX till_event_bookings_night ON till_event_bookings (night_date, status);

-- A Square app payment can now be for a till sale ('till', as before) or for an event booking ('event')
ALTER TABLE till_card_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'till';
ALTER TABLE till_card_requests ADD COLUMN booking_id INTEGER;
