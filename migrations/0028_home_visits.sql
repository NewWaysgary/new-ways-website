-- New Way's: private readings as a Home Visit (In Person: Gary travels to the customer's home) as well as by
-- WhatsApp video call. ADDITIVE ONLY: new columns with defaults, so every existing booking and incomplete booking
-- reads as a WhatsApp reading, exactly as before. No existing row is changed.
-- Gary's own home (the starting point for the mileage) is NOT stored here: it is a private server setting.

ALTER TABLE bookings ADD COLUMN reading_method TEXT NOT NULL DEFAULT 'whatsapp';   -- 'whatsapp' or 'home'
ALTER TABLE bookings ADD COLUMN visit_address TEXT NOT NULL DEFAULT '';            -- the customer's address (home visits)
ALTER TABLE bookings ADD COLUMN visit_postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN travel_miles_one_way REAL NOT NULL DEFAULT 0;      -- by road, as calculated
ALTER TABLE bookings ADD COLUMN travel_return_miles INTEGER NOT NULL DEFAULT 0;    -- there and back, rounded UP
ALTER TABLE bookings ADD COLUMN travel_pence INTEGER NOT NULL DEFAULT 0;           -- return miles × 60p
ALTER TABLE bookings ADD COLUMN travel_minutes INTEGER NOT NULL DEFAULT 0;         -- each way, kept clear in the diary

ALTER TABLE reading_drafts ADD COLUMN reading_method TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE reading_drafts ADD COLUMN visit_address TEXT NOT NULL DEFAULT '';
ALTER TABLE reading_drafts ADD COLUMN visit_postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE reading_drafts ADD COLUMN travel_return_miles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_drafts ADD COLUMN travel_pence INTEGER NOT NULL DEFAULT 0;
