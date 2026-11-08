-- STAGING ONLY: made-up test bookings for the test copy (new-ways-staging). Never used on the live website.
-- Run by the "Deploy STAGING (test copy)" workflow. Safe to run again: anything already there is left as it is.
-- The QR codes have fixed, made-up codes so the test links never change (see docs/STAGING.md). No real customer is here.
INSERT INTO events (name, date, time_text, summary, visible, sales_mode, start_time, venue, price_pence, capacity, legacy_places)
SELECT 'Staging Test Night', date('now'), '7pm', 'TEST EVENT on the staging copy', 1, 'link', '19:00', 'New Way’s (test)', 2500, 60, 4
WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'Staging Test Night');
INSERT INTO events (name, date, time_text, summary, visible, sales_mode, start_time, venue, price_pence, capacity)
SELECT 'Spring Supper (staging)', date('now', '+92 days'), '7pm', 'TEST EVENT three months ahead', 1, 'link', '19:00', 'New Way’s (test)', 2500, 60
WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'Spring Supper (staging)');

INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG001', 'online', 'confirmed', 'square_online', 'paid', 6, 2500, 15000, 'Mary Smith', '', 'StagingGroupOfSix00000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG001');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Mary Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 2, 'John Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 3, 'Ann Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 4, 'Bob Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 5, 'Catherine Montgomery-Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 6, 'Alexander Smith' FROM event_bookings b WHERE b.reference = 'EV-STG001';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG002', 'admin', 'confirmed', 'cash', 'paid', 2, 2500, 5000, 'Linda Brown', '', 'StagingLindaAndSam0000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG002');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Linda Brown' FROM event_bookings b WHERE b.reference = 'EV-STG002';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 2, 'Sam Grey' FROM event_bookings b WHERE b.reference = 'EV-STG002';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG003', 'online', 'confirmed', 'square_online', 'paid', 1, 2500, 2500, 'Linda Brown', '', 'StagingLindaSecond0000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG003');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Linda Brown' FROM event_bookings b WHERE b.reference = 'EV-STG003';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG004', 'admin', 'confirmed', 'card', 'paid', 1, 2500, 2500, 'Anne-Marie O’Neill', '', 'StagingCardBooking0000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG004');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Anne-Marie O’Neill' FROM event_bookings b WHERE b.reference = 'EV-STG004';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG005', 'admin', 'confirmed', 'cash', 'unpaid', 1, 2500, 2500, 'Pat Doyle', '', 'StagingPayAtDoor000000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG005');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Pat Doyle' FROM event_bookings b WHERE b.reference = 'EV-STG005';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG006', 'online', 'cancelled', 'square_online', 'paid', 1, 2500, 2500, 'Carl Gone', '', 'StagingCancelled000000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG006');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Carl Gone' FROM event_bookings b WHERE b.reference = 'EV-STG006';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG007', 'admin', 'confirmed', 'cash', 'paid', 2, 2500, 5000, 'Rhona Reserve', '', 'StagingReservation0000', 'https://new-ways-staging.newwaysmediumship.workers.dev', 'new', 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG007');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Rhona Reserve' FROM event_bookings b WHERE b.reference = 'EV-STG007';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 2, 'Ross Reserve' FROM event_bookings b WHERE b.reference = 'EV-STG007';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG008', 'online', 'confirmed', 'square_online', 'paid', 1, 2500, 2500, 'Jane Single', '', 'StagingJaneSingle00000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG008');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Jane Single' FROM event_bookings b WHERE b.reference = 'EV-STG008';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Staging Test Night' ORDER BY id LIMIT 1), 'EV-STG009', 'admin', 'confirmed', 'complimentary', 'free', 1, 0, 0, 'Peter Single', '', 'StagingPeterSingle0000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG009');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Peter Single' FROM event_bookings b WHERE b.reference = 'EV-STG009';
INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, origin, reservation_kind, note)
SELECT (SELECT id FROM events WHERE name = 'Spring Supper (staging)' ORDER BY id LIMIT 1), 'EV-STG010', 'online', 'confirmed', 'square_online', 'paid', 2, 2500, 5000, 'Fiona Future', '', 'StagingSpringSupper000', 'https://new-ways-staging.newwaysmediumship.workers.dev', NULL, 'STAGING test booking'
WHERE NOT EXISTS (SELECT 1 FROM event_bookings WHERE reference = 'EV-STG010');
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 1, 'Fiona Future' FROM event_bookings b WHERE b.reference = 'EV-STG010';
INSERT OR IGNORE INTO event_guests (booking_id, event_id, position, name) SELECT b.id, b.event_id, 2, 'Frank Future' FROM event_bookings b WHERE b.reference = 'EV-STG010';
