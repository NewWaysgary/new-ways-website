-- Private Reading bookings, Square payments and the Meditation Shop.
-- ADDITIVE ONLY: creates new tables and adds starting rows to them. No existing table or row is changed or removed.

-- Reading types and their CURRENT prices (Gary changes prices in Admin).
CREATE TABLE reading_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes % 30 = 0),
  price_pence INTEGER NOT NULL CHECK (price_pence > 0),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO reading_services (code, name, minutes, price_pence, sort_order) VALUES
  ('reading-30', '30 Minute Private Reading', 30, 4000, 1),
  ('reading-60', '60 Minute Private Reading', 60, 6500, 2);

-- Normal weekly reading hours, UK local time (0 = Sunday ... 6 = Saturday). Times are HH:MM on the hour or half hour.
CREATE TABLE availability_weekly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (start_time < end_time)
);
INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (0, '12:00', '17:00');

-- Changes for a single date: 'closed' (no readings), 'hours' (replaces the normal hours; several rows = several
-- windows) or 'extra' (adds time on top of the normal hours). Any weekday can be opened this way.
CREATE TABLE availability_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('closed', 'hours', 'extra')),
  start_time TEXT,
  end_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (mode = 'closed' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))
);
CREATE INDEX availability_dates_date ON availability_dates (date);

-- Blocked part of a day or single appointment times.
CREATE TABLE availability_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (start_time < end_time)
);
CREATE INDEX availability_blocks_date ON availability_blocks (date);

-- One record per purchase of any kind. The price is COPIED in when the order is made, so later price changes never
-- alter it. Financial records are never deleted automatically; after the retention period only the customer's
-- contact details are removed (personal_data_removed_at).
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('PRIVATE_READING', 'MEDITATION_PURCHASE')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'needs_attention')),
  item_name TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  currency TEXT NOT NULL DEFAULT 'GBP',
  product_id INTEGER,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  terms_text TEXT NOT NULL DEFAULT '',
  terms_accepted_at TEXT,
  access_hash TEXT NOT NULL DEFAULT '',   -- hash of the private key in the customer's order-page link
  origin TEXT NOT NULL DEFAULT '',        -- the website address the order was made on (for links in emails)
  square_payment_link_id TEXT,
  square_payment_url TEXT NOT NULL DEFAULT '',
  square_order_id TEXT UNIQUE,
  square_payment_id TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  personal_data_removed_at TEXT
);
CREATE INDEX orders_kind_status ON orders (kind, status, created_at);

-- The appointment belonging to a PRIVATE_READING order.
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  price_pence INTEGER NOT NULL,
  date TEXT NOT NULL,              -- UK local date
  local_start TEXT NOT NULL,       -- UK local HH:MM
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired', 'needs_attention')),
  hold_expires_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX bookings_date ON bookings (date, status);

-- Every half hour an appointment occupies (a 60-minute reading takes two rows). The PRIMARY KEY means the database
-- itself refuses a second appointment overlapping any half hour already held or booked.
CREATE TABLE booking_slots (
  slot_utc TEXT PRIMARY KEY,
  booking_id INTEGER NOT NULL
);
CREATE INDEX booking_slots_booking ON booking_slots (booking_id);

-- Square webhook events already handled, so a repeated delivery is recognised and ignored.
CREATE TABLE square_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  outcome TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Meditation products. Each has its own price, cover, PUBLIC preview and PRIVATE full recording.
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  by_line TEXT NOT NULL DEFAULT '',
  narration_note TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_key TEXT NOT NULL DEFAULT '',     -- public image (img/...)
  preview_key TEXT NOT NULL DEFAULT '',   -- public preview audio (audio/previews/...)
  full_key TEXT NOT NULL DEFAULT '',      -- PRIVATE full recording (private/meditations/...)
  price_pence INTEGER NOT NULL CHECK (price_pence > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The first meditation, as a DRAFT: it is not shown on the website until its recording is added and Gary publishes it.
INSERT INTO products (slug, title, by_line, narration_note, short_description, price_pence, status, sort_order) VALUES
  ('feel-it-awaken-the-spirit-within', 'Feel It – Awaken the Spirit Within', 'By Medium Gary Findlay', 'Narrated by an American voice artist',
   'A guided meditation by Medium Gary Findlay.', 999, 'draft', 1);

-- Every full recording ever uploaded, so a replaced recording is kept until no paid download still needs it.
CREATE TABLE product_files (
  key TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  retired_at TEXT
);

-- One-time download links for paid meditation orders. Only a hash of the token is stored.
CREATE TABLE download_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  completed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX download_entitlements_order ON download_entitlements (order_id);

-- Each email sent for an order, so the same email is never sent twice.
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  provider_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, kind)
);
