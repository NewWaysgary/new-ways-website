// Admin › Mailing list › SEND EMAIL TO SUBSCRIBERS: write, preview, test, send, and see what was sent.
import { redirect, siteOrigin, textResponse } from '../lib/http.js';
import { ukToday, longDate } from '../lib/dates.js';
import { EMAIL_RE } from '../bookings/config.js';
import { normaliseEmail } from '../lib/emails.js';
import { sendEmail, emailConfigured } from '../lib/email.js';
import { context } from '../notify.js';
import * as data from '../lib/data.js';
import { buildMessage, sendQueued, startSending, checkDelivery, subscriberCount, dailyLimit, sentToday } from '../mailing-send.js';
import * as view from '../views/admin-mailing-emails.js';

const nowIso = () => new Date().toISOString();
const TEST_LIMIT_PER_HOUR = 10;

// What the email can link to: upcoming events and Who's On listings that are on the website now
export async function linkChoices(env) {
  const today = ukToday();
  const [ev, md] = await Promise.all([
    env.DB.prepare(`SELECT id, name, date FROM events WHERE visible = 1 AND date >= ?1 ORDER BY date, start_time, id LIMIT 60`).bind(today).all(),
    env.DB.prepare(`SELECT id, name, date FROM mediums WHERE visible = 1 AND date >= ?1 ORDER BY date, id LIMIT 60`).bind(today).all()
  ]);
  return {
    events: (ev.results || []).map((e) => ({ ref: `event:${e.id}`, label: `${e.name} (${longDate(e.date)})`, path: `/events/${e.id}`, button: 'Find out more and book' })),
    mediums: (md.results || []).map((m) => ({ ref: `medium:${m.id}`, label: `${m.name}: Who’s On, ${longDate(m.date)}`, path: `/whos-on/${m.id}`, button: `See ${m.name} on Who’s On` }))
  };
}

async function settingsFor(env) {
  const c = await context(env);
  const s = c.s;
  const address = [s.address_line1, s.address_line2, [s.town, s.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { centre: c.centre, contact: c.contact, replyTo: c.replyTo, address };
}

function readForm(f, choices) {
  const values = { subject: String(f.subject || '').replace(/\s+/g, ' ').trim(), body: String(f.body || '').replace(/\r\n?/g, '\n').trim(), link_ref: String(f.link_ref || ''), link_label: String(f.link_label || '').replace(/\s+/g, ' ').trim() };
  const errors = {};
  if (values.subject.length < 3) errors.subject = 'Please write a subject.';
  else if (values.subject.length > 150) errors.subject = 'Please keep the subject under 150 characters.';
  if (values.body.length < 10) errors.body = 'Please write the message.';
  else if (values.body.length > 10000) errors.body = 'Please keep the message under 10,000 characters.';
  if (values.link_label.length > 60) errors.link_label = 'Please keep the button wording under 60 characters.';
  const all = [...choices.events, ...choices.mediums];
  const pick = all.find((x) => x.ref === values.link_ref);
  if (values.link_ref && !pick) errors.link_ref = 'That event or listing is no longer on the website. Please choose again.';
  return { values, errors, pick };
}

export async function handleMailingEmails({ request, env, url, method, path, form, page, csrf, admin }) {
  if (!path.startsWith('/admin/mailing-list/emails')) return null;
  const by = (admin && (admin.name || admin.email)) || 'Admin';
  const origin = siteOrigin(request, env);
  const f = form.fields;

  if (path === '/admin/mailing-list/emails' && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM mail_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM mail_campaign_recipients r WHERE r.campaign_id = c.id AND r.status IN ('failed', 'unknown')) AS problems
      FROM mail_campaigns c ORDER BY c.id DESC LIMIT 100`).all();
    return page(view.listPage({ campaigns: results || [], subscribers: await subscriberCount(env), configured: emailConfigured(env), csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }

  const choices = await linkChoices(env);
  if (path === '/admin/mailing-list/emails/new') {
    if (method === 'GET') return page(view.editPage({ choices, values: {}, csrf: csrf.token }));
    const { values, errors, pick } = readForm(f, choices);
    if (Object.keys(errors).length) return page(view.editPage({ choices, values, errors, csrf: csrf.token }), 422);
    const row = await env.DB.prepare(`INSERT INTO mail_campaigns (subject, body, link_ref, link_url, link_label, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
      .bind(values.subject, values.body, pick ? pick.ref : '', pick ? origin + pick.path : '', pick ? (values.link_label || pick.button) : '', by).first();
    return redirect(`/admin/mailing-list/emails/${row.id}?flash=saved`);
  }

  const m = path.match(/^\/admin\/mailing-list\/emails\/(\d{1,9})(?:\/(edit|test|send|continue|stop|delete|delivery))?$/);
  if (!m) return null;
  const id = Number(m[1]);
  const c = await env.DB.prepare('SELECT * FROM mail_campaigns WHERE id = ?1').bind(id).first();
  if (!c) return redirect('/admin/mailing-list/emails');
  const action = m[2] || '';
  const back = (flash) => redirect(`/admin/mailing-list/emails/${id}?flash=${flash}`);

  if (!action && method === 'GET') {
    const st = await settingsFor(env);
    const preview = buildMessage({ campaign: c, centre: st.centre, origin, who: { name: 'Mary Example', unsubscribe_token: 'PREVIEW-ONLY-LINK-000000' }, contact: st.contact, address: st.address });
    const counts = Object.fromEntries(((await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM mail_campaign_recipients WHERE campaign_id = ?1 GROUP BY status`).bind(id).all()).results || []).map((r) => [r.status, r.n]));
    const delivery = Object.fromEntries(((await env.DB.prepare(`SELECT delivery, COUNT(*) AS n FROM mail_campaign_recipients WHERE campaign_id = ?1 AND status = 'sent' GROUP BY delivery`).bind(id).all()).results || []).map((r) => [r.delivery || 'sent', r.n]));
    const people = c.status === 'draft' ? [] : ((await env.DB.prepare(`SELECT r.*, m.email, m.name FROM mail_campaign_recipients r LEFT JOIN mailing_list m ON m.id = r.subscriber_id WHERE r.campaign_id = ?1 ORDER BY r.id LIMIT 1000`).bind(id).all()).results || []);
    return page(view.campaignPage({ c, preview, counts, delivery, people, subscribers: await subscriberCount(env), limit: await dailyLimit(env), today: await sentToday(env),
      adminEmail: admin && admin.email, configured: emailConfigured(env), csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  if (method !== 'POST' && action !== 'edit') return textResponse('Method not allowed', { status: 405 });

  if (action === 'edit') {
    if (c.status !== 'draft') return back('locked');
    if (method === 'GET') return page(view.editPage({ choices, values: c, id, csrf: csrf.token }));
    const { values, errors, pick } = readForm(f, choices);
    if (Object.keys(errors).length) return page(view.editPage({ choices, values, id, errors, csrf: csrf.token }), 422);
    // any change means it must be tested again before sending
    await env.DB.prepare(`UPDATE mail_campaigns SET subject = ?1, body = ?2, link_ref = ?3, link_url = ?4, link_label = ?5, test_sent_at = NULL, updated_at = ?6 WHERE id = ?7 AND status = 'draft'`)
      .bind(values.subject, values.body, pick ? pick.ref : '', pick ? origin + pick.path : '', pick ? (values.link_label || pick.button) : '', nowIso(), id).run();
    return back('saved');
  }

  if (action === 'delete') {
    if (c.status !== 'draft') return back('locked');
    await env.DB.prepare(`DELETE FROM mail_campaigns WHERE id = ?1 AND status = 'draft'`).bind(id).run();
    return redirect('/admin/mailing-list/emails?flash=deleted');
  }

  if (action === 'test') {
    if (c.status !== 'draft') return back('locked');
    const to = normaliseEmail(f.to || (admin && admin.email) || '');
    if (!EMAIL_RE.test(to)) return back('bad-test-address');
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'mailing.test' AND at >= ?1`).bind(new Date(Date.now() - 3600_000).toISOString()).first();
    if (recent.n >= TEST_LIMIT_PER_HOUR) return back('test-limit');
    const st = await settingsFor(env);
    const msg = buildMessage({ campaign: c, centre: st.centre, origin, who: null, contact: st.contact, address: st.address });
    const out = await sendEmail(env, { to, replyTo: st.replyTo, subject: '[TEST] ' + msg.subject, html: msg.html, text: msg.text });
    if (out.status !== 'sent') return back(out.status === 'not_configured' ? 'not-configured' : 'test-failed');
    await env.DB.batch([
      env.DB.prepare(`UPDATE mail_campaigns SET test_sent_to = ?1, test_sent_at = ?2 WHERE id = ?3`).bind(to, nowIso(), id),
      data.audit(env, 'mailing.test', `Test of mailing-list email ${id} sent by ${by}`)
    ]);
    return back('tested');
  }

  if (action === 'send') {
    if (c.status !== 'draft') return back('locked');
    if (!c.test_sent_at) return back('test-first');
    if (f.checked !== '1') return back('tick');
    if (!emailConfigured(env)) return back('not-configured');
    const n = await startSending(env, id, by);
    if (n === null) return back('locked');
    await data.audit(env, 'mailing.send', `Mailing-list email ${id} (“${c.subject}”) sent to ${n} subscribers by ${by}`).run();
    const st = await settingsFor(env);
    await sendQueued(env, { campaignId: id, centre: st.centre, origin, contact: st.contact, address: st.address, replyTo: st.replyTo });
    return back('sending');
  }
  if (action === 'continue') {
    const st = await settingsFor(env);
    await sendQueued(env, { campaignId: id, centre: st.centre, origin, contact: st.contact, address: st.address, replyTo: st.replyTo });
    return back('continued');
  }
  if (action === 'stop') {
    if (c.status !== 'sending') return back('locked');
    await env.DB.batch([
      env.DB.prepare(`UPDATE mail_campaigns SET status = 'stopped', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'sending'`).bind(nowIso(), id),
      env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'skipped', error = 'Sending was stopped in Admin.' WHERE campaign_id = ?1 AND status = 'queued'`).bind(id),
      data.audit(env, 'mailing.stop', `Mailing-list email ${id} stopped by ${by}`)
    ]);
    return back('stopped');
  }
  if (action === 'delivery') {
    await checkDelivery(env, id);
    return back('checked');
  }
  return null;
}

// The hourly job: carries on with any email still being sent (e.g. over the daily limit)
export async function mailingHourlyJobs(env) {
  const busy = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mail_campaigns WHERE status = 'sending'`).first();
  if (!busy.n) return;
  const st = await settingsFor(env);
  await sendQueued(env, { centre: st.centre, origin: siteOrigin({ url: 'https://newwaysmediumshipdevelopmentcentre.com/' }, env), contact: st.contact, address: st.address, replyTo: st.replyTo });
}
