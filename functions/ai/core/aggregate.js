'use strict';
/**
 * Pseudonymized aggregate (bw.agg.v1, DESIGN-AI Appendix F.1): codes, levels and a `numbers`
 * dict of display strings. The reporter routine may only write numbers as {{key}} placeholders.
 * No names, no family id, no free text, no item content.
 */
const kd = require('./kdate.js');
const { MEASURE_DOMAINS } = require('./series.js');

const DOMAIN_PREFIX = { composite: 'comp', memory: 'mem', attention: 'att', executive: 'exe', language: 'lan', visuospatial: 'vis', speed: 'spd', participation: 'part', anchor: 'anc' };
const DOMAIN_ORDER = ['composite', ...MEASURE_DOMAINS, 'speed', 'participation', 'anchor'];
const NOTE_CODES = ['sleep', 'illness', 'med_change', 'hospital', 'event', 'travel', 'device', 'mood', 'other'];

const pct = (x) => `${Math.round(x * 100)}%`;
const pp = (x, sign = false) => `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%p`;
const sgn1 = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
const fin = Number.isFinite;

/**
 * @param o {
 *   id, asOfMs, mode: 'daily'|'weekly'|'alert', pseudonym, phase, eval: evaluate() result, plan,
 *   today: { trained, games, items, refItems, refScore, startHour, minutes, abandoned } | null,
 *   notes: [{from,to,codes}], weeks (completed summary entries), extra: { dateQWrong, checkTotal, checkDate, iiv, ies }
 * }
 */
function buildAggregate(o) {
  const E = o.eval, M = E.metrics, N = {};
  const asOf = kd.kst(o.asOfMs);
  N.date = kd.koDate(asOf.date);
  const startWk = o.plan && o.plan.startDate ? o.plan.startDate : null;
  if (startWk) {
    N.base_from = kd.koDate(kd.addDays(startWk, 7), false);
    N.base_to = kd.koDate(kd.addDays(startWk, 7 * 5 - 1), false);
    N.week_no = `${Math.max(1, Math.floor(kd.daysBetween(startWk, asOf.date) / 7) + 1)}주차`;
  }
  const domains = [];
  const addDomain = (domain, metrics) => {
    const light = E.lights[domain] || 'gray';
    domains.push({ domain, light, metrics: metrics.filter((k) => N[k] != null) });
  };

  if (M.comp && M.base) {
    N.comp_ma4 = pct(M.comp.m); N.comp_base = pct(M.base.mu); N.comp_band = `±${Math.round(M.comp.band * 100)}%p`;
    N.comp_diff = pp(M.comp.m - M.base.mu, true); N.comp_z = sgn1(M.comp.z);
    if (M.comp.win) { N.comp_from = kd.koDate(M.comp.win.from, false); N.comp_to = kd.koDate(M.comp.win.to, false); }
  }
  const compSlope = slopeOf(o.weeks || []);
  if (compSlope) { N.comp_slope = `한 달에 ${pp(compSlope.m, true)}`; }
  addDomain('composite', ['comp_ma4', 'comp_base', 'comp_band', 'comp_diff', 'comp_slope', 'comp_from', 'comp_to']);

  for (const d of MEASURE_DOMAINS) {
    const p = DOMAIN_PREFIX[d], m = M[d];
    if (m) { N[`${p}_ma4`] = pct(m.m); N[`${p}_base`] = pct(m.base); N[`${p}_mdc90`] = `±${Math.round(m.mdc90w * 100)}%p`; N[`${p}_drop3`] = pp(-m.drop, true); }
    addDomain(d, [`${p}_ma4`, `${p}_base`, `${p}_mdc90`, `${p}_drop3`]);
  }

  if (M.speed) {
    const c = M.speed.change;
    if (fin(c)) N.spd_change = Math.abs(c) < 0.005 ? '평소와 같음' : `${Math.round(Math.abs(c) * 100)}% ${c > 0 ? '느림' : '빠름'}`;
    if (fin(M.speed.slope)) {
      const f = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs((Math.exp(x) - 1) * 100).toFixed(1)}%`;
      N.spd_slope = `주당 ${f(M.speed.slope)}`; if (fin(M.speed.lo)) { N.spd_slope_lo = f(M.speed.lo); N.spd_slope_hi = f(M.speed.hi); }
    }
    const s3 = E.indicators['S3:speed'];
    if (s3 && s3.since) N.spd_since = `${kd.koDate(s3.since, false)} 주`;
  }
  addDomain('speed', ['spd_change', 'spd_slope', 'spd_slope_lo', 'spd_slope_hi', 'spd_since']);

  if (M.part) {
    N.part_days14 = `${M.part.trained}일`; N.part_planned14 = `${M.part.planned}일`; N.part_abandon14 = pct(M.part.abandon);
    if (M.part.streak) N.part_streak = `${M.part.streak}일`;
  }
  addDomain('participation', ['part_days14', 'part_planned14', 'part_abandon14', 'part_streak']);

  let anchor = null;
  if (M.anchor && E.lights.anchor) {
    const a = M.anchor;
    N.anc_set = a.set || ''; N.anc_prev = a.prevWk ? `${kd.koDate(kd.weekStart(a.prevWk), false)} 주` : ''; N.anc_cur = a.wk ? `${kd.koDate(kd.weekStart(a.wk), false)} 주` : '';
    N.anc_n = `${a.nAnswered}문항`; N.anc_c1 = `${a.correct1}개`; N.anc_c2 = `${a.correct2}개`;
    N.anc_both = `${a.bothOk}`; N.anc_up = `${a.up}`; N.anc_down = `${a.down}`; N.anc_bothwrong = `${a.bothWrong}`;
    N.anc_p_sign = a.pSign.toFixed(2); N.anc_rci = sgn1(a.rci);
    if (a.spdChange != null) { N.anc_spd = `${Math.round(Math.abs(a.spdChange) * 100)}% ${a.spdChange > 0 ? '느려짐' : '빨라짐'}`; N.anc_p_wil = a.pWil.toFixed(2); }
    N.anc_pe = a.peK >= 2 ? pp(a.pe, true) : '추정 전';
    anchor = { set: a.set, verdict: E.lights.anchor, peReady: a.peK >= 2, metrics: Object.keys(N).filter((k) => k.startsWith('anc_')) };
    addDomain('anchor', anchor.metrics);
  }

  if (o.today) {
    const t = o.today;
    N.today_games = `${t.games}개`; N.today_items = `${t.items}개`; N.today_ref = `${t.refItems}개`; N.today_refok = `${t.refScore}개`;
    if (t.startHour != null) N.today_start = `${t.startHour}시`;
    if (t.minutes != null) N.today_min = `${t.minutes}분`;
    N.today_abandon = `${t.abandoned}번`;
  }
  const ex = o.extra || {};
  if (ex.dateQWrong != null) N.dateq_wrong = `${ex.dateQWrong}개`;
  if (ex.checkTotal != null) { N.check_total = `${ex.checkTotal}점`; N.check_date = kd.koDate(ex.checkDate, false); }
  if (fin(ex.iiv)) N.iiv = ex.iiv.toFixed(2);
  if (fin(ex.ies)) N.ies = `${(ex.ies / 1000).toFixed(1)}초`;

  const confounders = [];
  (o.notes || []).forEach((n, i) => {
    const codes = (n.codes || []).filter((c) => NOTE_CODES.includes(c));
    if (!codes.length || !kd.okYmd(n.from)) return;
    const k = i + 1;
    N[`note${k}_from`] = kd.koDate(n.from, false);
    if (n.to && kd.okYmd(n.to)) N[`note${k}_to`] = kd.koDate(n.to, false);
    codes.forEach((code) => confounders.push({ code, from: `note${k}_from`, to: n.to ? `note${k}_to` : null }));
  });

  const signals = E.signals.map((s) => ({
    key: s.key, rule: s.rule, domain: s.domain, level: s.level, why: s.why,
    downgraded: (s.downgradedBy || []).length > 0, evidence: (domains.find((d) => d.domain === s.domain) || { metrics: [] }).metrics,
  }));
  const glossaryKeys = ['baseline', 'band', 'mdc'];
  if (E.lights.speed && E.lights.speed !== 'gray') glossaryKeys.push('rt', 'ewma', 'slope');
  if (signals.some((s) => s.rule === 'S6')) glossaryKeys.push('cusum');
  if (anchor) glossaryKeys.push('anchor', 'rci', 'practice');
  if (N.iiv) glossaryKeys.push('iiv'); if (N.ies) glossaryKeys.push('ies');
  glossaryKeys.push('participation');

  return {
    schema: 'bw.agg.v1', id: o.id, asOf: new Date(o.asOfMs + 9 * 3600e3).toISOString().replace('Z', '+09:00').replace(/\.\d{3}/, ''),
    mode: o.mode, subject: /^사용자 [A-Z]$/.test(o.pseudonym || '') ? o.pseudonym : '사용자 A', phase: E.monitoring ? 'monitoring' : (o.phase || E.phase), thresholdsVer: E.thresholdsVer,
    today: o.today ? { trained: !!o.today.trained, metrics: Object.keys(N).filter((k) => k.startsWith('today_')) } : null,
    domains: domains.sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain)),
    signals, anchor, confounders,
    participation: { metrics: ['part_days14', 'part_planned14', 'part_abandon14'].filter((k) => N[k] != null) },
    reference: ['dateq_wrong', 'check_total', 'check_date', 'iiv', 'ies'].filter((k) => N[k] != null),
    confidence: E.confidence, numbers: N, glossaryKeys: [...new Set(glossaryKeys)],
  };
}

/** Theil–Sen slope of weekly composite accuracy over the last 12 completed monitoring weeks, per month (4.35 weeks). */
function slopeOf(weeks) {
  const S = require('./stats.js');
  const ws = weeks.filter((w) => w.idx > 4 && w.adequate).slice(-12);
  if (ws.length < 6) return null;
  const b = S.theilSen(ws.map((w) => w.sum / w.n), ws.map((w) => w.idx));
  return fin(b) ? { m: b * 4.35 } : null;
}

module.exports = { buildAggregate, DOMAIN_PREFIX, DOMAIN_ORDER, NOTE_CODES };
