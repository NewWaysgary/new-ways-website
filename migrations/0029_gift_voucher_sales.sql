-- New Way's: gift vouchers bought on the public website, and what each voucher covers for travel.
-- ADDITIVE ONLY: new columns with defaults and new tables. No existing row is changed: every voucher made before this
-- update reads as 'whatsapp_only' (exactly what it covered when it was made) and as made in Admin, until Gary changes
-- an individual voucher himself in Admin.

-- What a voucher covers: 'whatsapp_only' (a WhatsApp video reading; no home visit), 'mileage_payable' (WhatsApp, or a
-- home visit with the normal travel charge paid by the customer) or 'free_mileage' (WhatsApp, or a home visit with the
-- travel FREE). Chosen by Gary in Admin; vouchers bought on the website are 'mileage_payable'.
ALTER TABLE gift_vouchers ADD COLUMN travel_cover TEXT NOT NULL DEFAULT 'whatsapp_only';
ALTER TABLE gift_vouchers ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';          -- 'admin' (made in Admin) or 'purchase' (bought online)
ALTER TABLE gift_vouchers ADD COLUMN purchase_id INTEGER;                           -- the purchase that paid for it (bought online)
CREATE UNIQUE INDEX gift_vouchers_purchase ON gift_vouchers (purchase_id) WHERE purchase_id IS NOT NULL;   -- one voucher per purchase, ever

-- A gift voucher being bought. The voucher itself is only made once Square confirms the payment.
CREATE TABLE voucher_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                    -- NWV- and 6 characters (Square's reference for the payment)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'needs_attention')),
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  purchaser_name TEXT NOT NULL,
  purchaser_email TEXT NOT NULL,
  delivery TEXT NOT NULL CHECK (delivery IN ('purchaser', 'recipient')),   -- A: sent to the purchaser; B: straight to the recipient
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  terms_text TEXT NOT NULL DEFAULT '',               -- exactly what the purchaser agreed to, with the total
  terms_accepted_at TEXT,
  access_hash TEXT NOT NULL,                         -- the purchaser's private page link (only its hash)
  print_key TEXT NOT NULL UNIQUE,                    -- the private link to the printable voucher (sent by email once paid)
  origin TEXT NOT NULL,
  square_payment_link_id TEXT,
  square_payment_url TEXT,
  square_order_id TEXT UNIQUE,
  square_payment_id TEXT UNIQUE,
  voucher_id INTEGER UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  paid_at TEXT,
  personal_data_removed_at TEXT
);
CREATE INDEX voucher_purchases_status ON voucher_purchases (status, created_at);

-- Every email about a purchase, so the same one is never sent twice (a failed one can be tried again)
CREATE TABLE voucher_purchase_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (purchase_id, kind)
);
