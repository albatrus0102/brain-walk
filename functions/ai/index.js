'use strict';
/**
 * AI question bank and admin reports — Cloud Functions v2, region asia-northeast3 (Firestore Seoul).
 *
 *   aiRead        HTTPS GET   routine reads: current aggregate | bank needs | wake job (+its aggregate)
 *   aiSubmit      HTTPS POST  routine writes one aiInbox doc (items | report)
 *   aiOnInbox     aiInbox/{id} created → validate items / report instantly
 *   aiOnItemLog   families/{fid}/itemLogs/{sid} created → bank exposures, quarantine rules, packs
 *   aiOnProgress  families/{fid}/progress/{pid} → course done → aggregate + signals → wake on new orange
 *   aiOnReview    families/{fid}/aiReview/{itemId} created (admin) → approve / retire / flag a bank item
 *   aiDaily       06:50 KST → weekly stats, signals, aggregate, measure/training packs, bank needs
 *   aiTick        every 10 min → queued Telegram, 08:30 template fallback, wake timeouts, stall alerts
 *   aiPurge       04:30 KST → retention backstop (TTL does inbox/aggregates/jobs/rejects)
 *
 * Secrets (Secret Manager, `firebase functions:secrets:set …`): ROUTINE_REPORTER_URL, ROUTINE_REPORTER_TOKEN,
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. The routine key lives only as a sha256 in aiConfig/main.routineKeyHash.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { SECRETS, getConfig } = require('./config.js');
const endpoints = require('./endpoints.js');
const { processInbox } = require('./inbox.js');
const { runFamily } = require('./pipeline.js');
const { afterCourse } = require('./course.js');
const { tick } = require('./tick.js');
const { purge } = require('./purge.js');
const bank = require('./bank.js');
const { sanitizeLog } = require('./core/series.js');
const { FieldValue } = require('./fb.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

const REGION = 'asia-northeast3';
const TG = [SECRETS.TELEGRAM_BOT_TOKEN, SECRETS.TELEGRAM_CHAT_ID];
const ALL = [...TG, SECRETS.ROUTINE_REPORTER_URL, SECRETS.ROUTINE_REPORTER_TOKEN];
const http = { region: REGION, invoker: 'public', cors: false, maxInstances: 2, concurrency: 20, memory: '256MiB', timeoutSeconds: 30 };

exports.aiRead = onRequest(http, endpoints.aiRead);
exports.aiSubmit = onRequest(http, endpoints.aiSubmit);

exports.aiOnInbox = onDocumentCreated({ document: 'aiInbox/{id}', region: REGION, retry: false, memory: '512MiB', timeoutSeconds: 300, secrets: TG }, async (event) => {
  if (!event.data) return;
  try { await processInbox(event.data.ref); } catch (e) { log.debugError(e); log.error('inbox_failed', { code: e && e.code ? String(e.code) : 'error' }); await event.data.ref.update({ status: 'error' }).catch(() => {}); }
});

exports.aiOnItemLog = onDocumentCreated({ document: 'families/{fid}/itemLogs/{sid}', region: REGION, retry: false }, async (event) => {
  const cfg = await getConfig();
  if (!event.data || event.params.fid !== cfg.familyId || cfg.enabled === false) return;
  const L = sanitizeLog(event.data.data(), event.params.sid);
  if (!L) { log.warn('itemlog_invalid', {}); return; }
  const r = await bank.recordExposures(event.params.fid, L);
  log.info('itemlog', { items: L.items.length, cells: r.touched ? r.touched.length : 0, quarantined: r.quarantined || 0 });
});

exports.aiOnProgress = onDocumentWritten({ document: 'families/{fid}/progress/{pid}', region: REGION, retry: false, timeoutSeconds: 300, memory: '512MiB', secrets: ALL }, async (event) => {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.status !== 'done' || (before && before.status === 'done') || after.kind !== 'course') return;
  const cfg = await getConfig();
  if (event.params.fid !== cfg.familyId || cfg.enabled === false) return;
  try { await afterCourse(event.params.fid); } catch (e) { log.error('after_course_failed', { code: e && e.code ? String(e.code) : 'error' }); }
});

exports.aiOnReview = onDocumentCreated({ document: 'families/{fid}/aiReview/{itemId}', region: REGION, retry: false }, async (event) => {
  const cfg = await getConfig();
  if (!event.data || event.params.fid !== cfg.familyId) return;
  const d = event.data.data();
  const to = await bank.applyReview(event.params.itemId, d.decision);
  await event.data.ref.update({ result: to, processedTs: FieldValue.serverTimestamp() });
  await bank.rebuildPacks(event.params.fid);
  await bank.writeBankStatus(event.params.fid, await bank.bankCounts());
  log.info('review', { decision: d.decision, result: to });
});

exports.aiDaily = onSchedule({ schedule: '50 6 * * *', timeZone: 'Asia/Seoul', region: REGION, retryCount: 0, timeoutSeconds: 540, memory: '512MiB', secrets: TG }, async () => {
  const cfg = await getConfig(true);
  if (!cfg.familyId || cfg.enabled === false) return;
  const now = kd.kst();
  try { await runFamily(cfg.familyId, { mode: now.weekday === 0 ? 'weekly' : 'daily', reason: 'daily', daily: true }); }
  catch (e) { log.error('daily_failed', { code: e && e.code ? String(e.code) : 'error' }); }
});

exports.aiTick = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Asia/Seoul', region: REGION, retryCount: 0, timeoutSeconds: 300, secrets: TG }, async () => {
  try { await tick(); } catch (e) { log.error('tick_failed', { code: e && e.code ? String(e.code) : 'error' }); }
});

exports.aiPurge = onSchedule({ schedule: '30 4 * * *', timeZone: 'Asia/Seoul', region: REGION, retryCount: 1, timeoutSeconds: 540 }, async () => {
  await purge();
});

