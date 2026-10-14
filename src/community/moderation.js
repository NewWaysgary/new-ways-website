// New Way's Community: comment protection. ONE set of rules, used for real visitor comments (Stage 5) and by
// Admin's Test a Comment box, always on the server.
//
// Every comment, reply and display name is checked and gets one of three results:
//   ALLOW  it can be published straight away;
//   HOLD   it is kept privately until Gary or Julie approve it (something looks suspicious but is not clearly wrong);
//   BLOCK  it is not published and is not stored; the visitor sees a friendly message and keeps their wording to change.
//
// The checks (all free, inside this website; no outside moderation service):
//   1. language: the editable word lists (block / hold / allow), with disguises undone first: capitals, accents, look-alike
//      letters, numbers and symbols for letters (sh1t, $hit, @ss), spaced or dotted letters (f u c k, f.u.c.k),
//      stretched letters (fuuuuck), hidden characters and masked words (f**k);
//   2. links: web addresses (also "dot com" spellings), email addresses, phone numbers, social and messaging links,
//      payment links, pictures;
//   3. scams and advertising: spare or resold tickets, private readings or services for sale, requests for money,
//      moving the conversation to private messages, pretending to be New Way's;
//   4. names: no Admin, official, staff or New Way's names, no tick or badge symbols; guest mediums' names are held;
//   5. repeats and nonsense: copied comments, the same visitor repeating themselves, endless repeated characters;
//   6. the visitor's record: someone who keeps sending blocked comments has their comments held for a while.
// Innocent words that merely contain a strong word (Scunthorpe, cocktail, Essex, class, snigger) are never blocked.

export const MESSAGES = {
  language: 'Your comment contains language that is not permitted in New Way’s Community. Please remove the inappropriate wording before posting.',
  link: 'Links are not permitted in New Way’s Community comments. Please remove the link before posting.',
  advert: 'Your comment cannot be posted because it may contain advertising, ticket sales or other content not permitted in New Way’s Community. Please change your comment before trying again.',
  name: 'Please choose a different name. Names that look like New Way’s, its team or its administrators can’t be used.',
  nameLanguage: 'Please choose a different name. That name contains language that is not permitted in New Way’s Community.',
  empty: 'Please write your comment before posting.',
  emptyName: 'Please enter your name (or a first name) before posting.',
  tooLong: 'Please keep your comment under 1,000 characters.',
  nameLength: 'Please keep your name under 40 characters.',
  repeat: 'You’ve already posted this comment.',
  held: 'Thank you. Your comment will appear once it has been checked.'
};
export const MAX_COMMENT = 1000;
export const MAX_NAME = 40;

// ---------- undoing disguises ----------
const LOOKALIKE = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'к': 'k', 'м': 'm',
  'т': 't', 'в': 'b', 'н': 'h', 'ɡ': 'g', 'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i', 'κ': 'k', 'τ': 't', 'ρ': 'p', 'ε': 'e', 'υ': 'u', 'χ': 'x',
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ı': 'i'
};
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e', '+': 't', '¡': 'i' };

export function baseText(text) {
  let s = String(text ?? '').normalize('NFKC').toLowerCase();
  s = s.replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '');   // hidden characters
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');                   // accents
  s = s.replace(/[^\u0000-\u007f]/g, (c) => (LOOKALIKE[c] !== undefined ? LOOKALIKE[c] : c));
  return s.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
}

// Letters spelled out one at a time: "f u c k", "f.u.c.k", "f-u-c-k", "f_u_c_k" -> "fuck"
function joinSpelledOut(s) {
  return s.replace(/(?:^|(?<=[\s,;:"(]))((?:[a-z0-9@$!|*](?:[\s._\-*~+'"]{1,3}|(?=$))){3,})/g, (m) => {
    const letters = m.replace(/[\s._\-~+'",]/g, '');
    return letters.length >= 3 && /^[a-z0-9@$!|*]+$/.test(letters) ? letters + ' ' : m;
  });
}

const leet = (t, one) => t.replace(/[0-9@$!|€+¡]/g, (c) => (c === '1' ? one : LEET[c] || c));

// Every way a word might have been written: as typed, numbers/symbols as letters, stretched letters shortened
export function wordForms(token) {
  const forms = new Set([token]);
  const hasLetter = /[a-z]/.test(token);
  if (hasLetter && /[0-9@$!|€+¡]/.test(token)) { forms.add(leet(token, 'i')); forms.add(leet(token, 'l')); }
  for (const f of [...forms]) {
    const clean = f.replace(/[^a-z*]/g, '');
    if (clean && clean !== f) forms.add(clean);
    if (/(.)\1\1/.test(f)) { forms.add(f.replace(/(.)\1{2,}/g, '$1')); forms.add(f.replace(/(.)\1{2,}/g, '$1$1')); }
    if (f.includes('ph')) forms.add(f.replace(/ph/g, 'f'));
  }
  return [...forms].filter(Boolean);
}

export function tokenise(text) {
  const s = joinSpelledOut(baseText(text));
  // (exclamation marks and similar at the end or start of a word are punctuation: "monkey!" is "monkey"; "sh!t" is not)
  return s.split(/[^a-z0-9@$!|*€+¡']+/).map((t) => t.replace(/^['!|+¡]+|['!|+¡]+$/g, '').replace(/'/g, '')).filter(Boolean);
}

// ---------- the word lists ----------
export function normalisePhrase(p) {
  return tokenise(p).join(' ');
}

// Prepares the lists once per check: { block: Map, hold: Map, allow: Set, allowPhrases: [] }
export function prepareLists(rows) {
  const L = { words: new Map(), phrases: [], anywhere: [], allowWords: new Set(), allowPhrases: [] };
  for (const r of rows || []) {
    const phrase = normalisePhrase(r.phrase);
    if (!phrase) continue;
    const entry = { phrase, shown: r.phrase, action: r.action, category: r.category || '' };
    if (r.action === 'allow') { if (phrase.includes(' ')) L.allowPhrases.push(phrase); else L.allowWords.add(phrase); continue; }
    if (phrase.includes(' ')) L.phrases.push(entry);
    else {
      L.words.set(phrase, entry);
      if (Number(r.anywhere) === 1 && phrase.length >= 4) L.anywhere.push(entry);
    }
  }
  return L;
}

const rank = { allow: 0, hold: 1, block: 2 };
export function mask(word) {
  const w = String(word);
  if (w.includes(' ')) return w.split(' ').map(mask).join(' ');
  return w.length <= 2 ? w[0] + '*' : w[0] + '*'.repeat(w.length - 2) + w[w.length - 1];
}

// An innocent word, or a longer form of one ("sniggering" from "snigger", "cocktails" from "cocktail")
function isAllowed(word, lists) {
  if (lists.allowWords.has(word)) return true;
  for (const a of lists.allowWords) if (a.length >= 6 && word.startsWith(a)) return true;
  return false;
}

export function findWords(text, lists) {
  const tokens = tokenise(text);
  const found = new Map();
  const note = (entry, how) => { if (!found.has(entry.phrase)) found.set(entry.phrase, { ...entry, how }); };
  // innocent phrases ("blue tit", "kill time") take their words out of the check
  const skip = new Set();
  const joined = ' ' + tokens.join(' ') + ' ';
  for (const ap of lists.allowPhrases) {
    let at = joined.indexOf(' ' + ap + ' ');
    while (at !== -1) {
      const start = joined.slice(0, at).trim() ? joined.slice(0, at).trim().split(' ').length : 0;
      ap.split(' ').forEach((_, i) => skip.add(start + i));
      at = joined.indexOf(' ' + ap + ' ', at + 1);
    }
  }
  const forms = tokens.map((t) => wordForms(t));
  forms.forEach((fs, i) => {
    if (skip.has(i) || fs.some((f) => isAllowed(f, lists))) return;
    for (const f of fs) {
      if (f.includes('*')) {   // masked words: f**k, sh*t
        if (f.replace(/\*/g, '').length >= 1 && f.length >= 3) {
          const re = new RegExp('^' + f.replace(/\*/g, '[a-z]') + '$');
          for (const [w, e] of lists.words) if (e.action === 'block' && re.test(w)) { note(e, 'masked'); break; }
        }
        continue;
      }
      const hit = lists.words.get(f);
      if (hit) note(hit, f === tokens[i] ? 'word' : 'disguised');
      for (const e of lists.anywhere) if (f.length > e.phrase.length && f.includes(e.phrase)) note(e, 'inside');
    }
  });
  // two short pieces that make a strong word ("fu ck")
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (skip.has(i) || skip.has(i + 1)) continue;
    if (Math.min(tokens[i].length, tokens[i + 1].length) > 2) continue;
    for (const f of wordForms(tokens[i] + tokens[i + 1])) { const e = lists.words.get(f); if (e && e.action === 'block') note(e, 'split'); }
  }
  // phrases ("kill you", "i know where you live"), using the undisguised words
  const plain = ' ' + forms.map((fs, i) => (skip.has(i) ? '·' : (fs.find((f) => f !== tokens[i] && /^[a-z]+$/.test(f)) || tokens[i]))).join(' ') + ' ';
  const plainAsTyped = joined;
  for (const e of lists.phrases) {
    if (plain.includes(' ' + e.phrase + ' ') || plainAsTyped.includes(' ' + e.phrase + ' ')) note(e, 'phrase');
  }
  return [...found.values()];
}

// ---------- links, contact details and pictures ----------
// Endings that are almost always web addresses (blocked), and endings that are also ordinary words (held for a look)
const STRONG_TLD = 'com|net|org|uk|io|ly|gl|gg|info|biz|xyz|app|page|site|website|online|shop|store|link|click|ee|top|club|vip|icu|cc|ru|cn|tk|ml|ga|cf|ws|scot|wales|blog|social|chat|games|money|cash|bet|tech|space|email';
const SOFT_TLD = 'me|us|co|de|es|fr|ca|au|eu|ie|ai|tv|fm|pro|live|today|world|news|media|fun|win|it|in|is|at|be|so|to|no|my|by|am|an|as|do|go|he|hi|if|la|ms|mu|nu|pm|re|sh|st|im';

function linkText(text) {
  return baseText(text)
    .replace(/\s*[([{]\s*(?:dot|\.)\s*[)\]}]\s*/g, '.')        // (dot) [.] {dot}
    .replace(/([a-z0-9])\s+dot\s+(?=[a-z]{2,})/g, '$1.')         // "site dot com"
    .replace(/([a-z0-9])\s*\.\s+(?=(?:com|net|org|co|uk|ly|io|me)\b)/g, '$1.')   // "site . com"
    .replace(/\s*[([{]\s*at\s*[)\]}]\s*/g, '@');
}

export function findLinks(text) {
  const s = linkText(text);
  const hits = [];
  if (/\b(?:https?|ftp)\s*:\s*\/\/|\bwww\s*\.|\bhttps?\b/.test(s)) hits.push({ kind: 'link', detail: 'a web address' });
  const strong = new RegExp('\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + STRONG_TLD + ')\\b(?![\'’]?[a-z])', 'g');
  // (only when written in small letters straight after the full stop: "night.Me and my sister" is just a missing space)
  const soft = new RegExp('\\b[A-Za-z][A-Za-z0-9-]{1,}\\.(?:' + SOFT_TLD + ')\\b', 'g');
  const strongHit = (s.match(strong) || []).filter((d) => !/^\d+(?:\.\d+)+$/.test(d));
  if (strongHit.length) hits.push({ kind: 'link', detail: 'a web address (' + strongHit[0] + ')' });
  if (/[a-z0-9._%+-]+\s*@\s*[a-z0-9-]+\s*\.\s*[a-z]{2,}/.test(s)) hits.push({ kind: 'email', detail: 'an email address' });
  else if (/\b(?:gmail|googlemail|hotmail|yahoo|outlook|icloud|aol|btinternet|protonmail|live\s*\.\s*co)\b/.test(s)) hits.push({ kind: 'email', detail: 'an email address' });
  if (/\b(?:wa\.me|t\.me|m\.me|bit\.ly|tinyurl|linktr\.ee|cutt\.ly|rb\.gy|is\.gd|goo\.gl|ow\.ly|paypal\.me|revolut\.me|monzo\.me|cash\.app)\b/.test(s)) hits.push({ kind: 'link', detail: 'a short or payment link' });
  if (/<\s*(?:a|img|iframe|script)\b|\[\s*(?:img|url)\s*\]|data\s*:\s*image|\.(?:jpe?g|png|gif|webp|heic|pdf|apk|exe)\b/.test(s)) hits.push({ kind: 'link', detail: 'a picture, file or page code' });
  // phone numbers: 10 or more digits in a row (spaces, dashes, dots and brackets allowed), e.g. 07700 900123, +44 7700 900123
  for (const m of s.matchAll(/(?:\+|\b00|\b0)[\d\s().-]{8,}\d/g)) {
    if (m[0].replace(/\D/g, '').length >= 10) { hits.push({ kind: 'phone', detail: 'a phone number' }); break; }
  }
  const softHit = String(text ?? '').normalize('NFKC').match(soft);
  if (!hits.length && softHit) return [{ kind: 'maybe-link', detail: 'something that might be a web address (' + softHit[0] + ')' }];
  return hits;
}

// ---------- scams, ticket sales, advertising ----------
const has = (s, list) => list.find((p) => s.includes(' ' + p + ' '));
const CONTACT = ['message me', 'msg me', 'dm me', 'pm me', 'inbox me', 'text me', 'call me', 'ring me', 'contact me', 'email me', 'add me', 'whatsapp me', 'get in touch with me',
  'reach me', 'hit me up', 'drop me a', 'message for', 'dm for', 'inbox for', 'pm for', 'private message', 'direct message', 'my number', 'my inbox', 'contact for', 'details in my'];
const PLATFORMS = ['whatsapp', 'whats app', 'telegram', 'snapchat', 'snap chat', 'instagram', 'insta', 'tiktok', 'tik tok', 'kik', 'viber', 'wechat', 'facebook messenger', 'fb messenger',
  'onlyfans', 'facebook page', 'my facebook', 'fb page'];
const TICKET = /\b(?:tickets?|tix|seats?|places?)\b/;
const SALE_STRONG = ['spare', 'selling', 'sell', 'for sale', 'resell', 'resale', 'reselling', 'transfer', 'swap', 'going spare', 'up for grabs', 'half price', 'face value', 'cheap', 'offers'];
const SALE_WEAK = ['available', 'extra', 'buy', 'each', 'cant use', 'cant make', 'cant go', 'cannot make', 'cannot go', 'cannot use', 'want my', 'wants my', 'anyone want'];
const MONEY_STRONG = ['paypal', 'pay pal', 'revolut', 'monzo', 'cashapp', 'cash app', 'venmo', 'zelle', 'western union', 'moneygram', 'bank transfer', 'sort code', 'account number',
  'send money', 'send me money', 'pay me', 'donate to me', 'donations to me', 'my fundraiser', 'bitcoin', 'btc', 'crypto', 'usdt', 'ethereum', 'forex', 'binary options'];
const MONEY_SOFT = ['gofundme', 'go fund me', 'justgiving', 'just giving', 'gift card', 'giftcard', 'itunes card', 'investment', 'investing', 'earn money', 'make money', 'work from home', 'loan', 'loans'];
const ADVERT = ['readings available', 'reading available', 'book a reading', 'book your reading', 'book with me', 'i do readings', 'i offer', 'my readings', 'my services', 'my service', 'my website',
  'my page', 'my business', 'my shop', 'my channel', 'my group', 'check out my', 'visit my', 'follow me', 'follow my', 'subscribe', 'discount', 'promo', 'coupon', 'voucher code', 'special offer',
  'per cent off', 'percent off', 'free reading', 'free readings', 'for bookings', 'bookings contact', 'available for', 'hire me', 'taking bookings', 'now booking', 'tarot readings', 'psychic readings',
  'card readings', 'distance readings', 'email readings', 'phone readings', 'dm for readings', 'buy now', 'order now', 'limited time', 'click here', 'link in bio'];
const PRICE = /(?:£|\$|€|\bgbp\b)\s*\d|\d+\s*(?:£|quid|pounds?|gbp)\b/;
const IMPERSONATE = ['this is gary', 'gary here', 'julie here', 'admin here', 'from the admin', 'admin team', 'on behalf of new ways', 'official new ways', 'new ways admin', 'new ways team', 'new ways staff',
  'message from new ways', 'new ways official', 'i am gary', 'im gary', 'i am julie', 'im julie', 'moderator here'];

// The words with disguises undone ("sp4re t1ckets" -> "spare tickets"), for the scam and advertising checks
function plainWords(text) {
  return ' ' + tokenise(text).map((t) => wordForms(t).find((f) => f !== t && /^[a-z]+$/.test(f)) || t).join(' ') + ' ';
}

export function findScams(text) {
  const s = plainWords(text);
  const raw = baseText(text);
  const reasons = [];
  const question = /\?/.test(raw);
  const contact = has(s, CONTACT) || has(s, PLATFORMS);
  const ticket = TICKET.test(s);
  const saleStrong = has(s, SALE_STRONG);
  const saleWeak = has(s, SALE_WEAK);
  const price = PRICE.test(raw);
  const moneyStrong = has(s, MONEY_STRONG) || (/\bsend me\b/.test(s) && price && 'send me money');
  const moneySoft = has(s, MONEY_SOFT);
  const pricedService = price && /\b(?:readings?|tarot|psychic|healing|sessions?|services?|course|workshop)\b/.test(s) && 'a priced service';
  const advert = has(s, ADVERT) || (/\d+\s*%\s*off\b/.test(raw) && 'a discount') || pricedService;
  // Tickets: offering, selling or passing on tickets is not allowed; an ordinary question about tickets is fine
  if (ticket && ((saleStrong && !question) || ((saleStrong || saleWeak || price) && (contact || moneyStrong)) || (price && saleStrong)))
    reasons.push({ code: 'tickets', action: 'block', detail: 'looks like tickets being sold or passed on (' + (saleStrong || saleWeak || 'a price') + ')' });
  else if (ticket && (saleStrong || price || (saleWeak && !question))) reasons.push({ code: 'tickets', action: 'hold', detail: 'mentions spare, available or priced tickets' });
  if (moneyStrong) reasons.push({ code: 'money', action: 'block', detail: 'asks for money or names a payment service (' + moneyStrong + ')' });
  else if (moneySoft) reasons.push({ code: 'money', action: 'hold', detail: 'mentions fundraising, gift cards or money-making (' + moneySoft + ')' });
  if (advert && (contact || price)) reasons.push({ code: 'advert', action: 'block', detail: 'looks like advertising (' + advert + ')' });
  else if (advert) reasons.push({ code: 'advert', action: 'hold', detail: 'may be advertising (' + advert + ')' });
  if (contact && !reasons.some((r) => r.action === 'block')) reasons.push({ code: 'contact', action: 'hold', detail: 'asks people to get in touch privately or elsewhere (' + contact + ')' });
  const imp = has(s, IMPERSONATE);
  if (imp) reasons.push({ code: 'impersonation', action: 'hold', detail: 'claims to be from New Way’s or its team (' + imp + ')' });
  return reasons;
}

// ---------- names ----------
const NAME_RESERVED = [/\badmin/, /\badministrator/, /\bmoderator\b/, /\bmod\b/, /\bofficial\b/, /\bstaff\b/, /\bteam\b/, /\bowner\b/, /\bverified\b/, /\bsupport\b/, /\bmanagement\b/,
  /\bnew\s*ways?\b/, /\bnewways?\b/, /mediumship\s*development/, /development\s*centre/, /\bgary\s*findlay\b/, /\bmedium\s*gary\b/, /\bthe\s*centre\b/, /\breception\b/];
const BADGE_SYMBOLS = /[\u2713\u2714\u2611\u2705\u{1F5F8}\u{1F7E2}\u{1F49A}\u{1F7E9}\u{1F3C5}\u{1F396}\u{1F947}\u{1F6E1}]/u;

export function checkName(name, { mediumNames = [], lists } = {}) {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
  const reasons = [];
  if (!raw) return [{ code: 'name-empty', action: 'block', detail: 'no name given', message: MESSAGES.emptyName }];
  if (raw.length > MAX_NAME) return [{ code: 'name-length', action: 'block', detail: 'name too long', message: MESSAGES.nameLength }];
  const plain = baseText(raw).replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
  const squashed = tokenise(raw).map((t) => wordForms(t).find((f) => /^[a-z]+$/.test(f)) || t).join(' ');
  if (BADGE_SYMBOLS.test(raw)) reasons.push({ code: 'name-badge', action: 'block', detail: 'the name uses a tick or badge symbol', message: MESSAGES.name });
  const hit = NAME_RESERVED.find((re) => re.test(plain) || re.test(squashed) || re.test(squashed.replace(/\s+/g, '')));
  if (hit) reasons.push({ code: 'name-reserved', action: 'block', detail: 'the name looks like New Way’s, its team or an administrator', message: MESSAGES.name });
  if (findLinks(raw).some((l) => l.kind !== 'maybe-link')) reasons.push({ code: 'name-link', action: 'block', detail: 'the name contains a link or contact details', message: MESSAGES.link });
  if (lists) {
    const words = findWords(raw, lists);
    const worst = words.reduce((a, w) => (rank[w.action] > rank[a] ? w.action : a), 'allow');
    if (worst !== 'allow') reasons.push({ code: 'name-language', action: worst, detail: 'the name contains ' + words.map((w) => `“${mask(w.shown)}” (${w.category || w.action})`).join(', '), message: MESSAGES.nameLanguage });
  }
  const key = (n) => tokenise(n).join(' ');
  const me = key(raw);
  const medium = mediumNames.find((m) => key(m) && (key(m) === me || (me.split(' ').length >= 2 && key(m).includes(me)) || (key(m).split(' ').length >= 2 && me.includes(key(m)))));
  if (medium) reasons.push({ code: 'name-medium', action: 'hold', detail: `the name matches guest medium “${medium}”` });
  return reasons;
}

// ---------- shouting, nonsense and repeats ----------
function findNoise(text) {
  const reasons = [];
  // (Comments written all in capitals are fine: many people type that way. So are long rows of kisses: xxxxx.)
  if (/([^xX\s])\1{19,}/su.test(String(text))) reasons.push({ code: 'noise', action: 'hold', detail: 'the same character repeated many times' });
  if (String(text).split(/\s+/).some((w) => w.length > 45 && !/^https?:/i.test(w))) reasons.push({ code: 'noise', action: 'hold', detail: 'an unusually long word' });
  return reasons;
}

// A scrambled code of the wording (capitals, spaces and punctuation ignored), to spot copied comments
export async function fingerprint(text) {
  const plain = tokenise(text).join(' ');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nwc|' + plain));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the whole check ----------
// input: { name, text }   context: { lists (prepareLists), mediumNames, sameFromVisitor, sameFromOthers, visitor }
// Returns { verdict: 'allow'|'hold'|'block', message (for the visitor), reasons: [{ code, action, detail }] }
export function moderate(input, context = {}) {
  const text = String(input.text ?? '');
  const reasons = [];
  const lists = context.lists || prepareLists([]);
  const trimmed = text.trim();
  if (!trimmed) reasons.push({ code: 'empty', action: 'block', detail: 'no comment written', message: MESSAGES.empty });
  if (text.length > MAX_COMMENT) reasons.push({ code: 'too-long', action: 'block', detail: `${text.length} characters (the limit is ${MAX_COMMENT})`, message: MESSAGES.tooLong });
  if (input.name !== undefined) reasons.push(...checkName(input.name, { mediumNames: context.mediumNames || [], lists }));

  for (const w of findWords(text, lists)) {
    reasons.push({ code: 'word', action: w.action, category: w.category, detail: `${w.action === 'block' ? 'blocked' : 'held'} ${w.phrase.includes(' ') ? 'phrase' : 'word'} “${mask(w.shown)}” (${w.category || 'word list'}${w.how === 'word' || w.how === 'phrase' ? '' : ', ' + { disguised: 'disguised', masked: 'hidden with symbols', inside: 'inside another word', split: 'split up' }[w.how]})`, message: MESSAGES.language });
  }
  for (const l of findLinks(text)) {
    reasons.push(l.kind === 'maybe-link' ? { code: 'maybe-link', action: 'hold', detail: l.detail } : { code: l.kind, action: 'block', detail: 'contains ' + l.detail, message: MESSAGES.link });
  }
  for (const r of findScams(text)) reasons.push({ ...r, message: r.action === 'block' ? MESSAGES.advert : undefined });
  reasons.push(...findNoise(text));

  if (context.sameFromVisitor) reasons.push({ code: 'repeat', action: 'block', detail: 'this visitor has already posted the same comment', message: MESSAGES.repeat });
  else if (context.sameFromOthers) reasons.push({ code: 'copied', action: 'hold', detail: `the same wording was posted ${context.sameFromOthers} time${context.sameFromOthers === 1 ? '' : 's'} recently` });
  const v = context.visitor;
  if (v && v.always_hold) reasons.push({ code: 'visitor', action: 'hold', detail: 'Gary or Julie chose to check every comment from this visitor' });
  else if (v && v.hold_until && Date.parse(v.hold_until) > (context.now || Date.now())) reasons.push({ code: 'visitor', action: 'hold', detail: 'this visitor recently sent several blocked comments' });

  const verdict = reasons.reduce((a, r) => (rank[r.action] > rank[a] ? r.action : a), 'allow');
  const first = reasons.find((r) => r.action === 'block' && r.message);
  return { verdict, reasons, message: verdict === 'block' ? (first ? first.message : MESSAGES.language) : verdict === 'hold' ? MESSAGES.held : '' };
}
