'use strict';
/**
 * Storing reports for the app (families/{fid}/trainees/{mid}/aiReports/{r-<aggId>}), the template fallback, and
 * the Telegram that announces them (deferred to ≥ 08:00 KST for morning/weekly reports).
 * Report text names the person only as {{who}}; the server keeps it as is and the app fills in the label.
 */
const { db, FieldValue, expireIn } = require('./fb.js');
const { checkReport, fillReport } = require('./core/report.js');
const { templateReport } = require('./core/template.js');
const { sendTelegram } = require('./telegram.js');
const { RETENTION_DAYS } = require('./config.js');
const { tref, resolveLetter } = require('./family.js');
const log = require('./log.js');

const reportId = (agg) => 'r-' + agg.id;
const orangeCount = (agg) => (agg.signals || []).filter((s) => s.level === 'orange').length;
/** Letter of a scheduled report's basedOn ('a-B-20270316-0650' → 'B'). */
const letterOfAggId = (id) => { const m = /^a-([A-Z])-\d{8}-\d{4}(-al)?$/.exec(String(id || '')); return m ? m[1] : null; };

/** Write a checked report (routine or template) for trainee `mid`. Returns the report id. */
async function storeReport(fid, mid, agg, rep, { generatedBy, jobId = 'scheduled', rejectCodes = null }) {
  const filled = fillReport(rep, agg);
  const id = reportId(agg);
  const lights = Object.fromEntries(agg.domains.map((d) => [d.domain, d.light]));
  const t = tref(fid, mid);
  await t.collection('aiReports').doc(id).set({
    v: 1, kind: agg.mode, date: agg.asOf.slice(0, 10), basedOn: agg.id, jobId, generatedBy, rejectCodes,
    lights, confidence: agg.confidence, phase: agg.phase, thresholdsVer: agg.thresholdsVer,
    report: filled, numbers: agg.numbers, domains: agg.domains, signals: agg.signals, anchor: agg.anchor, confounders: agg.confounders,
    participation: agg.participation, reference: agg.reference || [], glossaryKeys: agg.glossaryKeys, orange: orangeCount(agg),
    ts: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.reports),
  });
  await t.collection('aiOps').doc('health').set({ rep: { lastReportTs: FieldValue.serverTimestamp(), lastAggId: agg.id, lastGeneratedBy: generatedBy, lastKind: agg.mode } }, { merge: true });
  return id;
}

/** Template ("간단판") report for an aggregate. */
async function storeTemplate(fid, mid, agg, { jobId = 'scheduled', rejectCodes = null } = {}) {
  const rep = templateReport(agg, jobId);
  const c = checkReport(rep, agg, { jobId });
  if (!c.ok) log.error('template_invalid', { codes: c.codes });   // should never happen; still stored for the app
  return storeReport(fid, mid, agg, rep, { generatedBy: 'template', jobId, rejectCodes });
}

/** Announce a report. Morning/weekly announcements wait until 08:00 KST (queued in tgOutbox, so all trainees'
 *  morning reports arrive as ONE digest); every send also obeys the 02:00–08:00 no-Telegram gate inside sendTelegram.
 *  opts.queue: queue it anyway (the 08:30 template fallback batches its trainees into one digest). */
async function announce(fid, mid, kind, agg, nowMs = Date.now(), opts = {}) {
  const r = await sendTelegram(kind, orangeCount(agg), nowMs, { holdUntil8: !['alert', 'rule_only'].includes(kind), queue: !!opts.queue, s: agg.s || letterOfAggId(agg.id) });
  await tref(fid, mid).collection('aiOps').doc('health').set({ tg: { lastKind: kind, lastResult: r, lastTs: FieldValue.serverTimestamp() } }, { merge: true });
  return r;
}
const tgKind = (mode, template) => (mode === 'alert' ? (template ? 'rule_only' : 'alert') : mode === 'weekly' ? (template ? 'weekly_template' : 'weekly') : (template ? 'morning_template' : 'morning'));

/**
 * Handle one report from the inbox. jobId 'scheduled' → the letter L comes from payload.basedOn and the report must
 * be based on aiAggregates/current-{L}; otherwise on the job's alert aggregate (L = aiJobs/{job}.s).
 * The report is stored under the trainee that L maps to. Failing reports are replaced by the template.
 */
async function handleReport(fid, payload, jobId, nowMs = Date.now()) {
  let agg = null, job = null, L = null;
  if (jobId === 'scheduled') {
    L = letterOfAggId(payload && payload.basedOn);
    if (L) { const s = await db().collection('aiAggregates').doc(`current-${L}`).get(); agg = s.exists ? s.data() : null; }
  } else {
    const j = await db().collection('aiJobs').doc(jobId).get();
    job = j.exists ? j.data() : null;
    L = job && /^[A-Z]$/.test(job.s || '') ? job.s : null;
    if (L && job.aggregateId) { const a = await db().collection('aiAggregates').doc(job.aggregateId).get(); agg = a.exists ? a.data() : null; }
  }
  if (!agg || !L) return { ok: false, codes: ['based_on'] };
  const mid = await resolveLetter(L);
  if (!mid) return { ok: false, codes: ['based_on'] };
  const t = tref(fid, mid);
  const existing = await t.collection('aiReports').doc(reportId(agg)).get();
  if (existing.exists && existing.get('generatedBy') === 'routine') return { ok: false, codes: ['duplicate'] };
  const c = checkReport(payload, agg, { jobId });
  const already = existing.exists;   // a template was already stored and announced
  if (c.ok) await storeReport(fid, mid, agg, payload, { generatedBy: 'routine', jobId });
  else if (!already) await storeTemplate(fid, mid, agg, { jobId, rejectCodes: c.codes });
  if (job) await db().collection('aiJobs').doc(jobId).update({ status: c.ok ? 'reported' : 'rejected', reportedTs: FieldValue.serverTimestamp() });
  if (job) await t.collection('aiOps').doc('wakes').set({ open: FieldValue.arrayRemove(jobId) }, { merge: true });
  if (!already) await announce(fid, mid, tgKind(agg.mode, !c.ok), agg, nowMs);
  return { ok: c.ok, codes: c.codes, s: L };
}

module.exports = { storeReport, storeTemplate, announce, handleReport, tgKind, reportId, orangeCount, letterOfAggId };
