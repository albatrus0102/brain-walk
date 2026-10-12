'use strict';
/**
 * Per-family aggregation run (DESIGN-AI §5.1): 06:50 daily, and after the course is done (progress doc).
 *   eligibility → plan → ingest itemLogs into weekly stats → speed model → summary → anchor comparison →
 *   signal engine → aiSignals on/off → pseudonymized aggregate (aiAggregates/current + dated copy) →
 *   (daily) measure packs, training packs, bank needs, bank status
 * Returns { ran, reason, aggId, newOrange[] }.
 */
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const kd = require('./core/kdate.js');
const SR = require('./core/series.js');
const { evaluate, speedBaseline, DEFAULT_T } = require('./core/signals.js');
const { anchorCompare } = require('./core/anchor.js');
const { buildAggregate } = require('./core/aggregate.js');
const bank = require('./bank.js');
const { getConfig, RETENTION_DAYS } = require('./config.js');
const { VERSION } = require('./core/index.js');
const log = require('./log.js');

const CONSENT_KIND = 'ai-report-notice';

/** Is the configured family ready for aggregation? Returns { ok, why, traineeId, plan, ... }. */
async function eligibility(fid) {
  const f = fam(fid);
  const [famSnap, trSnap, swSnap] = await Promise.all([f.get(), f.collection('state').doc('trainee').get(), f.collection('aiState').doc('switch').get()]);
  if (!famSnap.exists) return { ok: false, why: 'no_family' };
  if (swSnap.exists && swSnap.get('enabled') === false) return { ok: false, why: 'switched_off' };
  const traineeId = trSnap.exists ? trSnap.get('userId') : null;
  if (!traineeId) return { ok: false, why: 'no_trainee' };
  const c = await f.collection('consents').doc(traineeId).get();
  if (!c.exists || c.get('kind') !== CONSENT_KIND || c.get('withdrawnTs') || !c.get('ackTs')) return { ok: false, why: 'no_consent', traineeId };
  return { ok: true, traineeId, consentTs: c.get('ackTs') };
}

/** aiState/plan: created on first eligible run; program starts the Sunday on/after consent. */
async function loadPlan(fid, consentTs) {
  const ref = fam(fid).collection('aiState').doc('plan');
  const s = await ref.get();
  if (s.exists) return s.data();
  const ackDate = kd.kst(consentTs && consentTs.toMillis ? consentTs.toMillis() : Date.now()).date;
  const startDate = kd.weekday(ackDate) === 0 ? ackDate : kd.addDays(kd.sundayOf(ackDate), 7);
  const plan = { v: 1, startDate, startWeek: kd.weekKey(startDate), phase: 'familiarization', refLevels: null, specVer: 'ref-v1', changePoints: [], createdTs: FieldValue.serverTimestamp() };
  await ref.set(plan);
  return plan;
}

async function readLogs(fid, traineeId, fromDate, toDate) {
  const s = await fam(fid).collection('itemLogs').where('date', '>=', fromDate).where('date', '<=', toDate).get();
  return s.docs.map((d) => SR.sanitizeLog(d.data(), d.id)).filter((x) => x && x.userId === traineeId);
}
async function bankMeta(logs) {
  const ids = [...new Set(logs.flatMap((l) => l.items.map((x) => (x.id || '').split('#')[0])).filter((id) => /^bk_[0-9a-f]{20}$/.test(id)))];
  const meta = {};
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db().getAll(...ids.slice(i, i + 100).map((id) => db().collection('aiBank').doc(id)));
    snaps.forEach((s) => { if (s.exists) meta[s.id] = { len: s.get('len'), nch: s.get('nch'), fmt: s.get('format'), lv: s.get('level') }; });
  }
  // story questions are logged as bk_xxx#qN: same meta
  for (const l of logs) for (const x of l.items) { const base = (x.id || '').split('#')[0]; if (x.id && meta[base] && !meta[x.id]) meta[x.id] = meta[base]; }
  return meta;
}

async function runFamily(fid, { mode = 'daily', reason = 'schedule', nowMs = Date.now(), daily = false } = {}) {
  const cfg = await getConfig();
  if (cfg.enabled === false) return { ran: false, reason: 'disabled' };
  const el = await eligibility(fid);
  const health = fam(fid).collection('aiOps').doc('health');
  if (!el.ok) {
    await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: el.why } }, { merge: true });
    if (el.why === 'switched_off') await clearAggregates();
    return { ran: false, reason: el.why };
  }
  const plan = await loadPlan(fid, el.consentTs);
  const now = kd.kst(nowMs);
  const curWk = kd.weekKey(now.date);
  const idxOf = (wk) => kd.weeksBetween(plan.startWeek, wk);
  const curIdx = idxOf(curWk);
  if (curIdx < 0) { await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: 'waiting_start' } }, { merge: true }); return { ran: false, reason: 'before_start' }; }

  const statsCol = fam(fid).collection('aiStats');
  const sumRef = statsCol.doc('summary');
  const sumSnap = await sumRef.get();
  const summary = sumSnap.exists ? sumSnap.data() : { v: 1, weeks: [], anchorCmp: [] };
  summary.weeks = summary.weeks || []; summary.anchorCmp = summary.anchorCmp || [];

  // ---- ingest: previous and current week, plus every week since the start that the summary lacks
  // (first run, or after an outage; at most 30 weeks per run so one run stays small)
  const known = new Set(summary.weeks.map((w) => w.wk));
  let want = [];
  for (let i = 0; i <= curIdx; i++) { const wk = kd.nextWeekKey(plan.startWeek, i); if (!known.has(wk) || i >= curIdx - 1) want.push(wk); }
  if (want.length > 30) want = want.slice(0, 28).concat(want.slice(-2));
  const logs = await readLogs(fid, el.traineeId, kd.weekStart(want[0]), now.date);
  const meta = await bankMeta(logs);
  const modelRef = statsCol.doc('model');
  let model = (await modelRef.get()).data() || null;
  const weekDocs = {};
  for (const wk of want) {
    const ws = SR.weekStats(wk, logs.filter((l) => l.date >= kd.weekStart(wk) && l.date <= kd.weekEnd(wk)), meta);
    weekDocs[wk] = ws;
    await statsCol.doc(wk).set({ ...ws, idx: idxOf(wk), expireAt: expireIn(RETENTION_DAYS.stats), updatedTs: FieldValue.serverTimestamp() });
  }
  // ---- reference levels after the familiarization week
  if (!plan.refLevels && curIdx >= 1) {
    const w0 = weekDocs[plan.startWeek] || (await statsCol.doc(plan.startWeek).get()).data();
    plan.refLevels = SR.chooseRefLevels((w0 && w0.trainCells) || {});
    await fam(fid).collection('aiState').doc('plan').set({ refLevels: plan.refLevels }, { merge: true });
  }
  // ---- speed model after the baseline (D.5); re-score every week once it exists
  if (!model && curIdx > SR.BASELINE_WEEKS) {
    const bw = [];
    for (let i = 1; i <= SR.BASELINE_WEEKS; i++) { const wk = kd.nextWeekKey(plan.startWeek, i); const d = weekDocs[wk] || (await statsCol.doc(wk).get()).data(); if (d) { weekDocs[wk] = d; bw.push(...(d.rows || [])); } }
    model = SR.fitSpeedModel(bw);
    if (model) {
      await modelRef.set({ ...model, fittedTs: FieldValue.serverTimestamp() });
      for (const w of summary.weeks) if (!weekDocs[w.wk]) { const d = (await statsCol.doc(w.wk).get()).data(); if (d) weekDocs[w.wk] = d; }
    }
  }
  for (const [wk, ws] of Object.entries(weekDocs)) {
    const e = SR.summaryEntry(ws, idxOf(wk), model);
    const i = summary.weeks.findIndex((w) => w.wk === wk);
    if (i >= 0) summary.weeks[i] = e; else summary.weeks.push(e);
  }
  summary.weeks.sort((a, b) => a.idx - b.idx);
  summary.weeks = summary.weeks.slice(-260);

  // ---- change points (device / text size / voice) after the baseline → speed re-baseline
  const cps = plan.changePoints || [];
  for (let i = 1; i < summary.weeks.length; i++) {
    const a = summary.weeks[i - 1], b = summary.weeks[i];
    if (a.env && b.env && a.env !== b.env && b.idx > SR.BASELINE_WEEKS && !cps.some((c) => c.date === b.start)) cps.push({ date: b.start, kind: 'env' });
  }
  if (cps.length !== (plan.changePoints || []).length) { plan.changePoints = cps; await fam(fid).collection('aiState').doc('plan').set({ changePoints: cps }, { merge: true }); }

  // ---- anchor comparison when the last completed week was an anchor week with a prior run of the same set
  const completed = summary.weeks.filter((w) => w.wk < curWk);
  const lastDone = completed[completed.length - 1];
  if (lastDone && lastDone.anchorSet && lastDone.idx >= 13 && !summary.anchorCmp.some((c) => c.wk === lastDone.wk)) {
    const prevWk = kd.nextWeekKey(lastDone.wk, -12);
    const [cur, prev] = await Promise.all([statsCol.doc(lastDone.wk).get(), statsCol.doc(prevWk).get()]);
    if (cur.exists && prev.exists) {
      const exSnap = await db().collection('aiBank').where('anchorSet', '==', lastDone.anchorSet).where('excluded', '==', true).get();
      const base = completed.filter((w) => w.idx >= 1 && w.idx <= 4);
      const B = require('./core/stats.js').baseline(base.map((w) => ({ n: w.n, sum: w.sum })));
      const pw = summary.weeks.find((w) => w.wk === prevWk);
      const c = anchorCompare(prev.get('anchorRows') || [], cur.get('anchorRows') || [], {
        phi: B ? B.phi : 1, excluded: new Set(exSnap.docs.map((d) => d.id)), setSize: 20,
        repeats: summary.anchorCmp.map((x) => ({ a1: x.x1, a2: x.x2, r1: x.r1, r2: x.r2 })),
      });
      summary.anchorCmp.push({ ...c, set: lastDone.anchorSet, wk: lastDone.wk, prevWk, idx: lastDone.idx, r1: pw && pw.n ? pw.sum / pw.n : null, r2: lastDone.n ? lastDone.sum / lastDone.n : null });
    }
  }
  const lastCmp = summary.anchorCmp[summary.anchorCmp.length - 1];
  const anchorForEval = lastCmp && lastDone && lastDone.idx - lastCmp.idx < 4 ? lastCmp : null;
  summary.updatedTs = FieldValue.serverTimestamp();
  await sumRef.set(summary);

  // ---- signal engine
  const [notesSnap, thrSnap, assessSnap] = await Promise.all([
    fam(fid).collection('aiNotes').where('from', '>=', kd.addDays(now.date, -180)).get(),
    fam(fid).collection('aiOps').doc('thresholds').get(),
    fam(fid).collection('assessments').orderBy('ts', 'desc').limit(1).get(),
  ]);
  const notes = notesSnap.docs.map((d) => ({ id: d.id, from: d.get('from'), to: d.get('to') || null, codes: d.get('codes') || [] })).sort((a, b) => (a.from < b.from ? -1 : 1));
  const days = {};
  for (const wk of [kd.nextWeekKey(curWk, -3), kd.nextWeekKey(curWk, -2), kd.nextWeekKey(curWk, -1), curWk]) {
    const d = weekDocs[wk] || (await statsCol.doc(wk).get()).data();
    if (d && d.days) Object.assign(days, d.days);
  }
  const trainingDays = await fam(fid).collection('state').doc('plan').get();
  const planWeekdays = trainingDays.exists && Array.isArray(trainingDays.get('weekdays')) ? trainingDays.get('weekdays') : [0, 1, 2, 3, 4, 5, 6];
  const cp = (plan.changePoints || []).filter((c) => c.date > kd.addDays(plan.startDate, 35)).map((c) => c.date).sort().pop() || null;
  const asOf = kd.addDays(now.date, -1);
  const E = evaluate({
    weeks: completed, asOf, days, planWeekdays, notes, anchor: anchorForEval, speedBase: speedBaseline(completed, model, cp),
    thresholds: { ...DEFAULT_T, ...((thrSnap.exists && thrSnap.get('current')) || {}) },
  });

  // ---- aiSignals on/off; newly orange = off→orange or yellow→orange
  const sigCol = fam(fid).collection('aiSignals');
  const open = await sigCol.where('on', '==', true).get();
  const openBy = new Map(open.docs.map((d) => [d.get('key'), d]));
  const newOrange = [];
  const b = db().batch();
  for (const s of E.signals) {
    const prev = openBy.get(s.key);
    if (prev) {
      const prevLevel = prev.get('level');
      if (s.level === 'orange' && prevLevel !== 'orange') newOrange.push(s);
      b.update(prev.ref, { level: s.level, why: s.why, lastSeen: asOf, downgradedBy: s.downgradedBy, notes: s.notes, levels: FieldValue.arrayUnion(`${asOf}:${s.level}`), maxLevel: prevLevel === 'orange' || s.level === 'orange' ? 'orange' : 'yellow' });
      E.indicators[s.key].since = prev.get('since');
      openBy.delete(s.key);
    } else {
      if (s.level === 'orange') newOrange.push(s);
      b.set(sigCol.doc(`${s.key.replace(':', '-')}-${asOf}`), { key: s.key, rule: s.rule, domain: s.domain, level: s.level, maxLevel: s.level, on: true, since: asOf, lastSeen: asOf, why: s.why, downgradedBy: s.downgradedBy, notes: s.notes, levels: [`${asOf}:${s.level}`], expireAt: expireIn(RETENTION_DAYS.signals) });
      E.indicators[s.key].since = asOf;
    }
  }
  for (const [, d] of openBy) b.update(d.ref, { on: false, until: asOf });
  await b.commit();

  // ---- aggregate (no names, no family id, no free text)
  const todayLogs = logs.filter((l) => l.date === now.date);
  const today = todayLogs.length ? {
    trained: todayLogs.some((l) => l.inCourse), games: todayLogs.length, items: todayLogs.reduce((a, l) => a + l.items.length, 0),
    refItems: todayLogs.reduce((a, l) => a + l.items.filter((x) => x.role === 'reference').length, 0),
    refScore: todayLogs.reduce((a, l) => a + l.items.filter((x) => x.role === 'reference' && x.ok).length, 0),
    startHour: Math.min(...todayLogs.map((l) => (l.hour == null ? 24 : l.hour))), abandoned: todayLogs.filter((l) => l.abandoned).length,
  } : null;
  if (today && today.startHour === 24) today.startHour = null;
  const lastW = completed[completed.length - 1];
  const assess = assessSnap.docs[0];
  const aggId = `a-${now.date.replace(/-/g, '')}-${now.hhmm}${mode === 'alert' ? '-al' : ''}`;
  const agg = buildAggregate({
    id: aggId, asOfMs: nowMs, mode, pseudonym: cfg.pseudonym || '사용자 A', phase: SR.phaseOf(curIdx), eval: E, plan, today, notes: notes.filter((n) => !n.to || n.to >= kd.addDays(now.date, -56)).slice(-6), weeks: completed,
    extra: { dateQWrong: lastW ? lastW.dateQ.wrong : null, iiv: lastW ? lastW.iiv : null, ies: lastW ? lastW.ies : null, checkTotal: assess ? assess.get('total') : null, checkDate: assess ? assess.get('date') : null },
  });
  const aggDoc = { ...agg, expireAt: expireIn(RETENTION_DAYS.aggregates) };
  await db().collection('aiAggregates').doc(aggId).set(aggDoc);
  if (mode !== 'alert') await db().collection('aiAggregates').doc('current').set(aggDoc);

  // ---- daily upkeep: measure packs (this + next 2 weeks), training packs, bank needs, status
  if (daily) {
    const levels = plan.refLevels || {};
    for (let k = 0; k <= 2; k++) {
      const wk = kd.nextWeekKey(curWk, k), idx = idxOf(wk);
      if (idx >= 1) await bank.buildMeasurePack(fid, wk, SR.anchorSetFor(idx), levels);
    }
    await bank.reactivate();
    await bank.rebuildPacks(fid);
    const themesSnap = await fam(fid).collection('aiState').doc('themes').get();
    const counts = await bank.bankCounts();
    await bank.writeBankNeeds({ plan, themes: validThemes(themesSnap.exists ? themesSnap.get('words') : []), counts, validator: { version: VERSION } });
    await bank.writeBankStatus(fid, counts);
  }
  await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: 'ok', reason }, thresholdsVer: E.thresholdsVer, phase: SR.phaseOf(curIdx), lastAggId: aggId }, { merge: true });
  log.info('aggregate', { mode, reason, weeks: completed.length, signals: E.signals.length, newOrange: newOrange.length, phaseIdx: curIdx });
  return { ran: true, aggId, newOrange, agg };
}

/** Theme words check (B.7): ≤ 8, 1–10 Hangul syllables each, no banned word, no PII, not a person name. */
function validThemes(words) {
  const { lexicon } = require('./core/lexicon.js');
  const { bannedHit, piiHit } = require('./core/checks.js');
  const lx = lexicon();
  return (Array.isArray(words) ? words : []).filter((w) => typeof w === 'string' && /^[가-힣]{1,10}$/.test(w) && !bannedHit(lx, w) && !piiHit(lx, w) && !lx.names.has(w)).slice(0, 8);
}
async function clearAggregates() {
  for (const col of ['aiAggregates', 'aiJobs']) {
    const s = await db().collection(col).limit(400).get();
    if (s.empty) continue;
    const b = db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
  }
}

module.exports = { runFamily, eligibility, loadPlan, validThemes, clearAggregates, CONSENT_KIND };
