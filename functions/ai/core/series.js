'use strict';
/**
 * itemLogs → weekly stats → series (pure). DESIGN-AI §4, Appendix C.1 / D.
 *
 * Program timeline: week index 0 = familiarization, 1..4 = baseline, ≥5 = monitoring.
 * Anchors at week index 1, 5, 9, 13, … with sets A, B, C rotating (same set every 12 weeks).
 */
const kd = require('./kdate.js');
const S = require('./stats.js');

const MEASURE_DOMAINS = ['memory', 'attention', 'executive', 'language', 'visuospatial'];
const ROLES = ['training', 'reference', 'anchor', 'proc'];
const BASELINE_WEEKS = 4;
const MIN_REF_PER_WEEK = 18;            // 60% of 30 (§4.5)
const ANCHOR_SETS = ['A', 'B', 'C'];

const phaseOf = (idx) => (idx < 0 ? 'none' : idx === 0 ? 'familiarization' : idx <= BASELINE_WEEKS ? 'baseline' : 'monitoring');
const anchorSetFor = (idx) => (idx >= 1 && (idx - 1) % 4 === 0 ? ANCHOR_SETS[((idx - 1) / 4) % 3] : null);

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/**
 * Sanitize one itemLogs doc (client-written; rules only check the top level). Returns null if unusable.
 * Keeps only known fields with sane ranges. Never copies free text.
 */
function sanitizeLog(doc, sid) {
  if (!doc || doc.v !== 1 || !kd.okYmd(doc.date) || !Array.isArray(doc.items)) return null;
  const items = [];
  for (const x of doc.items.slice(0, 20)) {
    if (!x || typeof x !== 'object' || !ROLES.includes(x.role)) continue;
    const errs = Array.isArray(x.err) ? x.err.filter((e) => typeof e === 'string' && /^[A-Z_]{2,24}$/.test(e)).slice(0, 4) : [];
    items.push({
      id: str(x.id, 80), role: x.role, fmt: str(x.fmt, 24), cd: str(x.cd, 16), lv: num(x.lv, 1, 5),
      score: num(x.score, 0, 1), ok: x.ok === true, rt: num(x.rt, 0, 600000), rtStart: str(x.rtStart, 16),
      err: errs, intr: x.intr === true, pos: num(x.pos, 0, 50), pick: Array.isArray(x.pick) ? x.pick.filter((p) => Number.isInteger(p) && p >= 0 && p < 20).slice(0, 14) : [],
    });
  }
  return {
    sid, date: doc.date, userId: str(doc.userId, 64), gameId: str(doc.gameId, 40), inCourse: doc.inCourse === true,
    level: num(doc.level, 1, 5), speechOn: doc.speechOn === true, size: str(doc.size, 10), device: str(doc.device, 20),
    hour: num(doc.hour, 0, 23), abandoned: doc.abandoned === true, items,
  };
}

const answered = (x) => !x.err.includes('OMIT') && !x.err.includes('ABANDON') && x.score != null;
const rtOk = (x) => x.ok && !x.intr && x.rt != null && x.rt >= 200 && x.rt <= 120000;
const mode = (arr) => { const m = new Map(); arr.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); let best = null, n = -1; m.forEach((c, v) => { if (c > n) { n = c; best = v; } }); return best; };

/**
 * Weekly stats doc from sanitized logs of one week (trainee only).
 * meta: { [itemId]: { len, nch, fmt, lv } } from the bank (server-side, not trusted from the client).
 */
function weekStats(wk, logs, meta = {}) {
  const ref = { n: 0, sum: 0, dom: {} };
  MEASURE_DOMAINS.forEach((d) => { ref.dom[d] = { n: 0, sum: 0 }; });
  const rows = [], anchorRows = [], err = {}, days = {}, dateQ = { n: 0, wrong: 0 }, pm = { n: 0, ok: 0 }, train = { n: 0, ok: 0 }, trainCells = {};
  let sessions = 0, abandoned = 0, offered = 0;
  const envs = [];
  for (const L of logs) {
    sessions++; if (L.abandoned) abandoned++;
    const day = days[L.date] || (days[L.date] = { games: 0, abandoned: 0, inCourse: 0 });
    day.games++; if (L.abandoned) day.abandoned++; if (L.inCourse) day.inCourse++;
    envs.push(`${L.device || '?'}|${L.size || '?'}|${L.speechOn ? 1 : 0}`);
    for (const x of L.items) {
      x.err.forEach((e) => { err[e] = (err[e] || 0) + 1; });
      if (x.fmt === 'date_q' || x.cd === 'orientation') { dateQ.n++; if (!x.ok) dateQ.wrong++; }
      if (x.fmt === 'prospective') { pm.n++; if (x.ok) pm.ok++; continue; }
      const m = (x.id && meta[x.id]) || {};
      const row = { id: x.id, cd: x.cd, fmt: m.fmt || x.fmt, lv: m.lv || x.lv, s: x.score, ok: x.ok, rt: x.rt, len: m.len || null, nch: m.nch || null, sp: L.speechOn ? 1 : 0, hr: L.hour, sid: L.sid, role: x.role };
      if (x.role === 'training') {
        if (answered(x)) { train.n++; if (x.ok) train.ok++; const k = `${x.cd}|${x.lv}`; const c = trainCells[k] || (trainCells[k] = [0, 0]); c[0]++; if (x.ok) c[1]++; }
        continue;
      }
      if (x.role === 'reference') {
        offered++;
        if (!answered(x) || !MEASURE_DOMAINS.includes(x.cd)) continue;
        ref.n++; ref.sum += x.score; ref.dom[x.cd].n++; ref.dom[x.cd].sum += x.score;
        rows.push(row);
      } else if (x.role === 'anchor') {
        anchorRows.push({ id: x.id, cd: x.cd, s: answered(x) ? x.score : null, ok: x.ok, rt: rtOk(x) ? x.rt : null, err: x.err, date: L.date });
      } else if (x.role === 'proc' && rtOk(x)) rows.push(row);
    }
  }
  return {
    v: 1, wk, start: kd.weekStart(wk), end: kd.weekEnd(wk),
    ref, offered, adequate: ref.n >= MIN_REF_PER_WEEK, rows, anchorRows, train, trainCells, err, dateQ, pm, days, sessions, abandoned,
    env: envs.length ? mode(envs) : null,
  };
}

// ------------------------------------------------------------ speed model
const HOUR_BUCKET = (h) => (h == null ? 0 : h < 12 ? 0 : h < 18 ? 1 : 2);
function designRow(r, fmts) {
  const x = [1];
  fmts.slice(1).forEach((f) => x.push(r.fmt === f ? 1 : 0));
  x.push(r.lv || 3, Math.log((r.len || 20) + 1), r.nch || 4, r.sp ? 1 : 0, HOUR_BUCKET(r.hr) === 1 ? 1 : 0, HOUR_BUCKET(r.hr) === 2 ? 1 : 0);
  return x;
}
/** Fit the personal regression expectation for ln(RT) on baseline rows (D.5). Null if too few rows. */
function fitSpeedModel(baselineRows) {
  const rows = baselineRows.filter((r) => r.ok && r.rt >= 200 && r.rt <= 120000 && r.fmt);
  if (rows.length < 30) return null;
  const fmts = [...new Set(rows.map((r) => r.fmt))].sort();
  const X = rows.map((r) => designRow(r, fmts)), y = rows.map((r) => Math.log(r.rt));
  const { beta, sigma } = S.huberFit(X, y);
  return { v: 1, fmts, beta, sigma, n: rows.length };
}
function residuals(model, rows) {
  if (!model) return [];
  return rows.filter((r) => r.ok && r.rt >= 200 && r.rt <= 120000 && model.fmts.includes(r.fmt))
    .map((r) => ({ sid: r.sid, r: Math.log(r.rt) - designRow(r, model.fmts).reduce((s, x, j) => s + x * model.beta[j], 0) }));
}
/** Weekly speed score (median residual), count and IIV (median within-session SD). */
function speedWeek(model, rows) {
  const res = residuals(model, rows);
  if (!res.length) return { s: null, n: 0, iiv: null };
  const bySid = new Map(); res.forEach((x) => { if (!bySid.has(x.sid)) bySid.set(x.sid, []); bySid.get(x.sid).push(x.r); });
  const iiv = S.iiv([...bySid.values()]);
  return { s: S.median(res.map((x) => x.r)), n: res.length, iiv: Number.isFinite(iiv) ? iiv : null };
}
/** IES from reference rows of a week. */
function iesWeek(rows) {
  const ref = rows.filter((r) => r.role === 'reference' && r.s != null);
  if (!ref.length) return null;
  const acc = ref.filter((r) => r.ok).length / ref.length;
  const rts = ref.filter((r) => r.ok && r.rt).map((r) => r.rt);
  const v = S.ies(S.mean(rts), acc);
  return Number.isFinite(v) ? v : null;
}

/** Compact summary entry for one week (stored in aiStats/summary.weeks[]). */
function summaryEntry(ws, idx, model) {
  const sp = speedWeek(model, ws.rows);
  const dom = {}; MEASURE_DOMAINS.forEach((d) => { dom[d] = [ws.ref.dom[d].n, round(ws.ref.dom[d].sum, 4)]; });
  return {
    wk: ws.wk, start: ws.start, idx, phase: phaseOf(idx), n: ws.ref.n, sum: round(ws.ref.sum, 4), offered: ws.offered, adequate: ws.adequate, dom,
    spd: sp.s == null ? null : round(sp.s, 5), spdN: sp.n, iiv: sp.iiv == null ? null : round(sp.iiv, 4), ies: iesWeek(ws.rows),
    sessions: ws.sessions, abandoned: ws.abandoned, dateQ: ws.dateQ, pm: ws.pm, env: ws.env, anchorSet: anchorSetFor(idx),
  };
}
const round = (x, k) => Math.round(x * 10 ** k) / 10 ** k;

/** Reference level per domain from the familiarization week: the level whose training accuracy is closest to 75% (≥ 8 items), else 3. */
function chooseRefLevels(trainCells, def = 3) {
  const out = {};
  for (const d of MEASURE_DOMAINS) {
    let best = def, gap = Infinity;
    for (let lv = 1; lv <= 5; lv++) { const c = trainCells[`${d}|${lv}`]; if (!c || c[0] < 8) continue; const g = Math.abs(c[1] / c[0] - 0.75); if (g < gap) { gap = g; best = lv; } }
    out[d] = best;
  }
  return out;
}

module.exports = {
  chooseRefLevels,
  MEASURE_DOMAINS, BASELINE_WEEKS, MIN_REF_PER_WEEK, ANCHOR_SETS, phaseOf, anchorSetFor,
  sanitizeLog, weekStats, fitSpeedModel, residuals, speedWeek, summaryEntry, iesWeek, designRow,
};
