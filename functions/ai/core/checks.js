'use strict';
/** Cross-format text checks: banned words, PII shapes, do-not-copy fingerprints, near-duplicate sketches. */
const { NFC, normForMatch, trigrams, jaccard, dncWordHash, dncGramHash, sha256, compact } = require('./text.js');

/** First banned hit as 'banned:<cat>' or null. `kind` = 'items' | 'report'. */
function bannedHit(lx, text, kind = 'items') {
  let t = normForMatch(text);
  const allow = kind === 'report' ? lx.allowReport : lx.allowItems;
  for (const a of allow) if (a) t = t.split(a).join('\u0000');
  const list = kind === 'report' ? lx.bannedReport : lx.bannedItems;
  for (const { cat, w } of list) if (w && t.includes(w)) return 'banned:' + cat;
  return null;
}

const PII = [
  /0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/,          // phone
  /\d{6}[-\s]?[1-4]\d{6}/,                        // RRN
  /[가-힣]{2,10}(로|길)\s?\d{1,4}(-\d{1,4})?(?!\d|\s?(분|시|초|개|원|번째|번|명|칸|일|살|층|마리|송이|봉지|단|포기|모|판|통|병|켤레|장|대|권|잔|그릇|미터|킬로|시간|주|달|년|월|가지|퍼센트|%))/, // road address (not '버스로 40분')
  /\d{1,4}\s?동\s?\d{1,4}\s?호/,                   // apt dong/ho
  /아파트\s?\d{1,4}/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
  /https?:\/\/|www\.|\.(com|kr|net|org)\b/i,       // link
];
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경';
/** 'pii' | 'name' | null. Allowed character names come from names.json. */
function piiHit(lx, text) {
  const t = NFC(text);
  for (const re of PII) if (re.test(t)) return 'pii';
  // "○○ 씨" / "○○ 님": the ○○ must be an allowed character name (or a title such as 사장님)
  // A name is 2–3 syllables after a non-Hangul boundary, then 씨/님, then end, space, punctuation or a particle.
  const re = /(?:^|[^가-힣])([가-힣]{2,3})\s?(씨|님)(?=$|[^가-힣]|[은는이가와과의도를을에께])/g;
  const NOT_NAME = /(날|솜|말|맵|아저|글|마음|불|목소리|사장|선생|기사|손|아드|따|형|누|임금|하느|해|달|별|부처|주인|어르신|할머|할아버)$/;
  let m;
  while ((m = re.exec(t))) {
    const cand = m[1];
    if (lx.titles.has(cand) || lx.titles.has(cand + m[2]) || NOT_NAME.test(cand)) continue;
    if (lx.names.has(cand)) continue;
    if (cand.length === 3 && SURNAMES.includes(cand[0])) return 'name';   // surname + given name = a full name
    return 'name';
  }
  return null;
}

/** 'copy_risk' or null. words: target word list(s); story: long text; all: every text field joined. */
function doNotCopyHit(lx, { words = [], story = '', all = '' }) {
  for (const re of lx.dncPatterns) if (re.test(NFC(all))) return 'copy_risk';
  if (words.length) {
    const hs = new Set(words.map(dncWordHash));
    for (const s of lx.dncSets) {
      let n = 0;
      for (const h of s.h) if (hs.has(h)) n++;
      if (n >= Math.min(3, s.h.size)) return 'copy_risk';
    }
  }
  if (story) {
    const g = new Set([...trigrams(story)].map(dncGramHash));
    for (const s of lx.dncStories) if (jaccard(g, s.g) >= 0.5) return 'copy_risk';
  }
  return null;
}

// ------------------------------------------------- near-duplicate sketch
const K = 48;
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** MinHash sketch (K values, base-36 strings) of the trigram set of `text`. */
function sketch(text) {
  const grams = [...trigrams(text)];
  const out = [];
  for (let i = 0; i < K; i++) {
    let min = 0xffffffff;
    for (const g of grams) { const h = fnv(i + '\u0001' + g); if (h < min) min = h; }
    out.push(min.toString(36));
  }
  return out.join('.');
}
function sketchSim(a, b) {
  if (!a || !b) return 0;
  const x = a.split('.'), y = b.split('.');
  let same = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] === y[i]) same++;
  return same / Math.max(x.length, y.length);
}
const contentHash = (s) => sha256(compact(s));

module.exports = { bannedHit, piiHit, doNotCopyHit, sketch, sketchSim, contentHash };
