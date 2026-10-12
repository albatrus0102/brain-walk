'use strict';
/**
 * Signal engine (DESIGN-AI §4.5–§4.6). Completed weeks only; no signals before monitoring.
 *
 *   S1 composite 4-week z      yellow z ≤ −1.65          orange z ≤ −1.96 two windows in a row
 *   S2 one domain, 3 declines  yellow + drop ≥ MDC90     orange + domain 4-week z ≤ −1.65
 *   S3 speed (slower)          yellow EWMA > limit(2.0) or 8-week slope CI > 0
 *                              orange EWMA > limit(2.962) two weeks AND slope CI > 0 AND accuracy not better
 *   S4 participation           yellow <50% planned days in 14 or abandon > 30%   orange 7 planned days in a row missed
 *   S5 anchor                  yellow RCI_PE ≤ −1.65     orange RCI_PE ≤ −1.96 and S1/S3 ≥ yellow
 *   S6 lower CUSUM composite   orange C > h (5σ)
 * Confounders: ≥ half of the evaluated days covered by an admin note → orange becomes yellow (not S4).
 * Improvement is computed the same way and shown blue; it never alerts.
 */
const S = require('./stats.js');
const kd = require('./kdate.js');
const { MEASURE_DOMAINS, BASELINE_WEEKS } = require('./series.js');
const { anchorVerdict } = require('./anchor.js');

const DEFAULT_T = Object.freeze({
  ver: 'v1', zY: -1.65, zO: -1.96, zBlue: 1.65, lambda: 0.2, ewmaLY: 2.0, ewmaLO: 2.962, cusumK: 0.5, cusumH: 5,
  slopeWeeks: 8, slopeB: 1000, rciY: -1.65, rciO: -1.96, partRatio: 0.5, partAbandon: 0.3, partMissRun: 7, notAccBetterZ: 1.0,
});
const NOTE_DOWNGRADE = new Set(['sleep', 'illness', 'med_change', 'hospital', 'event', 'travel', 'device', 'mood', 'other']);
const LEVEL_RANK = { gray: 0, green: 1, blue: 1, yellow: 2, orange: 3 };

/** Days in [from,to] covered by any note (inclusive). */
function noteCoverage(notes, from, to) {
  const covered = new Set(); const ids = [];
  for (const n of notes || []) {
    if (!n || !kd.okYmd(n.from) || !(n.codes || []).some((c) => NOTE_DOWNGRADE.has(c))) continue;
    const a = n.from > from ? n.from : from;
    const end = n.to && kd.okYmd(n.to) ? n.to : to;
    const b = end < to ? end : to;
    if (a > b) continue;
    ids.push(n.id);
    for (let d = a; d <= b; d = kd.addDays(d, 1)) covered.add(d);
  }
  const days = kd.daysBetween(from, to) + 1;
  return { share: covered.size / days, ids };
}

/**
 * @param o {
 *   weeks: summary entries (completed weeks only, ascending), asOf: 'YYYY-MM-DD' (last completed day),
 *   days: {date:{games,abandoned,inCourse}}, planWeekdays: [0..6], notes: [{id,from,to,codes}],
 *   anchor: anchorCompare() result + { set, wk, prevWk } | null, speedBase: {s, sigma, n} | null,
 *   thresholds?: partial overrides
 * }
 */
function evaluate(o) {
  const T = { ...DEFAULT_T, ...(o.thresholds || {}) };
  const weeks = (o.weeks || []).slice().sort((a, b) => a.idx - b.idx);
  const base = weeks.filter((w) => w.idx >= 1 && w.idx <= BASELINE_WEEKS && w.n > 0);
  const mon = weeks.filter((w) => w.idx > BASELINE_WEEKS);
  const last = weeks[weeks.length - 1];
  const monitoring = !!last && last.idx > BASELINE_WEEKS && base.length >= 3;
  const out = { thresholdsVer: T.ver, phase: last ? last.phase : 'none', indicators: {}, metrics: {}, signals: [], lights: {}, confidence: 'insufficient' };

  const B = S.baseline(base.map((w) => ({ n: w.n, sum: w.sum })));
  const BD = {};
  MEASURE_DOMAINS.forEach((d) => { BD[d] = S.baseline(base.map((w) => ({ n: w.dom[d][0], sum: w.dom[d][1] }))); });
  out.metrics.base = B; out.metrics.baseDom = BD;

  const adequate = mon.filter((w) => w.adequate);
  const window = (k) => mon.slice(Math.max(0, mon.length - 4 - k), mon.length - k);
  const winRange = (ws) => (ws.length ? { from: ws[0].start, to: kd.addDays(ws[ws.length - 1].start, 6) } : null);
  const ind = (key, rule, domain, level, why = [], extra = {}) => { out.indicators[key] = { key, rule, domain, level, why, ...extra }; return out.indicators[key]; };
  const gray = (key, rule, domain, why) => ind(key, rule, domain, 'gray', why);

  // ---------------------------------------------------------------- S1 composite
  const W0 = window(0), W1 = window(1);
  const comp = (ws) => S.windowScore(ws.filter((w) => w.adequate).map((w) => ({ n: w.n, sum: w.sum })));
  if (!monitoring || !B) gray('S1:composite', 'S1', 'composite', ['phase']);
  else if (W0.filter((w) => w.adequate).length < 2) gray('S1:composite', 'S1', 'composite', ['insufficient']);
  else {
    const c0 = comp(W0), c1 = comp(W1);
    const z0 = S.baselineZ(c0.m, c0.N, B), z1 = c1.N && W1.filter((w) => w.adequate).length >= 2 ? S.baselineZ(c1.m, c1.N, B) : NaN;
    out.metrics.comp = { m: c0.m, N: c0.N, z: z0, zPrev: z1, band: S.mdc(B.sem1, 1.645, 4), win: winRange(W0) };
    let level = 'green', why = [];
    if (z0 <= T.zO && z1 <= T.zO) { level = 'orange'; why = ['comp_z_orange_2w']; }
    else if (z0 <= T.zY) { level = 'yellow'; why = ['comp_z_yellow']; }
    else if (z0 >= T.zBlue) { level = 'blue'; why = ['comp_z_up']; }
    ind('S1:composite', 'S1', 'composite', level, why, { window: winRange(W0), evidence: { z: z0, zPrev: z1 } });
  }

  // ---------------------------------------------------------------- S2 domains
  for (const d of MEASURE_DOMAINS) {
    const key = `S2:${d}`, bd = BD[d];
    if (!monitoring || !bd) { gray(key, 'S2', d, ['phase']); continue; }
    const ws = mon.slice(-4);
    const ps = ws.map((w) => (w.dom[d][0] >= 3 ? w.dom[d][1] / w.dom[d][0] : NaN));
    const win = S.windowScore(ws.map((w) => ({ n: w.dom[d][0], sum: w.dom[d][1] })));
    if (ws.length < 4 || ps.some((p) => !Number.isFinite(p)) || !win.N) { gray(key, 'S2', d, ['insufficient']); continue; }
    const z = S.baselineZ(win.m, win.N, bd), mdc90 = S.mdc(bd.sem1, 1.645, 1);
    const declines = ps[0] > ps[1] && ps[1] > ps[2] && ps[2] > ps[3];
    const drop = ps[0] - ps[3];
    out.metrics[d] = { m: win.m, base: bd.mu, z, mdc90w: S.mdc(bd.sem1, 1.645, 4), mdc90, ps, drop };
    let level = 'green', why = [];
    if (declines && drop >= mdc90) { level = 'yellow'; why = ['dom_3w_decline_mdc']; if (z <= T.zY) { level = 'orange'; why.push('dom_z_yellow'); } }
    else if (z >= T.zBlue) { level = 'blue'; why = ['dom_z_up']; }
    else if (declines) why = ['dom_3w_decline_within_mdc'];
    ind(key, 'S2', d, level, why, { window: winRange(ws), evidence: { z, drop, mdc90 } });
  }

  // ---------------------------------------------------------------- S3 speed
  {
    const sb = o.speedBase;
    const series = mon.filter((w) => w.spd != null);
    if (!monitoring || !sb || !Number.isFinite(sb.sigmaW) || series.length < 2) gray('S3:speed', 'S3', 'speed', [monitoring ? 'insufficient' : 'phase']);
    else {
      const xs = mon.map((w) => (w.spd == null ? NaN : w.spd));
      const eY = S.ewma(xs, { lambda: T.lambda, z0: sb.s, sigma: sb.sigmaW, L: T.ewmaLY });
      const eO = S.ewma(xs, { lambda: T.lambda, z0: sb.s, sigma: sb.sigmaW, L: T.ewmaLO });
      const lastE = eY[eY.length - 1], lastO = eO[eO.length - 1], prevO = eO[eO.length - 2];
      const overY = lastE.z - sb.s > lastE.lim;
      const overO2 = prevO && lastO.z - sb.s > lastO.lim && prevO.z - sb.s > prevO.lim;
      const underY = sb.s - lastE.z > lastE.lim;
      const recent = mon.slice(-T.slopeWeeks).map((w) => (w.spd == null ? NaN : w.spd));
      const sl = S.slopeCI(recent, { B: T.slopeB, seed: 'spd:' + (last ? last.wk : '') });
      const slower = Number.isFinite(sl.lo) && sl.lo > 0, faster = Number.isFinite(sl.hi) && sl.hi < 0;
      const accNotBetter = !(out.metrics.comp && out.metrics.comp.z >= T.notAccBetterZ);
      const w4 = mon.slice(-4).filter((w) => w.spd != null);
      const sW = w4.length ? S.sum(w4.map((w) => w.spd * w.spdN)) / Math.max(1, S.sum(w4.map((w) => w.spdN))) : NaN;
      out.metrics.speed = { ewma: lastE.z - sb.s, limY: lastE.lim, limO: lastO.lim, slope: sl.slope, lo: sl.lo, hi: sl.hi, change: Number.isFinite(sW) ? Math.exp(sW - sb.s) - 1 : NaN, win: winRange(mon.slice(-4)) };
      let level = 'green', why = [];
      if (overO2 && slower && accNotBetter) { level = 'orange'; why = ['speed_ewma_orange_2w', 'speed_slope_pos_8w', 'speed_acc_not_better']; }
      else if (overY || slower) { level = 'yellow'; why = [overY ? 'speed_ewma_yellow' : null, slower ? 'speed_slope_pos_8w' : null].filter(Boolean); }
      else if (underY && faster) { level = 'blue'; why = ['speed_faster']; }
      ind('S3:speed', 'S3', 'speed', level, why, { window: winRange(mon.slice(-4)), evidence: out.metrics.speed });
    }
  }

  // ---------------------------------------------------------------- S4 participation
  {
    const asOf = o.asOf;
    const plan = new Set(o.planWeekdays && o.planWeekdays.length ? o.planWeekdays : [0, 1, 2, 3, 4, 5, 6]);
    let planned = 0, trained = 0, games = 0, aband = 0, run = 0, maxRunEnd = 0;
    const days = o.days || {};
    for (let i = 13; i >= 0; i--) {
      const d = kd.addDays(asOf, -i); const x = days[d];
      if (x) { games += x.games; aband += x.abandoned; }
      if (!plan.has(kd.weekday(d))) continue;
      planned++;
      if (x && x.inCourse > 0) { trained++; run = 0; } else { run++; maxRunEnd = run; }
    }
    // consecutive missed planned days ending at asOf (look back up to 21 days)
    let streak = 0;
    for (let i = 0; i < 21; i++) { const d = kd.addDays(asOf, -i); if (!plan.has(kd.weekday(d))) continue; const x = days[d]; if (x && x.inCourse > 0) break; streak++; }
    const ratio = planned ? trained / planned : NaN, abandon = games ? aband / games : 0;
    out.metrics.part = { planned, trained, ratio, abandon, streak, games };
    if (!monitoring) gray('S4:participation', 'S4', 'participation', ['phase']);
    else {
      let level = 'green', why = [];
      if (streak >= T.partMissRun) { level = 'orange'; why = ['part_missed_7d']; }
      else if (ratio < T.partRatio || abandon > T.partAbandon) { level = 'yellow'; why = [ratio < T.partRatio ? 'part_low_14d' : 'part_abandon_high']; }
      ind('S4:participation', 'S4', 'participation', level, why, { window: { from: kd.addDays(asOf, -13), to: asOf }, evidence: out.metrics.part, noDowngrade: true });
    }
    void maxRunEnd;
  }

  // ---------------------------------------------------------------- S6 CUSUM
  if (monitoring && B && adequate.length) {
    const sigmaW = B.sem1;
    const xs = mon.map((w) => (w.adequate ? w.sum / w.n : NaN));
    const cu = S.cusumLower(xs, { mu: B.mu, sigma: sigmaW, k: T.cusumK, h: T.cusumH });
    const fired = cu.signals.includes(xs.length - 1);
    out.metrics.cusum = { C: cu.path[cu.path.length - 1], h: T.cusumH, fired };
    ind('S6:composite', 'S6', 'composite', fired ? 'orange' : 'green', fired ? ['cusum_lower_h'] : [], { window: winRange(mon.slice(-4)), evidence: out.metrics.cusum });
  } else gray('S6:composite', 'S6', 'composite', ['phase']);

  // ---------------------------------------------------------------- S5 anchor
  if (o.anchor && monitoring) {
    const s1 = out.indicators['S1:composite'], s3 = out.indicators['S3:speed'];
    const s1s3 = [s1, s3].some((x) => x && LEVEL_RANK[x.level] >= 2);
    const aw = { from: kd.weekStart(o.anchor.wk), to: kd.weekEnd(o.anchor.wk) };
    const confounded = noteCoverage(o.notes, aw.from, aw.to).ids.length > 0;
    const v = anchorVerdict(o.anchor, { s1s3Yellow: s1s3, confounded, rciY: T.rciY, rciO: T.rciO });
    out.metrics.anchor = o.anchor;
    ind('S5:anchor', 'S5', 'anchor', v.level, v.why, { window: aw, evidence: { rci: o.anchor.rci, pe: o.anchor.pe, peK: o.anchor.peK } });
  }

  // ---------------------------------------------------------------- confounders
  for (const x of Object.values(out.indicators)) {
    if (x.noDowngrade || !x.window || (x.level !== 'orange' && x.level !== 'yellow')) continue;
    const cov = noteCoverage(o.notes, x.window.from, x.window.to);
    if (cov.ids.length) x.notes = cov.ids;
    if (x.level === 'orange' && cov.share >= 0.5) { x.level = 'yellow'; x.downgradedBy = cov.ids; x.why = x.why.concat('downgraded_note'); }
  }

  // ---------------------------------------------------------------- lights, signals, confidence
  const L = (k) => (out.indicators[k] ? out.indicators[k].level : 'gray');
  const worst = (...ks) => ks.map(L).reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] || (a === 'gray' && b !== 'gray') ? b : a), 'gray');
  out.lights.composite = worst('S1:composite', 'S6:composite');
  MEASURE_DOMAINS.forEach((d) => { out.lights[d] = L(`S2:${d}`); });
  out.lights.speed = L('S3:speed');
  out.lights.participation = L('S4:participation');
  if (out.indicators['S5:anchor']) out.lights.anchor = L('S5:anchor');
  out.signals = Object.values(out.indicators).filter((x) => x.level === 'yellow' || x.level === 'orange')
    .map((x) => ({ key: x.key, rule: x.rule, domain: x.domain, level: x.level, why: x.why, downgradedBy: x.downgradedBy || [], notes: x.notes || [], window: x.window }));
  if (!monitoring || L('S1:composite') === 'gray') out.confidence = 'insufficient';
  else {
    const flagged = out.signals.filter((s) => s.rule !== 'S4').length;
    out.confidence = flagged === 1 ? 'weak' : 'concordant';
  }
  out.monitoring = monitoring;
  return out;
}

/** Baseline speed reference for S3: median baseline weekly score and weekly SD (floored by theory). */
function speedBaseline(weeks, model, changePoint) {
  let ws = weeks.filter((w) => w.idx >= 1 && w.idx <= BASELINE_WEEKS && w.spd != null);
  if (changePoint) {
    const after = weeks.filter((w) => w.start >= changePoint && w.spd != null).slice(0, 2);
    if (after.length < 2) return null;
    ws = after;
  }
  if (ws.length < 2 || !model) return null;
  const s = S.mean(ws.map((w) => w.spd));
  const nbar = S.mean(ws.map((w) => w.spdN)) || 1;
  const theory = (1.253 * model.sigma) / Math.sqrt(nbar);
  const emp = S.sd(ws.map((w) => w.spd));
  return { s, sigmaW: Math.max(theory, Number.isFinite(emp) ? emp : 0), n: ws.length };
}

module.exports = { evaluate, speedBaseline, noteCoverage, DEFAULT_T, LEVEL_RANK, NOTE_DOWNGRADE };
