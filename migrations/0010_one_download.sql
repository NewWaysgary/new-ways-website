-- New Way's: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD (meditation downloads), with full records for Admin.
-- ADDITIVE ONLY: new tables and new columns. Nothing is deleted. The only changes to existing rows are two sentences
-- that described the emailed 6-digit codes, which no longer exist (each is changed only where that exact sentence is
-- still present, so anything Gary has rewritten is left alone):
--   * the personal-use terms shown before payment and in the email;
--   * the meditation sentence in the Privacy Notice.
--
-- What changes in the website (see src/shop/downloads.js):
--   * the 15-minute "restart" window is gone, and so are the emailed 6-digit codes for another device;
--   * pressing DOWNLOAD YOUR MEDITATION uses the purchase's one download (all-or-nothing, on the server) BEFORE any
--     of the file is sent, and gives that one browser a private, short-lived address for the file;
--   * the server never sends more than the file's size plus a small allowance in total for one purchase, so a
--     second complete copy can't be sent, even with several requests at the same moment;
--   * every transfer, refused attempt and Admin replacement is recorded.

-- The claim made by pressing the button, and what the server has sent for it
ALTER TABLE download_entitlements ADD COLUMN claim_hash TEXT;               -- hash of the private file address
ALTER TABLE download_entitlements ADD COLUMN claim_cookie_hash TEXT;        -- hash of the cookie given to that browser
ALTER TABLE download_entitlements ADD COLUMN claim_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_entitlements ADD COLUMN file_size INTEGER;             -- exact size in bytes, read from R2 when pressed
ALTER TABLE download_entitlements ADD COLUMN bytes_reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_entitlements ADD COLUMN bytes_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_entitlements ADD COLUMN transfer_status TEXT NOT NULL DEFAULT '';   -- '' | in_progress | completed | interrupted
ALTER TABLE download_entitlements ADD COLUMN transfer_completed_at TEXT;

-- One row per request for the file (a resumed download is a second row)
CREATE TABLE download_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  range_start INTEGER NOT NULL DEFAULT 0,
  range_length INTEGER NOT NULL,                   -- bytes this request asked for
  file_size INTEGER NOT NULL,
  bytes_sent INTEGER NOT NULL DEFAULT 0,           -- bytes the server handed on for sending
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'part_sent', 'interrupted')),
  user_agent TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
CREATE INDEX download_transfers_ent ON download_transfers (entitlement_id, id);
CREATE INDEX download_transfers_order ON download_transfers (order_id, id);

-- Refused attempts (a used link pressed again, a second request at the same moment, another browser, and so on)
CREATE TABLE download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  entitlement_id INTEGER,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX download_events_order ON download_events (order_id, id);

-- Replacement downloads, which only Gary or a full Admin (such as Julie) can authorise, with a reason
CREATE TABLE download_replacements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  old_entitlement_id INTEGER,
  new_entitlement_id INTEGER NOT NULL,
  authorised_by TEXT NOT NULL,                     -- name of the person signed in to Admin
  authorised_email TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  any_device INTEGER NOT NULL DEFAULT 0,
  email_status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX download_replacements_order ON download_replacements (order_id, id);

-- ---------- The two sentences about emailed codes (only where the exact sentence is still there) ----------
UPDATE settings SET value = replace(value, 'Your purchase includes one download. Your secure download link is sent by email straight after payment and must be started within 24 hours, on the phone or computer you buy on (or another device you confirm with a code we email to you).', 'Your purchase includes ONE download (a one-time download). Your secure download link is sent by email straight after payment and must be started within 24 hours, on the phone or computer you buy on. Pressing the download button uses your one download, and it can’t be downloaded again.')
  WHERE key = 'meditation_terms' AND instr(value, 'Your purchase includes one download. Your secure download link is sent by email straight after payment and must be started within 24 hours, on the phone or computer you buy on (or another device you confirm with a code we email to you).') > 0;
UPDATE content_blocks SET body = replace(body, 'If you download on a different device, we email a short code to the address you bought with, and that device is remembered too.', 'We also keep a record of your one download: when the download button was pressed, how much of the file our server sent and whether it finished, and any further attempts to download it.'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE key = 'privacy_notice' AND instr(body, 'If you download on a different device, we email a short code to the address you bought with, and that device is remembered too.') > 0;
