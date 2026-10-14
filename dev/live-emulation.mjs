// Local test copy only: stands in for Cloudflare's Durable Objects and WebSockets, so live comments can be tested
// without Cloudflare. Never used on Cloudflare.
//  - env.COMMUNITY_LIVE: a Durable Object namespace with one object per name, keeping its storage and connections.
//    "Hibernation" can be simulated (GET /__dev/live-hibernate): the object is thrown away and rebuilt on the next event,
//    exactly as Cloudflare does, so tests prove nothing depends on memory.
//  - WebSocketPair / WebSocketRequestResponsePair, as in Workers.
//  - attach(server): handles real WebSocket connections on the local HTTP server (a small RFC 6455 implementation:
//    text, ping/pong and close frames).
import crypto from 'node:crypto';

const pendingUpgrades = new Map();

class DevServerSocket {
  constructor() { this.readyState = 1; this.tags = []; this.queue = []; this.node = null; this.attachment = null; this.home = null; }
  send(text) { if (this.readyState !== 1) throw new Error('closed'); if (this.node) this.node.sendText(String(text)); else this.queue.push(String(text)); }
  close(code = 1000, reason = '') { if (this.readyState >= 2) return; this.readyState = 2; if (this.node) this.node.close(code, reason); }
  serializeAttachment(v) { this.attachment = JSON.parse(JSON.stringify(v)); }
  deserializeAttachment() { return this.attachment; }
}
class DevClientEnd { constructor(server) { this.server = server; } }

globalThis.WebSocketPair = function WebSocketPair() { const server = new DevServerSocket(); const client = new DevClientEnd(server); this[0] = client; this[1] = server; };
globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { this.request = request; this.response = response; } };
globalThis.__nwDevUpgrade = (client) => {
  const token = crypto.randomBytes(8).toString('hex');
  pendingUpgrades.set(token, client);
  return new Response(null, { status: 200, headers: { 'x-nw-dev-upgrade': token } });
};

class DevState {
  constructor() {
    this.sockets = new Set(); this.store = new Map(); this.auto = null; this.writes = 0;
    const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    this.storage = { get: async (k) => copy(this.store.get(k)), put: async (k, v) => { this.writes++; this.store.set(k, copy(v)); }, delete: async (k) => this.store.delete(k) };
  }
  acceptWebSocket(ws, tags = []) { ws.tags = tags; ws.home = this; this.sockets.add(ws); }
  getWebSockets(tag) { return [...this.sockets].filter((ws) => ws.readyState === 1 && (!tag || ws.tags.includes(tag))); }
  setWebSocketAutoResponse(pair) { this.auto = pair; }
}

export function liveNamespace(ObjectClass, env) {
  const records = new Map();
  const record = (name) => {
    if (!records.has(name)) records.set(name, { state: new DevState(), instance: null, wakes: 0 });
    const r = records.get(name);
    r.get = () => { if (!r.instance) { r.instance = new ObjectClass(r.state, env); r.wakes++; } return r.instance; };
    r.state.record = r;
    return r;
  };
  return {
    idFromName: (name) => String(name),
    get: (id) => ({ fetch: (req) => record(id).get().fetch(req) }),
    _records: records,
    hibernate() { for (const r of records.values()) r.instance = null; },   // as if Cloudflare put every object to sleep
    stats() { return [...records.entries()].map(([name, r]) => ({ name, open: r.state.getWebSockets().length, wakes: r.wakes, writes: r.state.writes })); }
  };
}

function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

// Real WebSocket connections on the local server: the Worker decides (sign-in, origin, launch setting); if it hands back
// a connection, the handshake is completed and messages flow to and from the Durable Object stand-in.
export function attach(server, worker, env) {
  server.on('upgrade', async (req, socket) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const response = await worker.fetch(new Request(url, { method: 'GET', headers }), env, { waitUntil() {}, passThroughOnException() {} });
      const token = response.headers.get('x-nw-dev-upgrade');
      const client = token && pendingUpgrades.get(token);
      if (!client) {
        const body = await response.text().catch(() => '');
        socket.end(`HTTP/1.1 ${response.status} Refused\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        return;
      }
      pendingUpgrades.delete(token);
      const ws = client.server;
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      let closed = false;
      const instance = () => ws.home.record.get();
      const finish = (code) => {
        if (closed) return;
        closed = true; ws.readyState = 3; ws.home.sockets.delete(ws);
        Promise.resolve(instance().webSocketClose(ws, code, '', true)).catch(() => {});
      };
      ws.node = {
        sendText: (t) => { if (!socket.destroyed) socket.write(frame(1, Buffer.from(t))); },
        close: (code) => { const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000); if (!socket.destroyed) socket.write(frame(8, b)); socket.end(); ws.readyState = 3; ws.home.sockets.delete(ws); closed = true; }
      };
      for (const t of ws.queue.splice(0)) ws.node.sendText(t);
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          const masked = buf[1] & 0x80;
          const mask = masked ? buf.subarray(off, off + 4) : null;
          if (masked) off += 4;
          if (buf.length < off + len) return;
          const data = Buffer.from(buf.subarray(off, off + len));
          if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
          buf = buf.subarray(off + len);
          if (op === 1) {
            const text = data.toString();
            const auto = ws.home.auto;
            if (auto && text === auto.request) ws.node.sendText(auto.response);   // answered without waking the object
            else Promise.resolve(instance().webSocketMessage(ws, text)).catch(() => {});
          } else if (op === 8) {
            const code = data.length >= 2 ? data.readUInt16BE(0) : 1005;
            if (!socket.destroyed) socket.write(frame(8, data.subarray(0, 2)));
            socket.end();
            finish(code);
          } else if (op === 9) { if (!socket.destroyed) socket.write(frame(10, data)); }
        }
      });
      socket.on('close', () => finish(1006));
      socket.on('error', () => finish(1006));
    } catch (err) {
      console.error('live emulation:', err);
      socket.destroy();
    }
  });
}
