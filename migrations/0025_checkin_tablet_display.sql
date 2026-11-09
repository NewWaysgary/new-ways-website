-- iPad self check-in: how the iPad is showing the check-in screens, as it last reported it, so Admin can confirm it is
-- running as the locked full-screen Home Screen app (no Safari address bar) rather than in an ordinary Safari tab.
-- ADDITIVE: one new column on the new checkin_tablets table only (added by 0024). Nothing else changes.
ALTER TABLE checkin_tablets ADD COLUMN display_mode TEXT NOT NULL DEFAULT '';
