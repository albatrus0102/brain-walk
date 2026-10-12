'use strict';
/** Course done → re-aggregate (throttled to once per 10 min) → wake the reporter on newly-on orange signals. */
const { db, fam, expireIn } = require('./fb.js');
const { runFamily } = require('./pipeline.js');
const { maybeWake } = require('./waker.js');
const { storeTemplate, announce } = require('./reports.js');

/** After a course: re-aggregate (throttled 10 min) and wake the reporter on newly-on orange signals. */
async function afterCourse(fid, nowMs = Date.now()) {
  const h = fam(fid).collection('aiOps').doc('health');
  const ok = await db().runTransaction(async (tx) => {
    const s = await tx.get(h); const last = s.exists ? s.get('lastProgressRunMs') || 0 : 0;
    if (nowMs - last < 10 * 60e3) return false;
    tx.set(h, { lastProgressRunMs: nowMs }, { merge: true }); return true;
  });
  if (!ok) return { throttled: true };
  const r = await runFamily(fid, { mode: 'daily', reason: 'course_done', nowMs });
  if (!r.ran || !r.newOrange.length) return r;
  const alertAgg = { ...r.agg, id: r.agg.id + '-al', mode: 'alert', expireAt: expireIn(90, nowMs) };
  await db().collection('aiAggregates').doc(alertAgg.id).set(alertAgg);
  const w = await maybeWake(fid, {
    newOrange: r.newOrange, aggregateId: alertAgg.id, nowMs,
    onFailure: async (job) => { await storeTemplate(fid, alertAgg, { jobId: job, rejectCodes: ['wake_failed'] }); await announce(fid, 'rule_only', alertAgg, nowMs); },
  });
  return { ...r, wake: w };
}
module.exports = { afterCourse };
