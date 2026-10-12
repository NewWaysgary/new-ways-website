-- Incomplete private reading bookings: the details a customer gave the booking assistant (name, WhatsApp mobile and
-- email, with the reading, date and time) when they did not go on to pay. Every record is deleted 24 hours after it
-- was first saved. These records never hold an appointment time (only the existing payment hold does that).
-- Additive only: one new table, one new Privacy Notice section (only if it isn't there already; anything Gary has
-- written stays as it is).

CREATE TABLE reading_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,                 -- the customer's browser holds the key; only its hash is stored
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  date TEXT NOT NULL,                              -- YYYY-MM-DD (UK)
  local_start TEXT NOT NULL,                       -- HH:MM (UK)
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'incomplete', 'checkout')),
  order_reference TEXT,                            -- set when the customer pressed Proceed to Secure Payment
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  incomplete_at TEXT,
  notify_status TEXT NOT NULL DEFAULT '',          -- '', 'sending', 'sent', 'failed', 'no_address', 'not_configured'
  delete_after TEXT NOT NULL                       -- created_at + 24 hours
);
CREATE INDEX reading_drafts_status ON reading_drafts (status, last_active_at);
CREATE INDEX reading_drafts_delete ON reading_drafts (delete_after);

-- ---------- Privacy Notice: a section about incomplete bookings ----------
UPDATE content_blocks SET body = replace(body, char(10) || '# Meditations' || char(10), char(10) || '# Incomplete bookings
If you give your name, WhatsApp mobile number and email address while booking a private reading but don’t go on to payment, we keep those details, with the reading, date and time you chose, for up to 24 hours. We use them only to check that our online booking is working properly (our legitimate interests). Only New Way’s staff can see them, in our secure Admin area. We won’t use them to contact you or for marketing. They are deleted automatically 24 hours after you gave them, whether or not you finish booking. Short-term disaster-recovery copies of our database kept by our hosting provider are overwritten within 30 days.' || char(10) || char(10) || '# Meditations' || char(10)),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE key = 'privacy_notice' AND instr(body, char(10) || '# Meditations' || char(10)) > 0 AND instr(body, '# Incomplete bookings') = 0;
UPDATE content_blocks SET body = replace(body, 'Chat conversations are deleted {Chat kept} after the last message.', 'Chat conversations are deleted {Chat kept} after the last message. Details from unfinished private reading bookings are deleted 24 hours after they were given.')
  WHERE key = 'privacy_notice' AND instr(body, '# Incomplete bookings') > 0 AND instr(body, 'Details from unfinished private reading bookings') = 0;
