-- Events: a manual SOLD OUT switch for each event (Admin › Events).
-- Every existing event starts as NOT sold out, so nothing changes until Gary switches it on.
-- No existing booking, guest, QR code, payment or sales record is touched.

ALTER TABLE events ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0;

-- Last line of defence: refuse any NEW online ticket hold for an event that is switched to SOLD OUT,
-- or an online-tickets event whose maximum number of places is 0. The website already checks this first;
-- this rule only matters at the exact moment the switch is turned on.
-- It does not affect: places already held at checkout (they can still be paid for and confirmed),
-- bookings added by hand in Admin, any other event, or any other kind of sale.
CREATE TRIGGER event_sold_out_insert BEFORE INSERT ON event_bookings
WHEN NEW.source = 'online' AND NEW.status = 'held'
  AND (SELECT sold_out = 1 OR (sales_mode = 'online' AND capacity = 0) FROM events WHERE id = NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_FULL');
END;
