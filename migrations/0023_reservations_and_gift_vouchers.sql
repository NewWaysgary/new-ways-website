-- Event reservations made in Admin (with private payment links), places allocated before the website booking system,
-- and private reading gift vouchers.
-- ADDITIVE: new columns and new tables. No existing booking, guest, payment, order or event row is changed: every
-- existing event starts with 0 places "allocated before the website", so its places are counted exactly as before.
-- The three capacity rules are replaced by the same rules that ALSO count those earlier allocations (0 for every
-- event today, so nothing changes until Gary records some).

-- ---------- Events: places allocated before the website booking system ----------
-- Places given out before online tickets were used (paper lists, Square links, word of mouth). They are not on the
-- website's guest list, but they count towards the event's maximum, so the website can never sell them again.
ALTER TABLE events ADD COLUMN legacy_places INTEGER NOT NULL DEFAULT 0;

-- ---------- Reservations (an Admin booking that is waiting for payment) ----------
-- A reservation is an ordinary event booking (status 'held', source 'admin'), so the existing capacity rules protect
-- its places from the moment it is made, and the existing Square checkout, webhook, guest list, QR code and door
-- check-in are used when it is paid. reservation_kind is NULL for every other booking.
--   'new'      within the places still available
--   'previous' places allocated before the website (moved out of events.legacy_places, never counted twice)
--   'override' extra places Gary authorised beyond the maximum (the maximum is raised by exactly this many)
ALTER TABLE event_bookings ADD COLUMN reservation_kind TEXT CHECK (reservation_kind IS NULL OR reservation_kind IN ('new', 'previous', 'override'));
ALTER TABLE event_bookings ADD COLUMN reserve_key TEXT NOT NULL DEFAULT '';            -- the private link's key ('' = no working link)
ALTER TABLE event_bookings ADD COLUMN reserve_link_version INTEGER NOT NULL DEFAULT 0;   -- +1 each time a new link is made
ALTER TABLE event_bookings ADD COLUMN reserve_pay TEXT;                                 -- how the customer will pay: square_online, cash, card
ALTER TABLE event_bookings ADD COLUMN reserve_deadline TEXT;                            -- UTC; the private link stops working after this
ALTER TABLE event_bookings ADD COLUMN reserve_auto_release INTEGER NOT NULL DEFAULT 0;  -- 1 = released automatically at the deadline
ALTER TABLE event_bookings ADD COLUMN reserve_reason TEXT NOT NULL DEFAULT '';          -- why (required for 'previous' and 'override')
ALTER TABLE event_bookings ADD COLUMN reserve_by TEXT NOT NULL DEFAULT '';              -- who made it
ALTER TABLE event_bookings ADD COLUMN reserve_details_at TEXT;                          -- when the customer gave their details
ALTER TABLE event_bookings ADD COLUMN reserve_closed TEXT CHECK (reserve_closed IS NULL OR reserve_closed IN ('released', 'expired', 'cancelled'));
ALTER TABLE event_bookings ADD COLUMN reserve_capacity_added INTEGER NOT NULL DEFAULT 0; -- 'override': places added to the maximum
ALTER TABLE event_bookings ADD COLUMN reserve_capacity_returned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX event_bookings_reservations ON event_bookings (event_id, reservation_kind, status);

-- Every change to an event's places made through reservations or the "allocated before the website" figures
CREATE TABLE event_allocation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  booking_id INTEGER,
  action TEXT NOT NULL,
  places INTEGER NOT NULL DEFAULT 0,
  capacity_before INTEGER, capacity_after INTEGER,
  legacy_before INTEGER, legacy_after INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  done_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX event_allocation_log_event ON event_allocation_log (event_id, id);

-- ---------- The capacity rules, now also counting places allocated before the website ----------
DROP TRIGGER IF EXISTS event_capacity_insert;
CREATE TRIGGER event_capacity_insert BEFORE INSERT ON event_bookings
WHEN NEW.status IN ('held', 'confirmed')
  AND (SELECT capacity FROM events WHERE id = NEW.event_id) > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.event_id AND status IN ('held', 'confirmed'))
      + (SELECT legacy_places FROM events WHERE id = NEW.event_id)
      + NEW.quantity > (SELECT capacity FROM events WHERE id = NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_FULL');
END;

DROP TRIGGER IF EXISTS event_capacity_update;
CREATE TRIGGER event_capacity_update BEFORE UPDATE OF status, quantity ON event_bookings
WHEN NEW.status IN ('held', 'confirmed')
  AND (SELECT capacity FROM events WHERE id = NEW.event_id) > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.event_id AND status IN ('held', 'confirmed') AND id != NEW.id)
      + (SELECT legacy_places FROM events WHERE id = NEW.event_id)
      + NEW.quantity > (SELECT capacity FROM events WHERE id = NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_FULL');
END;

-- The maximum can't be set below the places taken (now including earlier allocations), and earlier allocations
-- can't go below 0 or above what the maximum leaves room for
DROP TRIGGER IF EXISTS event_capacity_lowered;
CREATE TRIGGER event_capacity_lowered BEFORE UPDATE OF capacity, legacy_places ON events
WHEN NEW.capacity > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings WHERE event_id = NEW.id AND status IN ('held', 'confirmed')) + NEW.legacy_places > NEW.capacity
BEGIN
  SELECT RAISE(ABORT, 'EVENT_CAPACITY_BELOW_TAKEN');
END;
CREATE TRIGGER event_legacy_not_negative BEFORE UPDATE OF legacy_places ON events
WHEN NEW.legacy_places < 0
BEGIN
  SELECT RAISE(ABORT, 'LEGACY_NOT_ENOUGH');
END;

-- ---------- Private readings: how an order was settled ----------
-- 'square' for every existing and normal order; 'gift_voucher' for a reading covered by a voucher (no Square payment).
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'square';
ALTER TABLE orders ADD COLUMN voucher_id INTEGER;

-- ---------- Gift vouchers / reservation codes for private readings ----------
-- One voucher = one reading of a set length. The code is random (not guessable) and stored as issued, so the printed
-- voucher always shows the real code. 'reserved' is a short hold while someone is confirming a booking with it.
CREATE TABLE gift_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                         -- GV- and 12 random characters in groups of 4, in capitals
  service_code TEXT NOT NULL,                        -- reading-30 or reading-60
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  value_pence INTEGER NOT NULL DEFAULT 0,            -- the reading's price when the voucher was made (shown on it)
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'redeemed', 'cancelled')),
  expires_on TEXT,                                   -- UK date; the booking must be made by the end of this day
  note TEXT NOT NULL DEFAULT '',                     -- e.g. Raffle prize
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reserved_until TEXT,                               -- while 'reserved'
  reserved_token TEXT,
  redeemed_at TEXT,
  order_id INTEGER,                                  -- the reading booked with it
  cancelled_at TEXT,
  cancelled_by TEXT NOT NULL DEFAULT '',
  image_key TEXT,                                    -- the finished voucher picture (PNG) in private storage
  image_made_at TEXT
);
CREATE INDEX gift_vouchers_status ON gift_vouchers (status, created_at);

CREATE TABLE gift_voucher_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL,
  what TEXT NOT NULL,
  done_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX gift_voucher_log_voucher ON gift_voucher_log (voucher_id, id);
