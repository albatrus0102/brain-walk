'use strict';
/**
 * Every 10 minutes (KST), a few reads:
 *   1. ≥ 08:00 send anything still queued in tgOutbox as one digest (backstop for aiTgFlush)
 *   2. ≥ 08:30 per eligible trainee: no report for today's current-{L} → template "간단판" (re-runs that trainee's
 *      aggregate if 06:50 failed); the template announcements of all trainees go out as ONE digest
 *   3. per trainee: fired wake jobs without a report after 90 min → template alert report + rule-only Telegram
 *   4. ≥ 09:00 generator accepted nothing for 2 days → one Telegram until it recovers
 *   5. routine key used outside its windows today → one Telegram per day
 * Family-level aiOps/health holds morningDone, the generator health (gen) and the stall flag.
 */
const { db, fam, FieldValue } = require('./fb.js');
const { getConfig, WAKE, MORNING } = require('./config.js');
const kd = require('./core/kdate.js');
const { sendTelegram, flushOutbox } = require('./telegram.js');
const { storeTemplate, announce, tgKind, reportId } = require('./reports.js');
const { runTrainee, eligibility } = require('./pipeline.js');
const F = require('./family.js');
const log = require('./log.js');

const isToday = (snap, date) => snap.exists && String(snap.get('asOf')).slice(0, 10) === date;

async function tick(nowMs = Date.now()) {
  const cfg = await getConfig();
  const fid = cfg.familyId;
  if (!fid || cfg.enabled === false) return { skipped: true };
  const now = kd.kst(nowMs);
  const mins = now.hour * 60 + now.minute;
  const h = fam(fid).collection('aiOps').doc('health');
  const hs = await h.get(); const H = hs.exists ? hs.data() : {};
  const done = [];

  // 1. backstop for the 08:00 digest (aiTgFlush): anything still queued is sent once the hold window is over
  if (now.hour >= MORNING.telegramAfterHour) { const f = await flushOutbox(nowMs); if (f.sent) done.push('tg_digest'); }

  // 2. morning fallback, per eligible trainee
  if (mins >= MORNING.fallbackAfter.h * 60 + MORNING.fallbackAfter.m && H.morningDone !== now.date) {
    const T = await F.loadTrainees(fid);
    let queued = 0;
    for (const mid of T.ids) {
      try {
        const el = await eligibility(fid, mid, T);
        if (!el.ok) continue;
        const L = await F.ensureLetter(mid);
        if (!L) continue;
        const curRef = db().collection('aiAggregates').doc(`current-${L}`);
        let cur = await curRef.get();
        if (!isToday(cur, now.date)) {
          const r = await runTrainee(fid, mid, { mode: now.weekday === 0 ? 'weekly' : 'daily', reason: 'tick_fallback', nowMs, T });
          if (r.ran) cur = await curRef.get();
        }
        if (!isToday(cur, now.date)) continue;
        const agg = cur.data();
        const rep = await F.tref(fid, mid).collection('aiReports').doc(reportId(agg)).get();
        if (!rep.exists) { await storeTemplate(fid, mid, agg); await announce(fid, mid, tgKind(agg.mode, true), agg, nowMs, { queue: true }); queued++; done.push('morning_template'); }
      } catch (e) { log.debugError(e); log.error('morning_fallback_failed', { code: e && e.code ? String(e.code) : 'error' }); }
    }
    if (queued) await flushOutbox(nowMs);
    await h.set({ morningDone: now.date }, { merge: true });
  }

  // 3. wake jobs without a report (every trainee that ever had a letter, so a removed trainee's open job still closes)
  for (const mid of Object.keys(cfg.subjects || {})) {
    const wref = F.tref(fid, mid).collection('aiOps').doc('wakes');
    const ws = await wref.get();
    for (const job of (ws.exists && ws.get('open')) || []) {
      const j = await db().collection('aiJobs').doc(job).get();
      if (!j.exists) { await wref.set({ open: FieldValue.arrayRemove(job) }, { merge: true }); continue; }
      const created = j.get('createdTs') && j.get('createdTs').toMillis ? j.get('createdTs').toMillis() : 0;
      if (j.get('status') !== 'fired' || nowMs - created < WAKE.reportTimeoutMin * 60e3) continue;
      const a = await db().collection('aiAggregates').doc(j.get('aggregateId')).get();
      if (a.exists) { await storeTemplate(fid, mid, a.data(), { jobId: job, rejectCodes: ['timeout'] }); await announce(fid, mid, 'rule_only', a.data(), nowMs); }
      await j.ref.update({ status: 'timeout' });
      await wref.set({ open: FieldValue.arrayRemove(job) }, { merge: true });
      done.push('job_timeout');
    }
  }

  // 4. generator stalled
  if (now.hour >= 9) {
    const gen = H.gen || {};
    const lastOk = gen.lastOkDate || null;
    const stalled = !lastOk || lastOk < kd.addDays(now.date, -1);
    if (stalled && H.stallNotifiedFor !== (lastOk || 'never') && H.server && H.server.state === 'ok') {
      await sendTelegram('gen_stalled', 0, nowMs);
      await h.set({ stallNotifiedFor: lastOk || 'never' }, { merge: true });
      done.push('gen_stalled');
    }
  }

  // 5. key used off schedule
  const ku = await db().collection('aiRate').doc('keyuse').get();
  const off = ku.exists ? ku.get('offSchedule') : null;
  if (off && off.date === now.date && off.n > 0 && ku.get('notified') !== now.date) {
    await sendTelegram('key_offschedule', 0, nowMs);
    await ku.ref.set({ notified: now.date }, { merge: true });
    done.push('key_offschedule');
  }
  await h.set({ server: { lastTick: FieldValue.serverTimestamp() } }, { merge: true });
  if (done.length) log.info('tick', { done });
  return { done };
}
module.exports = { tick };
