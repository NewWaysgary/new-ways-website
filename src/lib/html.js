// Safe HTML building for server-rendered pages.
// Every value placed in html`...` is escaped unless it was produced by html`` or raw().

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class Raw {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

export function raw(text) { return new Raw(String(text ?? '')); }

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function join(items, separator = '') {
  return raw(items.filter(Boolean).map(render).join(separator));
}

// Gary's simple formatting for editable wording:
// a blank line starts a new paragraph, lines starting with "-" or "•" become bullet points,
// and a line starting with "#" becomes a small heading.
// Text is always escaped first, so nothing typed in Admin can inject HTML.
export function formatText(text, { replaceTokens } = {}) {
  let source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return raw('');
  const blocks = source.split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let para = [];
    let bullets = [];
    const flushPara = () => {
      const filled = para.map(fill).filter((l) => l.trim());
      if (filled.length) out.push('<p>' + filled.join('<br>') + '</p>');
      para = [];
    };
    const flushBullets = () => {
      const filled = bullets.map(fill).filter((l) => l.trim());
      if (filled.length) out.push('<ul class="stars-list">' + filled.map((l) => '<li>' + l + '</li>').join('') + '</ul>');
      bullets = [];
    };
    for (const line of lines) {
      const heading = line.match(/^#\s+(.*)$/);
      const bullet = line.match(/^(?:[-•*])\s+(.*)$/);
      if (heading) {
        flushPara(); flushBullets();
        const h = fill(heading[1]);
        if (h.trim()) out.push('<h3>' + h + '</h3>');
      } else if (bullet) { flushPara(); bullets.push(bullet[1]); }
      else { flushBullets(); para.push(line); }
    }
    flushPara();
    flushBullets();
  }
  function fill(line) {
    const safe = esc(line);
    return replaceTokens ? replaceTokens(safe) : safe;
  }
  return raw(out.join(''));
}

// Structured data for Google, safe inside a <script> element.
export function jsonLd(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return raw('<script type="application/ld+json">' + json + '</script>');
}
