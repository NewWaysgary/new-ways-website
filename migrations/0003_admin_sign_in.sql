-- Admin sign-in (WorkOS AuthKit). One owner account only.

-- Server-side sessions. The browser only holds a random token; only its hash is stored here.
DROP TABLE IF EXISTS admin_sessions;
CREATE TABLE admin_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,                   -- WorkOS user id (must match the owner)
  workos_sid TEXT NOT NULL DEFAULT '',     -- WorkOS session id, used to sign out there too
  refresh_token TEXT NOT NULL DEFAULT '',  -- encrypted (AES-GCM) with SESSION_SECRET
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                -- absolute limit (30 days)
  last_seen_at TEXT NOT NULL,              -- for the inactivity limit (14 days)
  checked_at TEXT NOT NULL,                -- last time WorkOS confirmed the session is still valid
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX admin_sessions_expiry ON admin_sessions (expires_at);

-- The owner: bound to Gary's WorkOS account the first time OWNER_EMAIL signs in with a verified email.
CREATE TABLE owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  workos_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  bound_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
