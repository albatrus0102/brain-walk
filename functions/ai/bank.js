'use strict';
/**
 * Item bank, family packs, measure sets and bank needs (DESIGN-AI §2.5, §2.8–§2.10, Appendix B.5, C.2).
 *
 * aiBank/{bk_<hash20>}   status: pending_review | ready | reserved | used | quarantine | retired | frozen
 *                        The full item is stored as a JSON string in `json` (Firestore cannot store arrays inside
 *                        arrays: grids, maps, card pairs, logic facts); scalar fields beside it are for queries.
 * aiBankIndex/{format}   recent: [{h, s, w?, d}] ≤ 400 (dedupe: exact hash, MinHash sketch, word lists)
 * families/{fid}/trainees/{mid}/aiPacks/{cd}-L{n}          itemsJson: ≤ 40 ready training items of one cell
 *                                                          (theme items only for that trainee's themes)
 * families/{fid}/trainees/{mid}/aiPacks/measure-{YYYY-Www} referenceJson / anchorJson: measure items of that week
 *
 * The bank and bank needs are SHARED by every trainee of the family (DESIGN-MULTI §4.3): an item consumed by
 * anyone is used for everyone. Measure sets are per trainee: reference reservations carry refWeek = 'YYYY-Www:L',
 * anchor sets are frozen as '<set>_<L>' ('A_A', 'B_A', … 'A_B'), each at that trainee's reference levels.
 */
const { db, fam, FieldValue, Timestamp, expireIn } = require('./fb.js');
const kd = require('./core/kdate.js');
const { vlen } = require('./core/text.js');
const { FORMATS } = require('./core/formats.js');
const REF = require('./data/reference-v1.json');
const { SPEC_VER, LIMITS, maxItemsFor } = require('./config.js');

const CELL_DOMAINS = ['memory', 'attention', 'executive', 'language', 'visuospatial', 'orientation'];
const FORMATS_OF = {};
for (const [f, def] of Object.entries(FORMATS)) (FORMATS_OF[def.cd] = FORMATS_OF[def.cd] || []).push(f);
const TRAINING_FORMATS = (cd) => (FORMATS_OF[cd] || []).filter((f) => f !== 'prospective');
const INDEX_CAP = 400;
const PACK_SIZE = 40;
const CELL_TARGET = 20;            // ready training items per cell, per active trainee
const FMT_MIN = 6;                 // per format in a cell, per active trainee
const ANCHOR_SETS = ['A', 'B', 'C'];
const refWeekKey = (wk, L) => `${wk}:${L}`;
const anchorKey = (set, L) => `${set}_${L}`;
const bankId = (hash) => 'bk_' + hash.slice(0, 20);

// ------------------------------------------------------------- dedupe index
async function loadRecent() {
  const snap = await db().collection('aiBankIndex').get();
  const recent = { hashes: new Set(), sketches: {}, wordLists: [] };
  const cutoff = kd.addDays(kd.kst().date, -180);
  snap.forEach((d) => {
    if (d.id.startsWith('_')) return;
    for (const e of d.get('recent') || []) {
      recent.hashes.add(e.h);
      if (e.d >= cutoff) { (recent.sketches[d.id] = recent.sketches[d.id] || []).push(e.s); if (e.w) recent.wordLists.push(e.w); }
    }
  });
  return recent;
}

/** Daily accepted-item quota (400/day KST), reserved atomically before inserting. Returns how many may be taken. */
async function takeQuota(n) {
  const ref = db().collection('aiRate').doc('items-' + kd.kst().date);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref); const used = s.exists ? s.get('n') || 0 : 0;
    const take = Math.max(0, Math.min(n, LIMITS.itemsPerDay - used));
    tx.set(ref, { n: used + take, expireAt: expireIn(3) }, { merge: true });
    return take;
  });
}

/** Insert accepted items (output of checkItems().accepted). Returns ids written. */
async function insertAccepted(accepted, { inboxId }) {
  const ids = [];
  const byFormat = {};
  const today = kd.kst().date;
  for (let i = 0; i < accepted.length; i += 200) {
    const batch = db().batch();
    for (const a of accepted.slice(i, i + 200)) {
      const id = bankId(a.hash);
      const status = a.review ? 'pending_review' : 'ready';
      const it = a.item;
      batch.set(db().collection('aiBank').doc(id), {
        id, hash: a.hash, sketch: a.sketch, status, review: !!a.review, aux: !!a.aux, role: a.role, requestedRole: a.requestedRole,
        format: it.format, cdomain: it.cdomain, level: it.level, specVer: it.specVer || null, theme: it.theme || null,
        validFrom: it.validFrom || null, validTo: it.validTo || null, json: JSON.stringify({ ...it, id }),
        len: textLen(it), nch: choiceCount(it), nExp: 0, exposures: [], inboxId, createdTs: FieldValue.serverTimestamp(),
      }, { merge: false });
      ids.push(id);
      (byFormat[a.item.format] = byFormat[a.item.format] || []).push({ h: a.hash, s: a.sketch, d: today, ...(a.item.format === 'word_recog' ? { w: a.words } : {}) });
    }
    await batch.commit();
  }
  for (const [fmt, list] of Object.entries(byFormat)) {
    const ref = db().collection('aiBankIndex').doc(fmt);
    await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.exists ? s.get('recent') || [] : [];
      tx.set(ref, { recent: cur.concat(list).slice(-INDEX_CAP), updatedTs: FieldValue.serverTimestamp() });
    });
  }
  return ids;
}
/** Visible text length of an item (for the RT model, D.5). */
function textLen(it) {
  const parts = [it.prompt || ''];
  const b = it.body || {};
  ['story', 'sentence', 'desc', 'text', 'instruction'].forEach((k) => { if (typeof b[k] === 'string') parts.push(b[k]); });
  if (Array.isArray(b.steps)) parts.push(...b.steps);
  if (Array.isArray(b.line)) parts.push(b.line.join(''));
  return parts.reduce((a, s) => a + vlen(s), 0);
}
const choiceCount = (it) => (Array.isArray(it.choices) ? it.choices.length : Array.isArray(it.options) ? it.options.length : it.format === 'word_recog' ? (it.body.targets.length + it.body.foils.length) : null);

// --------------------------------------------------------------------- packs
/** Full item of a bank doc (stored as JSON). */
const itemOf = (d) => { try { return JSON.parse(d.json || '{}'); } catch { return {}; } };
/** What the app receives for one item: no qa, no hashes, no internal bookkeeping. */
function packItem(bankDoc) {
  const d = { ...itemOf(bankDoc), id: bankDoc.id, status: bankDoc.status, role: bankDoc.role };
  const measure = d.role === 'reference' || d.status === 'frozen' || d.role === 'anchor';
  const o = {
    id: d.id, format: d.format, cdomain: d.cdomain, level: d.level, role: d.status === 'frozen' ? 'anchor' : d.role,
    specVer: d.specVer || null, theme: d.theme || null, prompt: d.prompt || null, speak: d.speak || null,
    body: d.body || {}, choices: Array.isArray(d.choices) ? d.choices : null, options: d.options || null, present: d.present || null,
    explain: measure ? null : d.explain || null, validFrom: d.validFrom || null, validTo: d.validTo || null,
    noFeedback: measure, review: undefined,
  };
  if (d.format === 'reminiscence') o.talk = (d.body && d.body.talk) || null;
  delete o.review;
  return o;
}
/** One trainee's training packs. Theme items only when the theme is one of that trainee's themes. */
async function rebuildPacks(fid, mid, themes = [], cells = null) {
  const out = {};
  const todo = cells || CELL_DOMAINS.flatMap((cd) => [1, 2, 3, 4, 5].map((lv) => [cd, lv])).concat([['reminiscence', 2]]);
  const today = kd.kst().date;
  const mine = new Set(themes || []);
  const col = fam(fid).collection('trainees').doc(mid).collection('aiPacks');
  for (const [cd, lv] of todo) {
    const q = await db().collection('aiBank').where('status', '==', 'ready').where('role', '==', 'training').where('cdomain', '==', cd).where('level', '==', lv).limit(PACK_SIZE * 3).get();
    const items = q.docs.map((d) => d.data()).filter((d) => !(d.validTo && d.validTo < today) && (!d.theme || mine.has(d.theme))).slice(0, PACK_SIZE).map(packItem);
    await col.doc(`${cd}-L${lv}`).set({ v: 1, cd, lv, n: items.length, itemsJson: JSON.stringify(items), builtTs: FieldValue.serverTimestamp() });
    out[`${cd}|${lv}`] = items.length;
  }
  return out;
}

// ------------------------------------------------------------- measure sets
const recipeList = (recipe) => Object.entries(recipe).flatMap(([cd, fm]) => Object.entries(fm).map(([format, n]) => ({ cd, format, n })));
async function pick(where, n) {
  let q = db().collection('aiBank');
  for (const [k, v] of Object.entries(where)) q = q.where(k, '==', v);
  const s = await q.limit(n).get();
  return s.docs;
}
/** Reserve trainee L's reference set for week `wk` (status reserved, refWeek 'wk:L'). Returns { ok, ids, missing }. */
async function reserveReference(wk, L, levels) {
  const key = refWeekKey(wk, L);
  const ex = await db().collection('aiBank').where('refWeek', '==', key).get();
  if (!ex.empty) return { ok: true, ids: ex.docs.map((d) => d.id), missing: [] };
  const chosen = [], missing = [];
  for (const { cd, format, n } of recipeList(REF.weekly)) {
    const docs = await pick({ status: 'ready', role: 'reference', format, level: levels[cd] || REF.defaultLevel, specVer: SPEC_VER }, n);
    if (docs.length < n) missing.push({ cd, format, lv: levels[cd] || REF.defaultLevel, n: n - docs.length });
    chosen.push(...docs);
  }
  if (missing.length) return { ok: false, ids: [], missing };
  const b = db().batch();
  chosen.forEach((d) => b.update(d.ref, { status: 'reserved', refWeek: key }));
  await b.commit();
  return { ok: true, ids: chosen.map((d) => d.id), missing };
}
/** Freeze an anchor set once (bank key '<A|B|C>_<L>'). Content, choice order and positions never change afterwards. */
async function freezeAnchor(set, levels) {
  const ex = await db().collection('aiBank').where('anchorSet', '==', set).get();
  if (!ex.empty) return { ok: true, ids: ex.docs.map((d) => d.id), missing: [] };
  const chosen = [], missing = [];
  for (const { cd, format, n } of recipeList(REF.anchor)) {
    const docs = await pick({ status: 'ready', role: 'anchor_candidate', format, level: levels[cd] || REF.defaultLevel, specVer: SPEC_VER }, n);
    if (docs.length < n) missing.push({ cd, format, lv: levels[cd] || REF.defaultLevel, n: n - docs.length });
    chosen.push(...docs);
  }
  if (missing.length) return { ok: false, ids: [], missing };
  const b = db().batch();
  chosen.forEach((d) => b.update(d.ref, { status: 'frozen', anchorSet: set, frozenHash: d.get('hash'), frozenTs: FieldValue.serverTimestamp() }));   // json never changes after this
  await b.commit();
  return { ok: true, ids: chosen.map((d) => d.id), missing };
}
/** Write trainees/{mid}/aiPacks/measure-{wk}: that trainee's reserved reference set + the anchor set scheduled that week. */
async function buildMeasurePack(fid, mid, L, wk, anchorSet, levels) {
  const ref = await reserveReference(wk, L, levels);
  let anchor = { ok: true, ids: [] };
  if (anchorSet) anchor = await freezeAnchor(anchorKey(anchorSet, L), levels);
  const load = async (ids) => (ids.length ? (await db().getAll(...ids.map((id) => db().collection('aiBank').doc(id)))).filter((s) => s.exists).map((s) => packItem(s.data())) : []);
  const reference = ref.ok ? await load(ref.ids) : [], anchorItems = anchor.ok && anchorSet ? await load(anchor.ids) : [];
  const doc = {
    v: 1, week: wk, start: kd.weekStart(wk), specVer: SPEC_VER, nRef: reference.length, nAnchor: anchorItems.length,
    referenceJson: JSON.stringify(reference), anchorJson: JSON.stringify(anchorItems),
    anchorSet: anchorSet || null, plan: { perDay: REF.perDay, firstPosition: 1 }, noFeedback: true, ready: ref.ok && anchor.ok, builtTs: FieldValue.serverTimestamp(),
  };
  await fam(fid).collection('trainees').doc(mid).collection('aiPacks').doc('measure-' + wk).set(doc);
  return { ref, anchor };
}

// --------------------------------------------------------------- bank needs
/**
 * Counts of usable items per (status, role, cdomain, level, format). One pass over the live part of the bank
 * (select only). 'used' and 'retired' items are the bulk after a few months and are not counted, so the reads per
 * call stay near the bank's working size instead of growing with every item ever made. `total` = live items.
 */
const LIVE = ['ready', 'pending_review', 'quarantine', 'reserved', 'frozen'];
async function bankCounts() {
  const s = await db().collection('aiBank').where('status', 'in', LIVE).select('status', 'role', 'cdomain', 'level', 'format', 'validTo', 'refWeek', 'anchorSet').get();
  const c = { cell: {}, fmt: {}, ref: {}, anchorCand: {}, review: 0, quarantine: 0, total: s.size, frozen: {}, reservedWeeks: new Set() };
  const today = kd.kst().date;
  s.forEach((d) => {
    const x = d.data();
    if (x.status === 'pending_review') c.review++;
    if (x.status === 'quarantine') c.quarantine++;
    if (x.status === 'frozen' && x.anchorSet) c.frozen[x.anchorSet] = (c.frozen[x.anchorSet] || 0) + 1;
    if (x.status === 'reserved' && x.refWeek) c.reservedWeeks.add(x.refWeek);
    if (x.status !== 'ready' || (x.validTo && x.validTo < today)) return;
    if (x.role === 'training') {
      const k = `${x.cdomain}|${x.level}`; c.cell[k] = (c.cell[k] || 0) + 1;
      const f = `${x.cdomain}|${x.format}|${x.level}`; c.fmt[f] = (c.fmt[f] || 0) + 1;
    } else if (x.role === 'reference') { const k = `${x.format}|${x.level}`; c.ref[k] = (c.ref[k] || 0) + 1; }
    else if (x.role === 'anchor_candidate') { const k = `${x.format}|${x.level}`; c.anchorCand[k] = (c.anchorCand[k] || 0) + 1; }
  });
  return c;
}
/**
 * aiAggregates/bankNeeds (bw.needs.v1): what the generator should make next. No scores, no names, no member ids.
 * Shared by every trainee: reference and anchor demand is summed over the trainees' own levels (letters only),
 * training cells and the item cap scale with the number of active trainees. Priority under limits.maxItems:
 * reference sets → anchor candidates → training cells.
 * subjects: [{ L, plan }] (aiState/plan per trainee, sorted by letter); nTrainees: trainees in T (≥ 1).
 */
async function writeBankNeeds({ subjects = [], nTrainees = 1, themes, counts, validator }) {
  const n = Math.max(1, nTrainees || subjects.length || 1);
  const subs = subjects.length ? subjects : [{ L: 'A', plan: null }];
  const lvOf = (plan, cd) => ((plan && plan.refLevels) || {})[cd] || REF.defaultLevel;
  const needs = [];
  const weeksWanted = REF.reserveWeeksAhead + REF.spareWeeks;
  const refWant = new Map(), ancWant = new Map();     // 'cd|format|lv' → items wanted
  for (const { L, plan } of subs) {
    for (const { cd, format, n: k } of recipeList(REF.weekly)) { const key = `${cd}|${format}|${lvOf(plan, cd)}`; refWant.set(key, (refWant.get(key) || 0) + k * weeksWanted); }
    const anchorsNeeded = ANCHOR_SETS.filter((set) => !counts.frozen[anchorKey(set, L)]).length;
    if (anchorsNeeded) for (const { cd, format, n: k } of recipeList(REF.anchor)) { const key = `${cd}|${format}|${lvOf(plan, cd)}`; ancWant.set(key, (ancWant.get(key) || 0) + k * anchorsNeeded); }
  }
  for (const [key, want] of refWant) {
    const [cd, format, lv] = key.split('|');
    const per = recipeList(REF.weekly).find((x) => x.cd === cd && x.format === format).n;
    const left = want - (counts.ref[`${format}|${lv}`] || 0);
    if (left > 0) needs.push({ cd, fmt: format, lv: Number(lv), role: 'reference', n: Math.min(left, per * 3 * subs.length) });
  }
  for (const [key, want] of ancWant) {
    const [cd, format, lv] = key.split('|');
    const left = want - (counts.anchorCand[`${format}|${lv}`] || 0);
    if (left > 0) needs.push({ cd, fmt: format, lv: Number(lv), role: 'anchor_candidate', n: left });
  }
  const cellTarget = CELL_TARGET * n, fmtMin = FMT_MIN * n;
  for (const cd of CELL_DOMAINS) for (let lv = 1; lv <= 5; lv++) {
    const have = counts.cell[`${cd}|${lv}`] || 0;
    if (have >= cellTarget) continue;
    const fmts = TRAINING_FORMATS(cd);
    const missing = cellTarget - have;
    fmts.forEach((f) => {
      const per = Math.max(Math.ceil(missing / fmts.length), fmtMin - (counts.fmt[`${cd}|${f}|${lv}`] || 0));
      if (per > 0) needs.push({ cd, fmt: f, lv, role: 'training', n: per });
    });
  }
  if ((counts.cell['reminiscence|2'] || 0) < 6 * n && counts.review < 10) needs.push({ cd: 'reminiscence', fmt: 'reminiscence', lv: 2, role: 'training', n: 6 });
  // cap to maxItems in priority order
  const maxItems = maxItemsFor(n);
  let left = maxItems; const cells = [];
  for (const role of ['reference', 'anchor_candidate', 'training']) for (const x of needs.filter((y) => y.role === role)) {
    if (left <= 0) break; const k = Math.min(x.n, left); cells.push({ ...x, n: k }); left -= k;
  }
  const recentStems = {};
  const idx = await db().collection('aiBankIndex').get();
  idx.forEach((d) => { if (!d.id.startsWith('_')) recentStems[d.id] = (d.get('stems') || []).slice(-30); });
  const today = kd.kst().date;
  const levelsOf = (plan) => Object.fromEntries(Object.keys(REF.weekly).map((cd) => [cd, lvOf(plan, cd)]));
  const doc = {
    schema: 'bw.needs.v1', asOf: new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00').replace(/\.\d{3}/, ''),
    today, specVer: SPEC_VER, cells,
    reference: {
      weeks: plannedWeeks(subs.find((x) => x.plan) ? subs.find((x) => x.plan).plan : null), specVer: SPEC_VER,
      levels: levelsOf(subs[0].plan),                                            // compat: the first subject's levels
      levelSets: subs.map((x) => ({ s: x.L, levels: levelsOf(x.plan) })),
    },
    dateWindow: { from: today, to: kd.addDays(today, 21) },
    themes: themes || [], recentStems, limits: { maxItems }, validator: validator || null, expireAt: expireIn(90),
  };
  await db().collection('aiAggregates').doc('bankNeeds').set(doc);
  return doc;
}
function plannedWeeks(plan) {
  if (!plan || !plan.startDate) return [];
  const cur = kd.weekKey(kd.kst().date);
  return [0, 1, 2].map((i) => kd.nextWeekKey(cur, i));
}

/** Short prompt stems for the generator's "do not repeat" list (first 20 visible chars). */
async function addStems(items) {
  const by = {};
  items.forEach((it) => { const s = (it.prompt || (it.body && (it.body.story || it.body.title || it.body.sentence || it.body.desc)) || '').slice(0, 20); if (s) (by[it.format] = by[it.format] || []).push(s); });
  for (const [fmt, list] of Object.entries(by)) {
    const ref = db().collection('aiBankIndex').doc(fmt);
    await ref.set({ stems: FieldValue.arrayUnion(...list) }, { merge: true });
    const s = await ref.get(); const st = s.get('stems') || [];
    if (st.length > 60) await ref.update({ stems: st.slice(-60) });
  }
}

// ------------------------------------------------------- exposures & review
const QUAR_RT_FACTOR = 3;
/**
 * Mark bank items seen in an itemLogs doc. Training: used (back to ready after 60 days, max 3 exposures).
 * Reference: used. Anchors: stay frozen. Shared bank: whoever saw it, it is used for every trainee. Applies quarantine rules ② (same wrong pick twice) and ③ (wrong and
 * RT ≥ 3× the cell's running median) from §2.8 using a small per-cell running stat.
 */
async function recordExposures(log) {
  const ids = [...new Set(log.items.map((x) => (x.id || '').split('#')[0]).filter((id) => /^bk_[0-9a-f]{20}$/.test(id)))];
  if (!ids.length) return { touched: [] };
  const snaps = await db().getAll(...ids.map((id) => db().collection('aiBank').doc(id)));
  const cellsRef = db().collection('aiBankIndex').doc('_cells');
  const cellsSnap = await cellsRef.get(); const cells = cellsSnap.exists ? cellsSnap.data() : {};
  const b = db().batch(); const touched = new Set(); let quarantined = 0;
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data();
    const xs = log.items.filter((x) => (x.id || '').split('#')[0] === d.id);
    const ok = xs.every((x) => x.ok), rt = xs.reduce((a, x) => a + (x.rt || 0), 0) || null;
    const exp = { date: log.date, role: xs[0].role, ok, pick: xs[0].pick || [], rt };
    const exposures = (d.exposures || []).concat(exp).slice(-5);
    const upd = { exposures, nExp: (d.nExp || 0) + 1, lastExposed: log.date };
    const ck = `${d.cdomain}|${d.level}`;
    const c = cells[ck] || { n: 0, ok: 0, lrt: null };
    if (d.status === 'ready' || d.status === 'reserved') upd.status = 'used';
    if (d.role === 'training' && !ok) {
      const prev = (d.exposures || []).filter((e) => !e.ok);
      const sameWrong = prev.some((e) => JSON.stringify(e.pick) === JSON.stringify(exp.pick)) && c.n >= 20 && c.ok / c.n >= 0.8;
      const slowWrong = rt && c.lrt != null && Math.log(rt) - c.lrt >= Math.log(QUAR_RT_FACTOR);
      if (sameWrong || slowWrong) { upd.status = 'quarantine'; upd.quarantineWhy = sameWrong ? 'same_wrong_pick' : 'slow_wrong'; quarantined++; }
    }
    if (d.status === 'frozen') delete upd.status;
    if (upd.status === 'used' && (d.nExp || 0) + 1 >= 3 && d.role === 'training') upd.status = 'retired';
    if (upd.status === 'retired') upd.retiredTs = FieldValue.serverTimestamp();
    b.update(s.ref, upd);
    cells[ck] = { n: c.n + 1, ok: c.ok + (ok ? 1 : 0), lrt: rt ? (c.lrt == null ? Math.log(rt) : c.lrt * 0.95 + Math.log(rt) * 0.05) : c.lrt };
    if (d.role === 'training') touched.add(`${d.cdomain}|${d.level}`);
  }
  b.set(cellsRef, cells);
  await b.commit();
  // the caller rebuilds the packs of the touched cells (shared bank → every trainee's packs)
  return { touched: [...touched], cells: [...touched].map((k) => { const [cd, lv] = k.split('|'); return [cd, Number(lv)]; }), quarantined };
}
/** Training items used ≥ 60 days ago with < 3 exposures go back to ready; reserved reference sets of past weeks become used. */
async function reactivate() {
  const cutoff = kd.addDays(kd.kst().date, -60);
  const s = await db().collection('aiBank').where('status', '==', 'used').where('lastExposed', '<', cutoff).limit(400).get();
  const b = db().batch(); let n = 0;
  s.forEach((d) => { if (d.get('role') === 'training' && (d.get('nExp') || 0) < 3) { b.update(d.ref, { status: 'ready' }); n++; } });
  if (n) await b.commit();
  return n;
}
/** Admin review decision on a bank item (aiReview trigger). */
async function applyReview(itemId, decision) {
  if (!/^bk_[0-9a-f]{20}$/.test(itemId)) return 'bad_id';
  const ref = db().collection('aiBank').doc(itemId);
  const s = await ref.get(); if (!s.exists) return 'missing';
  const st = s.get('status');
  if (st === 'frozen') return decision === 'flag' ? (await ref.update({ excluded: true }), 'excluded') : 'frozen';
  const to = decision === 'approve' ? (['pending_review', 'quarantine'].includes(st) ? 'ready' : st) : decision === 'retire' ? 'retired' : 'quarantine';
  await ref.update({ status: to, reviewedTs: FieldValue.serverTimestamp(), ...(decision === 'flag' ? { quarantineWhy: 'admin_flag' } : {}), ...(to === 'retired' ? { retiredTs: FieldValue.serverTimestamp() } : {}) });
  return to;
}

/** Admin-facing bank summary (aiOps/bank) and review list (aiOps/review). */
async function writeBankStatus(fid, counts, extra = {}) {
  await fam(fid).collection('aiOps').doc('bank').set({
    cells: counts.cell, review: counts.review, quarantine: counts.quarantine, total: counts.total,
    // anchors: frozen items per set summed over trainees (A = A_A + A_B …); anchorSets: per '<set>_<L>'
    anchors: Object.fromEntries(ANCHOR_SETS.map((set) => [set, Object.entries(counts.frozen).filter(([k]) => k === set || k.startsWith(set + '_')).reduce((a, [, v]) => a + v, 0)])),
    anchorSets: counts.frozen, reservedWeeks: [...counts.reservedWeeks].sort(),
    ...extra, updatedTs: FieldValue.serverTimestamp(),
  }, { merge: true });
  const rev = await db().collection('aiBank').where('status', 'in', ['pending_review', 'quarantine']).limit(50).get();
  await fam(fid).collection('aiOps').doc('review').set({
    n: rev.size,
    itemsJson: JSON.stringify(rev.docs.map((d) => { const x = d.data(), it = itemOf(x); return { ...packItem(x), status: x.status, why: x.status === 'pending_review' ? 'reminiscence' : (x.quarantineWhy || 'quarantine'), basis: (it.qa && it.qa.basis) || null, risk: (it.qa && it.qa.risk) || null, nExp: x.nExp || 0 }; })),
    updatedTs: FieldValue.serverTimestamp(),
  });
}

module.exports = {
  itemOf, CELL_DOMAINS, FORMATS_OF, bankId, loadRecent, takeQuota, insertAccepted, packItem, rebuildPacks, reserveReference, freezeAnchor,
  buildMeasurePack, bankCounts, refWeekKey, anchorKey, ANCHOR_SETS, writeBankNeeds, addStems, recordExposures, reactivate, applyReview, writeBankStatus, textLen, Timestamp,
};
