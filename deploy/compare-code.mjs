// Compares the code the live Worker is running with a dry-run build of the main branch (read-only).
// Prints only whether they match and, if not, a short summary. Code only: nothing personal.
import fs from 'node:fs';
import path from 'node:path';
const [rawFile, distDir] = process.argv.slice(2);
let live = fs.readFileSync(rawFile, 'utf8');
// The API may return the script wrapped as multipart form data: take the JavaScript part
const boundary = live.startsWith('--') ? live.slice(0, live.search(/\r?\n/)) : '';
if (boundary) {
  const parts = live.split(boundary).slice(1).map((p) => { const i = p.search(/\r?\n\r?\n/); return { head: p.slice(0, i), body: p.slice(i).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '') }; });
  const js = parts.find((p) => /javascript/i.test(p.head) && !/\.map"/.test(p.head)) || parts.find((p) => /filename="[^"]+\.js"/.test(p.head));
  console.log('Parts in the live upload: ' + parts.map((p) => (p.head.match(/filename="([^"]+)"/) || [])[1] || '?').join(', '));
  live = js ? js.body : '';
}
const built = fs.readFileSync(path.join(distDir, fs.readdirSync(distDir).find((f) => f.endsWith('.js'))), 'utf8');
const norm = (s) => s.replace(/\/\/# sourceMappingURL=.*$/m, '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*\/\/ /.test(l));
const a = norm(live), b = norm(built);
const setA = new Set(a), setB = new Set(b);
const onlyLive = a.filter((l) => !setB.has(l)), onlyMain = b.filter((l) => !setA.has(l));
console.log(`Live code: ${a.length} lines. Main branch build: ${b.length} lines.`);
console.log(`Lines only in the LIVE code: ${onlyLive.length}. Lines only in the MAIN build: ${onlyMain.length}.`);
for (const l of onlyLive.slice(0, 40)) console.log('  live only: ' + l.trim().slice(0, 160));
for (const l of onlyMain.slice(0, 40)) console.log('  main only: ' + l.trim().slice(0, 160));
console.log(onlyLive.length + onlyMain.length === 0 ? 'RESULT: IDENTICAL' : 'RESULT: DIFFERENT');
