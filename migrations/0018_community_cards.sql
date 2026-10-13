-- New Way's Community, Stage 2: thank-you cards (hidden; nothing is public until a card is published, and publishing
-- arrives in Stage 3). Adds two new tables only. No existing table or data is changed or removed.

-- One thank-you card for a Wednesday guest medium. The wording, fonts, colours and the position of the official badge
-- are kept as a "layout" (JSON, checked on the server), so the website card and the Facebook picture are drawn from
-- the same layout. The background is one of the nine approved designs (01-06, 08-10).
CREATE TABLE community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL DEFAULT '',                    -- readable part of the address, e.g. thank-you-jane-smith
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL DEFAULT '',                   -- page heading and Facebook title
  medium_name TEXT NOT NULL DEFAULT '',
  wed_date TEXT NOT NULL DEFAULT '',                -- YYYY-MM-DD (UK date of the Wednesday)
  background TEXT NOT NULL DEFAULT '01',
  layout_json TEXT NOT NULL DEFAULT '{}',
  animate_logo INTEGER NOT NULL DEFAULT 1,          -- the badge's gold shimmer (website and app only)
  text_shadow INTEGER NOT NULL DEFAULT 0,           -- soft shadow behind the wording
  share_key TEXT NOT NULL DEFAULT '',               -- R2 key of the finished 1200 x 630 Facebook picture (Stage 3)
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT
);
CREATE INDEX community_posts_status ON community_posts (status, published_at);

-- The background rotation: every one of the nine designs is used once before any repeats.
CREATE TABLE community_rotation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used TEXT NOT NULL DEFAULT '[]',                  -- designs already used in this round, e.g. ["01","02"]
  last TEXT NOT NULL DEFAULT '',                    -- the design used most recently (never first in the next round)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO community_rotation (id) VALUES (1);
