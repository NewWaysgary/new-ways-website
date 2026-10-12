-- Private readings: every date starts CLOSED. There are no recurring weekly hours any more; Gary makes each date
-- available himself in Admin › Private Readings › Availability. Customers can book at most 8 weeks ahead.
-- Bookings, payments and the 30-minute break are not touched.

DELETE FROM availability_weekly;
DELETE FROM availability_dates;
DELETE FROM availability_blocks;
UPDATE settings SET value = '8' WHERE key = 'booking_horizon_weeks' AND (CAST(value AS INTEGER) > 8 OR CAST(value AS INTEGER) < 1);
INSERT OR IGNORE INTO settings (key, value) VALUES ('booking_horizon_weeks', '8');
