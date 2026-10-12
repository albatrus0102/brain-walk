'use strict';
/* Signal engine S1–S6, confounder downgrade, anchor comparison and the simulation sanity check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const kd = require('../ai/core/kdate.js');
const { evaluate } = require('../ai/core/signals.js');
const { anchorCompare, anchorVerdict } = require('../ai/core/anchor.js');
const { simulate, syntheticBaseline } = require('../ai/core/simulate.js');
const SR = require('../ai/core/series.js');

const START = '2026-11-01';
const DOMS = SR.MEASURE_DOMAINS;
/** week i with composite accuracy p (6 items × 5 domains); dom overrides [n,sum]; spd median residual */
function wk(i, p, { dom = {}, spd = 0, n = 30 } = {}) {
  const per = n / 5, d = {}; let sum = 0;
  DOMS.forEach((x) => { d[x] = dom[x] || [per, per * p]; sum += d[x][1]; });
  const start = kd.addDays(START, 7 * i);
  return { wk: kd.weekKey(start), start, idx: i, phase: SR.phaseOf(i), n, sum, dom: d, adequate: n >= 18, spd, spdN: 30, iiv: null, ies: null };
}
function allDays(nWeeks, trained = true) { const d = {}; for (let k = 0; k < 7 * nWeeks; k++) d[kd.addDays(START, k)] = { games: 5, abandoned: 0, inCourse: trained ? 5 : 0 }; return d; }
const base = () => [0, 1, 2, 3, 4].map((i) => wk(i, 0.75));
const ev = (weeks, o = {}) => evaluate({ weeks, asOf: kd.addDays(weeks[weeks.length - 1].start, 6), days: allDays(weeks.length), planWeekdays: [0, 1, 2, 3, 4, 5, 6], notes: [], speedBase: { s: 0, sigmaW: 0.05, n: 4 }, ...o });

test('baseline phase: no signals, everything gray, confidence insufficient', () => {
  const r = ev(base().slice(0, 4));
  assert.equal(r.signals.length, 0); assert.equal(r.confidence, 'insufficient');
  assert.ok(Object.values(r.lights).every((l) => l === 'gray'));
});
test('stable monitoring: all green, "concordant" (all maintain)', () => {
  const r = ev([...base(), ...[5, 6, 7, 8, 9, 10].map((i) => wk(i, 0.75))]);
  assert.equal(r.signals.length, 0); assert.equal(r.lights.composite, 'green'); assert.equal(r.confidence, 'concordant');
});
test('one bad week (one bad day) never makes a signal', () => {
  const r = ev([...base(), ...[5, 6, 7, 8].map((i) => wk(i, 0.75)), wk(9, 0.5)]);
  assert.equal(r.signals.filter((s) => s.level === 'orange').length, 0);
  assert.equal(r.indicators['S1:composite'].level, 'green');
});
test('S1: a sustained ~20%p drop is orange (two windows), a single low window only yellow', () => {
  const o = ev([...base(), ...[5, 6, 7, 8, 9].map((i) => wk(i, 0.55))]);
  assert.equal(o.indicators['S1:composite'].level, 'orange');
  const y = ev([...base(), ...[5, 6, 7].map((i) => wk(i, 0.75)), wk(8, 0.6), wk(9, 0.6), wk(10, 0.6)]);
  assert.ok(['yellow', 'green'].includes(y.indicators['S1:composite'].level));
  assert.notEqual(y.indicators['S1:composite'].level, 'orange');
});
test('S1 orange is downgraded to yellow when notes cover ≥ half of the window', () => {
  const weeks = [...base(), ...[5, 6, 7, 8, 9].map((i) => wk(i, 0.55))];
  const from = weeks[6].start, to = kd.addDays(weeks[9].start, 6);
  const r = ev(weeks, { notes: [{ id: 'n1', from, to, codes: ['illness'] }] });
  assert.equal(r.indicators['S1:composite'].level, 'yellow'); assert.deepEqual(r.indicators['S1:composite'].downgradedBy, ['n1']);
});
test('S2: three declines beyond MDC90 → yellow; plus low 4-week z → orange; within MDC → green', () => {
  const mem = (s) => ({ dom: { memory: [6, s] } });
  const y = ev([...base(), wk(5, 0.75), wk(6, 0.75, mem(6)), wk(7, 0.75, mem(5)), wk(8, 0.75, mem(4)), wk(9, 0.75, mem(3))]);
  assert.ok(['yellow', 'orange'].includes(y.indicators['S2:memory'].level), y.indicators['S2:memory'].level);
  const o = ev([...base(), wk(5, 0.75), wk(6, 0.75, mem(4)), wk(7, 0.75, mem(3)), wk(8, 0.75, mem(2)), wk(9, 0.75, mem(1))]);
  assert.equal(o.indicators['S2:memory'].level, 'orange');
  const g = ev([...base(), wk(5, 0.75), wk(6, 0.75, mem(5)), wk(7, 0.75, mem(4.8)), wk(8, 0.75, mem(4.6)), wk(9, 0.75, mem(4.4))]);
  assert.equal(g.indicators['S2:memory'].level, 'green'); assert.ok(g.indicators['S2:memory'].why.includes('dom_3w_decline_within_mdc'));
});
test('S3: steady slowing with unchanged accuracy → orange; slowing with better accuracy → not orange', () => {
  const slow = [...base(), ...[5, 6, 7, 8, 9, 10, 11, 12].map((i, k) => wk(i, 0.75, { spd: 0.03 * (k + 1) }))];
  assert.equal(ev(slow).indicators['S3:speed'].level, 'orange');
  const traded = [...base(), ...[5, 6, 7, 8, 9, 10, 11, 12].map((i, k) => wk(i, 0.92, { spd: 0.03 * (k + 1) }))];
  assert.notEqual(ev(traded).indicators['S3:speed'].level, 'orange');
});
test('S4: 7 planned days missed → orange (never downgraded by notes); < 50% → yellow', () => {
  const weeks = [...base(), ...[5, 6, 7].map((i) => wk(i, 0.75))];
  const days = allDays(weeks.length); const asOf = kd.addDays(weeks[7].start, 6);
  for (let k = 0; k < 8; k++) days[kd.addDays(asOf, -k)] = { games: 0, abandoned: 0, inCourse: 0 };
  const r = ev(weeks, { days, notes: [{ id: 'n', from: kd.addDays(asOf, -13), to: asOf, codes: ['hospital'] }] });
  assert.equal(r.indicators['S4:participation'].level, 'orange');
  const d2 = allDays(weeks.length); for (let k = 0; k < 14; k += 2) d2[kd.addDays(asOf, -k)] = { games: 0, abandoned: 0, inCourse: 0 }; for (let k = 1; k < 14; k += 4) d2[kd.addDays(asOf, -k)] = { games: 0, abandoned: 0, inCourse: 0 };
  assert.equal(ev(weeks, { days: d2 }).indicators['S4:participation'].level, 'yellow');
});
test('S6: small drops that accumulate fire the lower CUSUM', () => {
  const weeks = [...base(), ...Array.from({ length: 10 }, (_, k) => wk(5 + k, 0.67))];
  const fired = []; for (let i = 6; i < weeks.length; i++) { const r = ev(weeks.slice(0, i + 1)); if (r.indicators['S6:composite'].level === 'orange') fired.push(i); }
  assert.ok(fired.length >= 1, 'CUSUM should fire at some week');
});
test('improvement is blue and never a signal', () => {
  const r = ev([...base(), ...[5, 6, 7, 8, 9].map((i) => wk(i, 0.95))]);
  assert.equal(r.lights.composite, 'blue'); assert.equal(r.signals.filter((s) => s.rule === 'S1').length, 0);
});

test('anchor comparison: sign test, Wilcoxon, practice-adjusted RCI and verdicts', () => {
  const mk = (oks, rts) => oks.map((ok, i) => ({ id: 'a' + i, s: ok ? 1 : 0, ok: !!ok, rt: rts[i], err: ok ? [] : ['MISS'] }));
  const prev = mk([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], new Array(20).fill(6000));
  const cur = mk([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0], new Array(20).fill(5800));
  const c = anchorCompare(prev, cur, { phi: 1 });
  assert.equal(c.up, 3); assert.equal(c.down, 2); assert.equal(c.bothOk, 14); assert.equal(c.bothWrong, 1);
  assert.equal(c.pSign, 1); assert.equal(c.peK, 0); assert.ok(Math.abs(c.rci) < 1.65);
  assert.equal(anchorVerdict(c).level, 'green');
  const worse = anchorCompare(prev, mk(new Array(20).fill(0).map((_, i) => (i < 9 ? 1 : 0)), new Array(20).fill(7000)), { phi: 1 });
  assert.ok(worse.rci <= -1.96);
  assert.equal(anchorVerdict(worse, { s1s3Yellow: true }).level, 'orange');
  assert.equal(anchorVerdict(worse, { s1s3Yellow: false }).level, 'yellow');
  assert.equal(anchorVerdict(worse, { confounded: true }).level, 'gray');
  const few = anchorCompare(prev, cur.slice(0, 10), { phi: 1, setSize: 20 });
  assert.equal(anchorVerdict(few).level, 'gray');
  const better = anchorCompare(mk(new Array(20).fill(0).map((_, i) => (i < 9 ? 1 : 0)), new Array(20).fill(7000)), prev, { phi: 1 });
  assert.equal(anchorVerdict(better).level, 'green', 'improvement is held back until Δ̂_PE exists');
  assert.ok(anchorVerdict(better).why.includes('anchor_up_pe_pending'));
});

test('simulation: no-change data rarely fires orange; an injected decline is caught', () => {
  const b = syntheticBaseline({ seed: 'unit' });
  const nul = simulate(b, { sims: 40, weeks: 104, seed: 'null-unit', slopeB: 150 });
  assert.ok(nul.orangePerYear <= 1.0, `orange/yr ${nul.orangePerYear}`);
  assert.ok(nul.yellowPerYear <= 6.0, `yellow/yr ${nul.yellowPerYear}`);
  const inj = simulate(b, { sims: 25, weeks: 52, seed: 'inj-unit', slopeB: 150, inject: { startWeek: 10, overWeeks: 8, accDrop: 0.10, rtUp: 0.15 } });
  const caught = inj.firstCaught.filter((x) => x != null);
  assert.ok(caught.length / inj.runs >= 0.8, `caught ${caught.length}/${inj.runs}`);
});
