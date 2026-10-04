# Spam protection for Visitor Experiences: Cloudflare Turnstile (free)

Turnstile is free (unlimited widgets and checks) and needs no payment card.

1. Cloudflare dashboard → Turnstile → Add widget.
2. Name: New Way’s experiences. Hostnames: the temporary address (and later newwaysmediumshipdevelopmentcentre.com).
3. Widget mode: Managed.
4. In the Cloudflare dashboard (Workers & Pages → new-ways → Settings → Variables and Secrets) add two secrets:
   `TURNSTILE_SITE_KEY` (the Site key) and `TURNSTILE_SECRET_KEY` (the Secret key).

Until both are set, the website shows “Sharing experiences is not open yet” and accepts nothing.

What protects the form: the Turnstile check (verified on the server, single use), a hidden trap field, a signed time stamp
(forms sent within 3 seconds are ignored, forms older than 2 hours must be resent), at most 3 experiences an hour per
connection and 40 a day in total, and a same-site check. Every experience is saved as “awaiting approval” and is never
shown until Gary approves it in Admin. Rejected experiences are deleted automatically after 30 days.
