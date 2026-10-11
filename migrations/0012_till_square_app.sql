-- New Way's: Wednesday till card payments taken in the Square Point of Sale app, checked with Square and recorded
-- automatically. ADDITIVE ONLY: one new table and two new columns. Nothing is deleted and no existing row is changed.

-- One row each time the till opens the Square app for a sale
CREATE TABLE till_card_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,                        -- random; given to Square and handed back when Square returns
  client_ref TEXT NOT NULL,                        -- the till's own reference for the sale (till_sales.client_ref)
  night_date TEXT NOT NULL,
  total_pence INTEGER NOT NULL CHECK (total_pence > 0),
  lines_json TEXT NOT NULL,                        -- the priced lines when the Square app was opened
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN
    ('waiting', 'checking', 'paid', 'cancelled', 'failed', 'mismatch', 'unverified', 'duplicate')),
  square_transaction_id TEXT UNIQUE,               -- from Square when it returns (the Square order ID)
  square_client_transaction_id TEXT,
  square_payment_id TEXT UNIQUE,                   -- the payment Square confirmed: each one can only ever count once
  detail TEXT NOT NULL DEFAULT '',                 -- why it was not paid, in plain words
  checks INTEGER NOT NULL DEFAULT 0,
  sale_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  returned_at TEXT,                                -- when Square came back to the website
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX till_card_requests_sale ON till_card_requests (client_ref);
CREATE INDEX till_card_requests_night ON till_card_requests (night_date, id);

-- A card sale confirmed by Square records which Square payment it was (so the same payment can't count twice)
ALTER TABLE till_sales ADD COLUMN square_payment_id TEXT;
ALTER TABLE till_sales ADD COLUMN card_request_id INTEGER;
CREATE UNIQUE INDEX till_sales_square_payment ON till_sales (square_payment_id) WHERE square_payment_id IS NOT NULL;
