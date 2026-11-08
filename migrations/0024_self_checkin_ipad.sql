-- iPad self check-in at the entrance (guests check themselves in by QR code or by typing their full name).
-- ADDITIVE: four new tables only. No existing event, booking, guest, QR code, payment, reading or Wednesday record is
-- changed. LIVE check-ins use the existing event_guests rows and the same single database step Admin uses, so a guest
-- can never be counted twice, whether checked in on the iPad, on Julie's phone, or both at once.
-- TEST MODE check-ins go only into checkin_test_attendance (below), never into the real attendance.
-- To undo: the previous version of the website simply ignores these tables (see docs/CHANGES-ipad-self-checkin.md).

-- Each iPad allowed to run self check-in. It never signs in to Admin: Admin shows a one-time setup code, the iPad types
-- it once and is given its own private key (kept here only in scrambled form). The key works only for self check-in.
-- Admin chooses the iPad's event (any event, any date), TEST or LIVE, and whether check-in is open:
--   state  'active' (guests can check in), 'paused', 'closed', or 'disconnected' (still set up; reconnect in Admin)
--   mode   'test' (practice: nothing real is recorded) or 'live' (real attendance; needs confirming in Admin)
CREATE TABLE checkin_tablets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Entrance iPad',
  token_hash TEXT UNIQUE,                            -- SHA-256 of the iPad's private key (NULL until set up)
  pair_code_hash TEXT UNIQUE,                        -- SHA-256 of the one-time setup code (NULL once used)
  pair_expires_at TEXT,                              -- UTC; the setup code stops working after this
  event_id INTEGER,                                  -- the event chosen in Admin (NULL = none yet)
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('active', 'paused', 'closed', 'disconnected')),
  state_changed_at TEXT,
  state_changed_by TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paired_at TEXT,
  key_renewed_at TEXT,                               -- the iPad's key is renewed once a day while it is in use (expires after 60 days unused)
  last_seen_at TEXT,
  pending_count INTEGER NOT NULL DEFAULT 0,          -- offline check-ins saved on the iPad, not yet sent (as the iPad last reported)
  pending_since TEXT,                                -- when the oldest of those was made
  last_sync_at TEXT,                                 -- when the iPad last sent offline check-ins
  revoked_at TEXT                                    -- removed in Admin: needs a new setup code
);

-- TEST MODE attendance: practice check-ins, kept apart from the real attendance (event_guests.checked_in_at).
-- One row per guest at most, so a guest can't be test-checked-in twice either. "Reset test check-ins" empties it.
CREATE TABLE checkin_test_attendance (
  guest_id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  checked_in_at TEXT NOT NULL,
  checked_in_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX checkin_test_attendance_event ON checkin_test_attendance (event_id, checked_in_at);

-- When the iPad sends someone to Julie (two guests with the same name, a name that isn't on the guest list, a booking
-- that needs her), it is shown live on Julie's check-in screen until she marks it done. Removed after 14 days.
CREATE TABLE checkin_help (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tablet_id INTEGER,
  event_id INTEGER NOT NULL,
  test INTEGER NOT NULL DEFAULT 0,                   -- 1 = from TEST MODE
  kind TEXT NOT NULL CHECK (kind IN ('same_name', 'not_found', 'booking', 'other_event', 'unknown_qr', 'offline_duplicate', 'offline_problem')),
  typed_name TEXT NOT NULL DEFAULT '',               -- what the guest typed (name searches only)
  booking_id INTEGER,                                -- the booking concerned (QR codes and single matches)
  guest_id INTEGER,                                  -- the guest concerned (offline check-ins)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX checkin_help_event ON checkin_help (event_id, test, resolved_at, id);

-- Every check-in the iPad makes carries its own random number (made on the iPad). When the iPad was offline it sends
-- them later; this table makes sending the same one again harmless (the first answer is simply given again), and keeps
-- a record of what happened to each offline check-in. Kept for 14 days.
CREATE TABLE checkin_sync_log (
  client_id TEXT PRIMARY KEY,
  tablet_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  test INTEGER NOT NULL DEFAULT 0,
  guest_id INTEGER NOT NULL,
  offline INTEGER NOT NULL DEFAULT 0,                -- 1 = made while the iPad was offline, sent later
  result TEXT NOT NULL,                              -- 'in', 'already' (someone had checked them in already) or 'rejected'
  client_at TEXT,                                    -- when the guest checked in, by the iPad's clock
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX checkin_sync_log_event ON checkin_sync_log (event_id, test, recorded_at);
