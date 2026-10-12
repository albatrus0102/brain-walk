'use strict';
/**
 * Anchor comparison (DESIGN-AI §4.4, D.4): same frozen items, ~12 weeks apart.
 * Verdict is for the whole set by server rules — never per item, never by the AI.
 */
const S = require('./stats.js');

/**
 * prev/cur: anchor rows [{ id, s, ok, rt, err }] of the earlier and the current run of one set.
 * opts: { phi (from reference baseline), excluded: Set(itemIds), repeats: [{a1,a2,r1,r2}] earlier repeats for Δ̂_PE,
 *         refChange: reference composite change over the same two weeks (to log as a repeat), setSize }
 */
function anchorCompare(prev, cur, opts = {}) {
  const ex = opts.excluded || new Set();
  const P = new Map(prev.filter((r) => r.id && !ex.has(r.id)).map((r) => [r.id, r]));
  const pairs = cur.filter((r) => r.id && !ex.has(r.id) && P.has(r.id)).map((r) => [P.get(r.id), r]);
  const both = pairs.filter(([a, b]) => a.s != null && b.s != null);
  const setSize = opts.setSize || Math.max(P.size, cur.length, 1);
  const out = { nItems: setSize, nAnswered: both.length, answeredShare: both.length / setSize };
  if (!both.length) return { ...out, verdict: 'gray', why: ['anchor_no_pairs'] };
  const x1 = S.mean(both.map(([a]) => a.s)), x2 = S.mean(both.map(([, b]) => b.s));
  let bothOk = 0, up = 0, down = 0, bothWrong = 0;
  both.forEach(([a, b]) => { if (a.ok && b.ok) bothOk++; else if (!a.ok && b.ok) up++; else if (a.ok && !b.ok) down++; else bothWrong++; });
  const pSign = S.signTest(up, down);
  const lr = both.filter(([a, b]) => a.ok && b.ok && a.rt && b.rt).map(([a, b]) => Math.log(b.rt / a.rt));
  const wil = S.wilcoxon(lr);
  const spdChange = lr.length ? Math.exp(S.median(lr)) - 1 : null;
  const pbar = (x1 + x2) / 2, phi = opts.phi || 1;
  const sem = Math.sqrt(phi * Math.max(pbar * (1 - pbar), 0.02) / both.length);
  const pe = S.practiceEffect(opts.repeats || []);
  const rci = S.rci(x1, x2, sem, pe.pe);
  const errs = (rows) => { const m = {}; rows.forEach((r) => (r.err || []).forEach((e) => { m[e] = (m[e] || 0) + 1; })); return m; };
  return {
    ...out, x1, x2, correct1: both.filter(([a]) => a.ok).length, correct2: both.filter(([, b]) => b.ok).length,
    bothOk, up, down, bothWrong, pSign, nSpeed: lr.length, pWil: wil.p, spdChange, sem, pe: pe.pe, peK: pe.k, rci,
    errPrev: errs(both.map(([a]) => a)), errCur: errs(both.map(([, b]) => b)),
  };
}

/**
 * §4.4 verdict. s1s3Yellow: S1 or S3 at yellow or worse; confounded: a note overlaps that week.
 * Returns { level: blue|green|yellow|orange|gray, why[] } — "향상 판단 보류" when Δ̂_PE has < 2 repeats.
 */
function anchorVerdict(c, { s1s3Yellow = false, confounded = false, rciY = -1.65, rciO = -1.96 } = {}) {
  if (!c || c.verdict === 'gray' || c.answeredShare < 0.8) return { level: 'gray', why: ['anchor_insufficient'] };
  if (confounded) return { level: 'gray', why: ['anchor_note_overlap'] };
  if (c.rci <= rciO && s1s3Yellow) return { level: 'orange', why: ['anchor_rci_orange', 'anchor_with_trend'] };
  if (c.rci <= rciY) return { level: 'yellow', why: ['anchor_rci_yellow'] };
  if (c.rci >= 1.65) return c.peK >= 2 ? { level: 'blue', why: ['anchor_rci_up'] } : { level: 'green', why: ['anchor_up_pe_pending'] };
  return { level: 'green', why: ['anchor_stable'] };
}

module.exports = { anchorCompare, anchorVerdict };
