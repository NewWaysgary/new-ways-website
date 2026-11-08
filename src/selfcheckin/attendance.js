// Attendance: LIVE (the real attendance, event_guests.checked_in_at, exactly as Admin has always used it) or TEST
// (practice check-ins in checkin_test_attendance, which never touch real attendance and can be reset at any time).
// Every check-in, live or test, is ONE database step that only succeeds if that guest isn't checked in yet, so two
// devices tapping at the same moment can never count a guest twice.

// SQL pieces for a query over event_guests g: where the check-in time and "by" come from
export function att(test) {
  return test
    ? { join: 'LEFT JOIN checkin_test_attendance ta ON ta.guest_id = g.id', at: 'ta.checked_in_at', by: 'ta.checked_in_by' }
    : { join: '', at: 'g.checked_in_at', by: 'g.checked_in_by' };
}

const nowIso = () => new Date().toISOString();

// Returns { ok } or { already: { name, checked_in_at, checked_in_by } } or { invalid }
export async function checkIn(env, eventId, guestId, by, test = false, at = null) {
  const who = String(by || '').slice(0, 80);
  const when = at || nowIso();   // an offline check-in keeps the time the guest actually checked in
  let r;
  if (!test) {
    r = await env.DB.prepare(`UPDATE event_guests SET checked_in_at = ?1, checked_in_by = ?2
      WHERE id = ?3 AND event_id = ?4 AND checked_in_at IS NULL AND EXISTS (SELECT 1 FROM event_bookings b WHERE b.id = event_guests.booking_id AND b.status = 'confirmed')`)
      .bind(when, who, guestId, eventId).run();
  } else {
    r = await env.DB.prepare(`INSERT INTO checkin_test_attendance (guest_id, event_id, booking_id, checked_in_at, checked_in_by)
      SELECT g.id, g.event_id, g.booking_id, ?1, ?2 FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id
      WHERE g.id = ?3 AND g.event_id = ?4 AND b.status = 'confirmed'
      ON CONFLICT (guest_id) DO NOTHING`).bind(when, who, guestId, eventId).run();
  }
  if (r.meta.changes) return { ok: true };
  const a = att(test);
  const g = await env.DB.prepare(`SELECT g.id, g.name, ${a.at} AS checked_in_at, ${a.by} AS checked_in_by FROM event_guests g ${a.join} WHERE g.id = ?1 AND g.event_id = ?2`)
    .bind(guestId, eventId).first();
  return g && g.checked_in_at ? { already: g } : { invalid: true };
}

export function undoStatement(env, eventId, guestId, test = false) {
  return test
    ? env.DB.prepare('DELETE FROM checkin_test_attendance WHERE guest_id = ?1 AND event_id = ?2').bind(guestId, eventId)
    : env.DB.prepare(`UPDATE event_guests SET checked_in_at = NULL, checked_in_by = '' WHERE id = ?1 AND event_id = ?2`).bind(guestId, eventId);
}

export async function counts(env, eventId, test = false) {
  const a = att(test);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS booked, COUNT(${a.at}) AS arrived
    FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id ${a.join} WHERE g.event_id = ?1 AND b.status = 'confirmed'`).bind(eventId).first();
  return { booked: row.booked, arrived: row.arrived, waiting: row.booked - row.arrived };
}

// Test Mode: start again (only the practice check-ins and practice notes for this event; nothing real)
export function resetTestStatements(env, eventId) {
  return [
    env.DB.prepare('DELETE FROM checkin_test_attendance WHERE event_id = ?1').bind(eventId),
    env.DB.prepare('DELETE FROM checkin_help WHERE event_id = ?1 AND test = 1').bind(eventId)
  ];
}
