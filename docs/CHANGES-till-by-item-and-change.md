# Wednesday till: totals by item, and change for cash (14 October 2026)

Built on the GitHub version with live comments (commit 3a47789). Card payments and the Square app are unchanged.

- **Tonight so far, by item** (till screen, tap to open; updates by itself): every till button on its own line with
  how many were sold, cash, card and total; advance payments online as one line; then the totals.
  Cancelled sales don't count. New buttons appear automatically.
- **Close night** and the **night's report**: the same table. The spreadsheet (CSV) has a matching "By item" section.
- **Change for cash sales**: on the CASH screen, an optional "Cash given" box with Exact, £5, £10, £20 and £50, showing
  "CHANGE £6.36" (or "£3.64 still to pay"). After Cash received, the message repeats the change to give.
- No database changes. New file `public/css/till.css`; `door.js` now has its own version number (`?v=17-2`), so phones
  load it without the rest of the website changing version.
- Tests: new `tests/till.test.mjs` (14 checks); full `npm test` 1,415 checks, all passing; a phone-sized browser
  run of a £13.64 cash sale with £20 given (9 checks) passed.
