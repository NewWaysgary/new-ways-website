# Stage 4 correction (1.0.1-test)

**What failed:** an independent `npm test` run of New-Ways-System-Stage-4.zip gave 30 passed, 18 failed and stopped,
with "column index out of range" from `activeAnnouncements` and 500 errors on public pages.

**Cause (local test stand-in only):** `dev/server.mjs` imitates Cloudflare D1 with Node's built-in SQLite and passed
D1-style numbered parameters (`?1`, `?2`) straight to it. Node before 24.7.0 (and some 22.x releases) binds those as
named parameters (nodejs/node#59340), so every query with `?1` failed there. The release used for the original
test run (Node 22.22.2) binds them correctly, which is why it passed. Cloudflare D1 supports `?NNN` ordered
parameters, so the website's queries were valid for production.

**Changes:**

- `dev/server.mjs`: the D1 stand-in now converts `?NNN` and `?` itself, following SQLite's numbering rules, and passes
  only plain `?` to Node. Like D1, it now refuses a wrong number of values, `undefined` values, named parameters, and
  unknown columns in `first(column)`. It checks itself at start-up and stops with a clear message if binding is wrong.
- `src/views/public.js`: the parts shown on every page (Centre Settings, announcements, LIVE NOW, social links, music)
  now fall back safely and log the error if one fails to load, so one failing part cannot cause a 500 on every page.
- `tests/system.test.mjs`: prints the Node and SQLite versions, no longer stops if sign-in cannot start, reports passed,
  failed and not run, and adds checks that run the site under the older Node behaviour
  (`tests/support/simulate-old-node-sqlite.mjs`) and with simulated database failures.
- `package.json`: `engines.node >= 22.13.0` (Node's built-in SQLite is available without a flag from 22.13).

No change to the design, the database migrations, or any other website behaviour.
