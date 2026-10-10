// Centre Settings: standard information Gary changes once and the site shows everywhere.
// Values not yet known are left empty; empty details are simply not shown on the public site.
import { esc } from './html.js';

export const SETTING_GROUPS = [
  {
    id: 'centre',
    title: 'Centre',
    fields: [
      { key: 'centre_name', label: 'Centre name', type: 'text', value: 'New Way’s Mediumship Development Centre', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text', value: '', help: 'A short line about New Way’s, shown at the bottom of every page.' },
      { key: 'site_description', label: 'Short description for Google and shared links', type: 'textarea', rows: 3,
        value: 'New Way’s is a community focused spiritual centre at Thomson Park, Dundee. Every Wednesday we welcome a different guest medium, followed by our Development Circle. Everyone is welcome.' }
    ]
  },
  {
    id: 'wednesday',
    title: 'Wednesday evenings',
    intro: 'These details appear on Who’s On, the Home screen, the Development Circle page and in the FAQs.',
    fields: [
      { key: 'doors_open', label: 'Doors open', type: 'time', value: '6:30pm', placeholder: 'e.g. 6:30pm' },
      { key: 'service_start', label: 'Service starts', type: 'time', value: '7pm', placeholder: 'e.g. 7pm' },
      { key: 'service_end', label: 'Service ends', type: 'time', value: '', placeholder: 'e.g. 8:15pm' },
      { key: 'break_time', label: 'Break', type: 'text', value: '', placeholder: 'e.g. 8:15pm to 8:30pm' },
      { key: 'circle_start', label: 'Development Circle starts', type: 'time', value: '', placeholder: 'e.g. 8:30pm' },
      { key: 'circle_end', label: 'Development Circle ends', type: 'time', value: '', placeholder: 'e.g. 9:30pm' },
      { key: 'entry_price', label: 'Wednesday entry price', type: 'price', value: '5' },
      { key: 'circle_price', label: 'Development Circle price', type: 'price', value: '3' },
      { key: 'payment_wording', label: 'Payment wording', type: 'text', value: 'Cash or card accepted' },
      { key: 'booking_wording', label: 'Booking wording', type: 'text', value: 'No tickets or booking needed' },
      { key: 'welcome_wording', label: 'Everyone welcome wording', type: 'text', value: 'Everyone welcome' },
      { key: 'other_info', label: 'Other standard Wednesday information', type: 'textarea', rows: 3, value: '',
        help: 'Shown in the Every Wednesday box. Leave empty if not needed.' }
    ]
  },
  {
    id: 'venue',
    title: 'Venue and directions',
    fields: [
      { key: 'venue_name', label: 'Venue name', type: 'text', value: 'New Way’s Mediumship Development Centre' },
      { key: 'address_line1', label: 'Address line 1', type: 'text', value: 'Thomson Park' },
      { key: 'address_line2', label: 'Address line 2', type: 'text', value: 'Napier Drive' },
      { key: 'town', label: 'Town or city', type: 'text', value: 'Dundee' },
      { key: 'postcode', label: 'Postcode', type: 'text', value: 'DD2 2SJ' },
      { key: 'directions_link', label: 'Directions link', type: 'url', value: '',
        help: 'Paste the exact Google Maps link for New Way’s. The GET DIRECTIONS button appears once this is filled in.' },
      { key: 'parking_info', label: 'Parking information', type: 'textarea', rows: 3, value: '' },
      { key: 'transport_info', label: 'Public transport information', type: 'textarea', rows: 3, value: '' }
    ]
  },
  {
    id: 'contact',
    title: 'Contact',
    fields: [
      { key: 'phone', label: 'Phone number', type: 'tel', value: '' },
      { key: 'email', label: 'Email address', type: 'email', value: '' },
      { key: 'contact_info', label: 'Other contact information', type: 'textarea', rows: 3, value: '',
        help: 'For example, the best way to reach the centre.' }
    ]
  }
  // The old "Square booking calendar link" detail is no longer used: private readings are booked on the website itself
  // (Admin > Private Readings). Any link saved earlier is left untouched in the database.
];

export const SETTING_FIELDS = SETTING_GROUPS.flatMap((g) => g.fields);
export const SETTING_DEFAULTS = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.value]));

// "5" -> "£5", "5.5" -> "£5.50"
export function formatPrice(value) {
  const v = String(value ?? '').trim().replace(/^£/, '');
  if (!v) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return '£' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

export function fullAddress(s) {
  return [s.address_line1, s.address_line2, s.town, s.postcode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
}

// Tokens Gary can type into wording and FAQ answers, e.g. "Entry is {Entry price}."
export const TOKENS = [
  ['Centre name', (s) => s.centre_name],
  ['Doors open', (s) => s.doors_open],
  ['Service starts', (s) => s.service_start],
  ['Service ends', (s) => s.service_end],
  ['Break', (s) => s.break_time],
  ['Circle starts', (s) => s.circle_start],
  ['Circle ends', (s) => s.circle_end],
  ['Entry price', (s) => formatPrice(s.entry_price)],
  ['Circle price', (s) => formatPrice(s.circle_price)],
  ['Payment', (s) => s.payment_wording],
  ['Booking', (s) => s.booking_wording],
  ['Everyone welcome', (s) => s.welcome_wording],
  ['Address', (s) => fullAddress(s)],
  ['Postcode', (s) => s.postcode],
  ['Parking', (s) => s.parking_info],
  ['Public transport', (s) => s.transport_info],
  ['Phone', (s) => s.phone],
  ['Email', (s) => s.email],
  ['Customer details kept', (s) => { const m = Number(s.customer_retention_months) || 24; return m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`; }],
  ['Chat kept', (s) => `${Math.min(365, Math.max(7, Number(s.chat_retention_days) || 90))} days`]
];

// Works on text that has already been HTML-escaped; inserted values are escaped too.
export function tokenReplacer(settings) {
  const map = new Map(TOKENS.map(([name, get]) => [name.toLowerCase(), get]));
  return (escapedText) => escapedText.replace(/\{([A-Za-z ]{2,30})\}/g, (whole, name) => {
    const get = map.get(name.trim().toLowerCase());
    return get ? esc(get(settings) ?? '') : whole;
  });
}

// Validation for the Centre Settings form. Returns { values, errors }.
export function validateSettings(input) {
  const values = {};
  const errors = {};
  for (const f of SETTING_FIELDS) {
    let v = String(input[f.key] ?? '').replace(/\r\n?/g, '\n').trim();
    const max = f.type === 'textarea' ? 1500 : 300;
    if (v.length > max) errors[f.key] = `Please keep this under ${max} characters.`;
    if (f.required && !v) errors[f.key] = 'This is needed.';
    if (f.type === 'price' && v) {
      v = v.replace(/^£/, '').trim();
      if (!/^\d{1,4}(\.\d{1,2})?$/.test(v)) errors[f.key] = 'Enter an amount like 5 or 5.50.';
    }
    if (f.type === 'url' && v) {
      if (!/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) v = 'https://' + v;
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad');
      } catch { errors[f.key] = 'This doesn’t look like a web link. It should start with https://'; }
    }
    if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = 'This doesn’t look like an email address.';
    values[f.key] = v;
  }
  return { values, errors };
}
