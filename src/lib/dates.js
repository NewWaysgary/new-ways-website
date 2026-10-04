// Dates are worked out in UK time, so a Wednesday "passes" at midnight in Dundee, not in UTC.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ukToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1;
}

// "2026-10-14" -> "Wednesday 14 October" (the year is added when it isn't this year)
export function longDate(iso, today = ukToday()) {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const text = `${DAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  return String(y) === today.slice(0, 4) ? text : `${text} ${y}`;
}

export function weekdayOf(iso) {
  if (!isIsoDate(iso)) return -1;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Number of days from today (UK) to the given date
export function daysFromToday(iso, today = ukToday()) {
  if (!isIsoDate(iso)) return null;
  const a = Date.parse(today + 'T00:00:00Z');
  const b = Date.parse(iso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

export function nowIso() { return new Date().toISOString(); }

// ---------- UK clock times (announcements) ----------
// Gary types times as they are in Dundee; they are stored in UTC, so British Summer Time is handled automatically.

function londonOffsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(instant).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

// "2026-10-14T18:00" (UK time) -> "2026-10-14T17:00:00.000Z"
export function londonLocalToUtc(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m || !isIsoDate(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - londonOffsetMinutes(new Date(guess)) * 60000;
  const second = londonOffsetMinutes(new Date(utc));
  utc = guess - second * 60000;
  return new Date(utc).toISOString();
}

// "2026-10-14T17:00:00.000Z" -> "2026-10-14T18:00" (for the Admin form)
export function utcToLondonLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).reduce((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "Wednesday 14 October, 6pm" style, in UK time
export function friendlyDateTime(iso) {
  const local = utcToLondonLocal(iso);
  if (!local) return '';
  const [date, time] = local.split('T');
  let [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${longDate(date)}, ${h}${m ? ':' + String(m).padStart(2, '0') : ''}${suffix}`;
}
