// The Admin list sections share one engine: each section is described here (its fields and rules),
// and the same code validates, saves, hides/shows, reorders and deletes for all of them.
import { isIsoDate, ukToday, weekdayOf, longDate, londonLocalToUtc, utcToLondonLocal, friendlyDateTime } from '../lib/dates.js';
import { storeImage, deleteMedia } from '../lib/media.js';
import { audit } from '../lib/data.js';
import { youtubeId, youtubePageUrl, watchUrl } from '../lib/youtube.js';

const pounds = (pence) => '£' + (Number(pence || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: Number(pence) % 100 ? 2 : 0, maximumFractionDigits: 2 });

export const SECTIONS = {
  'whos-on': {
    table: 'mediums', title: 'Who’s On', noun: 'guest medium', addLabel: 'Add a guest medium', publicPath: '/whos-on',
    intro: 'Each Wednesday disappears from the website automatically once it has passed. The standard Wednesday details come from Centre Settings.',
    dated: true, reorder: 'same-date', insertAt: 'end', order: 'date ASC, sort_order ASC, id ASC',
    fields: [
      { key: 'date', label: 'Wednesday', type: 'date', required: true, wednesday: true, notPastOnCreate: true },
      { key: 'name', label: 'Medium’s name', type: 'text', required: true, max: 120 },
      { key: 'location', label: 'Where they’re from', type: 'text', max: 120, placeholder: 'e.g. Glasgow' },
      { key: 'description', label: 'Description', type: 'textarea', max: 3000, rows: 6 },
      { key: 'photo_key', label: 'Photograph', type: 'image', purpose: 'medium', maxEdge: 1600, quality: 0.85,
        help: 'An upright (portrait) photo looks best. It is resized on your phone before uploading.' },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.name, lines: [longDate(r.date), r.location && 'From ' + r.location].filter(Boolean), image: r.photo_key })
  },
  events: {
    table: 'events', title: 'Events', noun: 'event', addLabel: 'Add an event', publicPath: '/events',
    intro: 'Events disappear from the website automatically after their date. Choose how tickets are sold for each event: your Square ticket link (as now), online tickets on this website (with guest lists and check-in), or no tickets.',
    dated: true, reorder: 'same-date', insertAt: 'end', order: 'date ASC, sort_order ASC, id ASC',
    fields: [
      { key: 'name', label: 'Event name', type: 'text', required: true, max: 150 },
      { key: 'date', label: 'Date', type: 'date', required: true, notPastOnCreate: true },
      { key: 'time_text', label: 'Time (as shown on the website)', type: 'text', max: 80, placeholder: 'e.g. 7pm to 9:30pm' },
      { key: 'summary', label: 'Short information', type: 'textarea', max: 600, rows: 3 },
      { key: 'details', label: 'Full information', type: 'textarea', max: 5000, rows: 6, help: 'Shown when visitors tap More information.' },
      { key: 'ticket_info', label: 'Ticket information', type: 'text', max: 200, placeholder: 'e.g. Tickets £12' },
      { key: 'poster_key', label: 'Poster or photo', type: 'image', purpose: 'event', maxEdge: 2000, quality: 0.88, thumbKey: 'share_key', thumbEdge: 1200, thumbType: 'jpeg',
        help: 'Posters are kept sharp enough to read. Resized on your phone before uploading. A JPEG copy is made too, for the picture shown when the event is shared on Facebook or WhatsApp.' },
      { key: 'visible', label: 'Published: show on the website', type: 'checkbox', default: 1, help: 'Untick to keep it as a draft that only you can see in Admin.' },
      { type: 'heading', key: '_tickets', label: 'Tickets', help: 'Existing events keep using their Square ticket link exactly as before until you change this.' },
      { key: 'sales_mode', label: 'How are tickets sold?', type: 'select', default: 'link',
        options: [['link', 'Square ticket link (as now)'], ['online', 'Online tickets on this website'], ['none', 'No tickets to buy']] },
      { key: 'ticket_url', label: 'Square ticket link', type: 'url', help: 'Only used with “Square ticket link”. Leave empty if there are no tickets to buy.' },
      { type: 'heading', key: '_online', label: 'Online tickets on this website', help: 'Only used with “Online tickets on this website”. Guests’ names and your questions are collected for every ticket.' },
      { key: 'start_time', label: 'Start time', type: 'time' },
      { key: 'doors_time', label: 'Doors open (optional)', type: 'time' },
      { key: 'venue', label: 'Venue (optional)', type: 'text', max: 120, help: 'Leave empty to use the venue in Centre Settings.' },
      { key: 'address', label: 'Address (optional)', type: 'text', max: 200, help: 'Leave empty to use the address in Centre Settings.' },
      { key: 'price_pence', label: 'Ticket price', type: 'money', optional: true },
      { key: 'capacity', label: 'Maximum number of places', type: 'int', min: 0, max: 5000, help: 'Online and cash bookings both count. When every place is taken the website shows SOLD OUT.' },
      { key: 'max_per_booking', label: 'Most tickets in one booking', type: 'int', min: 1, max: 20, default: 10 },
      { key: 'sales_open_at', label: 'Tickets go on sale (optional)', type: 'datetime', help: 'Leave empty to sell straight away.' },
      { key: 'sales_close_at', label: 'Online sales close (optional)', type: 'datetime', help: 'Leave empty to sell until the start time.' },
      { key: 'instructions', label: 'Information for guests (optional)', type: 'textarea', max: 2000, rows: 4, help: 'For example arrival, parking or what to bring. Included in the confirmation and the reminder.' },
      { key: 'booking_terms', label: 'Booking terms (optional)', type: 'textarea', max: 2000, rows: 4, help: 'If added, customers must tick to agree before paying.' }
    ],
    summary: (r) => ({ title: r.name, lines: [longDate(r.date) + (r.time_text ? ', ' + r.time_text : ''),
      r.sales_mode === 'online' ? `Online tickets: ${r.places_confirmed || 0} booked${r.capacity ? ' of ' + r.capacity : ''}${r.places_held ? `, ${r.places_held} being paid for` : ''}`
        : r.sales_mode === 'none' ? 'No tickets' : r.ticket_url ? 'Square ticket link added' : 'No ticket link'], image: r.poster_key }),
    extraActions: (r) => [[`/admin/events/${r.id}/manage`, r.sales_mode === 'online' || r.places_confirmed ? 'Guests, tickets & check-in' : 'Tickets & guests']],
    check: (values, errors) => {
      if (values.sales_mode !== 'online') return;
      if (!values.start_time) errors.start_time = 'Online tickets need a start time.';
      if (!(values.price_pence >= 100)) errors.price_pence = 'Online tickets need a price of at least £1. (For free places, use Add a booking in Admin.)';
      if (!(values.capacity > 0)) errors.capacity = 'Online tickets need a maximum number of places, so the event can’t be oversold.';
      if (values.sales_open_at && values.sales_close_at && values.sales_close_at <= values.sales_open_at) errors.sales_close_at = 'This needs to be after the time tickets go on sale.';
    }
  },
  announcements: {
    table: 'announcements', title: 'Announcements', noun: 'announcement', addLabel: 'Add an announcement', publicPath: '/',
    intro: 'Announcements show at the top of every page. They stop automatically at their end time, or when switched off.',
    reorder: false, insertAt: 'end', toggleField: 'active',
    order: `active DESC, CASE importance WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, id DESC`,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 120 },
      { key: 'message', label: 'Message', type: 'textarea', max: 1000, rows: 4 },
      { key: 'importance', label: 'Importance', type: 'select', default: 'notice',
        options: [['notice', 'Notice'], ['important', 'Important (gold edge)'], ['urgent', 'Urgent (most prominent)']] },
      { key: 'starts_at', label: 'Start showing', type: 'datetime', help: 'Optional. Leave empty to show straight away.' },
      { key: 'ends_at', label: 'Stop showing', type: 'datetime', help: 'Optional. Leave empty to keep it until you switch it off.' },
      { key: 'active', label: 'Switched on', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.title, lines: [
      ({ notice: 'Notice', important: 'Important', urgent: 'Urgent' })[r.importance],
      r.starts_at && 'From ' + friendlyDateTime(r.starts_at), r.ends_at && 'Until ' + friendlyDateTime(r.ends_at)].filter(Boolean) })
  },
  charity: {
    table: 'charity_totals', title: 'Community & Charity', noun: 'charity total', addLabel: 'Add a charity total', publicPath: '/charity',
    intro: 'Totals show in this order on the Community & Charity page.',
    reorder: 'all', insertAt: 'start', order: 'sort_order ASC, id ASC',
    fields: [
      { key: 'charity_name', label: 'Charity name', type: 'text', required: true, max: 120 },
      { key: 'amount_pence', label: 'Amount raised', type: 'money', required: true },
      { key: 'date_label', label: 'When', type: 'text', max: 60, placeholder: 'e.g. November 2025' },
      { key: 'description', label: 'Description', type: 'textarea', max: 1500, rows: 4 },
      { key: 'image_key', label: 'Charity logo (optional)', type: 'image', purpose: 'charity', maxEdge: 1000, quality: 0.88 },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: `${pounds(r.amount_pence)} for ${r.charity_name}`, lines: [r.date_label].filter(Boolean), image: r.image_key })
  },
  faqs: {
    table: 'faqs', title: 'First Visit & FAQs', noun: 'question', addLabel: 'Add a question', publicPath: '/faqs',
    intro: 'Questions show in this order. A question with an empty answer stays hidden.',
    reorder: 'all', insertAt: 'end', order: 'sort_order ASC, id ASC',
    fields: [
      { key: 'question', label: 'Question', type: 'text', required: true, max: 200 },
      { key: 'answer', label: 'Answer', type: 'textarea', max: 3000, rows: 6, tokens: true,
        help: 'You can use details from Centre Settings, for example {Entry price} or {Doors open}.' },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.question, lines: [String(r.answer).trim() ? '' : 'No answer yet, so it is hidden'].filter(Boolean) })
  },
  'social-links': {
    table: 'social_links', title: 'Social links', noun: 'link', addLabel: 'Add a social link', publicPath: '/find-us',
    intro: 'Shown on the Find Us page and at the bottom of every page.',
    reorder: 'all', insertAt: 'end', order: 'sort_order ASC, id ASC',
    fields: [
      { key: 'platform', label: 'Name shown', type: 'text', required: true, max: 40, suggestions: ['Facebook', 'Instagram', 'YouTube', 'TikTok', 'X', 'WhatsApp'] },
      { key: 'url', label: 'Link', type: 'url', required: true },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.platform, lines: [r.url] })
  },
  gallery: {
    table: 'gallery_photos', title: 'Gallery', noun: 'photo', addLabel: 'Add a photo', publicPath: '/gallery',
    intro: 'Photos show newest first. You can add several at once below.',
    reorder: 'all', insertAt: 'start', order: 'sort_order ASC, id DESC',
    fields: [
      { key: 'image_key', label: 'Photo', type: 'image', required: true, purpose: 'gallery', maxEdge: 1800, quality: 0.85, thumbKey: 'thumb_key', thumbEdge: 600,
        help: 'Resized on your phone before uploading, with a small preview copy for fast loading.' },
      { key: 'caption', label: 'Caption (optional)', type: 'text', max: 200 },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.caption || 'Photo', lines: [], image: r.thumb_key || r.image_key })
  },
  tour: {
    table: 'tour_stops', title: 'Virtual tour', noun: 'tour stop', addLabel: 'Add a tour stop', publicPath: '/tour',
    intro: 'A look around New Way’s at Thomson Park, one photo at a time, in this order. Please use only genuine photos of the centre. The tour page only appears on the website once at least one stop is showing.',
    reorder: 'all', insertAt: 'end', order: 'sort_order ASC, id ASC',
    fields: [
      { key: 'title', label: 'Name of this stop', type: 'text', required: true, max: 80, placeholder: 'e.g. The entrance, The main hall, The tea room' },
      { key: 'image_key', label: 'Photo of the centre', type: 'image', required: true, purpose: 'tour', maxEdge: 1800, quality: 0.85, thumbKey: 'thumb_key', thumbEdge: 600,
        help: 'A real photo taken at New Way’s. Resized on your phone before uploading.' },
      { key: 'description', label: 'What visitors see here (optional)', type: 'textarea', max: 800, rows: 4 },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 1 }
    ],
    summary: (r) => ({ title: r.title, lines: [String(r.description || '').slice(0, 90)].filter(Boolean), image: r.thumb_key || r.image_key })
  },
  'teaching-videos': {
    table: 'teaching_videos', title: 'Teaching Videos', noun: 'video', addLabel: 'Add a teaching video', publicPath: '/teaching-videos',
    intro: 'Videos stay on YouTube; New Way’s only shows them. New videos start hidden so you can prepare them, then tap Show when ready.',
    deleteConfirm: 'Remove this video from New Way’s? It stays on YouTube.',
    reorder: 'all', insertAt: 'start', order: 'sort_order ASC, id DESC',
    fields: [
      { key: 'youtube_url', label: 'YouTube link', type: 'youtube', required: true, idKey: 'youtube_id',
        help: 'In the YouTube app, tap Share, then Copy link, and paste it here.' },
      { key: 'title', label: 'Title', type: 'text', required: true, max: 150 },
      { key: 'description', label: 'Description', type: 'textarea', max: 3000, rows: 5 },
      { key: 'category', label: 'Category (optional)', type: 'text', max: 60, placeholder: 'e.g. Development' },
      { key: 'thumbnail_key', label: 'Thumbnail (optional)', type: 'image', purpose: 'video', maxEdge: 1280, quality: 0.85,
        help: 'Leave empty to use YouTube’s own thumbnail.' },
      { key: 'embed_ok', label: 'Play inside the website', type: 'checkbox', default: 1,
        help: 'If YouTube doesn’t allow this video on other websites, visitors get a Watch on YouTube button instead.' },
      { key: 'visible', label: 'Show on the website', type: 'checkbox', default: 0, help: 'Leave unticked while you prepare it.' }
    ],
    summary: (r) => ({ title: r.title, lines: [r.category, r.embed_ok ? '' : 'Opens on YouTube'].filter(Boolean),
      image: r.thumbnail_key, imageUrl: r.thumbnail_key ? '' : `https://i.ytimg.com/vi/${r.youtube_id}/mqdefault.jpg` })
  }
};

// Live has one entry, edited on its own page, but uses the same field rules
export const LIVE = {
  table: 'live_stream', title: 'Live', noun: 'livestream',
  fields: [
    { key: 'youtube_url', label: 'YouTube Live link', type: 'youtube', allowPage: true, idKey: null,
      help: 'The link to the livestream on YouTube (Share, then Copy link). A link to your channel’s live page works too, as a Watch on YouTube button.' },
    { key: 'title', label: 'Title', type: 'text', max: 150 },
    { key: 'description', label: 'Description', type: 'textarea', max: 2000, rows: 4 },
    { key: 'scheduled_at', label: 'Scheduled date and time', type: 'datetime', help: 'Optional. Shown as the next broadcast while you are not live.' },
    { key: 'thumbnail_key', label: 'Thumbnail (optional)', type: 'image', purpose: 'live', maxEdge: 1280, quality: 0.85 },
    { key: 'embed_ok', label: 'Play inside the website', type: 'checkbox', default: 1,
      help: 'Untick if YouTube doesn’t allow this stream on other websites. Visitors then get a Watch on YouTube button.' }
  ]
};

// ---------- reading ----------

export async function listRows(env, section) {
  const sql = section.table === 'events'
    ? `SELECT events.*, (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings b WHERE b.event_id = events.id AND b.status = 'confirmed') AS places_confirmed,
        (SELECT COALESCE(SUM(quantity), 0) FROM event_bookings b WHERE b.event_id = events.id AND b.status = 'held') AS places_held
       FROM events ORDER BY ${section.order}`
    : `SELECT * FROM ${section.table} ORDER BY ${section.order}`;
  const { results } = await env.DB.prepare(sql).all();
  return results || [];
}

export async function getRow(env, section, id) {
  return env.DB.prepare(`SELECT * FROM ${section.table} WHERE id = ?1`).bind(id).first();
}

export function status(section, row) {
  const chips = [];
  if (section.dated && row.date < ukToday()) chips.push(['past', 'Past (not shown)']);
  if ('visible' in row && !row.visible) chips.push(['hidden', 'Hidden']);
  if (section.table === 'announcements') {
    const now = new Date().toISOString();
    if (!row.active) chips.push(['hidden', 'Switched off']);
    else if (row.ends_at && row.ends_at <= now) chips.push(['past', 'Finished']);
    else if (row.starts_at && row.starts_at > now) chips.push(['soon', 'Scheduled']);
    else chips.push(['live', 'Showing now']);
  }
  if (section.table === 'faqs' && !String(row.answer).trim()) chips.push(['hidden', 'Needs an answer']);
  return chips;
}

// Values for the form: from a saved row, or the defaults for a new entry
export function formValues(section, row) {
  const v = {};
  for (const f of section.fields) {
    if (f.type === 'heading') continue;
    let value = row ? row[f.key] : (f.default ?? '');
    if (f.type === 'money' && row) value = f.optional && !Number(value) ? '' : (Number(value) / 100).toFixed(Number(value) % 100 ? 2 : 0);
    if (f.type === 'datetime') value = row ? utcToLondonLocal(value) : '';
    v[f.key] = value ?? '';
  }
  return v;
}

// ---------- validation ----------

function normaliseUrl(text) {
  let v = String(text || '').trim();
  if (!v) return { value: '' };
  if (!/^[a-z]+:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return { error: 'Links must start with https://' };
    return { value: u.toString() };
  } catch {
    return { error: 'This doesn’t look like a web link. It should start with https://' };
  }
}

export function validate(section, fields, { creating, files = {} }) {
  const values = {};
  const errors = {};
  for (const f of section.fields) {
    if (f.type === 'heading') continue;
    if (f.type === 'image') {
      if (f.required && creating && !files[f.key]) errors[f.key] = 'Please choose a photo.';
      continue;
    }
    const raw = String(fields[f.key] ?? '').replace(/\r\n?/g, '\n').trim();
    if (f.type === 'checkbox') { values[f.key] = fields[f.key] === '1' ? 1 : 0; continue; }
    if (f.required && !raw) { errors[f.key] = 'This is needed.'; continue; }
    if (f.max && raw.length > f.max) { errors[f.key] = `Please keep this under ${f.max} characters.`; continue; }
    if (f.type === 'date') {
      if (!isIsoDate(raw)) { errors[f.key] = 'Please choose a date.'; continue; }
      if (f.wednesday && weekdayOf(raw) !== 3) { errors[f.key] = 'Who’s On is for Wednesday evenings. Please choose a Wednesday.'; continue; }
      if (f.notPastOnCreate && creating && raw < ukToday()) { errors[f.key] = 'That date has already passed.'; continue; }
      values[f.key] = raw;
    } else if (f.type === 'url') {
      const r = normaliseUrl(raw);
      if (r.error) errors[f.key] = r.error; else values[f.key] = r.value;
    } else if (f.type === 'youtube') {
      const id = youtubeId(raw);
      if (id) { values[f.key] = watchUrl(id); if (f.idKey) values[f.idKey] = id; }
      else if (!raw && !f.required) { values[f.key] = ''; if (f.idKey) values[f.idKey] = ''; }
      else if (f.allowPage && youtubePageUrl(raw)) values[f.key] = youtubePageUrl(raw);
      else errors[f.key] = 'This doesn’t look like a YouTube video link. In YouTube, tap Share, then Copy link, and paste it here.';
    } else if (f.type === 'money') {
      if (!raw && f.optional) { values[f.key] = 0; continue; }
      const n = raw.replace(/[£,\s]/g, '');
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(n)) { errors[f.key] = 'Enter an amount like 1795 or 1795.50.'; continue; }
      values[f.key] = Math.round(Number(n) * 100);
    } else if (f.type === 'time') {
      if (raw && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) { errors[f.key] = 'Please choose a time.'; continue; }
      values[f.key] = raw;
    } else if (f.type === 'int') {
      const v = raw === '' ? String(f.default ?? 0) : raw;
      if (!/^\d{1,5}$/.test(v) || Number(v) < (f.min ?? 0) || Number(v) > (f.max ?? 99999)) { errors[f.key] = `Enter a whole number from ${f.min ?? 0} to ${f.max ?? 99999}.`; continue; }
      values[f.key] = Number(v);
    } else if (f.type === 'select') {
      const v = !raw && f.default !== undefined ? f.default : raw;   // a form from before this choice existed keeps the default
      if (!f.options.some(([o]) => o === v)) { errors[f.key] = 'Please choose one of the options.'; continue; }
      values[f.key] = v;
    } else if (f.type === 'datetime') {
      if (!raw) { values[f.key] = null; continue; }
      const utc = londonLocalToUtc(raw);
      if (!utc) { errors[f.key] = 'Please choose a date and time.'; continue; }
      values[f.key] = utc;
    } else {
      values[f.key] = raw;
    }
  }
  if (section.table === 'announcements' && values.starts_at && values.ends_at && values.ends_at <= values.starts_at) {
    errors.ends_at = 'The stop time needs to be after the start time.';
  }
  if (section.check) section.check(values, errors);
  return { values, errors };
}

// ---------- saving ----------

// Stores any new photos, removes replaced or removed ones, then saves the row. Returns the row id.
export async function save(env, section, id, values, files, removeFlags, existing) {
  const oldKeys = [];
  for (const f of section.fields.filter((x) => x.type === 'image')) {
    const current = existing ? existing[f.key] : '';
    const currentThumb = f.thumbKey && existing ? existing[f.thumbKey] : '';
    if (files[f.key]) {
      values[f.key] = await storeImage(env, files[f.key], f.purpose);
      if (current) oldKeys.push(current);
      if (f.thumbKey) {
        values[f.thumbKey] = files[f.key + '__thumb'] ? await storeImage(env, files[f.key + '__thumb'], f.purpose + '-thumb') : '';
        if (currentThumb) oldKeys.push(currentThumb);
      }
    } else if (removeFlags[f.key]) {
      values[f.key] = '';
      if (current) oldKeys.push(current);
      if (f.thumbKey) { values[f.thumbKey] = ''; if (currentThumb) oldKeys.push(currentThumb); }
    } else {
      values[f.key] = current || '';
      if (f.thumbKey) values[f.thumbKey] = currentThumb || '';
    }
  }
  const cols = Object.keys(values);
  const touch = ['mediums', 'events', 'charity_totals', 'faqs', 'announcements', 'teaching_videos', 'live_stream', 'tour_stops'].includes(section.table);
  let rowId = id;
  if (id) {
    const sets = cols.map((c, i) => `${c} = ?${i + 1}`).join(', ') + (touch ? `, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')` : '');
    await env.DB.batch([
      env.DB.prepare(`UPDATE ${section.table} SET ${sets} WHERE id = ?${cols.length + 1}`).bind(...cols.map((c) => values[c]), id),
      audit(env, section.table + '.update', `${section.title}: updated “${label(section, values)}”`)
    ]);
  } else {
    let sortOrder = 0;
    if (section.reorder) {
      const agg = section.insertAt === 'start' ? 'MIN(sort_order) - 1' : 'MAX(sort_order) + 1';
      sortOrder = (await env.DB.prepare(`SELECT COALESCE(${agg}, 0) AS s FROM ${section.table}`).first('s')) ?? 0;
    }
    const allCols = section.reorder ? [...cols, 'sort_order'] : cols;
    const placeholders = allCols.map((_, i) => `?${i + 1}`).join(', ');
    const [res] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO ${section.table} (${allCols.join(', ')}) VALUES (${placeholders})`)
        .bind(...cols.map((c) => values[c]), ...(section.reorder ? [sortOrder] : [])),
      audit(env, section.table + '.create', `${section.title}: added “${label(section, values)}”`)
    ]);
    rowId = res.meta.last_row_id;
  }
  for (const key of oldKeys) await deleteMedia(env, key);
  return rowId;
}

function label(section, values) {
  return String(values.name || values.title || values.charity_name || values.question || values.platform || values.caption || 'photo').slice(0, 80);
}

export async function remove(env, section, row) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${section.table} WHERE id = ?1`).bind(row.id),
    audit(env, section.table + '.delete', `${section.title}: deleted “${label(section, row)}”`)
  ]);
  for (const f of section.fields.filter((x) => x.type === 'image')) {
    await deleteMedia(env, row[f.key]);
    if (f.thumbKey) await deleteMedia(env, row[f.thumbKey]);
  }
}

export async function toggle(env, section, row) {
  const field = section.toggleField || 'visible';
  await env.DB.prepare(`UPDATE ${section.table} SET ${field} = ?1 WHERE id = ?2`).bind(row[field] ? 0 : 1, row.id).run();
}

// Swap with the neighbour above or below (for dated sections, only within the same date)
export async function move(env, section, row, direction) {
  if (!section.reorder) return false;
  const rows = await listRows(env, section);
  const pool = section.reorder === 'same-date' ? rows.filter((r) => r.date === row.date) : rows;
  const i = pool.findIndex((r) => r.id === row.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= pool.length) return false;
  // give every row in the pool a clean position first, then swap the two
  const ordered = pool.map((r) => r.id);
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  await env.DB.batch(ordered.map((rid, k) => env.DB.prepare(`UPDATE ${section.table} SET sort_order = ?1 WHERE id = ?2`).bind(k, rid)));
  return true;
}

export function canMove(section, rows, row) {
  if (!section.reorder) return { up: false, down: false };
  const pool = section.reorder === 'same-date' ? rows.filter((r) => r.date === row.date) : rows;
  const i = pool.findIndex((r) => r.id === row.id);
  return { up: i > 0, down: i >= 0 && i < pool.length - 1 };
}
