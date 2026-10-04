-- New Way's: database structure for the whole system.
-- Applied with: wrangler d1 migrations apply new-ways --remote

-- Centre Settings: one row per setting (prices, times, address, links...)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Editable wording: Home welcome, About, Our Story, Mission, Development Circle, Privacy notice...
CREATE TABLE content_blocks (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Who's On: guest mediums (a Wednesday drops off automatically once it has passed)
CREATE TABLE mediums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',       -- where the medium is from
  description TEXT NOT NULL DEFAULT '',
  photo_key TEXT NOT NULL DEFAULT '',      -- R2 key of the photograph
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX mediums_date ON mediums (date);

-- Special events (BOOK / BUY TICKETS only shows when a ticket link is entered)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  time_text TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',        -- short information
  details TEXT NOT NULL DEFAULT '',        -- full information
  ticket_info TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',     -- Square link
  poster_key TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX events_date ON events (date);

-- Community & charity totals
CREATE TABLE charity_totals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charity_name TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  date_label TEXT NOT NULL DEFAULT '',     -- e.g. "November 2025"
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- First visit / FAQs ({Entry price} style tokens are filled from Centre Settings)
CREATE TABLE faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Gallery photographs
CREATE TABLE gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Visitor experiences. Nothing is public until Gary approves it.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER,                          -- optional 1 to 5
  body TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,      -- agreed to public display
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden', 'rejected')),
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT
);
CREATE INDEX reviews_status ON reviews (status, created_at);

-- Announcements (stop showing automatically after their end time)
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  importance TEXT NOT NULL DEFAULT 'notice' CHECK (importance IN ('notice', 'important', 'urgent')),
  starts_at TEXT,                          -- UTC ISO, optional
  ends_at TEXT,                            -- UTC ISO, optional
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Live: a single row describing the current or next YouTube Live stream
CREATE TABLE live_stream (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,                       -- UTC ISO, optional
  thumbnail_key TEXT NOT NULL DEFAULT '',
  is_live INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Teaching videos: YouTube links only. Removing an entry never touches the video on YouTube.
CREATE TABLE teaching_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_url TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  thumbnail_key TEXT NOT NULL DEFAULT '',  -- optional own thumbnail, otherwise YouTube's
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Social links (Facebook, YouTube and others)
CREATE TABLE social_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Background music: a single row
CREATE TABLE music (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  track_key TEXT NOT NULL DEFAULT '',
  track_title TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  default_volume INTEGER NOT NULL DEFAULT 40 CHECK (default_volume BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every photo, poster and music file stored in R2
CREATE TABLE media (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  original_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Admin sessions (filled in once the sign-in provider is connected)
CREATE TABLE admin_sessions (
  id_hash TEXT PRIMARY KEY,                -- only a hash of the cookie value is stored
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  refresh_token TEXT NOT NULL DEFAULT '',  -- stored encrypted
  user_agent TEXT NOT NULL DEFAULT ''
);

-- Short-lived counters for spam and abuse limits (no personal data kept long term)
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- A record of Admin changes, to help with recovery
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT ''
);

INSERT INTO live_stream (id) VALUES (1);
INSERT INTO music (id) VALUES (1);
