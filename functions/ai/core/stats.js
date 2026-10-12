'use strict';
/**
 * Statistics for N=1 change detection (DESIGN-AI §4, Appendix D). Pure functions, no I/O.
 *
 *   D.1/D.2  baseline μ, over-dispersion φ, window score, personal-baseline z
 *   D.3      SEM (1 week / k weeks), MDC90/95, split-half r with Spearman–Brown
 *   D.4      RCI (Jacobson–Truax), practice-adjusted RCI (Chelune), sign test, Wilcoxon signed-rank
 *   D.5      Huber regression (IRLS) for RT adjustment, median-based speed z
 *   D.6      EWMA with time-varying limits, lower CUSUM with reset
 *   D.10     Theil–Sen slope with moving-block bootstrap CI, IIV, IES
 */
const { seededRng } = require('./text.js');

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
function variance(a, ddof = 1) { if (a.length <= ddof) return NaN; const m = mean(a); return sum(a.map((x) => (x - m) ** 2)) / (a.length - ddof); }
const sd = (a) => Math.sqrt(variance(a));
function quantile(a, q) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const median = (a) => quantile(a, 0.5);

// ------------------------------------------------------------------ D.1–D.3
/**
 * weeks: [{ n, sum }] (n answered reference items, sum of scores 0..1).
 * Returns { mu, phi, nbar, N, sem1 } where sem1 is the 1-week SEM (D.3).
 */
function baseline(weeks) {
  const W = weeks.filter((w) => w && w.n > 0);
  const N = sum(W.map((w) => w.n));
  if (!N) return null;
  const mu = sum(W.map((w) => w.sum)) / N;
  const nbar = N / W.length;
  const p = W.map((w) => w.sum / w.n);
  const binom = (mu * (1 - mu)) / nbar;
  const emp = p.length >= 2 ? variance(p) : NaN;
  const phi = binom > 0 && isFinite(emp) ? Math.max(1, emp / binom) : 1;
  const sem1 = Math.sqrt(phi * Math.max(mu * (1 - mu), 1e-6) / nbar);
  return { mu, phi, nbar, N, weeks: W.length, sem1 };
}
/** Item-weighted window score over weeks [{n,sum}]. */
function windowScore(weeks) {
  const N = sum(weeks.map((w) => (w ? w.n : 0)));
  return N ? { m: sum(weeks.map((w) => (w ? w.sum : 0))) / N, N } : { m: NaN, N: 0 };
}
/** D.2: z of a window mean against the baseline (difference of two proportions with over-dispersion). */
function baselineZ(mW, NW, b) {
  const v = Math.max(b.mu * (1 - b.mu), 1e-6);
  const se = Math.sqrt(b.phi * v * (1 / NW + 1 / b.N));
  return (mW - b.mu) / se;
}
/** D.3: MDC for a k-week window (SEM / √k), at z = 1.645 (90) or 1.96 (95). */
const mdc = (sem1, z = 1.645, k = 1) => z * Math.SQRT2 * sem1 / Math.sqrt(k);
/** Split-half reliability with Spearman–Brown: r_sb = 2r / (1 + r). */
function splitHalf(odd, even) {
  if (odd.length !== even.length || odd.length < 3) return NaN;
  const mo = mean(odd), me = mean(even);
  const cov = sum(odd.map((x, i) => (x - mo) * (even[i] - me)));
  const r = cov / Math.sqrt(sum(odd.map((x) => (x - mo) ** 2)) * sum(even.map((x) => (x - me) ** 2)));
  return isFinite(r) ? (2 * r) / (1 + r) : NaN;
}

// ------------------------------------------------------------------- D.4
/** Jacobson–Truax RCI with S_diff = √2·SEM; Chelune practice-adjusted when pe is given. */
const rci = (x1, x2, sem, pe = 0) => ((x2 - x1) - pe) / (Math.SQRT2 * sem);
/** Δ̂_PE = mean over repeats of (anchor change − reference change); 0 when fewer than 2 repeats. */
function practiceEffect(repeats) {
  const ok = repeats.filter((r) => [r.a1, r.a2, r.r1, r.r2].every(Number.isFinite));
  return ok.length >= 2 ? { pe: mean(ok.map((r) => (r.a2 - r.a1) - (r.r2 - r.r1))), k: ok.length } : { pe: 0, k: ok.length };
}
function logChoose(n, k) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; }
const binomPmf = (k, n, p) => Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
/** Exact two-sided sign (McNemar-type) test on discordant counts b, c. */
function signTest(b, c) {
  const n = b + c; if (!n) return 1;
  let cdf = 0; for (let k = 0; k <= Math.min(b, c); k++) cdf += binomPmf(k, n, 0.5);
  return Math.min(1, 2 * cdf);
}
/**
 * Wilcoxon signed-rank test (two-sided). Zero differences dropped, ties get average ranks.
 * Exact null distribution (DP over ranks×2) for n ≤ 25, normal approximation with tie and continuity correction above.
 */
function wilcoxon(diffs) {
  const d = diffs.filter((x) => Number.isFinite(x) && x !== 0);
  const n = d.length;
  if (!n) return { n: 0, W: 0, p: 1 };
  const abs = d.map((x, i) => ({ a: Math.abs(x), s: Math.sign(x), i })).sort((x, y) => x.a - y.a);
  const ranks = new Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && abs[j + 1].a === abs[i].a) j++; const r = (i + j + 2) / 2; for (let k = i; k <= j; k++) ranks[k] = r; i = j + 1; }
  let Wplus = 0; abs.forEach((x, k) => { if (x.s > 0) Wplus += ranks[k]; });
  const total = (n * (n + 1)) / 2, W = Math.min(Wplus, total - Wplus);
  const ties = ranks.some((r) => r % 1 !== 0);
  if (n <= 25 && !ties) {
    const dist = new Array(total + 1).fill(0); dist[0] = 1;
    for (let r = 1; r <= n; r++) for (let s = total; s >= r; s--) dist[s] += dist[s - r];
    const all = 2 ** n; let cdf = 0; for (let s = 0; s <= Math.floor(W); s++) cdf += dist[s];
    return { n, W: Wplus, p: Math.min(1, (2 * cdf) / all) };
  }
  let tieAdj = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && ranks[j + 1] === ranks[i]) j++; const t = j - i + 1; tieAdj += t ** 3 - t; i = j + 1; }
  const mu = total / 2, sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieAdj / 48);
  const z = (Math.abs(Wplus - mu) - 0.5) / sigma;
  return { n, W: Wplus, p: Math.min(1, 2 * (1 - normCdf(z))) };
}
function normCdf(z) { // Abramowitz–Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ------------------------------------------------------------------- D.5
/** Solve (XᵀWX + λI)β = XᵀWy by Gaussian elimination. */
function wls(X, y, w, ridge = 1e-6) {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { const xa = X[i][a] * w[i]; for (let b = 0; b < p; b++) A[a][b] += xa * X[i][b]; A[a][p] += xa * y[i]; }
  for (let a = 0; a < p; a++) A[a][a] += ridge;
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c] / d; for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[p] / (row[i] || 1e-12));
}
/** Huber M-estimate by IRLS (k = 1.345·scale, scale = MAD/0.6745). */
function huberFit(X, y, { k = 1.345, iters = 30 } = {}) {
  let w = y.map(() => 1), beta = wls(X, y, w);
  for (let it = 0; it < iters; it++) {
    const res = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * beta[j], 0));
    const scale = (median(res.map(Math.abs)) / 0.6745) || 1e-6;
    w = res.map((r) => { const u = Math.abs(r) / scale; return u <= k ? 1 : k / u; });
    const nb = wls(X, y, w);
    const delta = Math.max(...nb.map((b, j) => Math.abs(b - beta[j])));
    beta = nb; if (delta < 1e-8) break;
  }
  const res = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  return { beta, sigma: (median(res.map(Math.abs)) / 0.6745) || 0 };
}
/** z for a median residual shift (D.5): 1.253 = efficiency correction of the median. */
const speedZ = (sW, sB, sigma, NW, NB) => (sW - sB) / (1.253 * sigma * Math.sqrt(1 / NW + 1 / NB));

// ------------------------------------------------------------------- D.6
/**
 * EWMA over xs starting at z0; limits ±L·σ·√(λ/(2−λ)·(1−(1−λ)^{2t})).
 * Returns [{ z, lim, t }] (t = 1-based step).
 */
function ewma(xs, { lambda = 0.2, z0, sigma, L = 2.962 }) {
  let z = z0; const out = [];
  xs.forEach((x, i) => {
    if (Number.isFinite(x)) z = lambda * x + (1 - lambda) * z;
    const t = i + 1;
    out.push({ z, t, lim: L * sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * t))) });
  });
  return out;
}
/**
 * Lower CUSUM on standardized values u = (x − μ)/σ: C = max(0, C − u − k); signal when C > h, then reset.
 * Returns { path: [C], signals: [index] }.
 */
function cusumLower(xs, { mu, sigma, k = 0.5, h = 5 }) {
  let C = 0; const path = [], signals = [];
  xs.forEach((x, i) => {
    if (Number.isFinite(x)) { C = Math.max(0, C - (x - mu) / sigma - k); }
    path.push(C);
    if (C > h) { signals.push(i); C = 0; }
  });
  return { path, signals };
}

// ------------------------------------------------------------------ D.10
/** Theil–Sen slope: median of pairwise slopes. xs default 0..n-1. NaN entries skipped. */
function theilSen(ys, xs) {
  const pts = ys.map((y, i) => [xs ? xs[i] : i, y]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const s = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) s.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  return s.length ? median(s) : NaN;
}
/**
 * Moving-block bootstrap CI for the Theil–Sen slope of a weekly series (D.10).
 * Resamples residual blocks around the fitted line (keeps the trend, preserves short autocorrelation).
 */
function slopeCI(ys, { B = 1000, block = 2, alpha = 0.10, seed = 'slope' } = {}) {
  const idx = ys.map((y, i) => i).filter((i) => Number.isFinite(ys[i]));
  if (idx.length < 4) return { slope: NaN, lo: NaN, hi: NaN };
  const x = idx, y = idx.map((i) => ys[i]);
  const b = theilSen(y, x), a = median(y.map((v, i) => v - b * x[i]));
  const res = y.map((v, i) => v - (a + b * x[i]));
  const rng = seededRng(seed), n = res.length, starts = n - block + 1, out = [];
  for (let r = 0; r < B; r++) {
    const rs = [];
    while (rs.length < n) { const s = Math.floor(rng() * starts); for (let k = 0; k < block && rs.length < n; k++) rs.push(res[s + k]); }
    out.push(theilSen(x.map((xi, i) => a + b * xi + rs[i]), x));
  }
  return { slope: b, lo: quantile(out, alpha / 2), hi: quantile(out, 1 - alpha / 2) };
}
/** IIV: SD of adjusted log-RT residuals within one session; weekly value = median over sessions. */
function iiv(sessions) {
  const v = sessions.filter((r) => r.length >= 3).map((r) => sd(r));
  return v.length ? median(v) : NaN;
}
/** IES = mean correct RT / proportion correct; only when accuracy ≥ 0.6. */
const ies = (meanRtCorrect, acc) => (acc >= 0.6 && meanRtCorrect > 0 ? meanRtCorrect / acc : NaN);

module.exports = {
  sum, mean, variance, sd, quantile, median, normCdf,
  baseline, windowScore, baselineZ, mdc, splitHalf,
  rci, practiceEffect, signTest, binomPmf, wilcoxon,
  wls, huberFit, speedZ, ewma, cusumLower, theilSen, slopeCI, iiv, ies,
};
