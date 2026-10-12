'use strict';
/**
 * Text helpers shared by the validator (server and the routine's vendored copy).
 * Pure: depends only on node:crypto and Intl. Never logs.
 */
const crypto = require('node:crypto');

const NFC = (s) => String(s == null ? '' : s).normalize('NFC');
const VS16 = /️/g;
const stripVS = (e) => String(e).replace(VS16, '');

/** Lower-noise form for substring matching: NFC, drop whitespace/punctuation, collapse ≥3 repeats to 2. */
function normForMatch(s) {
  return NFC(s)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/(.)\1{2,}/gu, '$1$1')
    .toLowerCase();
}
/** Compact form for hashing/dedupe: NFC, no whitespace. */
const compact = (s) => NFC(s).replace(/\s+/g, '');

const SEG = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const graphemes = (s) => [...SEG.segment(NFC(s))].map((x) => x.segment);

// ---------------------------------------------------------------- Hangul
const isSyllable = (ch) => { const c = ch.codePointAt(0); return c >= 0xac00 && c <= 0xd7a3; };
const isHangulWord = (w) => typeof w === 'string' && w.length > 0 && [...w].every(isSyllable);
function decompose(ch) {
  const c = ch.codePointAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return { cho: Math.floor(c / 588), jung: Math.floor((c % 588) / 28), jong: c % 28 };
}
/** Jamo sequence (as small ints, tagged by position) for edit distance. */
function jamoSeq(word) {
  const out = [];
  for (const ch of NFC(word)) {
    const d = decompose(ch);
    if (!d) { out.push('x' + ch); continue; }
    out.push('c' + d.cho, 'v' + d.jung);
    if (d.jong) out.push('j' + d.jong);
  }
  return out;
}
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const jamoDistance = (a, b) => editDistance(jamoSeq(a), jamoSeq(b));
/** True when the last syllable has a final consonant (받침). */
function hasBatchim(word) {
  const s = [...NFC(word).replace(/[^가-힣]/g, '')];
  if (!s.length) return null;
  return decompose(s[s.length - 1]).jong !== 0;
}
/** Syllables that differ from `t` in exactly one of (initial, vowel) and share the final. "닮은 글자". */
function isLookalike(t, ch) {
  const a = decompose(t), b = decompose(ch);
  if (!a || !b || t === ch || a.jong !== b.jong) return false;
  return (a.cho === b.cho) !== (a.jung === b.jung);
}

// ---------------------------------------------------------- n-grams/hash
function trigrams(s) {
  const t = normForMatch(s);
  const g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  if (!g.size && t) g.add(t);
  return g;
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const dncWordHash = (w) => sha256('bw-dnc-v1|w|' + normForMatch(w)).slice(0, 16);
const dncGramHash = (g) => sha256('bw-dnc-v1|g|' + g).slice(0, 16);

// --------------------------------------------------------------- charset
// Hangul syllables, digits, space and a small punctuation set. Emoji only through an allowlist.
const PUNCT = new Set([...'.,?!·~:()‘’“”\'"-_=…%']);
/**
 * Returns the list of disallowed graphemes in `s` (empty = ok).
 * `emoji` is a Set of allowed emoji (variation selectors stripped) or null for "no emoji".
 */
function badChars(s, emoji) {
  const bad = [];
  for (const g of graphemes(s)) {
    if (g === ' ') continue;
    if (g.length === 1 && (isSyllable(g) || /[0-9]/.test(g) || PUNCT.has(g))) continue;
    if (emoji && emoji.has(stripVS(g))) continue;
    bad.push(g);
  }
  return bad;
}
/** Visible length in graphemes (emoji = 1). */
const vlen = (s) => graphemes(s).length;

/** Count sentences: split on . ! ? and the Korean final '요.' pattern. */
function sentences(s) {
  return NFC(s).split(/(?<=[.!?。])\s*/).map((x) => x.trim()).filter(Boolean);
}

/** Deterministic PRNG from a string seed (mulberry32 over a 32-bit hash). */
function seededRng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleSeeded(arr, seed) {
  const a = arr.slice(), r = seededRng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = {
  NFC, stripVS, normForMatch, compact, graphemes, vlen, sentences,
  isSyllable, isHangulWord, decompose, jamoSeq, editDistance, jamoDistance, hasBatchim, isLookalike,
  trigrams, jaccard, sha256, dncWordHash, dncGramHash,
  badChars, PUNCT, seededRng, shuffleSeeded,
};
