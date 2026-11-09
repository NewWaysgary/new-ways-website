-- New Way's: emails to mailing-list subscribers (Admin › Mailing list › SEND EMAIL TO SUBSCRIBERS).
-- ADDITIVE ONLY: two new tables. No existing table or row is changed.
-- Only people on the mailing list with status 'subscribed' are ever sent these emails. Booking emails (confirmations,
-- reminders, QR codes) are separate and unaffected.

CREATE TABLE mail_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link_ref TEXT NOT NULL DEFAULT '',          -- 'event:12' or 'medium:5' (what was chosen), or ''
  link_url TEXT NOT NULL DEFAULT '',          -- the page on the website the button opens
  link_label TEXT NOT NULL DEFAULT '',        -- the button's wording
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'stopped')),
  recipients INTEGER NOT NULL DEFAULT 0,      -- how many subscribers it was sent to (fixed when sending starts)
  test_sent_to TEXT NOT NULL DEFAULT '',
  test_sent_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  finished_at TEXT
);

-- One row per subscriber per email: the same email can never be sent to the same person twice.
CREATE TABLE mail_campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,             -- mailing_list.id (the address itself is not copied here)
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT NOT NULL DEFAULT '',       -- Resend's id for the email
  delivery TEXT NOT NULL DEFAULT '',          -- Resend's latest news about it: delivered, bounced, complained…
  error TEXT NOT NULL DEFAULT '',
  claimed_at TEXT,
  sent_at TEXT,
  checked_at TEXT,
  UNIQUE (campaign_id, subscriber_id)
);
CREATE INDEX mail_campaign_recipients_status ON mail_campaign_recipients (campaign_id, status);
CREATE INDEX mail_campaign_recipients_sent ON mail_campaign_recipients (sent_at);
