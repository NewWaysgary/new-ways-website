-- New Way's Community: live comments (14 October 2026). Only adds; nothing existing is changed or deleted.

-- A counter that goes up whenever a card's published conversation changes (a comment or reply is published, hidden,
-- deleted or restored). Phones compare it to know whether they have missed anything.
ALTER TABLE community_posts ADD COLUMN live_version INTEGER NOT NULL DEFAULT 0;

-- Replying to a reply: the reply stays in the same conversation (under the first comment) and shows
-- "replying to <name>" for the reply it answers.
ALTER TABLE community_comments ADD COLUMN reply_to_id INTEGER;

-- Each Admin's own Community phone-notification choices (Gary's and Julie's are separate).
-- who: 'owner' (Gary) or 'admin:<Admin team id>' (for example Julie), the same as the Admin phone list.
CREATE TABLE community_admin_prefs (
  who TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'review', 'off')),   -- every new comment / only ones needing review / none
  show_text INTEGER NOT NULL DEFAULT 1,                                         -- show the commenter's name and words on the lock screen
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Grouping and no-duplicates for those notifications: per person and per card, the last comment already notified and
-- how many more are waiting to be summed up ("3 more comments on …"). post_id 0 = comments waiting for review.
CREATE TABLE community_alerts (
  who TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  last_sent_at TEXT NOT NULL DEFAULT '',
  last_comment_id INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (who, post_id)
);
CREATE INDEX community_alerts_pending ON community_alerts (pending, last_sent_at);
