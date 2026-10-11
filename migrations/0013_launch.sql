-- New Way's: launch preparation. ADDITIVE ONLY: new tables, and new wording blocks only if they don't exist yet.
-- The Privacy Notice gains a "Donations" section, and only if it doesn't already have one (anything Gary has written
-- stays as it is; the section goes just before "Live chat").

-- ---------- Donations to New Way's (Support New Way's page) ----------
CREATE TABLE donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                  -- ND-XXXXXX
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'needs_attention')),
  amount_pence INTEGER NOT NULL CHECK (amount_pence >= 100),
  donor_name TEXT NOT NULL DEFAULT '',
  donor_email TEXT NOT NULL DEFAULT '',
  show_publicly INTEGER NOT NULL DEFAULT 0 CHECK (show_publicly IN (0, 1)),   -- the donor's own choice
  public_name TEXT NOT NULL DEFAULT '',            -- the name the donor chose to show (only if show_publicly)
  public_hidden_at TEXT,                           -- Gary or Julie took it off the Supporters list (the payment stays)
  public_hidden_by TEXT NOT NULL DEFAULT '',
  access_hash TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  square_payment_link_id TEXT,
  square_payment_url TEXT NOT NULL DEFAULT '',
  square_order_id TEXT UNIQUE,
  square_payment_id TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  personal_data_removed_at TEXT
);
CREATE INDEX donations_status ON donations (status, paid_at);

-- Each email for a donation, so the thank-you is only ever sent once
CREATE TABLE donation_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sending',
  provider_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (donation_id, kind)
);

-- ---------- Removing test records (Admin › Clear test data): a full copy of everything removed is kept here ----------
CREATE TABLE cleanup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '',          -- the removed rows, exactly as they were
  done_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------- Wording for the Support New Way's page (editable in Admin › Pages and wording) ----------
INSERT OR IGNORE INTO content_blocks (key, title, body) VALUES
  ('support_intro', 'Support New Way’s', 'Your donation helps New Way’s Mediumship Development Centre keep its doors open for everyone: our Wednesday evenings, development circles, events and the centre itself. Every donation, of any size, is gratefully received.

Donations made here go to New Way’s Mediumship Development Centre. (They are separate from the charities we raise money for on our Community & Charity page.)'),
  ('support_thanks', 'Thank you', 'From everyone at New Way’s: thank you. Your kindness helps us keep welcoming people through our doors, week after week. We are truly grateful for your support.');

-- ---------- Privacy Notice: a section about donations ----------
UPDATE content_blocks SET body = replace(body, char(10) || '# Live chat' || char(10), char(10) || '# Donations
If you make a donation we keep your name, email address, the amount, the date and the payment reference, and whether you chose to be shown on our Supporters list. We use your email address to send your thank-you and confirmation. Your name and amount only appear on the Supporters list if you choose that, and we can remove them from the list at any time if you ask. Your contact details are removed {Customer details kept} after your donation; the record of the payment itself is kept for our accounts.' || char(10) || char(10) || '# Live chat' || char(10)),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE key = 'privacy_notice' AND instr(body, char(10) || '# Live chat' || char(10)) > 0 AND instr(body, '# Donations') = 0;
UPDATE content_blocks SET body = replace(body, 'Contact details for readings, meditations, event bookings and Wednesday payments are removed', 'Contact details for readings, meditations, event bookings, Wednesday payments and donations are removed')
  WHERE key = 'privacy_notice' AND instr(body, '# Donations') > 0;
