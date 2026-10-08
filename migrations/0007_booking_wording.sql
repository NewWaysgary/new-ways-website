-- Wording for online bookings and the Meditation Shop.
-- Each change is made ONLY if that wording is still exactly the original starting text, so anything Gary has already
-- edited in Admin (Pages and wording) is left exactly as it is.

UPDATE content_blocks
SET body = 'Private readings are available with Medium Gary Findlay by WhatsApp video call. Choose an available date and time that suits you and book securely online. Your reading will take place by WhatsApp video call, so please provide a mobile number connected to WhatsApp when booking.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'private_readings' AND body = 'Private readings are available with Medium Gary Findlay.';

UPDATE content_blocks
SET body = replace(body,
'# Bookings and payments
Private readings and event tickets are booked and paid for through Square. Square handles that information under its own privacy policy. We do not copy booking or payment details into this website.',
'# Private readings and meditations
When you book a private reading or buy a meditation on this website, we keep your name, your email address and, for a reading, the mobile number you use for WhatsApp, together with what you booked or bought, the price, the date and your agreement to the terms shown before payment. We use these only to provide your reading or download and to contact you about it.

Payment is taken by Square on its own secure checkout page. We never see or store your card details. Square handles payment information under its own privacy policy. Confirmation emails are sent through our email provider, Resend.

We remove your name, email address and phone number after {Customer details kept}. A record of each payment (the date, what was bought, the amount and Square’s payment reference) is kept for our accounts.

# Event tickets
Event tickets are bought through Square, which handles that information under its own privacy policy.'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'privacy_notice' AND instr(body, 'We do not copy booking or payment details into this website.') > 0;
