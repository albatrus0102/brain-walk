'use strict';
/**
 * Storing reports for the app (families/{fid}/aiReports/{r-<aggId>}), the template fallback, and the
 * Telegram that announces them (deferred to ≥ 08:00 KST for morning/weekly reports).
 */
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const { checkReport, fillReport } = require('./core/report.js');
const { templateReport } = require('./core/template.js');
const { sendTelegram } = require('./telegram.js');
const { RETENTION_DAYS, MORNING } = require('./config.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

const reportId = (agg) => 'r-' + agg.id;
const orangeCount = (agg) => (agg.signals || []).filter((s) => s.level === 'orange').length;

/** Write a checked report (routine or template). Returns the report id. */
async function storeReport(fid, agg, rep, { generatedBy, jobId = 'scheduled', rejectCodes = null }) {
  const filled = fillReport(rep, agg);
  const id = reportId(agg);
  const lights = Object.fromEntries(agg.domains.map((d) => [d.domain, d.light]));
  await fam(fid).collection('aiReports').doc(id).set({
    v: 1, kind: agg.mode, date: agg.asOf.slice(0, 10), basedOn: agg.id, jobId, generatedBy, rejectCodes,
    lights, confidence: agg.confidence, phase: agg.phase, thresholdsVer: agg.thresholdsVer,
    report: filled, numbers: agg.numbers, domains: agg.domains, signals: agg.signals, anchor: agg.anchor, confounders: agg.confounders,
    participation: agg.participation, reference: agg.reference || [], glossaryKeys: agg.glossaryKeys, orange: orangeCount(agg),
    ts: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.reports),
  });
  await fam(fid).collection('aiOps').doc('health').set({ rep: { lastReportTs: FieldValue.serverTimestamp(), lastAggId: agg.id, lastGeneratedBy: generatedBy, lastKind: agg.mode } }, { merge: true });
  return id;
}

/** Template ("간단판") report for an aggregate. */
async function storeTemplate(fid, agg, { jobId = 'scheduled', rejectCodes = null } = {}) {
  const rep = templateReport(agg, jobId);
  const c = checkReport(rep, agg, { jobId });
  if (!c.ok) log.error('template_invalid', { codes: c.codes });   // should never happen; still stored for the app
  return storeReport(fid, agg, rep, { generatedBy: 'template', jobId, rejectCodes });
}

/** Telegram now, or queue it until 08:00 KST (morning/weekly). */
async function announce(fid, kind, agg, nowMs = Date.now()) {
  const n = orangeCount(agg);
  const now = kd.kst(nowMs);
  const early = now.hour < MORNING.telegramAfterHour && !['alert', 'rule_only'].includes(kind);
  const h = fam(fid).collection('aiOps').doc('health');
  if (early) { await h.set({ pendingTg: FieldValue.arrayUnion(`${now.date}|${kind}|${n}`) }, { merge: true }); return 'queued'; }
  const ok = await sendTelegram(kind, n);
  await h.set({ tg: { lastKind: kind, lastOk: ok, lastTs: FieldValue.serverTimestamp() } }, { merge: true });
  return ok ? 'sent' : 'failed';
}
const tgKind = (mode, template) => (mode === 'alert' ? (template ? 'rule_only' : 'alert') : mode === 'weekly' ? (template ? 'weekly_template' : 'weekly') : (template ? 'morning_template' : 'morning'));

/**
 * Handle one report from the inbox. jobId 'scheduled' → must be based on aiAggregates/current;
 * otherwise on the job's alert aggregate. Failing reports are replaced by the template.
 */
async function handleReport(fid, payload, jobId, nowMs = Date.now()) {
  let agg = null, job = null;
  if (jobId === 'scheduled') {
    const s = await db().collection('aiAggregates').doc('current').get();
    agg = s.exists ? s.data() : null;
  } else {
    const j = await db().collection('aiJobs').doc(jobId).get();
    job = j.exists ? j.data() : null;
    if (job && job.aggregateId) { const a = await db().collection('aiAggregates').doc(job.aggregateId).get(); agg = a.exists ? a.data() : null; }
  }
  if (!agg) return { ok: false, codes: ['based_on'] };
  const existing = await fam(fid).collection('aiReports').doc(reportId(agg)).get();
  if (existing.exists && existing.get('generatedBy') === 'routine') return { ok: false, codes: ['duplicate'] };
  const c = checkReport(payload, agg, { jobId });
  const already = existing.exists;   // a template was already stored and announced
  if (c.ok) await storeReport(fid, agg, payload, { generatedBy: 'routine', jobId });
  else if (!already) await storeTemplate(fid, agg, { jobId, rejectCodes: c.codes });
  if (job) await db().collection('aiJobs').doc(jobId).update({ status: c.ok ? 'reported' : 'rejected', reportedTs: FieldValue.serverTimestamp() });
  if (job) await fam(fid).collection('aiOps').doc('wakes').set({ open: FieldValue.arrayRemove(jobId) }, { merge: true });
  if (!already) await announce(fid, tgKind(agg.mode, !c.ok), agg, nowMs);
  return { ok: c.ok, codes: c.codes };
}

module.exports = { storeReport, storeTemplate, announce, handleReport, tgKind, reportId, orangeCount };
