'use strict';
/**
 * Loads the data files once and builds lookup indexes.
 * The routine's vendored validator bundles the same JSON files.
 */
const { NFC, stripVS, normForMatch, dncWordHash } = require('./text.js');

const RAW = {
  words: require('../data/words.json'),
  relations: require('../data/relations.json'),
  items: require('../data/items.json'),
  emoji: require('../data/emoji.json'),
  banned: require('../data/banned.json'),
  names: require('../data/names.json'),
  donotcopy: require('../data/donotcopy.json'),
  holidays: require('../data/holidays-2026-2030.json'),
};

let cache = null;
function lexicon() {
  if (cache) return cache;
  const W = RAW.words;
  const wordCats = new Map();            // word -> Set(category)
  const catGroup = new Map();            // category -> group
  const catNear = new Map();             // category -> Set(near categories)
  for (const [cat, def] of Object.entries(W.categories)) {
    catGroup.set(cat, def.group);
    catNear.set(cat, new Set(def.near || []));
    for (const w of def.words) {
      const k = NFC(w);
      if (!wordCats.has(k)) wordCats.set(k, new Set());
      wordCats.get(k).add(cat);
    }
  }
  const known = new Set([...wordCats.keys(), ...W.extra.map(NFC)]);
  const ambiguous = new Set(W.ambiguous.map(NFC));

  // relations: symmetric for synonym/antonym/opposite
  const SYM = new Set(['synonym', 'antonym', 'opposite']);
  const rel = new Set();
  const relWords = new Set();
  for (const [a, r, b] of RAW.relations.pairs) {
    rel.add(`${NFC(a)}|${r}|${NFC(b)}`);
    if (SYM.has(r)) rel.add(`${NFC(b)}|${r}|${NFC(a)}`);
    relWords.add(NFC(a)); relWords.add(NFC(b));
  }

  const emojiAll = new Set();
  const emojiGroup = new Map();
  for (const [g, list] of Object.entries(RAW.emoji.groups)) for (const e of list) { emojiAll.add(stripVS(e)); emojiGroup.set(stripVS(e), g); }
  for (const e of [...Object.keys(RAW.emoji.places), ...RAW.emoji.fills, RAW.emoji.empty, ...RAW.emoji.cues]) emojiAll.add(stripVS(e));
  const similarPairs = new Set();
  for (const [a, b] of RAW.emoji.similar) { similarPairs.add(stripVS(a) + '|' + stripVS(b)); similarPairs.add(stripVS(b) + '|' + stripVS(a)); }
  const places = new Map(Object.entries(RAW.emoji.places).map(([e, n]) => [stripVS(e), n]));

  const B = RAW.banned;
  const bannedItems = [];
  for (const cat of B.items) for (const w of B.categories[cat]) bannedItems.push({ cat, w: normForMatch(w) });
  const allowItems = B.allow.map(normForMatch);
  const bannedReport = B.report_banned.map((w) => ({ cat: 'report', w: normForMatch(w) }));
  for (const cat of ['politics', 'religion', 'violence', 'discrimination', 'adult', 'scary', 'brand', 'shaming']) {
    for (const w of B.categories[cat]) bannedReport.push({ cat, w: normForMatch(w) });
  }
  const allowReport = [...B.report_allow, ...B.allow].map(normForMatch);

  const names = new Set(RAW.names.allowed.map(NFC));
  const titles = new Set(RAW.names.titles.map(NFC));

  const D = RAW.donotcopy;
  const dncSets = D.wordSets.map((s) => ({ label: s.label, h: new Set(s.h) }));
  const dncStories = D.stories.map((s) => ({ label: s.label, g: new Set(s.g) }));
  const dncPatterns = D.patterns.map((p) => new RegExp(p, 'u'));

  const H = RAW.holidays;
  cache = {
    raw: RAW,
    wordCats, catGroup, catNear, known, ambiguous,
    rel, relWords, relTypes: new Set(RAW.relations.rels),
    items: RAW.items.items, itemGeneric: RAW.items.generic,
    emojiAll, emojiGroup, similarPairs, places, fills: new Set(RAW.emoji.fills.map(stripVS)), emptyCell: stripVS(RAW.emoji.empty), cues: new Set(RAW.emoji.cues.map(stripVS)),
    bannedItems, allowItems, bannedReport, allowReport, reportClosings: B.report_closings.map((s) => NFC(s)),
    names, titles, honorifics: RAW.names.honorifics,
    dncSets, dncStories, dncPatterns, dncWordHash,
    holidays: H,
  };
  return cache;
}

/** Categories of a word (Set) — empty Set if unknown. */
const catsOf = (lx, w) => lx.wordCats.get(NFC(w)) || new Set();
const shareCat = (lx, a, b) => { const A = catsOf(lx, a); for (const c of catsOf(lx, b)) if (A.has(c)) return true; return false; };
const hasRel = (lx, a, r, b) => lx.rel.has(`${NFC(a)}|${r}|${NFC(b)}`);

module.exports = { lexicon, catsOf, shareCat, hasRel };
