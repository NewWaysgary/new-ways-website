# Launch progress (checked through the connected accounts, 11 Oct 2026)

## Done and read back
- WorkOS (Staging environment, application "New Way’s Admin", the one Admin sign-in uses): added
  `https://newwaysmediumshipdevelopmentcentre.com/admin/callback` (redirect) and
  `https://newwaysmediumshipdevelopmentcentre.com/admin/signed-out` (sign-out). The workers.dev addresses are kept
  and are still the defaults, so today's sign-in is unchanged.
- Resend: domain `newwaysmediumshipdevelopmentcentre.com` added (region eu-west-1, Ireland). Not verified until
  these DNS records exist. They are on sub-names only, so they never affect the website or Google Sites:

| Type | Name | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCy1J+Hw5hbbvVroEUSjOVDdqf+OlQCL2nyZAqVLtEoL9SE1/DrHSKRLc/iS62fHP/wb7s1raseA2S3I1MaQ1Cz776L3XJ/2mi3RxqL8CFTKiDA8QQGsczqTa7hEJapvDWTVP6NH13SqjkCI0YthEtbNV+doBi6n5Q8xZytZWPkRwIDAQAB` | |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
| CNAME | `rsend` | `send.forge.rmta.net` | |

## Checked, unchanged
- Cloudflare: one Worker `new-ways-website`; database `new-ways` has migration 0013 applied. A second, empty
  database `new-ways-db` is unused (left alone).
- Square (live account, location "New Way's" LJHKF5GHVR31R): three real £1 card payments from the Galaxy S24 on
  11 Oct at 10:00, 10:30 and 11:00 UK time. The till has the 10:00 one (entered by hand) and the 11:00 one (confirmed
  automatically). The 10:30 one (receipt gXW7) is not in the till: use Wednesday door → Match it up with Square.
