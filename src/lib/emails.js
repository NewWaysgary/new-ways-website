// Every email address is stored and used in one form: no spaces at either end, all lower case.
// (Phones often capitalise the first letter; to email services "NewWays@…" and "newways@…" can otherwise differ.)
export function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}
