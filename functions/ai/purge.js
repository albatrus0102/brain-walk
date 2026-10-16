'use strict';
/**
 * Retention (04:30 KST). Firestore TTL deletes aiInbox / aiAggregates / aiJobs / aiRejects / aiRate by
 * `expireAt` (up to ~24 h late); this is the backstop plus everything TTL does not cover:
 *   itemLogs 2 years · aiReports, aiStats weeks, closed aiSignals, aiNotes 5 years · retired bank items 1 year
 *   everything left under a deleted family (recursive) and its aggregates/jobs/inbox; pseudonymized
 *   aggregates when the admin switched AI reports off, and a trainee's aggregates (s == L) when their consent is
 *   withdrawn or missing (and its wake jobs). Per-trainee data lives under trainees/{mid}/…; listDocuments() also returns removed
 *   trainees (no parent doc), so their history is kept for the same 5 years and then deleted.
 */
const { db, fam, Timestamp } = require('./fb.js');
const { getConfig, RETENTION_DAYS } = require('./config.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

async function delQuery(q, max = 2000) {
  let n = 0;
  while (n < max) {
    const s = await q.limit(400).get();
    if (s.empty) break;
    const b = db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
    n += s.size;
    if (s.size < 400) break;
  }
  return n;
}
async function purge(nowMs = Date.now()) {
  const cfg = await getConfig();
  const nowTs = Timestamp.fromMillis(nowMs);
  const today = kd.kst(nowMs).date;
  const out = {};
  for (const col of ['aiInbox', 'aiAggregates', 'aiJobs', 'aiRejects', 'aiRate', 'tgOutbox']) out[col] = await delQuery(db().collection(col).where('expireAt', '<', nowTs));
  const retiredCut = Timestamp.fromMillis(nowMs - RETENTION_DAYS.retiredBank * 864e5);
  out.bankRetired = await delQuery(db().collection('aiBank').where('status', '==', 'retired').where('retiredTs', '<', retiredCut));
  const fid = cfg.familyId;
  if (fid) {
    const f = fam(fid);
    const exists = (await f.get()).exists;
    if (!exists) {
      // The owner deleted the family ("모든 기록 삭제"). Clients cannot delete server-written AI docs
      // (aiStats, aiSignals, aiReports, aiOps, aiPacks, aiState/plan), so remove the whole leftover subtree here.
      await db().recursiveDelete(f);
      out.orphanFamily = 1;
      for (const col of ['aiAggregates', 'aiJobs', 'aiInbox']) out['orphan_' + col] = await delQuery(db().collection(col));
    } else {
      out.itemLogs = await delQuery(f.collection('itemLogs').where('date', '<', kd.addDays(today, -RETENTION_DAYS.itemLogs)));
      const cut5 = kd.addDays(today, -RETENTION_DAYS.reports);
      out.reports = 0; out.stats = 0; out.notes = 0; out.signals = 0;
      for (const t of await f.collection('trainees').listDocuments()) {
        out.reports += await delQuery(t.collection('aiReports').where('date', '<', cut5));
        out.stats += await delQuery(t.collection('aiStats').where('start', '<', cut5));
        out.notes += await delQuery(t.collection('aiNotes').where('from', '<', cut5));
        const sig = await t.collection('aiSignals').where('since', '<', cut5).limit(400).get();
        const b = db().batch(); let k = 0; sig.forEach((d) => { if (d.get('on') === false) { b.delete(d.ref); k++; } }); if (k) await b.commit();
        out.signals += k;
      }
      // consent withdrawn (or gone): that trainee's pseudonymized aggregates go now, not after the 90-day TTL
      out.withdrawn = 0;
      for (const [mid, L] of Object.entries(cfg.subjects || {})) {
        const c = await f.collection('consents').doc(mid).get();
        if (c.exists && c.get('ackTs') && !c.get('withdrawnTs')) continue;
        out.withdrawn += await delQuery(db().collection('aiAggregates').where('s', '==', L));
        out.withdrawn += await delQuery(db().collection('aiJobs').where('s', '==', L));
      }
      const sw = await f.collection('aiState').doc('switch').get();
      if (sw.exists && sw.get('enabled') === false) for (const col of ['aiAggregates', 'aiJobs']) out['off_' + col] = await delQuery(db().collection(col));
    }
  }
  log.info('purge', out);
  return out;
}
module.exports = { purge, delQuery };
