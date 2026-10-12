'use strict';
/**
 * Threshold-tuning simulation (DESIGN-AI §4.6, D.7). Not scheduled: run by hand after the baseline
 * (functions/ai/tools/simulate.mjs) and by the tests with synthetic data.
 *
 * 1. Resample the baseline weeks in week blocks (block bootstrap) into fake series with no change.
 * 2. Run the real rule engine week by week and count orange alarms (off→on) per year.
 * 3. Optionally inject a decline (accuracy −Δ over K weeks, RT × (1+r)) and record the first week caught.
 */
const { seededRng } = require('./text.js');
const { evaluate } = require('./signals.js');
const { MEASURE_DOMAINS, phaseOf } = require('./series.js');
const kd = require('./kdate.js');

/** Synthetic baseline weeks for tests: binomial accuracy p, 6 items per domain, speed residual noise. */
function syntheticBaseline({ p = 0.75, perDomain = 6, rtNoise = 0.35, weekSd = 0.02, seed = 'base', weeks = 4 } = {}) {
  const rng = seededRng(seed);
  const out = [];
  for (let w = 0; w < weeks; w++) out.push(makeWeek(rng, { p: p + gauss(rng) * weekSd, perDomain, rtShift: 0, rtNoise }));
  return out;
}
function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function makeWeek(rng, { p, perDomain, rtShift, rtNoise }) {
  const dom = {}; let n = 0, sum = 0;
  MEASURE_DOMAINS.forEach((d) => { let s = 0; for (let i = 0; i < perDomain; i++) if (rng() < Math.min(0.99, Math.max(0.01, p))) s++; dom[d] = [perDomain, s]; n += perDomain; sum += s; });
  const nRt = Math.round(n * p) + 10;
  const res = Array.from({ length: nRt }, () => rtShift + gauss(rng) * rtNoise).sort((a, b) => a - b);
  return { n, sum, dom, spd: res[Math.floor(nRt / 2)], spdN: nRt };
}

/**
 * baseWeeks: [{ n, sum, dom:{d:[n,sum]}, spd, spdN }] (4 baseline weeks).
 * Returns { orangePerYear, yellowPerYear, firstCaught: [weeks after injection start | null], runs }.
 */
function simulate(baseWeeks, { sims = 200, weeks = 104, seed = 'sim', inject = null, thresholds = {}, slopeB = 200, model = { sigma: 0.35 } } = {}) {
  const rng = seededRng(seed);
  let orange = 0, yellow = 0; const caught = [];
  const start = '2030-01-06'; // any Sunday
  for (let s = 0; s < sims; s++) {
    const series = [];
    // week 0 familiarization + 4 baseline (the real baseline, in order) + resampled monitoring weeks
    for (let i = 0; i <= 4 + weeks; i++) {
      const src = i === 0 ? baseWeeks[0] : i <= 4 ? baseWeeks[i - 1] : baseWeeks[Math.floor(rng() * baseWeeks.length)];
      const w = JSON.parse(JSON.stringify(src));
      const t = i - 4 - (inject ? inject.startWeek : 0);
      if (inject && i > 4 && t > 0) {
        const frac = Math.min(1, t / inject.overWeeks);
        const drop = inject.accDrop * frac;
        let sum = 0;
        MEASURE_DOMAINS.forEach((d) => { const [n, x] = w.dom[d]; const nx = Math.max(0, Math.round(x - drop * n + (rng() - 0.5))); w.dom[d] = [n, nx]; sum += nx; });
        w.sum = sum;
        w.spd += Math.log(1 + (inject.rtUp || 0) * frac);
      }
      const startDate = kd.addDays(start, 7 * i);
      series.push({ ...w, wk: kd.weekKey(startDate), start: startDate, idx: i, phase: phaseOf(i), adequate: w.n >= 18, iiv: null, ies: null });
    }
    const days = {};
    for (let d = 0; d < 7 * (5 + weeks); d++) days[kd.addDays(start, d)] = { games: 5, abandoned: 0, inCourse: 5 };
    const baseSpd = series.slice(1, 5).map((w) => w.spd);
    const mean = baseSpd.reduce((a, b) => a + b, 0) / baseSpd.length;
    const sd = Math.sqrt(baseSpd.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseSpd.length - 1));
    const nbar = series.slice(1, 5).reduce((a, w) => a + w.spdN, 0) / 4;
    const speedBase = { s: mean, sigmaW: Math.max(sd, (1.253 * model.sigma) / Math.sqrt(nbar)), n: 4 };
    let wasOrange = false, wasYellow = false, first = null;
    for (let i = 6; i <= 4 + weeks; i++) {
      const asOf = kd.addDays(series[i].start, 6);
      const r = evaluate({ weeks: series.slice(0, i + 1), asOf, days, planWeekdays: [0, 1, 2, 3, 4, 5, 6], notes: [], speedBase, thresholds: { slopeB, ...thresholds } });
      const isO = r.signals.some((x) => x.level === 'orange'), isY = r.signals.some((x) => x.level === 'yellow');
      if (isO && !wasOrange) { orange++; if (first == null && inject && i - 4 > inject.startWeek) first = i - 4 - inject.startWeek; }
      if (isY && !wasYellow) yellow++;
      wasOrange = isO; wasYellow = isY;
    }
    caught.push(first);
  }
  const years = (sims * (weeks - 2)) / 52;
  return { orangePerYear: orange / years, yellowPerYear: yellow / years, firstCaught: caught, runs: sims };
}

module.exports = { simulate, syntheticBaseline, makeWeek };
