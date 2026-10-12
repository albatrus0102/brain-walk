'use strict';
/**
 * checkItem: one generated item through every machine check (DESIGN-AI §2.6, Appendix B.1):
 *   schema → common → format recompute/features → banned → PII → dedupe → do-not-copy → qa
 * Quotas (per-day max) are applied by the caller (server) because they need the database.
 *
 * Returns { ok, codes[], item (normalized, server fields filled), role, review, hash, sketch, words }.
 * Never throws. Never logs. Same code runs in the routine's `bw-io.mjs check` (vendored copy).
 */
const { NFC, stripVS, vlen, badChars, shuffleSeeded } = require('./text.js');
const { lexicon } = require('./lexicon.js');
const { FORMATS, REF_FORMATS } = require('./formats.js');
const { bannedHit, piiHit, doNotCopyHit, sketch, sketchSim, contentHash } = require('./checks.js');

const ROLES = ['training', 'reference', 'anchor_candidate'];
const QA_KEYS = ['clear', 'single', 'distractor', 'plain', 'respect', 'safe', 'original'];
const LONG_PROMPT = new Set(['logic', 'schedule']);
/** Every reason code the validator can emit (documented in spec and CLIENT-CONTRACT). */
const REASONS = [
  'schema', 'field', 'format', 'cdomain', 'level', 'role', 'spec', 'theme', 'length', 'charset', 'emoji',
  'choices', 'answer', 'answer_leak', 'answer_number', 'errcode', 'recompute', 'features', 'unique', 'lexicon', 'particle',
  'price', 'format_money', 'format_time', 'prompt_numbers', 'grid', 'grid_symmetric', 'grid_options', 'route', 'route_choices',
  'date_query', 'date_window', 'date_uncertain', 'date_out_of_table', 'date_no_holiday', 'date_ambiguous',
  'banned:medical', 'banned:death', 'banned:politics', 'banned:religion', 'banned:violence', 'banned:discrimination',
  'banned:adult', 'banned:scary', 'banned:brand', 'banned:shaming', 'banned:test_tasks', 'pii', 'name',
  'dup', 'near_dup', 'wordlist_overlap', 'copy_risk', 'qa_missing', 'qa_scores', 'qa_solve', 'quota', 'internal',
];

const tokenize = (v) => (v == null ? null : Array.isArray(v) ? v.join(',') : String(v));

// ---- structure limits: a compromised generator must not smuggle markup, odd keys or deep nesting into the bank
const MAX_DEPTH = 8, MAX_NODES = 4000;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** null when ok, else a reason code. No string anywhere may open markup ('<' or '&'); the logic op '<' is allowed as a whole string. */
function structureError(v) {
  let nodes = 0;
  const walk = (x, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return 'field';
    if (typeof x === 'string') return x !== '<' && /[<&]/.test(x) ? 'charset' : null;
    if (x == null || typeof x !== 'object') return null;
    for (const k of Object.keys(x)) {
      if (BAD_KEYS.has(k)) return 'field';
      const e = walk(x[k], depth + 1); if (e) return e;
    }
    return null;
  };
  return walk(v, 0);
}
const pick = (o, keys) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const out = {}; for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined) out[k] = o[k]; return out;
};
const pickAll = (a, keys) => (Array.isArray(a) ? a.map((x) => pick(x, keys)) : a);
const choiceOf = (c) => (c && c.ok === true ? { t: c.t, ok: true } : { t: c && c.t, err: c && c.err });
/** Stored body = only the fields the format defines (unknown keys are dropped, never shown to the app). */
const BODY = {
  word_recog: (b) => ({ ...pick(b, ['targets', 'theme']), foils: pickAll(b.foils, ['t', 'err']) }),
  card_theme: (b) => pick(b, ['theme', 'cards', 'similar']),
  emoji_set: (b) => pick(b, ['pairs', 'category']),
  date_q: (b) => ({ query: pick(b.query, ['type', 'ref', 'weekday', 'name', 'date', 'year']) }),
  lang_complete: (b) => pick(b, ['sentence', 'answer']),
  lang_relation: (b) => pick(b, ['word', 'rel', 'answer']),
  lang_category: (b) => pick(b, ['category', 'mode', 'members', 'odd', 'answer']),
  word_find: (b) => pick(b, ['desc', 'answer']),
  analogy: (b) => pick(b, ['a', 'b', 'c', 'answer', 'rel']),
  shop_calc: (b) => ({ ...pick(b, ['scene', 'pay', 'ask']), shops: b.shops.map((sh) => ({ ...pick(sh, ['name']), lines: pickAll(sh.lines, ['item', 'price', 'qty', 'unit']), ...(sh.deal != null ? { deal: pick(sh.deal, ['type', 'pct', 'item']) } : {}) })) }),
  sequence: (b) => pick(b, ['kind', 'title', 'steps', 'before', 'intruder']),
  schedule: (b) => ({ ...pick(b, ['ask', 'travelMin', 'bufferMin', 'departAt', 'from', 'to', 'needMin']), events: pickAll(b.events, ['what', 'at', 'durMin']), ...(b.newEvent != null ? { newEvent: pick(b.newEvent, ['what', 'at', 'durMin']) } : {}) }),
  logic: (b) => pick(b, ['type', 'attr', 'entities', 'facts', 'ask']),
  letter_search: (b) => pick(b, ['line', 'target']),
  story_recall: (b) => ({ story: b.story, facts: pickAll(b.facts, ['slot', 'v']), questions: b.questions.map((q) => ({ ...pick(q, ['q', 'slot', 'delayed']), choices: q.choices.map(choiceOf) })) }),
  prospective: (b) => pick(b, ['cue', 'event', 'instruction', 'reminderMid']),
  grid_pattern: (b) => ({ ...pick(b, ['size', 'empty', 'frames']), rule: Array.isArray(b.rule) ? pickAll(b.rule, ['op', 'dx', 'dy', 'wrap', 'fill']) : pick(b.rule, ['op', 'dx', 'dy', 'wrap', 'fill']) }),
  grid_rotate: (b) => pick(b, ['size', 'src', 'op']),
  grid_memory: (b) => pick(b, ['size', 'cells', 'showMs', 'fill']),
  route: (b) => ({ ...pick(b, ['size', 'map', 'start', 'frame', 'heading', 'text']), steps: pickAll(b.steps, ['dir', 'turn', 'go']) }),
  reminiscence: (b) => pick(b, ['topic', 'answer', 'talk']),
};
const ITEM_KEYS = ['schema', 'format', 'cdomain', 'level', 'role', 'specVer', 'theme', 'features', 'prompt', 'speak', 'explain', 'validFrom', 'validTo', 'body', 'choices', 'qa'];
const QA_STORE = ['solve1', 'solve2', 'scores', 'risk', 'basis'];
const sameToken = (a, b) => a != null && b != null && stripVS(NFC(a)).replace(/\s+/g, '') === stripVS(NFC(b)).replace(/\s+/g, '');

/**
 * @param item  generator output (bw.item.v1)
 * @param ctx   { specVer, today('YYYY-MM-DD'), themes?: string[] | null, recent?: { hashes:Set, sketches:{[fmt]:string[]}, wordLists:string[][] } }
 */
function checkItem(item, ctx = {}) {
  const lx = ctx.lx || lexicon();
  const codes = [];
  const r = {
    codes, texts: [], words: [], story: '', answer: null, refOk: true, review: false, aux: false, noSolve: false, fill: {},
    fail(code) { if (!codes.includes(code)) codes.push(code); },
  };
  const done = (extra = {}) => ({ ok: codes.length === 0, codes, ...extra });
  const it = item;

  // ---- schema / common
  if (!it || typeof it !== 'object' || Array.isArray(it) || it.schema !== 'bw.item.v1') { r.fail('schema'); return done(); }
  if (typeof it.tempId !== 'string' || !/^g-\d{8}-\d{4}-\d{4}$/.test(it.tempId)) r.fail('schema');
  const fmt = FORMATS[it.format];
  if (!fmt) { r.fail('format'); return done(); }
  if (it.cdomain !== fmt.cd) r.fail('cdomain');
  if (!Number.isInteger(it.level) || it.level < 1 || it.level > 5) r.fail('level');
  if (!ROLES.includes(it.role)) r.fail('role');
  if (it.features == null || typeof it.features !== 'object') r.fail('features');
  if (codes.length) return done();
  const se = structureError(it);
  if (se) { r.fail(se); return done(); }

  if (it.theme != null) {
    if (typeof it.theme !== 'string' || (Array.isArray(ctx.themes) && !ctx.themes.includes(it.theme))) r.fail('theme');
    else r.texts.push(it.theme);
  }
  const promptMax = LONG_PROMPT.has(it.format) ? 90 : 60;
  if (it.prompt != null && (typeof it.prompt !== 'string' || vlen(it.prompt) > promptMax || !it.prompt.trim())) r.fail('length');
  if (it.speak != null && (typeof it.speak !== 'string' || vlen(it.speak) > 120)) r.fail('length');
  if (it.explain != null && (typeof it.explain !== 'string' || vlen(it.explain) > 80)) r.fail('length');
  ['prompt', 'speak', 'explain'].forEach((k) => { if (typeof it[k] === 'string') r.texts.push(it[k]); });
  if (codes.length) return done();

  // ---- format-specific recompute + features
  try { fmt.check(it, r, { lx, today: ctx.today }); } catch { r.fail('field'); }
  if (codes.length) return done();

  // ---- charset (every visible string; emoji only from the allowlist)
  const allText = r.texts.filter(Boolean).join('\n');
  if (r.texts.some((s) => typeof s === 'string' && badChars(s, lx.emojiAll).length)) r.fail('charset');
  // ---- banned words, PII
  const bh = bannedHit(lx, allText, 'items'); if (bh) r.fail(bh);
  const ph = piiHit(lx, allText); if (ph) r.fail(ph);
  if (codes.length) return done();

  // ---- dedupe (exact hash, near-duplicate sketch, word-list overlap)
  const hashBasis = [it.format, it.prompt || '', JSON.stringify(it.body || {}), JSON.stringify(Array.isArray(it.choices) ? it.choices.map((c) => c && c.t) : null)].join('|');
  const hash = contentHash(hashBasis);
  const sk = sketch(allText);
  const rec = ctx.recent || {};
  if (rec.hashes && rec.hashes.has(hash)) r.fail('dup');
  else if (rec.sketches && (rec.sketches[it.format] || []).some((s) => sketchSim(s, sk) >= 0.7)) r.fail('near_dup');
  if (r.words.length && it.format === 'word_recog' && Array.isArray(rec.wordLists)) {
    const mine = new Set(r.words.map(NFC));
    if (rec.wordLists.some((l) => l.filter((w) => mine.has(NFC(w))).length / Math.max(1, mine.size) >= 0.6)) r.fail('wordlist_overlap');
  }
  // ---- do-not-copy fingerprints
  const dh = doNotCopyHit(lx, { words: r.words, story: r.story, all: allText });
  if (dh) r.fail(dh);
  if (codes.length) return done();

  // ---- qa record (§2.7)
  const qa = it.qa;
  if (!qa || typeof qa !== 'object' || !qa.scores || typeof qa.risk !== 'string' || !qa.risk.trim() || vlen(qa.risk) > 120) r.fail('qa_missing');
  else {
    if (!QA_KEYS.every((k) => Number.isInteger(qa.scores[k]) && qa.scores[k] >= 4 && qa.scores[k] <= 5)) r.fail('qa_scores');
    const want = r.answer;
    if (!r.noSolve || qa.solve1 != null || qa.solve2 != null) {
      if (!sameToken(tokenize(qa.solve1), want) || !sameToken(tokenize(qa.solve2), want)) r.fail('qa_solve');
    }
  }
  if (codes.length) return done();

  // ---- role (the server decides; non-eligible reference requests become training)
  let role = it.role;
  const refEligible = REF_FORMATS.has(it.format) && r.refOk && it.theme == null && !r.review;
  if (role !== 'training') {
    if (!refEligible) role = 'training';
    else if (it.specVer !== ctx.specVer) r.fail('spec');
  }
  if (codes.length) return done();

  // ---- normalized stored item (fixed presentation order, seeded by the content hash)
  // only known fields are stored (unknown top-level, body and choice keys are dropped)
  const out = JSON.parse(JSON.stringify(pick(it, ITEM_KEYS)));
  if (r.fill.prompt) out.prompt = r.fill.prompt;
  if (r.fill.body) out.body = r.fill.body;
  out.body = JSON.parse(JSON.stringify(BODY[it.format](out.body || {})));
  if (r.fill.choices) out.choices = r.fill.choices;
  else if (Array.isArray(out.choices)) out.choices = out.choices.map(choiceOf);
  else delete out.choices;
  if (r.fill.options) out.options = r.fill.options;
  if (out.qa && typeof out.qa === 'object') out.qa = pick(out.qa, QA_STORE);
  if (Array.isArray(out.choices)) out.choices = shuffleSeeded(out.choices, hash + ':c');
  if (Array.isArray(out.options)) out.options = shuffleSeeded(out.options, hash + ':o');
  if (it.format === 'story_recall') out.body.questions.forEach((q, i) => { q.choices = shuffleSeeded(q.choices, hash + ':q' + i); });
  if (it.format === 'sequence') {
    const idx = out.body.steps.map((_, i) => i);
    let order = shuffleSeeded(idx, hash + ':s');
    if (order.every((v, i) => v === i)) order = order.slice(1).concat(order[0]);
    out.present = { order };
  }
  if (it.format === 'word_recog') out.present = { grid: shuffleSeeded([...out.body.targets, ...out.body.foils.map((f) => f.t)], hash + ':w') };
  out.role = role;
  out.tempId = it.tempId;
  return done({ item: out, role, review: r.review, aux: r.aux, hash, sketch: sk, words: r.words, requestedRole: it.role });
}

/** Check a whole bw.items.v1 payload; applies intra-batch dedupe and the max count. */
function checkItems(payload, ctx = {}) {
  const res = { schemaOk: true, accepted: [], rejected: [] };
  if (!payload || payload.schema !== 'bw.items.v1' || !Array.isArray(payload.items) || typeof payload.runId !== 'string' || !/^\d{8}-\d{4}$/.test(payload.runId)) {
    res.schemaOk = false; return res;
  }
  const recent = ctx.recent || { hashes: new Set(), sketches: {}, wordLists: [] };
  recent.hashes = recent.hashes || new Set(); recent.sketches = recent.sketches || {}; recent.wordLists = recent.wordLists || [];
  const max = ctx.maxItems == null ? 400 : ctx.maxItems;
  payload.items.forEach((item, i) => {
    if (res.accepted.length >= max) { res.rejected.push({ i, tempId: item && item.tempId, format: item && item.format, codes: ['quota'] }); return; }
    const c = checkItem(item, { ...ctx, recent });
    if (!c.ok) { res.rejected.push({ i, tempId: item && item.tempId, format: item && item.format, codes: c.codes }); return; }
    recent.hashes.add(c.hash);
    (recent.sketches[item.format] = recent.sketches[item.format] || []).push(c.sketch);
    if (item.format === 'word_recog') recent.wordLists.push(c.words);
    res.accepted.push({ i, ...c });
  });
  return res;
}

module.exports = { checkItem, checkItems, REASONS, QA_KEYS };
