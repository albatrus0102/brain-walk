'use strict';
/**
 * Report check and fill (DESIGN-AI Appendix B.8, F.2).
 *  1. schema bw.report.v1, basedOn == aggregate id, jobId match, mode match
 *  2. no digits anywhere outside {{key}} placeholders; every key exists in aggregate.numbers
 *  3. light, confidence and the domain list equal the server values exactly
 *  4. report_banned words absent; at least one approved closing phrase
 *  5. lengths (headline ≤ 60, summary 2–3 sentences ≤ 200, domain sentence ≤ 80, total ≤ 6,000)
 * Passing reports are filled (placeholders → numbers) by the server only.
 */
const { NFC, vlen, badChars } = require('./text.js');
const { lexicon } = require('./lexicon.js');
const { bannedHit, piiHit } = require('./checks.js');

const JOB_RE = /^w-\d{8}-\d{4}-[a-z0-9]{2}$/;
const KEYS = ['schema', 'jobId', 'basedOn', 'mode', 'headline', 'summary', 'domains', 'notable', 'confounders', 'doctorPoints', 'glossary', 'confidence', 'trend', 'anchor'];
const PH = /\{\{([a-z0-9_]{1,40})\}\}/g;
const REPORT_REASONS = ['schema', 'job', 'based_on', 'mode', 'domains', 'light', 'confidence', 'digits', 'placeholder', 'charset', 'length',
  'banned', 'pii', 'closing', 'glossary', 'evidence', 'trend', 'anchor'];

function checkReport(rep, agg, { jobId = 'scheduled' } = {}) {
  const lx = lexicon();
  const codes = [];
  const fail = (c) => { if (!codes.includes(c)) codes.push(c); };
  if (!rep || typeof rep !== 'object' || rep.schema !== 'bw.report.v1' || Object.keys(rep).some((k) => !KEYS.includes(k))) return { ok: false, codes: ['schema'] };
  if (!agg || agg.schema !== 'bw.agg.v1') return { ok: false, codes: ['based_on'] };
  if (rep.jobId !== jobId || (jobId !== 'scheduled' && !JOB_RE.test(jobId))) fail('job');
  if (rep.basedOn !== agg.id) fail('based_on');
  if (rep.mode !== agg.mode) fail('mode');
  if (rep.confidence !== agg.confidence) fail('confidence');

  const texts = [];
  const str = (v, max, where) => { if (typeof v !== 'string' || !v.trim() || vlen(v) > max) { fail('length'); return false; } texts.push([where, v]); return true; };
  const arr = (v, min, max) => Array.isArray(v) && v.length >= min && v.length <= max;

  str(rep.headline, 60, 'headline');
  if (!arr(rep.summary, 2, 3)) fail('length'); else { rep.summary.forEach((s) => str(s, 120, 'summary')); if (rep.summary.join('').length > 200) fail('length'); }
  if (!arr(rep.domains, agg.domains.length, agg.domains.length)) fail('domains');
  else rep.domains.forEach((d, i) => {
    const want = agg.domains[i];
    if (!d || d.domain !== want.domain) fail('domains');
    else if (d.light !== want.light) fail('light');
    if (d && Object.keys(d).some((k) => !['domain', 'light', 'sentence'].includes(k))) fail('schema');
    if (d) str(d.sentence, 80, 'domain');
  });
  const numKeys = new Set(Object.keys(agg.numbers || {}));
  const metricKeys = new Set(agg.domains.flatMap((d) => d.metrics || []));
  const evidenceOk = (ev) => Array.isArray(ev) && ev.length <= 6 && ev.every((k) => numKeys.has(k) || metricKeys.has(k));
  if (!arr(rep.notable, 0, 3)) fail('length'); else rep.notable.forEach((n) => { if (!n || !str(n.text, 120, 'notable') || !evidenceOk(n.evidence)) fail('evidence'); });
  if (!arr(rep.confounders, 0, 5)) fail('length'); else rep.confounders.forEach((c) => str(c, 60, 'confounder'));
  if (!arr(rep.doctorPoints, 1, 3)) fail('length'); else rep.doctorPoints.forEach((p) => { if (!p || !str(p.text, 120, 'doctor') || !evidenceOk(p.evidence)) fail('evidence'); });
  if (!arr(rep.glossary, 0, 12)) fail('length');
  else rep.glossary.forEach((g) => { if (!g || !agg.glossaryKeys.includes(g.key)) fail('glossary'); else { str(g.plain, 60, 'glossary'); str(g.analogy, 40, 'glossary'); } });
  if (agg.mode === 'weekly') { if (!arr(rep.trend, 2, 3)) fail('trend'); else rep.trend.forEach((t) => str(t, 120, 'trend')); }
  else if (rep.trend != null) fail('trend');
  if (agg.anchor && agg.mode === 'weekly') { if (!arr(rep.anchor, 2, 4)) fail('anchor'); else rep.anchor.forEach((t) => str(t, 120, 'anchor')); }
  else if (rep.anchor != null) fail('anchor');

  // digits only inside placeholders; placeholder keys must exist
  let total = 0;
  for (const [, t] of texts) {
    total += vlen(t);
    for (const m of t.matchAll(PH)) if (!numKeys.has(m[1])) fail('placeholder');
    const bare = t.replace(PH, '');
    if (/[0-9０-９]/.test(bare)) fail('digits');
    if (/[{}]/.test(bare)) fail('placeholder');
    if (badChars(bare, null).length) fail('charset');
  }
  if (total > 6000) fail('length');
  const all = texts.map(([, t]) => t.replace(PH, ' ')).join('\n');
  if (bannedHit(lx, all, 'report')) fail('banned');
  if (piiHit(lx, all)) fail('pii');
  const closing = [...(rep.summary || []), ...((rep.doctorPoints || []).map((p) => p && p.text))].filter((s) => typeof s === 'string');
  if (!closing.some((s) => lx.reportClosings.some((c) => NFC(s).includes(c)))) fail('closing');
  return { ok: codes.length === 0, codes };
}

/** Replace {{key}} with aggregate numbers (server side, after checkReport passed). */
function fillReport(rep, agg) {
  const N = agg.numbers || {};
  const f = (s) => (typeof s === 'string' ? s.replace(PH, (_, k) => (N[k] != null ? N[k] : '')) : s);
  const out = {
    headline: f(rep.headline), summary: rep.summary.map(f),
    domains: rep.domains.map((d) => ({ domain: d.domain, light: d.light, sentence: f(d.sentence) })),
    notable: rep.notable.map((n) => ({ text: f(n.text), evidence: n.evidence })),
    confounders: rep.confounders.map(f),
    doctorPoints: rep.doctorPoints.map((p) => ({ text: f(p.text), evidence: p.evidence })),
    glossary: rep.glossary.map((g) => ({ key: g.key, plain: f(g.plain), analogy: f(g.analogy) })),
  };
  if (rep.trend) out.trend = rep.trend.map(f);
  if (rep.anchor) out.anchor = rep.anchor.map(f);
  return out;
}

module.exports = { checkReport, fillReport, REPORT_REASONS, JOB_RE };
