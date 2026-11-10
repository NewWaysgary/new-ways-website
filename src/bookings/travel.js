// Home Visits (In Person): Gary travels to the customer's home. The travel charge is worked out here, on the server:
//   * the customer's postcode is checked and placed with postcodes.io (free, no key: UK government open data);
//   * the DRIVING route from Gary's home to it is found with OpenRouteService (when its free key is set) or else the
//     free OpenStreetMap routing service (OSRM). Never a straight line;
//   * return miles = the one-way road miles × 2, rounded UP to a whole mile; charge = return miles × 60p.
// If the postcode can't be found or no route can be worked out, NO figure is made up: the customer is asked to check
// their address. Gary's own home is a private server setting (READING_HOME_LOCATION: a postcode or "latitude,longitude");
// it is never sent to the browser, shown, emailed or stored with a booking. Without it, home visits aren't offered.
// "57 Findhorn Place, Dundee" / "Flat 2, Rose Cottage, Main Street, Perth": the house number or name exactly as typed,
// then the street (without repeating the number if the customer typed it in both boxes), then the town
export function visitAddress(v) {
  const house = String(v.house || '').trim(), street = String(v.street || '').trim();
  const streetHasHouse = house && street.toLowerCase().startsWith(house.toLowerCase() + ' ');
  const line = streetHasHouse ? street : /^\d+[A-Za-z]?$/.test(house) ? `${house} ${street}` : [house, street].filter(Boolean).join(', ');
  return [line, v.town].filter(Boolean).join(', ');
}

export const PENCE_PER_MILE = 60;
export const MAX_MILES_ONE_WAY = 20;          // Gary's home-visit area: 20 road miles each way at most
const METRES_PER_MILE = 1609.344;
const TIMEOUT_MS = 8000;
const UA = 'NewWaysMediumship/1.0 (private reading travel charge; newwaysmediumshipdevelopmentcentre.com)';
const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(u || ''));

export const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;
export function normalisePostcode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

// Return miles, rounded UP to a whole mile, and the charge at 60p a mile. (17.6 each way → 35.2 → 36 → £21.60)
export function travelCharge(oneWayMiles) {
  const exact = Math.round(oneWayMiles * 2 * 1000) / 1000;      // ignore floating-point dust (17.6 × 2 = 35.2 exactly)
  const returnMiles = Math.ceil(exact);
  return { returnMiles, travelPence: returnMiles * PENCE_PER_MILE };
}

// Each way, with a margin for traffic and parking, in whole minutes
export const milesText = (m) => (Math.round(Number(m) * 10) / 10).toFixed(1);

export const travelMinutes = (seconds) => Math.max(5, Math.ceil((seconds * 1.2) / 60));

function bases(env) {
  const test = isLocal(env.ROUTING_TEST_BASE) ? String(env.ROUTING_TEST_BASE).replace(/\/+$/, '') : '';
  return {
    postcodes: test ? test + '/postcodes' : 'https://api.postcodes.io/postcodes',
    ors: test ? test + '/ors/v2/directions/driving-car' : 'https://api.openrouteservice.org/v2/directions/driving-car',
    osrm: test ? test + '/osrm/route/v1/driving' : 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
  };
}

export function homeVisitsReady(env) {
  const v = String(env.READING_HOME_LOCATION || '').trim();
  return !!(normalisePostcode(v) || /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(v));
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// A UK postcode → { lat, lng } (or null if it isn't a real, current postcode)
export async function placePostcode(env, postcode) {
  const r = await getJson(bases(env).postcodes + '/' + encodeURIComponent(postcode));
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.body || !r.body.result) throw new Error('postcode lookup unavailable');
  const { latitude, longitude } = r.body.result;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return { lat: latitude, lng: longitude };
}

async function homePoint(env) {
  const v = String(env.READING_HOME_LOCATION || '').trim();
  const m = v.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  const pc = normalisePostcode(v);
  return pc ? placePostcode(env, pc) : null;
}

// The driving route: { metres, seconds } or null if none could be found
export async function drive(env, from, to) {
  const b = bases(env);
  if (env.ORS_API_KEY) {
    const r = await getJson(`${b.ors}?start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`, { Authorization: String(env.ORS_API_KEY).trim() });
    const s = r.status === 200 && r.body && r.body.features && r.body.features[0] && r.body.features[0].properties && r.body.features[0].properties.summary;
    if (s && s.distance > 0 && s.duration > 0) return { metres: s.distance, seconds: s.duration };
    // fall through to the OpenStreetMap service
  }
  const r = await getJson(`${b.osrm}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`);
  const route = r.status === 200 && r.body && r.body.code === 'Ok' && r.body.routes && r.body.routes[0];
  if (route && route.distance > 0 && route.duration > 0) return { metres: route.distance, seconds: route.duration };
  return null;
}

// The customer's address → the travel charge. Returns { ok: true, … } or { ok: false, field, message }.
export async function quote(env, { postcode }) {
  if (!homeVisitsReady(env)) return { ok: false, field: 'method', message: 'Home visits can’t be booked online just now. Please choose a WhatsApp video call, or contact Gary.' };
  const pc = normalisePostcode(postcode);
  if (!pc) return { ok: false, field: 'postcode', message: 'Please enter your full UK postcode, for example DD2 2SJ.' };
  try {
    const [from, to] = await Promise.all([homePoint(env), placePostcode(env, pc)]);
    if (!from) return { ok: false, field: 'method', message: 'Home visits can’t be booked online just now. Please choose a WhatsApp video call, or contact Gary.' };
    if (!to) return { ok: false, field: 'postcode', message: `We couldn’t find the postcode ${pc}. Please check it and try again.` };
    const route = await drive(env, from, to);
    if (!route) return { ok: false, field: 'postcode', message: `We couldn’t work out a driving route to ${pc}, so the travel charge can’t be calculated. Please check your address and postcode, or choose a WhatsApp video call.` };
    const oneWay = Math.round((route.metres / METRES_PER_MILE) * 1000) / 1000;   // kept exact (to 1/1000 mile): shown to 1 decimal place
    if (oneWay > MAX_MILES_ONE_WAY) return { ok: false, outOfArea: true, postcode: pc };   // outside the 20-mile area (the distance itself isn't shown)
    const { returnMiles, travelPence } = travelCharge(oneWay);
    return { ok: true, postcode: pc, oneWayMiles: oneWay, returnMiles, travelPence, travelMinutes: travelMinutes(route.seconds) };
  } catch (err) {
    console.error("New Way's: travel charge not calculated:", err && err.message ? err.message : err);
    return { ok: false, field: 'postcode', message: 'The travel charge can’t be calculated just now (the route service didn’t answer). Nothing has been booked. Please try again in a few minutes, or choose a WhatsApp video call.' };
  }
}

// ---------- the quote travels with the booking pages, signed, so the amount charged is exactly the amount shown ----------
const enc = new TextEncoder();
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode('home-visit-quote:' + String(env.SESSION_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const quoteText = (q, address) => [q.postcode, String(address || '').trim().toLowerCase().replace(/\s+/g, ' '), q.oneWayMiles, q.returnMiles, q.travelPence, q.travelMinutes, q.at].join('|');
export async function signQuote(env, q, address) {
  const at = Date.now();
  return { ...q, at, sig: await hmac(env, quoteText({ ...q, at }, address)) };
}
// From the hidden fields: the quote, if genuine, for this address, and less than 3 hours old
export async function readQuote(env, f, address) {
  const q = { postcode: normalisePostcode(f.q_postcode), oneWayMiles: Number(f.q_miles), returnMiles: Number(f.q_return), travelPence: Number(f.q_pence), travelMinutes: Number(f.q_minutes), at: Number(f.q_at) };
  if (!q.postcode || !(q.oneWayMiles > 0) || !Number.isInteger(q.returnMiles) || !Number.isInteger(q.travelPence) || !Number.isInteger(q.travelMinutes) || !Number.isFinite(q.at)) return null;
  if (Date.now() - q.at > 3 * 3600_000 || q.at > Date.now() + 60_000) return null;
  if (!env.SESSION_SECRET || String(f.q_sig || '') !== await hmac(env, quoteText(q, address))) return null;
  if (q.travelPence !== q.returnMiles * PENCE_PER_MILE || q.returnMiles !== travelCharge(q.oneWayMiles).returnMiles) return null;
  return q;
}
export const quoteFields = (q) => ({ q_postcode: q.postcode, q_miles: String(q.oneWayMiles), q_return: String(q.returnMiles), q_pence: String(q.travelPence), q_minutes: String(q.travelMinutes), q_at: String(q.at), q_sig: q.sig });

// The half hours a home visit keeps clear: the journey there, the reading, the journey back, then Gary's usual break
export function homeVisitSlots(startUtc, minutes, travelMin, breakMin, slotsFor) {
  const pad = Math.ceil(travelMin / 30) * 30;
  const from = new Date(Date.parse(startUtc) - pad * 60_000).toISOString();
  return slotsFor(from, pad + minutes + pad + breakMin);
}
