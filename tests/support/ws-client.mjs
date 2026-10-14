// A tiny WebSocket client for the tests (like a phone's browser: it sends the page's Origin and cookies).
import net from 'node:net';
import crypto from 'node:crypto';

function frame(op, payload) {
  const mask = crypto.randomBytes(4);
  const data = Buffer.from(payload);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]);
  return Buffer.concat([head, mask, data]);
}

// Resolves { status, body } if refused, or { status: 101, ws } with ws.next(ms), ws.send(text), ws.close(), ws.messages
export function connectWs(base, path, headers = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(u.port), u.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), upgraded = false, settled = false;
    const messages = [], waiters = [];
    let closeCode = null; const closeWaiters = [];
    const deliver = (m) => { const w = waiters.shift(); if (w) w(m); else messages.push(m); };
    const ws = {
      messages,
      next(ms = 3000) {
        if (messages.length) return Promise.resolve(messages.shift());
        return new Promise((res) => { const t = setTimeout(() => { const i = waiters.indexOf(f); if (i >= 0) waiters.splice(i, 1); res(null); }, ms); const f = (m) => { clearTimeout(t); res(m); }; waiters.push(f); });
      },
      async nextJson(ms = 3000) { for (;;) { const m = await ws.next(ms); if (m === null) return null; if (m === 'pong') continue; return JSON.parse(m); } },
      send(text) { socket.write(frame(1, Buffer.from(text))); },
      close() { try { const b = Buffer.alloc(2); b.writeUInt16BE(1000); socket.write(frame(8, b)); } catch { /* gone */ } setTimeout(() => socket.destroy(), 50); },
      get closeCode() { return closeCode; },
      closed(ms = 3000) { if (closeCode !== null) return Promise.resolve(closeCode); return new Promise((res) => { const t = setTimeout(() => res(null), ms); closeWaiters.push((c) => { clearTimeout(t); res(c); }); }); }
    };
    const markClosed = (c) => { if (closeCode === null) { closeCode = c; closeWaiters.splice(0).forEach((f) => f(c)); } };
    socket.on('connect', () => {
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`);
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString();
        const status = Number(head.split(' ')[1]);
        if (status !== 101) {
          socket.on('end', () => { if (!settled) { settled = true; resolve({ status, body: buf.subarray(end + 4).toString() }); } });
          return;
        }
        upgraded = true; settled = true;
        buf = buf.subarray(end + 4);
        resolve({ status: 101, ws });
      }
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const data = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 1) deliver(data.toString());
        else if (op === 8) { markClosed(data.length >= 2 ? data.readUInt16BE(0) : 1005); socket.end(); }
      }
    });
    socket.on('close', () => { markClosed(closeCode === null ? 1006 : closeCode); if (!settled) { settled = true; resolve({ status: 0, body: '' }); } });
    socket.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}
