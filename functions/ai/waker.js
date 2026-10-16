'use strict';
/**
 * Immediate wake of the reporter routine on a NEW orange signal (DESIGN-AI §5.2–§5.4, G.2).
 *  - only off→on (or yellow→orange); quiet hours 20:00–08:00 → left for the 07:30 morning report
 *  - per trainee (trainees/{mid}/aiOps/wakes): 7-day cooldown per signal key, at most 2 wakes per KST day;
 *    per family (aiOps/wakes.days): at most 4 wakes per KST day (WAKE.perDayFamily). The slot is claimed in a
 *    transaction before the fire call, so two trainees finishing at once cannot both pass the ceiling.
 *  - all newly-on orange signals are bundled into one wake; NO retry (the fire API has no idempotency key)
 *  - failure → template alert report + rule-only Telegram (no health content)
 * The fire text holds rule and reason codes only; the routine extracts the job id and reads aiJobs itself
 * (aiJobs/{job}.s = the trainee's letter; the server resolves the member from it).
 */
const crypto = require('node:crypto');
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const { tref } = require('./family.js');
const { secret, WAKE, RETENTION_DAYS } = require('./config.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

/** The fire URL, or '' when not configured (placeholder secret such as "unset"). Plain http only in the emulator (local mock). */
function fireUrl(u) {
  const emu = process.env.FUNCTIONS_EMULATOR === 'true';
  if (/^https:\/\//.test(u || '') || (emu && /^http:\/\/127\.0\.0\.1[:/]/.test(u || ''))) return u;
  return '';
}
/** Pure decision (exported for tests). wakes = the trainee's aiOps/wakes, famWakes = the family's aiOps/wakes. */
function decideWake({ newOrange, nowMs, wakes, famWakes }) {
  const now = kd.kst(nowMs);
  if (!newOrange.length) return { action: 'none' };
  if (now.hour < WAKE.quietEndHour || now.hour >= WAKE.quietStartHour) return { action: 'quiet', keys: newOrange.map((s) => s.key) };
  const last = (wakes && wakes.lastWake) || {};
  const eligible = newOrange.filter((s) => !last[s.key] || nowMs - last[s.key] >= WAKE.cooldownDays * 864e5);
  if (!eligible.length) return { action: 'cooldown', keys: newOrange.map((s) => s.key) };
  const today = (wakes && wakes.days && wakes.days[now.date]) || 0;
  if (today >= WAKE.perDay) return { action: 'cap', keys: eligible.map((s) => s.key) };
  const famToday = (famWakes && famWakes.days && famWakes.days[now.date]) || 0;
  if (famToday >= WAKE.perDayFamily) return { action: 'family_cap', keys: eligible.map((s) => s.key) };
  return { action: 'wake', eligible, date: now.date };
}
const jobIdFor = (nowMs) => { const n = kd.kst(nowMs); return `w-${n.date.replace(/-/g, '')}-${n.hhmm}-${crypto.randomBytes(2).toString('hex').slice(0, 2)}`; };

const pruneDays = (days, date) => { const o = { ...(days || {}) }; o[date] = (o[date] || 0) + 1; for (const k of Object.keys(o)) if (k < kd.addDays(date, -14)) delete o[k]; return o; };

/**
 * Trainee `mid` (letter L). newOrange: [{key, rule, why[]}]; aggregateId: the 'alert' aggregate for this job.
 * onFailure(job) is called (template report + rule-only Telegram) when the fire call fails.
 */
async function maybeWake(fid, mid, { L, newOrange, aggregateId, nowMs = Date.now(), onFailure }) {
  const wref = tref(fid, mid).collection('aiOps').doc('wakes');
  const fref = fam(fid).collection('aiOps').doc('wakes');
  // decide and claim the slot atomically (per-trainee cap + family ceiling)
  const d = await db().runTransaction(async (tx) => {
    const [ws, fs] = await Promise.all([tx.get(wref), tx.get(fref)]);
    const wakes = ws.exists ? ws.data() : {}, famWakes = fs.exists ? fs.data() : {};
    const dec = decideWake({ newOrange, nowMs, wakes, famWakes });
    if (dec.action !== 'wake') return dec;
    const lastWake = { ...(wakes.lastWake || {}) }; dec.eligible.forEach((s) => { lastWake[s.key] = nowMs; });
    tx.set(wref, { lastWake, days: pruneDays(wakes.days, dec.date) }, { merge: true });
    tx.set(fref, { days: pruneDays(famWakes.days, dec.date) }, { merge: true });
    return dec;
  });
  if (d.action !== 'wake') {
    if (d.action !== 'none') await wref.set({ deferred: FieldValue.arrayUnion(...d.keys.map((k) => `${kd.kst(nowMs).date}:${k}:${d.action}`)) }, { merge: true });
    log.info('wake_skip', { s: L, action: d.action, n: newOrange.length });
    return d;
  }
  const job = jobIdFor(nowMs);
  const rules = [...new Set(d.eligible.map((s) => s.rule))], why = [...new Set(d.eligible.flatMap((s) => s.why || []))];
  await db().collection('aiJobs').doc(job).set({ schema: 'bw.job.v1', job, s: L, rules, why, aggregateId, status: 'firing', createdTs: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.jobs) });
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
  const ws = await wref.get();
  const logEntry = { job, ts: nowMs, ok, status, rules };
  await wref.set({ log: [...((ws.exists && ws.get('log')) || []), logEntry].slice(-50), open: ok ? FieldValue.arrayUnion(job) : FieldValue.arrayRemove(job) }, { merge: true });
  await db().collection('aiJobs').doc(job).update({ status: ok ? 'fired' : 'failed', firedTs: FieldValue.serverTimestamp() });
  await db().collection('aiRate').doc('keyuse').set({ lastJobMs: nowMs }, { merge: true });
  log.info('wake', { s: L, ok, status, rules: rules.length });
  if (!ok && onFailure) await onFailure(job, d.eligible.length);
  return { action: 'wake', job, ok };
}

module.exports = { decideWake, maybeWake, jobIdFor };
