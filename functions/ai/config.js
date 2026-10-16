'use strict';
/**
 * AI settings: aiConfig/main (server-only doc) cached for 60 s, and the Secret Manager secrets.
 *
 * aiConfig/main = {
 *   familyId:        target family (one family per project, set by tools/set-routine-key.mjs --family)
 *   subjects:        { [memberId]: 'A' | 'B' | … }  pseudonym letter per trainee (사용자 A–Z). Assigned by the server
 *                    in a transaction the first time a trainee is eligible (in state/trainees + consent); never
 *                    reused, never removed (a removed and re-added trainee keeps the letter). Letter → member id is
 *                    resolved only on the server; the routine sees letters only.
 *   maxTrainees:     4
 *   enabled:         true | false   (false: endpoints 503, no aggregation, no wakes)
 *   routineKeyHash:  sha256 hex of the routine key (the raw key is never stored)
 *   appUrl?:         overrides APP_URL in Telegram links
 * }
 * Changing or deleting routineKeyHash cuts routine access within 60 s, with no redeploy.
 */
const { defineSecret, defineString } = require('firebase-functions/params');
const fb = require('./fb.js');

const SECRETS = {
  ROUTINE_REPORTER_URL: defineSecret('ROUTINE_REPORTER_URL'),
  ROUTINE_REPORTER_TOKEN: defineSecret('ROUTINE_REPORTER_TOKEN'),
  TELEGRAM_BOT_TOKEN: defineSecret('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID: defineSecret('TELEGRAM_CHAT_ID'),
};
let APP_URL = null;
function appUrlParam() { if (!APP_URL) APP_URL = defineString('APP_URL', { description: 'Public app URL with trailing slash, e.g. https://you.github.io/brain-walk/' }); return APP_URL; }
/** Secret value or '' (never throws, never logs). */
function secret(name) { try { return SECRETS[name].value() || ''; } catch { return ''; } }

const TTL_SEC = 60;
// Emulator only: tests may shorten the cache (production always uses 60 s).
const ttlMs = () => (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.AI_CONFIG_TTL_SEC ? Number(process.env.AI_CONFIG_TTL_SEC) : TTL_SEC) * 1000;
let cached = null, cachedAt = 0;
async function getConfig(force = false) {
  const now = Date.now();
  if (!force && cached && now - cachedAt < ttlMs()) return cached;
  const s = await fb.db().collection('aiConfig').doc('main').get();
  cached = s.exists ? s.data() : {};
  cachedAt = now;
  return cached;
}
/** tests */
const _resetConfigCache = () => { cached = null; cachedAt = 0; };

module.exports = {
  SECRETS, secret, getConfig, _resetConfigCache, appUrlParam,
  MAX_TRAINEES: 4,
  SPEC_VER: 'ref-v1',
  LIMITS: { bodyBytes: 512 * 1024, payloadChars: 500000, submitsPerHour: 20, ipPerHour: 120, badAuthPerIpHour: 10, itemsPerDay: 400, itemsPerSubmit: 200, maxItemsPerRun: 90 },
  /** Generator demand per run scales with the number of active trainees (shared bank). */
  maxItemsFor: (n) => Math.min(150, 60 + 30 * Math.max(1, n || 1)),
  RETENTION_DAYS: { itemLogs: 730, reports: 1826, stats: 1826, signals: 1826, notes: 1826, inbox: 30, rejects: 90, aggregates: 90, jobs: 90, ops: 365, retiredBank: 365 },
  WAKE: { perDay: 2, perDayFamily: 4, cooldownDays: 7, quietStartHour: 20, quietEndHour: 8, reportTimeoutMin: 90, fireTimeoutMs: 15000 },
  MORNING: { telegramAfterHour: 8, fallbackAfter: { h: 8, m: 30 } },
};
