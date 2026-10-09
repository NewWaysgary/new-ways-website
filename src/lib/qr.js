// QR codes, made here on the server (no outside service, nothing to install).
// Byte mode, error correction level M (about 15% of the code can be damaged and it still scans), versions 1 to 15.
// Output as a PNG image (for emails and printing) or an SVG (for web pages).
// Follows the QR Code specification (ISO/IEC 18004); the approach is the well-known one by Project Nayuki.

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
const MAX_VERSION = 15;
const ECL_BITS_M = 0;

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---------- Reed-Solomon over GF(256), with log tables (made once when the website starts) ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gfMul = (x, y) => (x && y ? EXP[LOG[x] + LOG[y]] : 0);
const DIVISORS = {};
function rsDivisor(degree) {
  if (DIVISORS[degree]) return DIVISORS[degree];
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return (DIVISORS[degree] = result);
}
function rsRemainder(data, divisor) {
  const n = divisor.length;
  const result = new Uint8Array(n);
  for (let d = 0; d < data.length; d++) {
    const factor = data[d] ^ result[0];
    result.copyWithin(0, 1);
    result[n - 1] = 0;
    if (factor) { const lf = LOG[factor]; for (let i = 0; i < n; i++) if (divisor[i]) result[i] ^= EXP[LOG[divisor[i]] + lf]; }
  }
  return Array.from(result);
}

// ---------- the matrix ----------
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('Too much text for a QR code');
  const size = ver * 4 + 17;

  // data bits, written straight into bytes
  const capBytes = dataCodewords(ver);
  const data = new Uint8Array(capBytes);
  let pos = 0;
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--, pos++) if ((val >>> i) & 1) data[pos >>> 3] |= 0x80 >>> (pos & 7); };
  put(4, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);
  pos += Math.min(4, capBytes * 8 - pos);           // terminator
  pos = (pos + 7) & ~7;                              // to a whole byte
  for (let pad = 0xec, at = pos >>> 3; at < capBytes; at++, pad ^= 0xec ^ 0x11) data[at] = pad;

  // error correction, split into blocks and interleaved
  const numBlocks = BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = Array.from(data.subarray(k, k + shortLen - eccLen + (i < numShort ? 0 : 1)));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]); });
  }

  // flat arrays (one byte per module) keep this quick on the free plan's CPU allowance
  const mod = new Uint8Array(size * size);
  const isFn = new Uint8Array(size * size);
  const setFn = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; isFn[y * size + x] = 1; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
    }
  }
  const align = alignmentPositions(ver, size);
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask) => {
    const d = (ECL_BITS_M << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((v >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setFn(a, c, b); setFn(c, a, b);
    }
  }

  // data, in the zig-zag order
  let i = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const k = y * size + right - j;
        if (!isFn[k] && i < totalBits) { mod[k] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
      }
    }
  }

  // try the 8 masks and keep the easiest to read (simple loops, no per-module function calls: quick even when cold)
  const pattern = new Uint8Array(size * size);
  const fillPattern = (m) => {
    for (let y = 0, k = 0; y < size; y++) {
      for (let x = 0; x < size; x++, k++) {
        let on;
        switch (m) {
          case 0: on = (x + y) % 2 === 0; break;
          case 1: on = y % 2 === 0; break;
          case 2: on = x % 3 === 0; break;
          case 3: on = (x + y) % 3 === 0; break;
          case 4: on = (((x / 3) | 0) + ((y / 2) | 0)) % 2 === 0; break;
          case 5: on = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: on = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: on = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        pattern[k] = on && !isFn[k] ? 1 : 0;
      }
    }
  };
  const applyMask = () => { for (let k = 0; k < mod.length; k++) mod[k] ^= pattern[k]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    fillPattern(m); applyMask(); drawFormat(m);
    const sc = penalty(mod, size);
    if (sc < bestScore) { bestScore = sc; best = m; }
    applyMask();
  }
  fillPattern(best); applyMask(); drawFormat(best);
  const rows = [];
  for (let y = 0; y < size; y++) { const row = new Array(size); for (let x = 0; x < size; x++) row[x] = mod[y * size + x] === 1; rows.push(row); }
  return rows;
}

function penalty(mod, size) {
  let score = 0, dark = 0;
  for (let a = 0; a < size; a++) {
    let runX = 1, runY = 1;
    for (let b = 0; b < size; b++) {
      const here = mod[a * size + b];
      dark += here;
      if (b > 0) {
        if (here === mod[a * size + b - 1]) { runX++; if (runX === 5) score += 3; else if (runX > 5) score++; } else runX = 1;
        const col = mod[b * size + a];
        if (col === mod[(b - 1) * size + a]) { runY++; if (runY === 5) score += 3; else if (runY > 5) score++; } else runY = 1;
        if (a > 0 && here === mod[(a - 1) * size + b] && here === mod[a * size + b - 1] && here === mod[(a - 1) * size + b - 1]) score += 3;
      }
    }
  }
  const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
  return score + Math.max(0, k) * 10;
}

// ---------- SVG (web pages) ----------
export function qrSvg(text, { border = 4, label = 'QR code' } = {}) {
  const m = qrMatrix(text);
  const n = m.length + border * 2;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + border},${y + border}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label.replace(/[<>&"]/g, '')}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- PNG (emails and printing): black and white, 1 bit per pixel ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(out, at, type, data) {
  const len = data.length;
  out[at] = len >>> 24; out[at + 1] = (len >>> 16) & 0xff; out[at + 2] = (len >>> 8) & 0xff; out[at + 3] = len & 0xff;
  for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
  out.set(data, at + 8);
  const crc = crc32(out.subarray(at + 4, at + 8 + len));
  out[at + 8 + len] = crc >>> 24; out[at + 9 + len] = (crc >>> 16) & 0xff; out[at + 10 + len] = (crc >>> 8) & 0xff; out[at + 11 + len] = crc & 0xff;
  return at + 12 + len;
}

// zlib stream using "stored" (uncompressed) blocks: simple and always valid; the images are small anyway
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  out[0] = 0x78; out[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, (b + 1) * 65535);
    out[at] = b === blocks - 1 ? 1 : 0;
    out[at + 1] = part.length & 0xff; out[at + 2] = part.length >>> 8;
    out[at + 3] = ~part.length & 0xff; out[at + 4] = (~part.length >>> 8) & 0xff;
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  let a = 1, c = 0;
  for (let i = 0; i < raw.length; i++) { a += raw[i]; if (a >= 65521) a -= 65521; c += a; if (c >= 65521) c -= 65521; }
  const adler = ((c << 16) | a) >>> 0;
  out[at] = adler >>> 24; out[at + 1] = (adler >>> 16) & 0xff; out[at + 2] = (adler >>> 8) & 0xff; out[at + 3] = adler & 0xff;
  return out;
}

export function qrPng(text, { scale = 8, border = 4 } = {}) {
  const m = qrMatrix(text);
  const modules = m.length + border * 2;
  const n = modules * scale;
  const rowBytes = Math.ceil(n / 8);
  const stride = rowBytes + 1;
  const raw = new Uint8Array(stride * n);
  // build each row of modules once, then repeat it `scale` times
  const line = new Uint8Array(stride);
  for (let my = -border; my < m.length + border; my++) {
    line.fill(0);
    for (let px = 0; px < n; px++) {
      const mx = ((px / scale) | 0) - border;
      const dark = my >= 0 && my < m.length && mx >= 0 && mx < m.length && m[my][mx];
      if (!dark) line[1 + (px >> 3)] |= 0x80 >> (px & 7);   // 1 = white
    }
    const top = (my + border) * scale;
    for (let r = 0; r < scale; r++) raw.set(line, (top + r) * stride);
  }
  const ihdr = new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 1, 0, 0, 0, 0]);
  const idat = zlibStored(raw);
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = writeChunk(out, 8, 'IHDR', ihdr);
  at = writeChunk(out, at, 'IDAT', idat);
  writeChunk(out, at, 'IEND', new Uint8Array(0));
  return out;
}

export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Run once when the website starts, so the first real QR code of the day isn't slowed by first-time set-up
try { qrPng('https://example.com/c/AAAAAAAAAAAAAAAAAAAAAA', { scale: 2 }); } catch { /* never stops the website starting */ }
