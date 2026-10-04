# Admin sign-in: WorkOS AuthKit setup (staging, free)

Use the **staging** environment. It is free and needs no payment card.
Do not add billing details and do not switch on any paid add-on (custom AuthKit domain, Radar).

## In the WorkOS dashboard (staging)

1. **Authentication**: Email + Password on. Everything else (social sign-in, Magic Auth, SSO) off.
2. **Sign up**: off. Nobody can create an account.
3. **Multi-Factor Auth (authenticator app)**: optional. Gary decides; recommended once he is comfortable.
4. **Users → Invites**: invite Gary’s email address. He sets his own password from the invitation email.
5. **Applications → your application → Redirects**
   - Redirect URI: `https://<temporary-address>/admin/callback`
   - Sign-out redirect: `https://<temporary-address>/admin/signed-out`
6. **Sessions**: maximum session length 30 days, inactivity timeout 14 days, access token 5 minutes.
7. **Branding**: New Way’s logo and colours (navy, gold, electric blue). The page stays on WorkOS’s own address.
8. **Radar**: leave off.

## In Cloudflare (Worker settings)

| Name | Type | Value |
| --- | --- | --- |
| `WORKOS_CLIENT_ID` | secret | the staging Client ID (`client_...`) |
| `WORKOS_API_KEY` | secret | the staging API key (`sk_test_...`) |
| `OWNER_EMAIL` | secret | Gary’s sign-in email address |
| `SESSION_SECRET` | secret | 48+ random characters (e.g. `openssl rand -base64 48`) |
| `TURNSTILE_SITE_KEY` | secret | see `docs/turnstile-setup.md` |
| `TURNSTILE_SECRET_KEY` | secret | see `docs/turnstile-setup.md` |

Add each in the Cloudflare dashboard: Workers & Pages → new-ways → Settings → Variables and Secrets → Add → type Secret.
(Or `npx wrangler secret put NAME`.) Never put these in code, in chat, or in the browser.
If any of them is missing, Admin stays locked.

## First sign-in

The first time Gary signs in with `OWNER_EMAIL` (verified by WorkOS), Admin links itself to that WorkOS account.
After that only that account can sign in, even if someone created another account with the same email.
If Gary’s WorkOS account is ever deleted and recreated, a developer clears the link with:
`npx wrangler d1 execute new-ways --remote --command "DELETE FROM owner"`

## When a payment card is needed

Not for staging. WorkOS asks for billing details only to switch on its **production** environment, at go-live.
AuthKit itself stays free at New Way’s usage. Cloudflare R2 (photo storage) also needs a card on file to switch on its free allowance.
