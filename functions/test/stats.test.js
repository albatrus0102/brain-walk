'use strict';
/* Statistics against hand-computed / textbook values (DESIGN-AI Appendix D). */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../ai/core/stats.js');
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b}`);

test('mean / variance / median / quantile', () => {
  near(S.mean([1, 2, 3, 4]), 2.5); near(S.variance([2, 4, 4, 4, 5, 5, 7, 9]), 32 / 7); near(S.median([5, 1, 3]), 3); near(S.quantile([1, 2, 3, 4], 0.25), 1.75);
});
test('normal CDF', () => { near(S.normCdf(1.96), 0.975, 2e-4); near(S.normCdf(-1.645), 0.05, 2e-4); near(S.normCdf(0), 0.5, 1e-9); });
test('binomial pmf', () => { near(S.binomPmf(2, 4, 0.5), 0.375); near(S.binomPmf(0, 10, 0.5), 1 / 1024); });

test('exact sign test (McNemar-type)', () => {
  near(S.signTest(3, 2), 1);            // design §7.2 example: p = 1.00
  near(S.signTest(0, 6), 2 / 64);
  near(S.signTest(1, 9), (2 * 11) / 1024);
  near(S.signTest(0, 0), 1);
});
test('Wilcoxon signed-rank, exact (Hollander & Wolfe depression data: W−=5, p=0.039)', () => {
  const x = [1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30], y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
  const r = S.wilcoxon(x.map((v, i) => v - y[i]));
  near(r.p, 0.0390625, 1e-9); assert.equal(r.n, 9); near(r.W, 40);
  near(S.wilcoxon([1, 2, 3, 4, 5]).p, 0.0625); near(S.wilcoxon([-1, 2, 3, 4, 5]).p, 0.125);
});
test('Wilcoxon with ties uses the normal approximation (finite p)', () => {
  const r = S.wilcoxon([1, 1, 2, 2, -1, 3, 3, 3]); assert.ok(r.p > 0 && r.p < 1);
});

test('baseline: μ, φ ≥ 1, 1-week SEM', () => {
  const b = S.baseline([{ n: 30, sum: 22.5 }, { n: 30, sum: 22.5 }, { n: 30, sum: 22.5 }, { n: 30, sum: 22.5 }]);
  near(b.mu, 0.75); near(b.phi, 1); near(b.sem1, Math.sqrt(0.75 * 0.25 / 30));
  const w = S.baseline([{ n: 30, sum: 15 }, { n: 30, sum: 30 }, { n: 30, sum: 15 }, { n: 30, sum: 30 }]);
  assert.ok(w.phi > 1, 'over-dispersed baseline inflates φ');
});
test('MDC matches the design sensitivity table (30 items/week → ~9%p, 6/domain → ~21%p)', () => {
  const sem30 = Math.sqrt(0.75 * 0.25 / 30), sem6 = Math.sqrt(0.75 * 0.25 / 6);
  near(S.mdc(sem30, 1.645, 4), 0.0920, 5e-4); near(S.mdc(sem6, 1.645, 4), 0.2056, 5e-4);
  near(S.mdc(sem30, 1.96, 1), 1.96 * Math.SQRT2 * sem30);
});
test('baseline z (difference of two proportions with φ)', () => {
  near(S.baselineZ(0.65, 120, { mu: 0.75, phi: 1, N: 120 }), -0.1 / Math.sqrt(0.1875 * (2 / 120)));
});
test('RCI and practice-adjusted RCI (Chelune)', () => {
  near(S.rci(0.80, 0.85, 0.05), 0.05 / (Math.SQRT2 * 0.05));
  near(S.rci(0.80, 0.85, 0.05, 0.05), 0);
  assert.deepEqual(S.practiceEffect([{ a1: 0.7, a2: 0.8, r1: 0.7, r2: 0.7 }]), { pe: 0, k: 1 });
  near(S.practiceEffect([{ a1: 0.7, a2: 0.8, r1: 0.7, r2: 0.7 }, { a1: 0.7, a2: 0.76, r1: 0.7, r2: 0.72 }]).pe, (0.1 + 0.04) / 2);
});
test('split-half reliability with Spearman–Brown', () => {
  near(S.splitHalf([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.ok(Number.isNaN(S.splitHalf([1, 2], [1, 2])));
});

test('EWMA values and time-varying limits', () => {
  const e = S.ewma([1, 1, 1], { lambda: 0.2, z0: 0, sigma: 1, L: 3 });
  near(e[0].z, 0.2); near(e[1].z, 0.36); near(e[2].z, 0.488);
  near(e[0].lim, 3 * Math.sqrt((0.2 / 1.8) * (1 - 0.8 ** 2)));
  const far = S.ewma(new Array(200).fill(0), { lambda: 0.2, z0: 0, sigma: 1, L: 3 });
  near(far[199].lim, 1, 1e-6);   // asymptote L·σ·√(λ/(2−λ)) = 3·⅓
});
test('lower CUSUM signals after the h threshold and resets', () => {
  const r = S.cusumLower(new Array(8).fill(-1.5), { mu: 0, sigma: 1, k: 0.5, h: 5 });
  assert.deepEqual(r.signals, [5]); near(r.path[4], 5); near(r.path[6], 1);
  assert.deepEqual(S.cusumLower([0.2, -0.3, 0.1, 0], { mu: 0, sigma: 1 }).signals, []);
});

test('Theil–Sen slope is robust to an outlier', () => {
  near(S.theilSen([1, 3, 5, 7]), 2); near(S.theilSen([1, 2, 3, 4, 100]), 1);
  near(S.theilSen([NaN, 2, 4, NaN, 8]), 2);
});
test('block-bootstrap slope CI covers the true slope and is deterministic', () => {
  const ys = [0, 0.11, 0.19, 0.31, 0.4, 0.52, 0.58, 0.71];
  const a = S.slopeCI(ys, { B: 500, seed: 's' }), b = S.slopeCI(ys, { B: 500, seed: 's' });
  assert.deepEqual(a, b); assert.ok(a.lo < 0.1 && a.hi > 0.1 && a.lo > 0, JSON.stringify(a));
  const flat = S.slopeCI([0.1, -0.1, 0.05, -0.05, 0.0, 0.08, -0.07, 0.02], { B: 500 });
  assert.ok(flat.lo < 0 && flat.hi > 0);
});
test('Huber regression recovers the line despite an outlier', () => {
  const X = [], y = [];
  for (let i = 0; i < 30; i++) { X.push([1, i]); y.push(1 + 2 * i + (i === 7 ? 50 : 0)); }
  const { beta } = S.huberFit(X, y);
  near(beta[0], 1, 0.05); near(beta[1], 2, 0.01);
});
test('speed z uses the 1.253 median efficiency factor', () => { near(S.speedZ(0.1, 0, 0.35, 30, 120), 0.1 / (1.253 * 0.35 * Math.sqrt(1 / 30 + 1 / 120))); });
test('IIV and IES', () => {
  near(S.iiv([[0, 0.1, 0.2], [0, 0.2, 0.4], [1]]), (0.1 + 0.2) / 2);
  near(S.ies(6000, 0.75), 8000); assert.ok(Number.isNaN(S.ies(6000, 0.5)));
});
