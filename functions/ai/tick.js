'use strict';
/**
 * Every 10 minutes (KST), a few reads:
 *   1. ≥ 08:00 flush Telegram messages queued earlier in the morning (today's only)
 *   2. ≥ 08:30 no report for today's aggregate → template "간단판" + Telegram (re-runs the aggregate if 06:50 failed)
 *   3. fired wake jobs without a report after 90 min → template alert report + rule-only Telegram
 *   4. ≥ 09:00 generator accepted nothing for 2 days → one Telegram until it recovers
 *   5. routine key used outside its windows today → one Telegram per day
 */
const { db, fam, FieldValue } = require('./fb.js');
const { getConfig, WAKE, MORNING } = require('./config.js');
const kd = require('./core/kdate.js');
const { sendTelegram } = require('./telegram.js');
const { storeTemplate, announce, tgKind, reportId } = require('./reports.js');
const { runFamily } = require('./pipeline.js');
const log = require('./log.js');

async function tick(nowMs = Date.now()) {
  const cfg = await getConfig();
  const fid = cfg.familyId;
  if (!fid || cfg.enabled === false) return { skipped: true };
  const now = kd.kst(nowMs);
  const mins = now.hour * 60 + now.minute;
  const h = fam(fid).collection('aiOps').doc('health');
  const hs = await h.get(); const H = hs.exists ? hs.data() : {};
  const done = [];

  // 1. queued Telegram
  if (now.hour >= MORNING.telegramAfterHour && Array.isArray(H.pendingTg) && H.pendingTg.length) {
    for (const e of H.pendingTg) { const [date, kind, n] = e.split('|'); if (date === now.date) { await sendTelegram(kind, Number(n) || 0); done.push('tg'); } }
    await h.set({ pendingTg: [] }, { merge: true });
  }

  // 2. morning fallback
  if (mins >= MORNING.fallbackAfter.h * 60 + MORNING.fallbackAfter.m && H.morningDone !== now.date) {
    let cur = await db().collection('aiAggregates').doc('current').get();
    if (!cur.exists || String(cur.get('asOf')).slice(0, 10) !== now.date) {
      const r = await runFamily(fid, { mode: now.weekday === 0 ? 'weekly' : 'daily', reason: 'tick_fallback', nowMs });
      cur = r.ran ? await db().collection('aiAggregates').doc('current').get() : cur;
    }
    if (cur.exists && String(cur.get('asOf')).slice(0, 10) === now.date) {
      const agg = cur.data();
      const rep = await fam(fid).collection('aiReports').doc(reportId(agg)).get();
      if (!rep.exists) { await storeTemplate(fid, agg); await announce(fid, tgKind(agg.mode, true), agg, nowMs); done.push('morning_template'); }
    }
    await h.set({ morningDone: now.date }, { merge: true });
  }

  // 3. wake jobs without a report
  const ws = await fam(fid).collection('aiOps').doc('wakes').get();
  for (const job of (ws.exists && ws.get('open')) || []) {
    const j = await db().collection('aiJobs').doc(job).get();
    if (!j.exists) { await ws.ref.set({ open: FieldValue.arrayRemove(job) }, { merge: true }); continue; }
    const created = j.get('createdTs') && j.get('createdTs').toMillis ? j.get('createdTs').toMillis() : 0;
    if (j.get('status') !== 'fired' || nowMs - created < WAKE.reportTimeoutMin * 60e3) continue;
    const a = await db().collection('aiAggregates').doc(j.get('aggregateId')).get();
    if (a.exists) { await storeTemplate(fid, a.data(), { jobId: job, rejectCodes: ['timeout'] }); await announce(fid, 'rule_only', a.data(), nowMs); }
    await j.ref.update({ status: 'timeout' });
    await ws.ref.set({ open: FieldValue.arrayRemove(job) }, { merge: true });
    done.push('job_timeout');
  }

  // 4. generator stalled
  if (now.hour >= 9) {
    const gen = H.gen || {};
    const lastOk = gen.lastOkDate || null;
    const stalled = !lastOk || lastOk < kd.addDays(now.date, -1);
    if (stalled && H.stallNotifiedFor !== (lastOk || 'never') && H.server && H.server.state === 'ok') {
      await sendTelegram('gen_stalled', 0);
      await h.set({ stallNotifiedFor: lastOk || 'never' }, { merge: true });
      done.push('gen_stalled');
    }
  }

  // 5. key used off schedule
  const ku = await db().collection('aiRate').doc('keyuse').get();
  const off = ku.exists ? ku.get('offSchedule') : null;
  if (off && off.date === now.date && off.n > 0 && ku.get('notified') !== now.date) {
    await sendTelegram('key_offschedule', 0);
    await ku.ref.set({ notified: now.date }, { merge: true });
    done.push('key_offschedule');
  }
  await h.set({ server: { lastTick: FieldValue.serverTimestamp() } }, { merge: true });
  if (done.length) log.info('tick', { done });
  return { done };
}
module.exports = { tick };
