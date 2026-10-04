// Simple fixed-window limits kept in D1. Only a hashed form of the visitor's IP address is stored, briefly.
import { sha256Hex } from './auth.js';

export async function allow(env, request, name, limit, windowSeconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const who = (await sha256Hex(ip + '|' + (env.SESSION_SECRET || 'nw'))).slice(0, 24);
  const bucket = `${name}:${who}:${windowStart}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count`
  ).bind(bucket, windowStart).first();
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(windowStart - 86400).run();
  }
  return (row ? row.count : 1) <= limit;
}
