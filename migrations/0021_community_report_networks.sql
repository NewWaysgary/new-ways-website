-- New Way's Community: security review (14 October 2026).
-- Reports now also keep a scrambled code for the visitor's network (never the IP address itself), so that one person
-- can't hide a comment on their own by reporting it three times from different browsers or private windows: three
-- reports must come from three different networks. Only adds a column; nothing existing is changed.
ALTER TABLE community_reports ADD COLUMN reporter_net TEXT NOT NULL DEFAULT '';
