'use strict';
/**
 * Aggregation runs (DESIGN-AI §5.1, DESIGN-MULTI §4.2): 06:50 daily for every trainee in state/trainees (one after
 * the other), and for one trainee after their course is done (progress doc).
 * Per trainee (all docs under families/{fid}/trainees/{mid}/…):
 *   eligibility → pseudonym letter L → plan → ingest that trainee's itemLogs into weekly stats → speed model →
 *   summary → anchor comparison → signal engine → aiSignals on/off → pseudonymized aggregate
 *   (aiAggregates/a-{L}-YYYYMMDD-HHMM + aiAggregates/current-{L}) → (daily) measure packs, training packs
 * Then, once per family (daily): reactivation, shared bank needs, bank status.
 * runTrainee returns { ran, reason, L, aggId, newOrange[], agg }.
 */
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const kd = require('./core/kdate.js');
const SR = require('./core/series.js');
const { evaluate, speedBaseline, DEFAULT_T } = require('./core/signals.js');
const { anchorCompare } = require('./core/anchor.js');
const { buildAggregate } = require('./core/aggregate.js');
const bank = require('./bank.js');
const { getConfig, RETENTION_DAYS } = require('./config.js');
const F = require('./family.js');
const log = require('./log.js');

const CONSENT_KIND = 'ai-report-notice';

/** Family-level gate: the family exists and the family AI switch is not off. */
async function familyGate(fid) {
  const f = fam(fid);
  const [famSnap, swSnap] = await Promise.all([f.get(), f.collection('aiState').doc('switch').get()]);
  if (!famSnap.exists) return { ok: false, why: 'no_family' };
  if (swSnap.exists && swSnap.get('enabled') === false) return { ok: false, why: 'switched_off' };
  return { ok: true };
}
/**
 * Is trainee `mid` ready for aggregation? In state/trainees + consents/{mid} acknowledged and not withdrawn.
 * Returns { ok, why, consentTs }. `T` (from loadTrainees) may be passed to save a read.
 */
async function eligibility(fid, mid, T = null) {
  const g = await familyGate(fid);
  if (!g.ok) return g;
  const set = T || (await F.loadTrainees(fid));
  if (!mid || !set.ids.includes(mid)) return { ok: false, why: 'no_trainee' };
  const c = await fam(fid).collection('consents').doc(mid).get();
  if (!c.exists || c.get('kind') !== CONSENT_KIND || c.get('withdrawnTs') || !c.get('ackTs')) return { ok: false, why: 'no_consent' };
  return { ok: true, consentTs: c.get('ackTs') };
}

/** trainees/{mid}/aiState/plan: created on first eligible run; program starts the Sunday on/after consent. */
async function loadPlan(fid, mid, consentTs) {
  const ref = F.tref(fid, mid).collection('aiState').doc('plan');
  const s = await ref.get();
  if (s.exists) return s.data();
  const ackDate = kd.kst(consentTs && consentTs.toMillis ? consentTs.toMillis() : Date.now()).date;
  const startDate = kd.weekday(ackDate) === 0 ? ackDate : kd.addDays(kd.sundayOf(ackDate), 7);
  const plan = { v: 1, startDate, startWeek: kd.weekKey(startDate), phase: 'familiarization', refLevels: null, specVer: 'ref-v1', changePoints: [], createdTs: FieldValue.serverTimestamp() };
  await ref.set(plan);
  return plan;
}

/** One trainee's itemLogs in [fromDate, toDate] (index: itemLogs userId ASC, date ASC). */
async function readLogs(fid, mid, fromDate, toDate) {
  const s = await fam(fid).collection('itemLogs').where('userId', '==', mid).where('date', '>=', fromDate).where('date', '<=', toDate).get();
  return s.docs.map((d) => SR.sanitizeLog(d.data(), d.id)).filter((x) => x && x.userId === mid);
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

/**
 * Every trainee in state/trainees, sequentially (aiDaily, 540 s), then the shared daily upkeep.
 * Returns { ran (any trainee ran), reason, results: [{ mid, ran, reason, L, aggId, newOrange }] }.
 */
async function runFamily(fid, { mode = 'daily', reason = 'schedule', nowMs = Date.now(), daily = false } = {}) {
  const cfg = await getConfig();
  if (cfg.enabled === false) return { ran: false, reason: 'disabled', results: [] };
  const famHealth = fam(fid).collection('aiOps').doc('health');
  const g = await familyGate(fid);
  if (!g.ok) {
    if (g.why === 'switched_off') { await clearAggregates(); await famHealth.set({ server: { lastRun: FieldValue.serverTimestamp(), state: g.why } }, { merge: true }); }
    return { ran: false, reason: g.why, results: [] };
  }
  const T = await F.loadTrainees(fid);
  if (daily) await bank.reactivate();
  const results = [];
  for (const mid of T.ids) {
    let r;
    try { r = await runTrainee(fid, mid, { mode, reason, nowMs, daily, T }); } catch (e) { log.debugError(e); log.error('trainee_run_failed', { code: e && e.code ? String(e.code) : 'error' }); r = { ran: false, reason: 'error' }; }
    results.push({ mid, ...r });
  }
  if (daily) {
    const counts = await bank.bankCounts();
    await F.writeFamilyBankNeeds(fid, counts);
    await bank.writeBankStatus(fid, counts);
  }
  const ran = results.filter((r) => r.ran).length;
  const state = ran ? 'ok' : !T.ids.length ? 'no_trainee' : (results[0] && results[0].reason) || 'idle';
  await famHealth.set({ server: { lastRun: FieldValue.serverTimestamp(), state, reason, trainees: T.ids.length, ran } }, { merge: true });
  return { ran: ran > 0, reason: state, results };
}

/** One trainee: eligibility, letter, then the aggregation. Health in trainees/{mid}/aiOps/health. */
async function runTrainee(fid, mid, { mode = 'daily', reason = 'schedule', nowMs = Date.now(), daily = false, T = null } = {}) {
  const cfg = await getConfig();
  if (cfg.enabled === false) return { ran: false, reason: 'disabled' };
  const t = F.tref(fid, mid);
  const el = await eligibility(fid, mid, T);
  const health = t.collection('aiOps').doc('health');
  if (!el.ok) {
    if (el.why === 'switched_off') await clearAggregates();
    if (el.why !== 'no_family' && el.why !== 'no_trainee') await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: el.why } }, { merge: true });
    return { ran: false, reason: el.why };
  }
  const L = await F.ensureLetter(mid);
  if (!L) { await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: 'no_letter' } }, { merge: true }); return { ran: false, reason: 'no_letter' }; }
  const plan = await loadPlan(fid, mid, el.consentTs);
  const now = kd.kst(nowMs);
  const curWk = kd.weekKey(now.date);
  const idxOf = (wk) => kd.weeksBetween(plan.startWeek, wk);
  const curIdx = idxOf(curWk);
  if (curIdx < 0) { await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: 'waiting_start' } }, { merge: true }); return { ran: false, reason: 'before_start' }; }

  const statsCol = t.collection('aiStats');
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
  const logs = await readLogs(fid, mid, kd.weekStart(want[0]), now.date);
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
    await t.collection('aiState').doc('plan').set({ refLevels: plan.refLevels }, { merge: true });
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
  if (cps.length !== (plan.changePoints || []).length) { plan.changePoints = cps; await t.collection('aiState').doc('plan').set({ changePoints: cps }, { merge: true }); }

  // ---- anchor comparison when the last completed week was an anchor week with a prior run of the same set
  const completed = summary.weeks.filter((w) => w.wk < curWk);
  const lastDone = completed[completed.length - 1];
  if (lastDone && lastDone.anchorSet && lastDone.idx >= 13 && !summary.anchorCmp.some((c) => c.wk === lastDone.wk)) {
    const prevWk = kd.nextWeekKey(lastDone.wk, -12);
    const [cur, prev] = await Promise.all([statsCol.doc(lastDone.wk).get(), statsCol.doc(prevWk).get()]);
    if (cur.exists && prev.exists) {
      const exSnap = await db().collection('aiBank').where('anchorSet', '==', bank.anchorKey(lastDone.anchorSet, L)).where('excluded', '==', true).get();
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
    t.collection('aiNotes').where('from', '>=', kd.addDays(now.date, -180)).get(),
    t.collection('aiOps').doc('thresholds').get(),
    fam(fid).collection('assessments').where('userId', '==', mid).orderBy('ts', 'desc').limit(1).get(),
  ]);
  const notes = notesSnap.docs.map((d) => ({ id: d.id, from: d.get('from'), to: d.get('to') || null, codes: d.get('codes') || [] })).sort((a, b) => (a.from < b.from ? -1 : 1));
  const days = {};
  for (const wk of [kd.nextWeekKey(curWk, -3), kd.nextWeekKey(curWk, -2), kd.nextWeekKey(curWk, -1), curWk]) {
    const d = weekDocs[wk] || (await statsCol.doc(wk).get()).data();
    if (d && d.days) Object.assign(days, d.days);
  }
  const trainingDays = await t.collection('state').doc('plan').get();
  const planWeekdays = trainingDays.exists && Array.isArray(trainingDays.get('weekdays')) ? trainingDays.get('weekdays') : [0, 1, 2, 3, 4, 5, 6];
  const cp = (plan.changePoints || []).filter((c) => c.date > kd.addDays(plan.startDate, 35)).map((c) => c.date).sort().pop() || null;
  const asOf = kd.addDays(now.date, -1);
  const E = evaluate({
    weeks: completed, asOf, days, planWeekdays, notes, anchor: anchorForEval, speedBase: speedBaseline(completed, model, cp),
    thresholds: { ...DEFAULT_T, ...((thrSnap.exists && thrSnap.get('current')) || {}) },
  });

  // ---- aiSignals on/off; newly orange = off→orange or yellow→orange
  const sigCol = t.collection('aiSignals');
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
  const aggId = `a-${L}-${now.date.replace(/-/g, '')}-${now.hhmm}${mode === 'alert' ? '-al' : ''}`;
  const agg = buildAggregate({
    id: aggId, asOfMs: nowMs, mode, pseudonym: `사용자 ${L}`, phase: SR.phaseOf(curIdx), eval: E, plan, today, notes: notes.filter((n) => !n.to || n.to >= kd.addDays(now.date, -56)).slice(-6), weeks: completed,
    extra: { dateQWrong: lastW ? lastW.dateQ.wrong : null, iiv: lastW ? lastW.iiv : null, ies: lastW ? lastW.ies : null, checkTotal: assess ? assess.get('total') : null, checkDate: assess ? assess.get('date') : null },
  });
  // `s` (the letter) is server bookkeeping: aiRead strips it, purge uses it on consent withdrawal
  const aggDoc = { ...agg, s: L, expireAt: expireIn(RETENTION_DAYS.aggregates) };
  await db().collection('aiAggregates').doc(aggId).set(aggDoc);
  if (mode !== 'alert') await db().collection('aiAggregates').doc(`current-${L}`).set(aggDoc);

  // ---- daily upkeep for this trainee: measure packs (this + next 2 weeks), training packs (own themes)
  if (daily) {
    const levels = plan.refLevels || {};
    for (let k = 0; k <= 2; k++) {
      const wk = kd.nextWeekKey(curWk, k), idx = idxOf(wk);
      if (idx >= 1) await bank.buildMeasurePack(fid, mid, L, wk, SR.anchorSetFor(idx), levels);
    }
    await bank.rebuildPacks(fid, mid, await F.loadThemes(fid, mid));
  }
  await health.set({ server: { lastRun: FieldValue.serverTimestamp(), state: 'ok', reason }, thresholdsVer: E.thresholdsVer, phase: SR.phaseOf(curIdx), lastAggId: aggId }, { merge: true });
  log.info('aggregate', { s: L, mode, reason, weeks: completed.length, signals: E.signals.length, newOrange: newOrange.length, phaseIdx: curIdx });
  return { ran: true, L, aggId: aggDoc.id, newOrange, agg: aggDoc };
}

const validThemes = F.validThemes;
async function clearAggregates() {
  for (const col of ['aiAggregates', 'aiJobs']) {
    const s = await db().collection(col).limit(400).get();
    if (s.empty) continue;
    const b = db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
  }
}

module.exports = { runFamily, runTrainee, eligibility, familyGate, loadPlan, validThemes, clearAggregates, CONSENT_KIND };
