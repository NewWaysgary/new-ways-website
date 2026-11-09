// Compares the code the live Worker is running with a dry-run build of the main branch (read-only).
// Prints only whether they match and, if not, a short summary. Code only: nothing personal.
import fs from 'node:fs';
import path from 'node:path';
const [rawFile, distDir] = process.argv.slice(2);
let live = fs.readFileSync(rawFile, 'utf8');
// The API may return the script wrapped as multipart form data: take the JavaScript part
const parts = live.split(/\r?\n--[^\r\n]+/);
if (parts.length > 2) live = parts.map((p) => p.replace(/^[\s\S]*?\r?\n\r?\n/, '')).sort((a, b) => b.length - a.length)[0];
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
