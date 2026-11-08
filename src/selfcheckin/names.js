// Matching a typed full name against the guest list, the same way on the iPad and on Julie's screen.
// Only differences that don't make it a different name are ignored: capitals, extra spaces, accents, full stops and
// apostrophes ("Mary O’Brien" = "mary obrien"), and hyphens or spaces ("Anne-Marie" = "Anne Marie").
// It is always the WHOLE name: "Mary" never matches "Mary Smith".
export function nameKey(raw) {
  return String(raw || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘'`´.]/g, '')
    .replace(/[-‐‑‒–—_,]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Names that more than one guest has (for Julie's "Same name" list): Map key -> guests
export function sameNameGroups(guests) {
  const by = new Map();
  for (const g of guests) {
    const k = nameKey(g.name);
    if (!k) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(g);
  }
  return [...by.values()].filter((list) => list.length > 1);
}
