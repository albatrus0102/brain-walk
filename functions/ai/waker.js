'use strict';
/**
 * Immediate wake of the reporter routine on a NEW orange signal (DESIGN-AI §5.2–§5.4, G.2).
 *  - only off→on (or yellow→orange); quiet hours 20:00–08:00 → left for the 07:30 morning report
 *  - per signal key: 7-day cooldown since the last wake; per KST day: at most 2 wakes
 *  - all newly-on orange signals are bundled into one wake; NO retry (the fire API has no idempotency key)
 *  - failure → template alert report + rule-only Telegram (no health content)
 * The fire text holds rule and reason codes only; the routine extracts the job id and reads aiJobs itself.
 */
const crypto = require('node:crypto');
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const { secret, WAKE, RETENTION_DAYS } = require('./config.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

/** The fire URL, or '' when not configured (placeholder secret such as "unset"). Plain http only in the emulator (local mock). */
function fireUrl(u) {
  const emu = process.env.FUNCTIONS_EMULATOR === 'true';
  if (/^https:\/\//.test(u || '') || (emu && /^http:\/\/127\.0\.0\.1[:/]/.test(u || ''))) return u;
  return '';
}
/** Pure decision (exported for tests). */
function decideWake({ newOrange, nowMs, wakes }) {
  const now = kd.kst(nowMs);
  if (!newOrange.length) return { action: 'none' };
  if (now.hour < WAKE.quietEndHour || now.hour >= WAKE.quietStartHour) return { action: 'quiet', keys: newOrange.map((s) => s.key) };
  const last = (wakes && wakes.lastWake) || {};
  const eligible = newOrange.filter((s) => !last[s.key] || nowMs - last[s.key] >= WAKE.cooldownDays * 864e5);
  if (!eligible.length) return { action: 'cooldown', keys: newOrange.map((s) => s.key) };
  const today = (wakes && wakes.days && wakes.days[now.date]) || 0;
  if (today >= WAKE.perDay) return { action: 'cap', keys: eligible.map((s) => s.key) };
  return { action: 'wake', eligible, date: now.date };
}
const jobIdFor = (nowMs) => { const n = kd.kst(nowMs); return `w-${n.date.replace(/-/g, '')}-${n.hhmm}-${crypto.randomBytes(2).toString('hex').slice(0, 2)}`; };

/**
 * newOrange: [{key, rule, why[]}]; aggregateId: the 'alert' aggregate for this job.
 * onFailure(job) is called (template report + rule-only Telegram) when the fire call fails.
 */
async function maybeWake(fid, { newOrange, aggregateId, nowMs = Date.now(), onFailure }) {
  const wref = fam(fid).collection('aiOps').doc('wakes');
  const ws = await wref.get(); const wakes = ws.exists ? ws.data() : {};
  const d = decideWake({ newOrange, nowMs, wakes });
  if (d.action !== 'wake') {
    if (d.action !== 'none') await wref.set({ deferred: FieldValue.arrayUnion(...d.keys.map((k) => `${kd.kst(nowMs).date}:${k}:${d.action}`)) }, { merge: true });
    log.info('wake_skip', { action: d.action, n: newOrange.length });
    return d;
  }
  const job = jobIdFor(nowMs);
  const rules = [...new Set(d.eligible.map((s) => s.rule))], why = [...new Set(d.eligible.flatMap((s) => s.why || []))];
  await db().collection('aiJobs').doc(job).set({ schema: 'bw.job.v1', job, rules, why, aggregateId, status: 'firing', createdTs: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.jobs) });
  const text = JSON.stringify({ v: 1, job, rules, why });
  let ok = false, status = 0;
  const url = fireUrl(secret('ROUTINE_REPORTER_URL')), token = secret('ROUTINE_REPORTER_TOKEN');
  if (url && token && token !== 'unset') {
    try {
      const r = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(WAKE.fireTimeoutMs),
        headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      status = r.status; ok = r.ok;           // the response body (session URL) is not read or stored
    } catch { ok = false; }
  }
  const lastWake = { ...(wakes.lastWake || {}) }; d.eligible.forEach((s) => { lastWake[s.key] = nowMs; });
  const days = { ...(wakes.days || {}) }; days[d.date] = (days[d.date] || 0) + 1;
  for (const k of Object.keys(days)) if (k < kd.addDays(d.date, -14)) delete days[k];
  const logEntry = { job, ts: nowMs, ok, status, rules };
  await wref.set({ lastWake, days, log: [...(wakes.log || []), logEntry].slice(-50), open: ok ? FieldValue.arrayUnion(job) : FieldValue.arrayRemove(job) }, { merge: true });
  await db().collection('aiJobs').doc(job).update({ status: ok ? 'fired' : 'failed', firedTs: FieldValue.serverTimestamp() });
  await db().collection('aiRate').doc('keyuse').set({ lastJobMs: nowMs }, { merge: true });
  log.info('wake', { ok, status, rules: rules.length });
  if (!ok && onFailure) await onFailure(job, d.eligible.length);
  return { action: 'wake', job, ok };
}

module.exports = { decideWake, maybeWake, jobIdFor };
