// A small PDF writer for the printable gift vouchers: one page with filled shapes, text in the PDF standard fonts
// (Helvetica and Times, which every PDF reader has, so nothing needs embedding), a JPEG picture, a QR code drawn as
// vector squares (sharp at any size) and a clickable link. No outside service is used.
import { WIDTHS } from './pdf-fonts.js';
import { qrMatrix } from './qr.js';

const FONTS = { helvetica: ['F1', 'Helvetica'], 'helvetica-bold': ['F2', 'Helvetica-Bold'], times: ['F3', 'Times-Roman'], 'times-bold': ['F4', 'Times-Bold'], 'times-italic': ['F5', 'Times-Italic'] };

// The few characters outside Latin-1 that WinAnsi has (curly quotes, dashes, bullet, ellipsis)
const WIN = { 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97, 0x2022: 0x95, 0x2026: 0x85, 0x20ac: 0x80 };
export function winAnsi(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (WIN[c]) out.push(WIN[c]);
    else if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else out.push(63);   // ?
  }
  return out;
}

export function textWidth(text, font, size) {
  const name = FONTS[font][1];
  return winAnsi(text).reduce((w, c) => w + (WIDTHS[name][c - 32] || 500), 0) * size / 1000;
}

const hexOf = (codes) => '<' + codes.map((c) => c.toString(16).padStart(2, '0')).join('') + '>';
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' '); };

export class PdfPage {
  constructor(width, height) { this.width = width; this.height = height; this.ops = []; this.images = []; this.links = []; }
  // y is measured from the TOP of the page (easier to lay out), converted for PDF here
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 1 } = {}) {
    const py = this.height - y - h;
    if (fill) this.ops.push(`${rgb(fill)} rg`);
    if (stroke) this.ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    this.ops.push(`${num(x)} ${num(py)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  line(x1, y1, x2, y2, { color = '#000000', lineWidth = 1 } = {}) {
    this.ops.push(`${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
  }
  // baseline at y (from the top); align: left | center | right (x is then the centre or right edge)
  text(str, x, y, { font = 'helvetica', size = 12, color = '#000000', align = 'left', spacing = 0 } = {}) {
    const codes = winAnsi(str);
    const w = textWidth(str, font, size) + spacing * Math.max(0, codes.length - 1);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    this.ops.push(`BT /${FONTS[font][0]} ${num(size)} Tf ${spacing ? num(spacing) + ' Tc ' : ''}${rgb(color)} rg ${num(left)} ${num(this.height - y)} Td ${hexOf(codes)} Tj${spacing ? ' 0 Tc' : ''} ET`);
    return w;
  }
  image(jpeg, x, y, w, h) {
    const name = 'Im' + (this.images.length + 1);
    this.images.push({ name, ...jpeg });
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.height - y - h)} cm /${name} Do Q`);
  }
  // A QR code with its white quiet zone, as vector squares
  qr(text, x, y, size, { dark = '#000000', light = '#FFFFFF', border = 4 } = {}) {
    const m = qrMatrix(text);
    const n = m.length + border * 2;
    const cell = size / n;
    this.rect(x, y, size, size, { fill: light });
    this.ops.push(`${rgb(dark)} rg`);
    m.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (!row[c]) { c++; continue; }
        let e = c;
        while (e < row.length && row[e]) e++;
        const px = x + (c + border) * cell, py = this.height - (y + (r + border + 1) * cell);
        this.ops.push(`${num(px)} ${num(py)} ${num((e - c) * cell + 0.01)} ${num(cell + 0.01)} re f`);
        c = e;
      }
    });
  }
  link(url, x, y, w, h) { this.links.push({ url, rect: [x, this.height - y - h, x + w, this.height - y] }); }
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Builds the PDF file (bytes): one page, or a list of pages (for several vouchers at once)
export function renderPdf(pageOrPages, { title = '', author = '' } = {}) {
  const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
  const enc = new TextEncoder();
  const objects = [];   // each: Uint8Array parts
  const add = (parts) => { objects.push(parts); return objects.length; };
  const str = (s) => enc.encode(s);
  const pdfString = (s) => hexOf([0xfe, 0xff, ...[...String(s)].flatMap((ch) => { const c = ch.charCodeAt(0); return [c >> 8, c & 0xff]; })]);

  const catalogId = 1, pagesId = 2;
  objects.length = 2;   // reserve 1-2
  const fontIds = {};
  for (const [, [key, base]] of Object.entries(FONTS)) fontIds[key] = add([str(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)]);
  const imageByData = new Map();   // the same picture is stored once, however many pages use it
  const pageIds = [];
  for (const page of pages) {
    const imageIds = {};
    for (const im of page.images) {
      if (!imageByData.has(im.base64)) {
        const bytes = b64ToBytes(im.base64);
        imageByData.set(im.base64, add([str(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`), bytes, str('\nendstream')]));
      }
      imageIds[im.name] = imageByData.get(im.base64);
    }
    const content = str(page.ops.join('\n'));
    const contentId = add([str(`<< /Length ${content.length} >>\nstream\n`), content, str('\nendstream')]);
    // a link's address is plain ASCII, written as a literal string
    const annots = page.links.map((l) => add([str(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${String(l.url).replace(/[^\x21-\x7e]/g, '').replace(/[()\\]/g, '\\$&')}) >> >>`)]));
    pageIds.push(add([str(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Contents ${contentId} 0 R` +
      ` /Resources << /Font << ${Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >>${Object.keys(imageIds).length ? ` /XObject << ${Object.entries(imageIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >>` : ''} >>` +
      `${annots.length ? ` /Annots [${annots.map((id) => `${id} 0 R`).join(' ')}]` : ''} >>`)]));
  }
  const infoId = add([str(`<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Producer (New Way's website) >>`)]);
  objects[catalogId - 1] = [str(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)];
  objects[pagesId - 1] = [str(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)];

  // the header, then a comment of bytes above 127 (tells programs the file is binary)
  const chunks = [new Uint8Array([...str('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    const head = str(`${i + 1} 0 obj\n`), tail = str('\nendobj\n');
    for (const p of [head, ...parts, tail]) { chunks.push(p); offset += p.length; }
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(str(xref + `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
