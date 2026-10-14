// New Way's Community live comments: ONE Cloudflare Durable Object that holds every open live connection (visitors on
// a card page, and Gary or Julie on View Live Comments). It is free on Cloudflare's Workers Free plan.
//
// How it keeps within the free allowance:
// - Connections are accepted with the "hibernation" API: between messages the object sleeps, connections stay open,
//   and sleeping time is not counted. Keep-alive "ping"s are answered automatically by Cloudflare without waking it.
// - New comments are sent OUT to the phones (outgoing messages are free). Phones never ask the server repeatedly.
// - Messages for a card are grouped: the object waits a moment (1 second, or 4 seconds when busy) and sends one message.
// - It counts, exactly, what the Community's live features use each day (UTC): connections opened and refused,
//   fallback checks, update messages. At the daily limit set in Admin, new public connections are refused until
//   midnight UTC (Admin connections are never refused). It cannot see Cloudflare's totals for the rest of the website.
//
// It is only ever reached through the Worker (src/community/live.js), which checks the launch setting, the visitor's
// origin and, for Admin, the Admin sign-in, before passing a connection here. It never reads the website's database.

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// Workers answer a WebSocket upgrade with status 101. The local test copy (Node) can't make a 101 Response, so it
// supplies its own stand-in; on Cloudflare this hook doesn't exist.
function upgraded(client) {
  if (typeof globalThis.__nwDevUpgrade === 'function') return globalThis.__nwDevUpgrade(client);
  return new Response(null, { status: 101, webSocket: client });
}

function parseLimits(text) {
  const d = { enabled: true, daily: 15000, reduce: 70, perCard: 1500, total: 4000, fallbackDaily: 5000, fallbackSecs: 60 };
  try { const v = JSON.parse(text || '{}'); for (const k of Object.keys(d)) if (k in v) d[k] = v[k]; } catch { /* defaults */ }
  return d;
}
const today = () => new Date().toISOString().slice(0, 10);
const blank = (day) => ({ day, conn: 0, refused: 0, full: 0, fallback: 0, manual: 0, bcast: 0, admin: 0, versions: {} });

export class CommunityLive {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;          // loaded from storage on first use after waking
    this.queue = new Map();     // card -> events waiting to be sent
    this.adminQueue = new Set();
    this.timer = null;
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch { /* older runtime */ }
  }

  async load() {
    if (!this.state) this.state = (await this.ctx.storage.get('state')) || blank(today());
    if (this.state.day !== today()) this.state = { ...blank(today()), versions: this.state.versions || {} };
    return this.state;
  }
  async save() { await this.ctx.storage.put('state', this.state); }   // one row written

  mode(limits) {
    const s = this.state;
    if (!limits.enabled) return 'off';
    if (s.conn >= limits.daily) return 'paused';
    return s.conn >= Math.floor(limits.daily * limits.reduce / 100) ? 'reduced' : 'normal';
  }
  fallbackSecs(limits, mode) { return mode === 'reduced' ? Math.min(600, limits.fallbackSecs * 3) : limits.fallbackSecs; }

  async fetch(request) {
    const url = new URL(request.url);
    const limits = parseLimits(request.headers.get('x-nwc-limits'));
    await this.load();
    if (url.pathname === '/connect') return this.connect(request, url, limits);
    if (url.pathname === '/broadcast' && request.method === 'POST') return this.broadcast(await request.json().catch(() => ({})), limits);
    if (url.pathname === '/check') return this.check(url, limits);
    if (url.pathname === '/usage') return json(this.usage(limits));
    return json({ ok: false }, 404);
  }

  async connect(request, url, limits) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ ok: false }, 426);
    const card = Number(url.searchParams.get('card')) || 0;
    const admin = request.headers.get('x-nwc-role') === 'admin';
    const s = this.state;
    if (!admin) {
      const mode = this.mode(limits);
      if (mode === 'off' || mode === 'paused') {
        s.refused++; await this.save();
        return json({ ok: false, state: mode }, 503, { 'x-nwc-state': mode });
      }
      if (this.ctx.getWebSockets('c:' + card).length >= limits.perCard || this.ctx.getWebSockets('pub').length >= limits.total) {
        s.full++; await this.save();
        return json({ ok: false, state: 'full' }, 503, { 'x-nwc-state': 'full' });
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, admin ? ['admin', 'a:' + card] : ['pub', 'c:' + card]);
    server.serializeAttachment({ card, admin });
    if (admin) s.admin++; else s.conn++;
    await this.save();
    const mode = admin ? 'normal' : this.mode(limits);
    server.send(JSON.stringify({ t: 'hello', v: s.versions[card] || 0, mode, ping: 40, fallback: this.fallbackSecs(limits, mode) }));
    return upgraded(client);
  }

  // From the Worker after a change: { card, v, events: [...], admin: true }. Nothing is read from the database here.
  async broadcast(body, limits) {
    const card = Number(body.card) || 0;
    if (!card) return json({ ok: false }, 400);
    const s = this.state;
    if (body.v && body.v > (s.versions[card] || 0)) s.versions[card] = body.v;
    if (Array.isArray(body.events) && body.events.length) {
      const q = this.queue.get(card) || [];
      q.push(...body.events.slice(0, 50));
      this.queue.set(card, q);
    }
    if (body.admin) this.adminQueue.add(card);
    s.bcast++;
    await this.save();
    if (!this.timer) {
      // Group whatever arrives in the next moment into one message per card (longer when busy)
      const wait = this.mode(limits) === 'reduced' ? 4000 : 1000;
      this.timer = setTimeout(() => this.flush(), wait);
    }
    return json({ ok: true });
  }

  flush() {
    this.timer = null;
    for (const [card, events] of this.queue) {
      const msg = JSON.stringify({ t: 'ev', list: events });
      const gone = events.some((e) => e.op === 'gone');
      for (const ws of this.ctx.getWebSockets('c:' + card)) {
        try { ws.send(msg); if (gone) ws.close(4004, 'card removed'); } catch { /* that phone has gone */ }
      }
    }
    this.queue.clear();
    for (const card of this.adminQueue) {
      for (const ws of this.ctx.getWebSockets('a:' + card)) { try { ws.send('{"t":"changed"}'); } catch { /* gone */ } }
    }
    this.adminQueue.clear();
  }

  // A phone that can't stay connected asks "anything new?" now and then (or someone taps Refresh comments).
  async check(url, limits) {
    const s = this.state;
    const manual = url.searchParams.get('kind') === 'manual';
    if (!limits.enabled || s.fallback + s.manual >= limits.fallbackDaily) return json({ ok: true, allowed: false, mode: 'paused' });
    if (manual) s.manual++; else s.fallback++;
    await this.save();
    const mode = this.mode(limits);
    return json({ ok: true, allowed: true, mode: mode === 'paused' ? 'paused' : mode, fallback: this.fallbackSecs(limits, mode) });
  }

  usage(limits) {
    const s = this.state;
    return { day: s.day, connections: s.conn, refused: s.refused, full: s.full, fallback: s.fallback, manual: s.manual, broadcasts: s.bcast, adminConnections: s.admin,
      openNow: this.ctx.getWebSockets('pub').length, adminOpenNow: this.ctx.getWebSockets('admin').length, mode: this.mode(limits) };
  }

  // Phones only ever send "ping" (answered automatically without waking this object); anything else is ignored.
  async webSocketMessage() { /* nothing to do */ }
  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 || !code ? 1000 : code, 'closed'); } catch { /* already closed */ }
  }
  async webSocketError(ws) { try { ws.close(1011, 'error'); } catch { /* already closed */ } }
}
