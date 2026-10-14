-- New Way's Community: public comments and reactions, verified Admin comments, the launch switch, visitor statistics,
-- Wednesday notifications and the artwork Designer. Adds new tables and three new columns on community_posts only.
-- No existing record is changed or removed. Everything stays switched OFF until Gary or Julie use the launch switch.

-- Community settings: the launch switch ('off' = hidden; 'testing' = card links work and comments can be tried, still
-- out of the menu and Google; 'live' = in the menu, sitemap and Google) and the official commenting switches.
CREATE TABLE community_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO community_config (key, value) VALUES ('launch', 'off'), ('official_gary', '0'), ('official_julie', '0');

-- Like, Love and Thank You on a card: one of each per visitor code.
CREATE TABLE community_reactions (
  post_id INTEGER NOT NULL,
  visitor_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'love', 'thanks')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (post_id, visitor_key, kind)
);

-- Likes on comments: one per visitor code.
CREATE TABLE community_comment_likes (
  comment_id INTEGER NOT NULL,
  visitor_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (comment_id, visitor_key)
);

-- Wednesday notifications: phones that chose to receive them (completely separate from Admin chat notifications).
CREATE TABLE community_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_ok_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);

-- One notification send per card (so the same card can never be sent twice), sent in small batches.
CREATE TABLE community_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
-- Each phone in a send: pending -> sending -> sent / failed / gone. A phone marked 'sending' is never sent to again,
-- so an interrupted batch can never send twice (in the rare worst case that phone misses that one notification).
CREATE TABLE community_deliveries (
  send_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'gone')),
  detail TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (send_id, subscriber_id)
);

-- Private visitor statistics (no cookies, no accounts, no IP addresses). post_id 0 = the Community list page.
CREATE TABLE community_stats (
  day TEXT NOT NULL,                                 -- YYYY-MM-DD (UK)
  post_id INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,                -- different visitors that day (estimated)
  facebook INTEGER NOT NULL DEFAULT 0,               -- visits that came from Facebook (estimated)
  PRIMARY KEY (day, post_id)
);
-- Today's scrambled visitor codes, only to count each visitor once a day (scrambled with a code that changes daily;
-- deleted after two days). post_id -1 = anywhere in the Community.
CREATE TABLE community_seen (
  day TEXT NOT NULL,
  code TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  PRIMARY KEY (day, code, post_id)
);

-- The Designer's picture library: backgrounds, photos, stickers and frames uploaded in Admin (stored in R2).
CREATE TABLE community_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'background' CHECK (kind IN ('background', 'photo', 'sticker', 'frame')),
  name TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  favourite INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The Designer's reusable templates.
CREATE TABLE community_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  design_json TEXT NOT NULL DEFAULT '{}',
  thumb_key TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Cards made in the Designer: kind 'design', the editable design, and the finished artwork (without the badge, which
-- the website adds on top so it can shimmer). Cards from the original editor stay kind 'card' and are unchanged.
ALTER TABLE community_posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'card';
ALTER TABLE community_posts ADD COLUMN design_json TEXT NOT NULL DEFAULT '';
ALTER TABLE community_posts ADD COLUMN art_key TEXT NOT NULL DEFAULT '';
