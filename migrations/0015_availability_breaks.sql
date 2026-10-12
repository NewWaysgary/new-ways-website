-- Private readings: Gary's regular hours become Sunday 3pm to 6pm (UK time), every other day closed unless he opens
-- it, and a 30-minute break after every reading. Both can be changed at any time in Admin › Private Readings ›
-- Availability. Changes for single dates, blocked times and every booking are left exactly as they are.

DELETE FROM availability_weekly;
INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (0, '15:00', '18:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('booking_break_minutes', '30');
