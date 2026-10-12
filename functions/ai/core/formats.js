'use strict';
/**
 * Per-format checkers (DESIGN-AI Appendix A.1–A.22). Each checker gets a mutable `r` result:
 *   r.fail(code)          reject with a reason code (see REASONS in item.js)
 *   r.texts               every user-visible string (banned / PII / do-not-copy scanning)
 *   r.words               target word list (do-not-copy word sets, word-list overlap)
 *   r.story               long text for do-not-copy 3-gram check
 *   r.answer              the canonical answer token compared with qa.solve1/qa.solve2
 *   r.refOk               false when the item must stay training-only
 *   r.review              true when an admin must approve before use (reminiscence)
 *   r.fill                server-computed fields merged into the stored item (choices, options, prompt …)
 *   r.noSolve             true for formats without a single answer (qa.solve may be null)
 * Checkers never throw on bad input; they record a code and return.
 */
const { NFC, stripVS, vlen, graphemes, sentences, isHangulWord, isSyllable, jamoDistance, hasBatchim, isLookalike, normForMatch, badChars } = require('./text.js');
const { catsOf, shareCat, hasRel } = require('./lexicon.js');
const kd = require('./kdate.js');

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v, max, min = 1) => typeof v === 'string' && vlen(v) >= min && vlen(v) <= max;
const eq = (a, b) => NFC(a).replace(/\s+/g, '') === NFC(b).replace(/\s+/g, '');

// ------------------------------------------------------------ choices
/**
 * Validate a choices array: 3–6 entries, each {t ≤ 14, ok:true} or {t, err ∈ allowed}; exactly one ok;
 * all texts distinct. Returns the ok text or null.
 */
function checkChoices(r, choices, allowedErr, { min = 3, max = 6, maxLen = 14 } = {}) {
  if (!Array.isArray(choices) || choices.length < min || choices.length > max) { r.fail('choices'); return null; }
  const seen = new Set(); let ok = null, nOk = 0;
  for (const c of choices) {
    if (!c || typeof c !== 'object' || !isStr(c.t, maxLen)) { r.fail('length'); return null; }
    const k = NFC(c.t).replace(/\s+/g, '');
    if (seen.has(k)) { r.fail('choices'); return null; }
    seen.add(k);
    r.texts.push(c.t);
    if (c.ok === true) { nOk++; ok = c.t; if (c.err != null) { r.fail('errcode'); return null; } }
    else if (!allowedErr.includes(c.err)) { r.fail('errcode'); return null; }
  }
  if (nOk !== 1) { r.fail('answer'); return null; }
  return ok;
}
const wrongs = (choices) => choices.filter((c) => c.ok !== true);

// ---------------------------------------------------------------- money
const parseWon = (s) => { const m = /^(\d{1,3}(?:,\d{3})+|\d{1,3})원$/.exec(NFC(s).replace(/\s+/g, '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const won = (n) => n.toLocaleString('en-US') + '원';

// ----------------------------------------------------------------- time
function parseKoTime(s) {
  const t = NFC(s).replace(/\s+/g, '');
  let m = /^(오전|오후)(\d{1,2})시(?:(\d{1,2})분|(반))?$/.exec(t);
  if (m) {
    let h = Number(m[2]); const mi = m[4] ? 30 : Number(m[3] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    if (m[1] === '오전') h = h === 12 ? 0 : h; else h = h === 12 ? 12 : h + 12;
    return h * 60 + mi;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const parseHHMM = (s) => (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);
function koTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? '오전' : '오후', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}시${m ? ` ${m}분` : ''}`;
}

// ---------------------------------------------------------------- grids
const gridKey = (g) => g.map((row) => row.map(stripVS).join('')).join('/');
function validGrid(lx, g, n, allowAnyEmoji = true) {
  if (!Array.isArray(g) || g.length !== n) return false;
  return g.every((row) => Array.isArray(row) && row.length === n && row.every((c) => typeof c === 'string' && (allowAnyEmoji ? lx.emojiAll.has(stripVS(c)) : (lx.fills.has(stripVS(c)) || stripVS(c) === lx.emptyCell))));
}
const clone = (g) => g.map((r) => r.slice());
const rot90 = (g) => { const n = g.length; return g.map((_, r) => g.map((__, c) => g[n - 1 - c][r])); };
const flipH = (g) => g.map((r) => r.slice().reverse());
const rotN = (g, k) => { let x = g; for (let i = 0; i < ((k % 4) + 4) % 4; i++) x = rot90(x); return x; };
const countFilled = (lx, g) => g.flat().filter((c) => stripVS(c) !== lx.emptyCell).length;

function applyRule(lx, g, rule, history) {
  const n = g.length;
  switch (rule && rule.op) {
    case 'shift': {
      const dx = rule.dx | 0, dy = rule.dy | 0;
      if (rule.wrap === 'torus') {
        const out = g.map((r) => r.map(() => lx.emptyCell));
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[(r + dy + n * 4) % n][(c + dx + n * 4) % n] = g[r][c];
        return out;
      }
      const flat = g.flat(), N = n * n, k = (((dy * n + dx) % N) + N) % N, out = new Array(N);
      for (let i = 0; i < N; i++) out[(i + k) % N] = flat[i];
      return Array.from({ length: n }, (_, r) => out.slice(r * n, r * n + n));
    }
    case 'rotate90': return rot90(g);
    case 'grow': {
      const fill = stripVS(rule.fill || '');
      if (!lx.emojiAll.has(fill)) return null;
      const out = clone(g);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (stripVS(out[r][c]) === lx.emptyCell) { out[r][c] = rule.fill; return out; }
      return null;
    }
    case 'alternate': return history && history.length >= 2 ? clone(history[history.length - 2]) : null;
    default: return null;
  }
}
function applyRules(lx, g, rules, history) {
  let x = g;
  for (const rl of rules) { x = applyRule(lx, x, rl, history); if (!x) return null; }
  return x;
}

// ================================================================ formats
const F = {};

// A.1 word_recog -----------------------------------------------------------
const WR = { 1: [3, 6, 0, 0], 2: [4, 8, 0, 0], 3: [5, 10, 1, 0], 4: [6, 12, 2, 0], 5: [7, 14, 2, 1] };
F.word_recog = {
  cd: 'memory', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const targets = b.targets, foils = b.foils;
    if (!Array.isArray(targets) || !Array.isArray(foils)) return r.fail('field');
    if (targets.some((w) => !isHangulWord(w) || vlen(w) < 1 || vlen(w) > 5) || foils.some((x) => !x || !isHangulWord(x.t) || vlen(x.t) > 5)) return r.fail('lexicon');
    const all = [...targets, ...foils.map((x) => x.t)].map(NFC);
    if (new Set(all).size !== all.length) return r.fail('choices');
    const sem = foils.filter((x) => x.err === 'INTR_SEM').length, phon = foils.filter((x) => x.err === 'INTR_PHON').length;
    if (f.targets !== targets.length || f.total !== all.length || f.semFoils !== sem || f.phonFoils !== phon || typeof f.delayed !== 'boolean') return r.fail('features');
    const T = WR[it.level];
    const strict = it.role !== 'training';
    if (strict ? (targets.length !== T[0] || all.length !== T[1] || sem < T[2] || phon < T[3]) : Math.abs(targets.length - T[0]) > 1) return r.fail('level');
    for (const x of foils) {
      if (!['INTR_SEM', 'INTR_PHON', 'INTR_UNREL'].includes(x.err)) return r.fail('errcode');
      const anyShare = targets.some((t) => shareCat(lx, t, x.t));
      if (x.err === 'INTR_SEM') {
        if (!catsOf(lx, x.t).size) { if (strict) return r.fail('lexicon'); r.refOk = false; } else if (!anyShare) return r.fail('errcode');
      } else if (x.err === 'INTR_PHON') {
        if (!targets.some((t) => jamoDistance(t, x.t) <= 2 && !shareCat(lx, t, x.t))) return r.fail('errcode');
      } else if (anyShare) return r.fail('errcode');
    }
    if (it.level <= 3) {
      const cats = new Map();
      targets.forEach((t) => catsOf(lx, t).forEach((c) => cats.set(c, (cats.get(c) || 0) + 1)));
      if ([...cats.values()].some((n) => n / targets.length > 0.6)) return r.fail('level');
    }
    if (all.some((w) => !lx.known.has(NFC(w)) || lx.ambiguous.has(NFC(w)))) { if (strict) return r.fail('lexicon'); r.refOk = false; }
    r.words.push(...targets); r.texts.push(...all, b.theme || '');
    r.answer = targets.join(',');
  },
};

// A.2 card_theme -----------------------------------------------------------
F.card_theme = {
  cd: 'memory', ref: false,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const cards = b.cards;
    if (!Array.isArray(cards) || cards.length < 6 || cards.length > 20) return r.fail('field');
    const es = new Set(), ns = new Set();
    for (const c of cards) {
      if (!Array.isArray(c) || c.length !== 2 || !lx.emojiAll.has(stripVS(c[0])) || !isHangulWord(c[1]) || vlen(c[1]) > 4) return r.fail('emoji');
      es.add(stripVS(c[0])); ns.add(NFC(c[1]));
    }
    if (es.size !== cards.length || ns.size !== cards.length) return r.fail('choices');
    const sim = Array.isArray(b.similar) ? b.similar : [];
    for (const p of sim) {
      if (!Array.isArray(p) || !isInt(p[0], 0, cards.length - 1) || !isInt(p[1], 0, cards.length - 1)) return r.fail('field');
      const a = stripVS(cards[p[0]][0]), c = stripVS(cards[p[1]][0]);
      if (!lx.similarPairs.has(a + '|' + c) && lx.emojiGroup.get(a) !== lx.emojiGroup.get(c)) return r.fail('features');
    }
    if (f.cards !== cards.length || f.similarPairs !== sim.length) return r.fail('features');
    r.texts.push(...cards.map((c) => c[1]), b.theme || '');
    r.words.push(...cards.map((c) => c[1]));
    r.noSolve = true;
  },
};

// A.3 emoji_set ------------------------------------------------------------
F.emoji_set = {
  cd: 'attention', ref: false,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    if (!Array.isArray(b.pairs) || b.pairs.length < 3 || b.pairs.length > 12 || !isInt(f.sim, 1, 3)) return r.fail('field');
    const seen = new Set();
    for (const p of b.pairs) {
      if (!Array.isArray(p) || p.length !== 2) return r.fail('field');
      const [a, c] = p.map(stripVS);
      if (!lx.emojiAll.has(a) || !lx.emojiAll.has(c)) return r.fail('emoji');
      if (a === c) return r.fail('choices');
      const k = [a, c].sort().join('|'); if (seen.has(k)) return r.fail('choices'); seen.add(k);
      const sameGroup = lx.emojiGroup.get(a) === lx.emojiGroup.get(c);
      const sim = lx.similarPairs.has(a + '|' + c) ? 3 : sameGroup ? 2 : 1;
      if (sim !== f.sim) return r.fail('features');
    }
    if (b.category != null && !isStr(b.category, 20)) return r.fail('length');
    if (b.category) r.texts.push(b.category);
    r.noSolve = true;
  },
};

// A.4 date_q ---------------------------------------------------------------
const DATE_TYPES = ['weekday_of', 'date_of', 'holiday_of', 'season_of', 'days_until'];
F.date_q = {
  cd: 'orientation', ref: false,
  check(it, r, ctx) {
    const q = (it.body || {}).query;
    if (!q || !DATE_TYPES.includes(q.type) || (it.features || {}).type !== q.type) return r.fail('features');
    if (!kd.okYmd(it.validFrom) || !kd.okYmd(it.validTo) || it.validFrom > it.validTo || kd.daysBetween(it.validFrom, it.validTo) > 13) return r.fail('date_window');
    if (ctx.today && it.validTo < ctx.today) return r.fail('date_window');
    let first = null;
    for (let d = it.validFrom; d <= it.validTo; d = kd.addDays(d, 1)) {
      const s = kd.solveDateQ(q, d, ctx.lx.holidays);
      if (s.error) return r.fail(s.error);
      if (first && s.answer !== first.answer) return r.fail('date_window');
      first = first || s;
    }
    r.answer = first.answer;
    r.fill.choices = dateChoices(first, it.validFrom, ctx);
    r.texts.push(...r.fill.choices.map((c) => c.t));
  },
};
function dateChoices(s, today, ctx) {
  const out = [{ t: s.answer, ok: true }];
  const add = (t, err) => { if (t && !out.some((c) => c.t === t)) out.push({ t, err }); };
  if (s.kind === 'weekday') {
    const i = kd.WD.indexOf(s.answer);
    add(kd.WD[(i + 6) % 7], 'DATE_NEAR'); add(kd.WD[(i + 1) % 7], 'DATE_NEAR'); add(kd.WD[(i + 3) % 7], 'DATE_WEEKDAY');
  } else if (s.kind === 'date') {
    add(kd.koDate(kd.addDays(s.date, -1), false), 'DATE_NEAR'); add(kd.koDate(kd.addDays(s.date, 1), false), 'DATE_NEAR'); add(kd.koDate(kd.addDays(s.date, 7), false), 'DATE_WEEKDAY');
  } else if (s.kind === 'days') {
    add(`${s.n + 1}일`, 'DATE_NEAR'); if (s.n > 1) add(`${s.n - 1}일`, 'DATE_NEAR'); add(`${s.n + 7}일`, 'DATE_WEEKDAY'); add(`${s.n + 2}일`, 'DATE_NEAR');
  } else if (s.kind === 'season') {
    const S = ['봄', '여름', '가을', '겨울'], i = S.indexOf(s.answer);
    add(S[(i + 1) % 4], 'SEASON'); add(S[(i + 3) % 4], 'SEASON'); add(S[(i + 2) % 4], 'SEASON');
  } else {
    const H = kd.holidayIndex(ctx.lx.holidays);
    const near = [];
    for (let k = 1; k <= 60 && near.length < 6; k++) for (const d of [kd.addDays(s.date, -k), kd.addDays(s.date, k)]) {
      for (const h of H.byDate.get(d) || []) { const n = h.name.replace(/ 연휴$/, ''); if (h.kind !== 'substitute' && n !== s.answer && !near.includes(n)) near.push(n); }
    }
    near.slice(0, 2).forEach((n) => add(n, 'DATE_NEAR'));
    add('특별한 날 아님', 'DATE_WEEKDAY');
  }
  return out.slice(0, 4);
}

// A.5 lang_complete --------------------------------------------------------
F.lang_complete = {
  cd: 'language', ref: false,
  check(it, r) {
    const b = it.body || {};
    if (!isStr(b.sentence, 60) || !isStr(b.answer, 14)) return r.fail('field');
    const blanks = NFC(b.sentence).match(/_{2,}/g) || [];
    if (blanks.length !== 1) return r.fail('field');
    const ok = checkChoices(r, it.choices, ['SEM_NEAR', 'SEM_FAR', 'PHON'], { min: 3, max: 4 });
    if (ok == null) return;
    if (!eq(ok, b.answer)) return r.fail('answer');
    const after = NFC(b.sentence).split(/_{2,}/)[1] || '';
    if (/^(을|를|이|가|은|는|과|와)(?!\()/.test(after)) {
      const want = hasBatchim(b.answer);
      if (it.choices.some((c) => hasBatchim(c.t) !== want)) return r.fail('particle');
    }
    r.texts.push(b.sentence); r.answer = ok;
  },
};

// A.6 lang_relation --------------------------------------------------------
F.lang_relation = {
  cd: 'language', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {};
    if (!isStr(b.word, 8) || !['synonym', 'antonym'].includes(b.rel) || !isStr(b.answer, 14)) return r.fail('field');
    const ok = checkChoices(r, it.choices, ['SEM_NEAR', 'SEM_FAR', 'PHON', 'REL_REVERSE', 'REL_WRONG'], { min: 3, max: 4 });
    if (ok == null) return;
    if (!eq(ok, b.answer)) return r.fail('answer');
    if (!NFC(it.prompt || '').includes(NFC(b.word))) return r.fail('field');
    for (const c of wrongs(it.choices)) if (hasRel(lx, b.word, b.rel, c.t)) return r.fail('answer');
    if (!hasRel(lx, b.word, b.rel, b.answer)) r.refOk = false;
    r.texts.push(b.word); r.answer = ok;
  },
};

// A.7 lang_category --------------------------------------------------------
F.lang_category = {
  cd: 'language', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {};
    if (!isStr(b.category, 12) || !['pick', 'odd_one_out'].includes(b.mode)) return r.fail('field');
    const ok = checkChoices(r, it.choices, ['SEM_NEAR', 'SEM_FAR', 'PHON'], { min: 3, max: 4 });
    if (ok == null) return;
    const want = it.level === 1 ? 3 : 4;
    if (it.choices.length !== want) return r.fail('level');
    const known = lx.catGroup.has(b.category);
    const inCat = (w) => catsOf(lx, w).has(b.category);
    const words = it.choices.map((c) => c.t);
    if (words.some((w) => lx.ambiguous.has(NFC(w)))) return r.fail('lexicon');
    if (!NFC(it.prompt || '').includes(NFC(b.category))) return r.fail('field');
    if (b.mode === 'odd_one_out') {
      if (!Array.isArray(b.members) || !eq(b.odd || '', ok)) return r.fail('answer');
      const members = wrongs(it.choices).map((c) => c.t);
      if (members.length !== b.members.length || !members.every((m) => b.members.some((x) => eq(x, m)))) return r.fail('field');
      if (known) {
        if (!members.every(inCat) || inCat(ok)) return r.fail('recompute');
        if (!catsOf(lx, ok).size) r.refOk = false;
      } else r.refOk = false;
    } else {
      if (!eq(b.answer || '', ok)) return r.fail('answer');
      if (known) {
        if (!inCat(ok) || wrongs(it.choices).some((c) => inCat(c.t))) return r.fail('recompute');
        if (wrongs(it.choices).some((c) => !catsOf(lx, c.t).size)) r.refOk = false;
      } else r.refOk = false;
    }
    if (it.level === 5 && !known) r.refOk = false;
    r.texts.push(b.category); r.answer = ok;
  },
};

// A.8 word_find ------------------------------------------------------------
F.word_find = {
  cd: 'language', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {};
    if (!isStr(b.desc, 60) || !isStr(b.answer, 14)) return r.fail('field');
    const ok = checkChoices(r, it.choices, ['SEM_NEAR', 'SEM_FAR', 'PHON'], { min: 3, max: 4 });
    if (ok == null) return;
    if (!eq(ok, b.answer)) return r.fail('answer');
    if (normForMatch(b.desc).includes(normForMatch(b.answer)) || normForMatch(it.prompt || '').includes(normForMatch(b.answer))) return r.fail('answer_leak');
    if (!lx.known.has(NFC(b.answer)) || lx.ambiguous.has(NFC(b.answer))) r.refOk = false;
    r.texts.push(b.desc); r.answer = ok;
  },
};

// A.9 analogy --------------------------------------------------------------
F.analogy = {
  cd: 'language', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {};
    if (!['a', 'b', 'c', 'answer'].every((k) => isStr(b[k], 8)) || !lx.relTypes.has(b.rel) || ['synonym', 'antonym'].includes(b.rel)) return r.fail('field');
    const ok = checkChoices(r, it.choices, ['REL_WRONG', 'REL_REVERSE', 'SEM_NEAR', 'SEM_FAR', 'PHON'], { min: 3, max: 4 });
    if (ok == null) return;
    if (!eq(ok, b.answer)) return r.fail('answer');
    const p = NFC(it.prompt || '');
    if (![b.a, b.b, b.c].every((w) => p.includes(NFC(w)))) return r.fail('field');
    for (const c of wrongs(it.choices)) if (hasRel(lx, b.c, b.rel, c.t)) return r.fail('answer');
    if (!(hasRel(lx, b.a, b.rel, b.b) && hasRel(lx, b.c, b.rel, b.answer))) r.refOk = false;
    r.answer = ok;
  },
};

// A.10 shop_calc -----------------------------------------------------------
function shopTotals(b) {
  const lineCost = (l, deal, mode) => {
    const qty = mode === 'noqty' ? 1 : l.qty;
    let n = qty * l.price;
    if (deal && mode !== 'nodeal' && (deal.item == null || deal.item === l.item)) {
      if (deal.type === 'bogo') n = Math.ceil(qty / 2) * l.price;
      else if (deal.type === 'pct') n = n * (100 - deal.pct) / 100;
    }
    return n;
  };
  const sum = (mode, skip = -1) => {
    let s = 0, idx = 0;
    for (const sh of b.shops) for (const l of sh.lines) { if (idx++ !== skip) s += lineCost(l, sh.deal, mode); }
    return s;
  };
  const nLines = b.shops.reduce((a, s) => a + s.lines.length, 0);
  const skips = []; for (let i = 0; i < nLines; i++) skips.push(sum('full', i));
  return { full: sum('full'), noqty: sum('noqty'), nodeal: sum('nodeal'), skips, nLines };
}
F.shop_calc = {
  cd: 'executive', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    if (!Array.isArray(b.shops) || b.shops.length < 1 || b.shops.length > 2 || !['total', 'change'].includes(b.ask)) return r.fail('field');
    let maxQty = 0, deals = 0;
    for (const sh of b.shops) {
      if (!isStr(sh.name, 10) || !Array.isArray(sh.lines) || sh.lines.length < 1 || sh.lines.length > 4) return r.fail('field');
      r.texts.push(sh.name);
      if (sh.deal != null) {
        deals++;
        const d = sh.deal;
        if (!(d.type === 'bogo' || (d.type === 'pct' && [10, 20, 50].includes(d.pct)))) return r.fail('field');
        if (d.item != null && !sh.lines.some((l) => l.item === d.item)) return r.fail('field');
      }
      for (const l of sh.lines) {
        if (!isStr(l.item, 8) || !isInt(l.price, 100, 200000) || l.price % 100 || !isInt(l.qty, 1, 5) || (l.unit != null && !isStr(l.unit, 4))) return r.fail('field');
        const known = lx.items[NFC(l.item)];
        if (known) { if (l.price < known.min || l.price > known.max) return r.fail('price'); }
        else { r.refOk = false; if (l.price < lx.itemGeneric.min || l.price > lx.itemGeneric.max) return r.fail('price'); }
        maxQty = Math.max(maxQty, l.qty);
        r.texts.push(l.item, l.unit || '');
      }
    }
    const T = shopTotals(b);
    if (!Number.isInteger(T.full)) return r.fail('recompute');
    if (b.ask === 'change' && (!isInt(b.pay, 1000, 500000) || b.pay <= T.full)) return r.fail('recompute');
    if (f.lines !== T.nLines || f.shops !== b.shops.length || f.maxQty !== maxQty || f.deals !== deals || f.ask !== b.ask) return r.fail('features');
    const L = it.level;
    const lvlOk = L === 1 ? T.nLines === 2 && b.shops.length === 1 && maxQty === 1 && !deals && b.ask === 'total'
      : L === 2 ? T.nLines === 2 && b.shops.length === 1 && maxQty === 1 && !deals
        : L === 3 ? T.nLines === 3 && b.shops.length === 1 && maxQty <= 2 && !deals
          : L === 4 ? b.shops.length === 2 && maxQty <= 3 && deals === 1
            : b.shops.length === 2 && b.ask === 'change';
    if (!lvlOk) return r.fail('level');
    if (L <= 1 && T.full % 500) return r.fail('level');
    const ok = checkChoices(r, it.choices, ['CALC_NOQTY', 'CALC_DEAL_IGNORED', 'CALC_SUM_AS_CHANGE', 'CALC_STEP_SKIP', 'CALC_NEAR', 'CALC_FAR'], { min: 3, max: 4 });
    if (ok == null) return;
    const toAns = (total) => (b.ask === 'change' ? b.pay - total : total);
    const ans = toAns(T.full);
    if (it.choices.some((c) => parseWon(c.t) == null)) return r.fail('format_money');
    if (parseWon(ok) !== ans) return r.fail('recompute');
    for (const c of wrongs(it.choices)) {
      const v = parseWon(c.t);
      const okErr = c.err === 'CALC_NOQTY' ? v === toAns(T.noqty) && T.noqty !== T.full
        : c.err === 'CALC_DEAL_IGNORED' ? deals > 0 && v === toAns(T.nodeal) && T.nodeal !== T.full
          : c.err === 'CALC_SUM_AS_CHANGE' ? b.ask === 'change' && v === T.full
            : c.err === 'CALC_STEP_SKIP' ? T.skips.some((s) => toAns(s) === v)
              : c.err === 'CALC_NEAR' ? v !== ans && Math.abs(v - ans) <= Math.max(100, ans * 0.1)
                : c.err === 'CALC_FAR' ? v > 0 && Math.abs(v - ans) > ans * 0.1 : false;
      if (!okErr) return r.fail('errcode');
    }
    // digits in the prompt must be amounts that appear in the body
    const nums = new Set([b.pay, ...b.shops.flatMap((s) => s.lines.flatMap((l) => [l.price, l.qty]))].filter((x) => x != null).map(String));
    for (const m of NFC(it.prompt || '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+/g) || []) if (!nums.has(m)) return r.fail('prompt_numbers');
    if (b.scene != null) { if (!isStr(b.scene, 20)) return r.fail('length'); r.texts.push(b.scene); }
    r.answer = ok;
  },
};

// A.11 sequence ------------------------------------------------------------
F.sequence = {
  cd: 'executive', ref: true,
  check(it, r) {
    const b = it.body || {}, f = it.features || {};
    if (!['procedure', 'story'].includes(b.kind) || !Array.isArray(b.steps) || b.steps.length < 3 || b.steps.length > 6 || !isStr(b.title, 16)) return r.fail('field');
    if (b.steps.some((s) => !isStr(s, 22))) return r.fail('length');
    if (new Set(b.steps.map((s) => NFC(s))).size !== b.steps.length) return r.fail('choices');
    const n = b.steps.length;
    if (!Array.isArray(b.before) || b.before.some((x) => !Array.isArray(x) || !isInt(x[0], 0, n - 1) || !isInt(x[1], 0, n - 1) || x[0] === x[1])) return r.fail('field');
    for (let i = 0; i + 1 < n; i++) if (!b.before.some((x) => x[0] === i && x[1] === i + 1)) return r.fail('unique');
    if (b.before.some((x) => x[0] > x[1])) return r.fail('recompute');
    const intr = b.intruder != null;
    if (intr && (!isStr(b.intruder, 22) || b.steps.some((s) => eq(s, b.intruder)))) return r.fail('field');
    if (f.steps !== n || f.intruder !== intr) return r.fail('features');
    if (it.level === 5 && !intr) return r.fail('level');
    if (b.kind === 'story') r.refOk = false;
    b.before.forEach((x) => { if (x[2] != null && !isStr(x[2], 30)) r.fail('length'); });
    r.texts.push(b.title, ...b.steps, b.intruder || '', ...b.before.map((x) => x[2] || ''));
    r.answer = b.steps.join('>');
  },
};

// A.12 schedule ------------------------------------------------------------
F.schedule = {
  cd: 'executive', ref: true,
  check(it, r) {
    const b = it.body || {};
    if (!['latest_departure', 'arrival_time', 'free_slot', 'overlap'].includes(b.ask) || !Array.isArray(b.events) || b.events.length < 1 || b.events.length > 4) return r.fail('field');
    for (const e of b.events) { if (!isStr(e.what, 12) || parseHHMM(e.at) == null || (e.durMin != null && !isInt(e.durMin, 5, 480))) return r.fail('field'); r.texts.push(e.what); }
    const nums = new Set();
    const addT = (m) => { nums.add(String(Math.floor(m / 60))); nums.add(String(Math.floor(m / 60) % 12 || 12)); nums.add(String(m % 60)); };
    b.events.forEach((e) => { addT(parseHHMM(e.at)); if (e.durMin) nums.add(String(e.durMin)); });
    let ans, near = [], errs = {};
    if (b.ask === 'latest_departure' || b.ask === 'arrival_time') {
      if (!isInt(b.travelMin, 5, 240) || (b.bufferMin != null && !isInt(b.bufferMin, 0, 60))) return r.fail('field');
      nums.add(String(b.travelMin)); if (b.bufferMin) nums.add(String(b.bufferMin));
      if (b.ask === 'latest_departure') {
        const at = parseHHMM(b.events[0].at), buf = b.bufferMin || 0;
        ans = at - b.travelMin - buf;
        errs = { TIME_BUFFER_SKIP: buf ? at - b.travelMin : null, TIME_DIR: at + b.travelMin };
      } else {
        const dep = parseHHMM(b.departAt); if (dep == null) return r.fail('field');
        addT(dep);
        ans = dep + b.travelMin; errs = { TIME_DIR: dep - b.travelMin };
      }
    } else if (b.ask === 'free_slot') {
      const from = parseHHMM(b.from), to = parseHHMM(b.to);
      if (from == null || to == null || from >= to || !isInt(b.needMin, 10, 240) || b.events.some((e) => !e.durMin)) return r.fail('field');
      addT(from); addT(to); nums.add(String(b.needMin));
      const busy = (s) => b.events.some((e) => { const a = parseHHMM(e.at); return s < a + e.durMin && a < s + b.needMin; });
      const fits = (s) => s >= from && s + b.needMin <= to && !busy(s);
      ans = null; for (let s = from; s + b.needMin <= to; s += 5) if (fits(s)) { ans = s; break; }
      if (ans == null) return r.fail('recompute');
      errs = { fits };
    } else {
      const ne = b.newEvent || {}; const s = parseHHMM(ne.at);
      if (s == null || !isInt(ne.durMin, 5, 480) || !isStr(ne.what, 12) || b.events.some((e) => !e.durMin)) return r.fail('field');
      addT(s); nums.add(String(ne.durMin)); r.texts.push(ne.what);
      const hits = b.events.filter((e) => { const a = parseHHMM(e.at); return s < a + e.durMin && a < s + ne.durMin; });
      if (hits.length !== 1) return r.fail('unique');
      const ok = checkChoices(r, it.choices, ['TIME_DIR', 'CALC_NEAR', 'CALC_FAR'], { min: 2, max: 4 });
      if (ok == null) return;
      if (!eq(ok, hits[0].what)) return r.fail('recompute');
      if (wrongs(it.choices).some((c) => !b.events.some((e) => eq(e.what, c.t)))) return r.fail('errcode');
      r.answer = ok; return checkPromptNums(r, it, nums);
    }
    if (ans < 0 || ans >= 24 * 60) return r.fail('recompute');
    const ok = checkChoices(r, it.choices, ['TIME_BUFFER_SKIP', 'TIME_DIR', 'CALC_NEAR', 'CALC_FAR'], { min: 3, max: 4 });
    if (ok == null) return;
    if (it.choices.some((c) => parseKoTime(c.t) == null)) return r.fail('format_time');
    if (parseKoTime(ok) !== ans) return r.fail('recompute');
    for (const c of wrongs(it.choices)) {
      const v = parseKoTime(c.t);
      const good = c.err === 'TIME_BUFFER_SKIP' ? errs.TIME_BUFFER_SKIP != null && v === errs.TIME_BUFFER_SKIP
        : c.err === 'TIME_DIR' ? v === errs.TIME_DIR
          : c.err === 'CALC_NEAR' ? v !== ans && Math.abs(v - ans) <= 15 && !(errs.fits && errs.fits(v))
            : c.err === 'CALC_FAR' ? Math.abs(v - ans) > 15 && !(errs.fits && errs.fits(v)) : false;
      if (!good) return r.fail('errcode');
    }
    r.answer = ok;
    checkPromptNums(r, it, nums);
  },
};
function checkPromptNums(r, it, nums) {
  for (const m of NFC(it.prompt || '').match(/\d+/g) || []) if (!nums.has(String(Number(m)))) return r.fail('prompt_numbers');
}

// A.13 logic ---------------------------------------------------------------
const ATTR = { 키: ['크', '작'], 나이: ['많', '적'], 몸무게: ['무거', '가벼'], 달리기: ['빠르', '느리'] };
function perms(a) { if (a.length <= 1) return [a.slice()]; const out = []; a.forEach((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).forEach((p) => out.push([x, ...p]))); return out; }
function logicSolve(b) {
  const E = b.entities;
  if (b.type === 'order' || b.type === 'position') {
    const holds = (p, f) => {
      const i = p.indexOf(f[0]), j = f.length > 2 ? p.indexOf(f[2]) : -1;
      switch (f[1]) {
        case '>': return i < j;            // order: index 0 = largest
        case '<': return i > j;
        case 'left_of': return i < j;
        case 'right_of': return i > j;
        case 'next_to': return Math.abs(i - j) === 1;
        case 'first': return i === 0;
        case 'last': return i === p.length - 1;
        default: return null;
      }
    };
    const ok = perms(E).filter((p) => b.facts.every((f) => holds(p, f) === true));
    const pick = (p, ask) => (ask === 'max' || ask === 'first' ? p[0] : ask === 'min' || ask === 'last' ? p[p.length - 1] : ask === 'middle' && p.length % 2 ? p[(p.length - 1) / 2] : null);
    const answers = new Set(ok.map((p) => pick(p, b.ask)));
    const opp = { max: 'min', min: 'max', first: 'last', last: 'first' }[b.ask];
    const reverse = opp ? new Set(ok.map((p) => pick(p, opp))) : new Set();
    return { n: ok.length, answer: answers.size === 1 ? [...answers][0] : null, reverse: reverse.size === 1 ? [...reverse][0] : null };
  }
  if (b.type === 'set') {
    const isA = new Map(); const all = []; const none = [];
    for (const f of b.facts) {
      if (f[0] === 'all') all.push([f[1], f[2]]); else if (f[0] === 'none') none.push([f[1], f[2]]);
      else if (f[0] === 'is') { if (!isA.has(f[1])) isA.set(f[1], new Set()); isA.get(f[1]).add(f[2]); } else return { n: 0 };
    }
    const [, x, C] = b.ask; const cats = new Set(isA.get(x) || []);
    for (let changed = true; changed;) { changed = false; for (const [A, B] of all) if (cats.has(A) && !cats.has(B)) { cats.add(B); changed = true; } }
    if (cats.has(C)) return { n: 1, answer: '네', reverse: '아니요' };
    if (none.some(([A, B]) => (cats.has(A) && B === C) || (cats.has(B) && A === C))) return { n: 1, answer: '아니요', reverse: '네' };
    return { n: 1, answer: '알 수 없어요', reverse: null };
  }
  return { n: 0 };
}
const josa = (w, a, b) => w + (hasBatchim(w) ? a : b);
function logicPrompt(b) {
  if (b.type !== 'order' || !ATTR[b.attr]) return null;
  const [big, small] = ATTR[b.attr];
  const bigV = { 크: '커요', 많: '많아요', 무거: '무거워요', 빠르: '빨라요' }[big];
  const smallQ = { 작: '작을까요', 적: '적을까요', 가벼: '가벼울까요', 느리: '느릴까요' }[small];
  const bigQ = { 크: '클까요', 많: '많을까요', 무거: '무거울까요', 빠르: '빠를까요' }[big];
  const subj = b.attr === '달리기' ? '달리기가' : josa(b.attr, '이', '가');
  const s = b.facts.map((f) => (f[1] === '>' ? `${josa(f[0], '은', '는')} ${f[2]}보다 ${subj} ${bigV}` : `${josa(f[2], '은', '는')} ${f[0]}보다 ${subj} ${bigV}`));
  const q = b.ask === 'min' ? `누가 가장 ${smallQ}?` : b.ask === 'max' ? `누가 가장 ${bigQ}?` : null;
  if (!q) return null;
  return s.join('. ') + '. ' + q;
}
F.logic = {
  cd: 'executive', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    if (!['order', 'position', 'set'].includes(b.type) || !Array.isArray(b.facts) || b.facts.length < 1 || b.facts.length > 6) return r.fail('field');
    if (b.type !== 'set') {
      if (!Array.isArray(b.entities) || b.entities.length < 3 || b.entities.length > 5 || new Set(b.entities).size !== b.entities.length) return r.fail('field');
      if (b.entities.some((e) => !lx.names.has(NFC(e)))) return r.fail('name');
      if (!['min', 'max', 'middle', 'first', 'last'].includes(b.ask)) return r.fail('field');
      if (b.facts.some((x) => !Array.isArray(x) || !b.entities.includes(x[0]) || (x.length > 2 && !b.entities.includes(x[2])))) return r.fail('field');
      const p = NFC(it.prompt || '');
      if (!b.entities.every((e) => p.includes(NFC(e)))) return r.fail('field');
    } else if (!Array.isArray(b.ask) || b.ask[0] !== 'is') return r.fail('field');
    if (b.type === 'order' && !ATTR[b.attr]) r.refOk = false;
    if (b.type !== 'order') r.refOk = r.refOk && b.type === 'position';
    const s = logicSolve(b);
    if (!s.n || s.answer == null) return r.fail('unique');
    if (f.people !== (b.entities || []).length || f.facts !== b.facts.length) return r.fail('features');
    const ok = checkChoices(r, it.choices, ['LOGIC_REVERSE', 'LOGIC_PARTIAL'], { min: 2, max: 5 });
    if (ok == null) return;
    if (!eq(ok, s.answer)) return r.fail('recompute');
    for (const c of wrongs(it.choices)) {
      if (c.err === 'LOGIC_REVERSE') { if (s.reverse == null || !eq(c.t, s.reverse)) return r.fail('errcode'); }
      else if (b.type !== 'set') {
        const partial = b.facts.some((x) => x.length > 2 && ((['min', 'last'].includes(b.ask) && eq(c.t, x[1] === '>' || x[1] === 'left_of' ? x[2] : x[0])) || (['max', 'first'].includes(b.ask) && eq(c.t, x[1] === '>' || x[1] === 'left_of' ? x[0] : x[2])) || b.ask === 'middle'));
        if (!partial) return r.fail('errcode');
      }
    }
    if (b.attr) r.texts.push(b.attr);
    r.answer = ok;
    if (it.role !== 'training' && r.refOk) {
      const tp = logicPrompt(b);
      if (tp && vlen(tp) <= 90) r.fill.prompt = tp; else r.refOk = false;
    }
  },
};

// A.14 letter_search --------------------------------------------------------
const LS_LEN = { 1: [6, 10], 2: [9, 14], 3: [12, 18], 4: [16, 24], 5: [20, 30] };
F.letter_search = {
  cd: 'attention', ref: true,
  check(it, r) {
    const b = it.body || {}, f = it.features || {};
    if (!Array.isArray(b.line) || typeof b.target !== 'string' || !isSyllable(b.target) || b.target.length !== 1) return r.fail('field');
    if (b.line.some((c) => typeof c !== 'string' || c.length !== 1 || !isSyllable(c))) return r.fail('charset');
    const n = b.line.length, count = b.line.filter((c) => c === b.target).length;
    const look = new Map(); b.line.forEach((c) => { if (isLookalike(b.target, c)) look.set(c, (look.get(c) || 0) + 1); });
    const lookTotal = [...look.values()].reduce((a, x) => a + x, 0), lookMax = Math.max(0, ...look.values());
    if (f.length !== n || f.targets !== count || f.lookalikes !== lookTotal) return r.fail('features');
    const [lo, hi] = LS_LEN[it.level]; if (n < lo || n > hi || count < 1) return r.fail('level');
    const ok = checkChoices(r, it.choices, ['COUNT_UNDER', 'COUNT_OVER', 'LOOKALIKE'], { min: 3, max: 4 });
    if (ok == null) return;
    const num = (t) => { const m = /^(\d+)개$/.exec(NFC(t).replace(/\s+/g, '')); return m ? Number(m[1]) : null; };
    if (num(ok) !== count) return r.fail('recompute');
    for (const c of wrongs(it.choices)) {
      const v = num(c.t);
      const good = v != null && (c.err === 'LOOKALIKE' ? lookMax > 0 && v === count + lookMax : c.err === 'COUNT_UNDER' ? v < count && v >= 0 : v > count);
      if (!good) return r.fail('errcode');
    }
    r.answer = ok;
  },
};

// A.15 story_recall ---------------------------------------------------------
F.story_recall = {
  cd: 'memory', ref: true,
  check(it, r) {
    const b = it.body || {}, f = it.features || {};
    if (!isStr(b.story, 220, 10) || !Array.isArray(b.facts) || !Array.isArray(b.questions)) return r.fail('field');
    const story = NFC(b.story);
    const sc = sentences(story).length;
    if (f.sentences !== sc || f.facts !== b.facts.length || f.questions !== b.questions.length) return r.fail('features');
    if (sc < 2 || sc > 6 || b.questions.length < 2 || b.questions.length > 4) return r.fail('level');
    for (const x of b.facts) if (!x || !isStr(x.slot, 12) || !isStr(x.v, 14) || !story.includes(NFC(x.v))) return r.fail('recompute');
    let delayed = 0; const answers = [];
    for (const q of b.questions) {
      if (!q || !isStr(q.q, 60) || typeof q.delayed !== 'boolean') return r.fail('field');
      if (q.delayed) delayed++;
      r.texts.push(q.q);
      const ok = checkChoices(r, q.choices, ['INTR_SEM', 'INTR_UNREL', 'INTR_PHON', 'SRC_CONF'], { min: 3, max: 4 });
      if (ok == null) return;
      if (q.choices.length !== f.choices) return r.fail('features');
      if (!story.includes(NFC(ok))) return r.fail('recompute');
      const fact = b.facts.find((x) => x.slot === q.slot);
      if (!fact || !eq(fact.v, ok)) return r.fail('recompute');
      for (const c of wrongs(q.choices)) {
        const inStory = story.includes(NFC(c.t));
        if (c.err === 'SRC_CONF' ? !inStory : inStory) return r.fail('errcode');
      }
      answers.push(ok);
    }
    if (f.delayedQ !== delayed) return r.fail('features');
    r.texts.push(story); r.story = story;
    r.answer = answers.join('|');
  },
};

// A.16 prospective -----------------------------------------------------------
F.prospective = {
  cd: 'memory', ref: false,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    if (!lx.cues.has(stripVS(b.cue || '')) || !isStr(b.instruction, 60) || typeof b.reminderMid !== 'boolean') return r.fail('field');
    const ev = String(b.event || '');
    const m = /^(after_last_item|after_game:([1-9])|when_see:(.+))$/u.exec(ev);
    if (!m || (m[3] && !lx.emojiAll.has(stripVS(m[3])))) return r.fail('field');
    const ins = NFC(b.instruction);
    if (!ins.includes(NFC(b.cue))) return r.fail('field');
    const ORD = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
    const phraseOk = m[1] === 'after_last_item' ? /마지막/.test(ins) : m[2] ? (ins.includes(ORD[Number(m[2])] + ' 번째') || ins.includes(ORD[Number(m[2])] + '번째') || ins.includes(m[2] + '번째')) : ins.includes(NFC(m[3]));
    if (!phraseOk) return r.fail('field');
    if (f.event !== ev || typeof f.distractorCue !== 'boolean') return r.fail('features');
    if ((it.level === 1 && !b.reminderMid) || (it.level >= 3 && b.reminderMid) || (it.level === 5 && !f.distractorCue)) return r.fail('level');
    r.texts.push(ins); r.noSolve = true; r.aux = true;
  },
};

// A.17 grid_pattern -----------------------------------------------------------
F.grid_pattern = {
  cd: 'visuospatial', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const n = b.size;
    if (!isInt(n, 3, 5) || !Array.isArray(b.frames) || b.frames.length < 2 || b.frames.length > 4) return r.fail('field');
    if (b.empty != null && stripVS(b.empty) !== lx.emptyCell) return r.fail('emoji');
    if (!b.frames.every((g) => validGrid(lx, g, n))) return r.fail('grid');
    const rules = Array.isArray(b.rule) ? b.rule : [b.rule];
    if (rules.length < 1 || rules.length > 2) return r.fail('field');
    for (let i = 1; i < b.frames.length; i++) {
      const want = applyRules(lx, b.frames[i - 1], rules, b.frames.slice(0, i));
      if (!want || gridKey(want) !== gridKey(b.frames[i])) return r.fail('recompute');
    }
    if (gridKey(b.frames[0]) === gridKey(b.frames[1])) return r.fail('grid');
    const last = b.frames[b.frames.length - 1];
    const correct = applyRules(lx, last, rules, b.frames);
    if (!correct) return r.fail('recompute');
    const variants = {
      RULE_PARTIAL: rules.length > 1 ? applyRules(lx, last, rules.slice(0, 1), b.frames) : clone(last),
      MIRROR: flipH(correct),
      STEP_SKIP: applyRules(lx, correct, rules, [...b.frames, correct]),
      ROT_ANGLE: rot90(correct),
    };
    const opts = fillGridOptions(r, it.options, correct, variants);
    if (!opts) return;
    if (f.size !== n || f.frames !== b.frames.length || f.rules !== rules.length || f.cells !== countFilled(lx, b.frames[0])) return r.fail('features');
    r.fill.options = opts; r.answer = gridKey(correct);
  },
};
function fillGridOptions(r, options, correct, variants) {
  if (!Array.isArray(options) || options.length < 3 || options.length > 4) { r.fail('choices'); return null; }
  const out = []; const seen = new Set(); let nOk = 0;
  for (const o of options) {
    if (!o || o.grid !== 'SERVER') { r.fail('field'); return null; }
    let g;
    if (o.err == null) { g = correct; nOk++; } else if (variants[o.err]) g = variants[o.err]; else { r.fail('errcode'); return null; }
    if (!g) { r.fail('errcode'); return null; }
    const k = gridKey(g);
    if (seen.has(k)) { r.fail('grid_options'); return null; }
    seen.add(k);
    out.push(o.err == null ? { grid: g, ok: true } : { grid: g, err: o.err });
  }
  if (nOk !== 1) { r.fail('answer'); return null; }
  return out;
}

// A.18 grid_rotate ------------------------------------------------------------
const ROT_OPS = { same: (g) => clone(g), rot90: (g) => rotN(g, 1), rot180: (g) => rotN(g, 2), rot270: (g) => rotN(g, 3), rot90_flip: (g) => flipH(rotN(g, 1)) };
F.grid_rotate = {
  cd: 'visuospatial', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const n = b.size;
    if (!isInt(n, 3, 5) || !validGrid(lx, b.src, n, false) || !ROT_OPS[b.op]) return r.fail('field');
    const forms = [0, 1, 2, 3].map((k) => gridKey(rotN(b.src, k)));
    const mirrors = [0, 1, 2, 3].map((k) => gridKey(flipH(rotN(b.src, k))));
    if (new Set([...forms, ...mirrors]).size !== 8) return r.fail('grid_symmetric');
    const correct = ROT_OPS[b.op](b.src);
    const others = [rotN(b.src, 1), rotN(b.src, 2), rotN(b.src, 3), b.src].filter((g) => gridKey(g) !== gridKey(correct));
    let rotIdx = 0;
    const variants = { MIRROR: flipH(correct) };
    const opts = [];
    if (!Array.isArray(it.options) || it.options.length < 3 || it.options.length > 4) return r.fail('choices');
    const seen = new Set(); let nOk = 0;
    for (const o of it.options) {
      if (!o || o.grid !== 'SERVER') return r.fail('field');
      let g;
      if (o.err == null) { g = correct; nOk++; } else if (o.err === 'ROT_ANGLE') g = others[rotIdx++]; else if (variants[o.err]) g = variants[o.err]; else return r.fail('errcode');
      if (!g) return r.fail('errcode');
      const k = gridKey(g); if (seen.has(k)) return r.fail('grid_options'); seen.add(k);
      opts.push(o.err == null ? { grid: g, ok: true } : { grid: g, err: o.err });
    }
    if (nOk !== 1) return r.fail('answer');
    const want = { 1: ['same'], 2: ['rot180'], 3: ['rot90', 'rot270'], 4: ['rot90', 'rot270'], 5: ['rot90_flip', 'rot90', 'rot270'] }[it.level];
    if (!want.includes(b.op)) return r.fail('level');
    if (f.size !== n || f.colored !== countFilled(lx, b.src) || f.op !== b.op) return r.fail('features');
    r.fill.options = opts; r.answer = gridKey(correct);
  },
};

// A.19 grid_memory ------------------------------------------------------------
const GM = { 1: [3, 3, 4000, 3], 2: [3, 4, 3500, 3], 3: [4, 5, 3000, 4], 4: [4, 6, 2500, 4], 5: [5, 7, 2000, 4] };
F.grid_memory = {
  cd: 'visuospatial', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const n = b.size;
    if (!isInt(n, 3, 5) || !Array.isArray(b.cells) || !lx.fills.has(stripVS(b.fill || '')) || !isInt(b.showMs, 1000, 6000)) return r.fail('field');
    const key = (c) => c[0] * 10 + c[1];
    if (b.cells.some((c) => !Array.isArray(c) || !isInt(c[0], 0, n - 1) || !isInt(c[1], 0, n - 1))) return r.fail('grid');
    if (new Set(b.cells.map(key)).size !== b.cells.length) return r.fail('grid');
    const T = GM[it.level];
    if (n !== T[0] || b.cells.length !== T[1] || b.showMs !== T[2] || it.options.length !== T[3]) return r.fail('level');
    const toGrid = (cells) => Array.from({ length: n }, (_, rr) => Array.from({ length: n }, (__, cc) => (cells.some((c) => c[0] === rr && c[1] === cc) ? b.fill : lx.emptyCell)));
    const correct = toGrid(b.cells);
    const filled = new Set(b.cells.map(key));
    let shifted = null;
    outer: for (let i = 0; i < b.cells.length; i++) for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const [rr, cc] = [b.cells[i][0] + dr, b.cells[i][1] + dc];
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && !filled.has(rr * 10 + cc)) { const cs = b.cells.slice(); cs[i] = [rr, cc]; shifted = toGrid(cs); break outer; }
    }
    const variants = { CELL_SHIFT: shifted, MIRROR: flipH(correct), MISS: toGrid(b.cells.slice(0, -1)), ROT_ANGLE: rot90(correct) };
    const opts = fillGridOptions(r, it.options, correct, variants);
    if (!opts) return;
    if (f.size !== n || f.cells !== b.cells.length || f.showMs !== b.showMs) return r.fail('features');
    r.fill.options = opts; r.answer = gridKey(correct);
  },
};

// A.20 route ------------------------------------------------------------------
const DIRV = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const TURN = { left: { up: 'left', left: 'down', down: 'right', right: 'up' }, right: { up: 'right', right: 'down', down: 'left', left: 'up' } };
const DIRWORD = { up: '위', down: '아래', left: '왼쪽', right: '오른쪽' };
const COUNT = ['', '한', '두', '세', '네', '다섯', '여섯'];
function followRoute(b, steps, swapLR) {
  let [rr, cc] = b.start; let head = b.heading;
  for (const s of steps) {
    let dir;
    if (b.frame === 'heading') {
      const t = swapLR && s.turn !== 'none' ? (s.turn === 'left' ? 'right' : 'left') : s.turn;
      head = t === 'none' ? head : TURN[t][head]; dir = head;
    } else dir = swapLR ? ({ left: 'right', right: 'left' }[s.dir] || s.dir) : s.dir;
    const [dr, dc] = DIRV[dir];
    for (let k = 0; k < s.go; k++) { rr += dr; cc += dc; if (rr < 0 || cc < 0 || rr >= b.size || cc >= b.size) return null; }
  }
  return [rr, cc];
}
function routeText(b, lx) {
  const startName = lx.places.get(stripVS(b.map[b.start[0]][b.start[1]]));
  const parts = b.steps.map((s) => (b.frame === 'heading'
    ? `${s.turn === 'none' ? '앞으로' : `${DIRWORD[s.turn]}으로 돌아`} ${COUNT[s.go]} 칸`
    : `${josa(DIRWORD[s.dir], '으로', '로')} ${COUNT[s.go]} 칸`));
  return `${startName}에서 ${parts.join(', ')} 가면 어디일까요?`;
}
F.route = {
  cd: 'visuospatial', ref: true,
  check(it, r, ctx) {
    const lx = ctx.lx, b = it.body || {}, f = it.features || {};
    const n = b.size;
    if (!isInt(n, 3, 5) || !Array.isArray(b.map) || b.map.length !== n || b.map.some((row) => !Array.isArray(row) || row.length !== n)) return r.fail('field');
    if (b.map.flat().some((c) => stripVS(c) !== lx.emptyCell && !lx.places.has(stripVS(c)))) return r.fail('emoji');
    if (!Array.isArray(b.start) || !isInt(b.start[0], 0, n - 1) || !isInt(b.start[1], 0, n - 1) || stripVS(b.map[b.start[0]][b.start[1]]) === lx.emptyCell) return r.fail('route');
    if (!['screen', 'heading'].includes(b.frame) || !Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > 6) return r.fail('field');
    if (b.frame === 'heading' && !DIRV[b.heading]) return r.fail('field');
    for (const s of b.steps) {
      if (!isInt(s.go, 1, 6)) return r.fail('field');
      if (b.frame === 'screen' ? !DIRV[s.dir] : !['left', 'right', 'none'].includes(s.turn)) return r.fail('field');
    }
    const cellName = (p) => (p ? lx.places.get(stripVS(b.map[p[0]][p[1]])) : null);
    const end = followRoute(b, b.steps, false);
    if (!end || !cellName(end) || (end[0] === b.start[0] && end[1] === b.start[1])) return r.fail('route');
    const answer = cellName(end);
    const choices = [{ t: answer, ok: true }];
    const add = (p, err) => { const nm = cellName(p); if (nm && !choices.some((c) => c.t === nm)) choices.push({ t: nm, err }); };
    add(followRoute(b, b.steps, true), 'LR_CONF');
    const short = b.steps.map((s) => ({ ...s })); short[short.length - 1].go -= 1;
    add(followRoute(b, short.filter((s) => s.go > 0), false), 'STEP_SKIP');
    for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (choices.length >= 4) break;
      const p = [end[0] + dr, end[1] + dc];
      if (p[0] >= 0 && p[1] >= 0 && p[0] < n && p[1] < n) add(p, 'CELL_SHIFT');
    }
    if (choices.length < 3) return r.fail('route_choices');
    // text must name the same directions and counts in the same order
    const text = NFC(b.text || '');
    if (!isStr(text, 70)) return r.fail('length');
    const nums = (text.match(/(한|두|세|네|다섯|여섯|\d)\s?칸/g) || []).map((m) => { const w = m.replace(/\s?칸/, ''); return /\d/.test(w) ? Number(w) : COUNT.indexOf(w); });
    const dirs = (text.match(/(위|아래|왼쪽|오른쪽|앞)/g) || []);
    const wantDirs = b.steps.map((s) => (b.frame === 'heading' ? (s.turn === 'none' ? '앞' : DIRWORD[s.turn]) : DIRWORD[s.dir]));
    if (nums.join(',') !== b.steps.map((s) => s.go).join(',') || dirs.join(',') !== wantDirs.join(',')) return r.fail('prompt_numbers');
    const turns = b.frame === 'heading' ? b.steps.filter((s) => s.turn !== 'none').length : b.steps.reduce((a, s, i) => a + (i && s.dir !== b.steps[i - 1].dir ? 1 : 0), 0);
    const totalGo = b.steps.reduce((a, s) => a + s.go, 0);
    if (f.size !== n || f.steps !== totalGo || f.turns !== turns || f.frame !== b.frame) return r.fail('features');
    if (it.level === 5 ? b.frame !== 'heading' : b.frame !== 'screen') return r.fail('level');
    r.fill.choices = choices;
    r.texts.push(text, ...choices.map((c) => c.t));
    r.answer = answer;
    if (it.role !== 'training') r.fill.body = { ...b, text: routeText(b, lx) };
  },
};

// A.21 reminiscence -------------------------------------------------------------
F.reminiscence = {
  cd: 'reminiscence', ref: false,
  check(it, r) {
    const b = it.body || {};
    if (!isStr(b.topic, 20) || !isStr(b.answer, 14) || (b.talk != null && !isStr(b.talk, 80))) return r.fail('field');
    if (!it.qa || !isStr(it.qa.basis, 120)) return r.fail('qa_missing');
    const ok = checkChoices(r, it.choices, ['ERA_NEAR', 'PLAUSIBLE'], { min: 3, max: 4 });
    if (ok == null) return;
    if (!eq(ok, b.answer)) return r.fail('answer');
    if (/[0-9]/.test(ok)) return r.fail('answer_number');
    r.texts.push(b.topic, b.talk || '', it.qa.basis);
    r.answer = ok; r.review = true;
  },
};

/** Formats eligible for reference/anchor roles (A.0 table). */
const REF_FORMATS = new Set(Object.entries(F).filter(([, v]) => v.ref).map(([k]) => k));

module.exports = { FORMATS: F, REF_FORMATS, parseWon, won, parseKoTime, koTime, gridKey, rot90, flipH, logicSolve, logicPrompt, routeText, shopTotals, checkChoices, badChars };
