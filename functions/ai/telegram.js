'use strict';
/**
 * Telegram notifier (DESIGN-AI G.3) — the ONE gate every server Telegram goes through.
 * Messages carry NO health content: a fixed kind sentence, an optional count of orange signals and the app link.
 * Bot token and chat id come from Secret Manager. In the Functions emulator only, TELEGRAM_API_BASE may point at a
 * local mock (tests).
 *
 * Owner rule: nothing is sent between 02:00 and 08:00 KST. Messages produced in that window (and morning/weekly
 * report announcements made before 08:00) are queued in the server-only `tgOutbox` collection and delivered as ONE
 * combined digest at 08:00 KST (aiTgFlush; aiTick re-flushes later as a backstop), one line per kind (repeats of the
 * same kind are merged; the orange count is the largest one queued).
 */
const { secret, getConfig, appUrlParam } = require('./config.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

const KIND = {
  morning: '아침 리포트가 올라왔어요',
  morning_template: '아침 리포트(간단판)가 올라왔어요 · AI 설명은 오늘 빠졌어요',
  weekly: '주간 장기 리포트가 올라왔어요',
  weekly_template: '주간 리포트(간단판)가 올라왔어요 · AI 설명은 오늘 빠졌어요',
  alert: '살펴볼 변화 설명이 올라왔어요',
  rule_only: '주의 신호가 있어요. 앱의 관리자 화면에서 확인해 주세요',
  gen_stalled: '문제 만들기가 2일째 멈췄어요(앱은 정상이에요)',
  key_offschedule: '루틴 키가 예정에 없던 시각에 쓰였어요. 루틴 상태를 확인해 주세요',
  test: '알림 시험이에요',
};
/** The exact text that will be sent (exported for tests: no digits other than the count, no names). */
function messageText(kind, orangeCount, appUrl) {
  const k = KIND[kind] || KIND.test;
  const n = Number.isInteger(orangeCount) && orangeCount > 0 ? ` · 주의 신호 ${orangeCount}건` : '';
  return `🧠 오늘의 두뇌 산책\n${k}${n}\n${appUrl}`;
}
async function appUrl() {
  let cfg = {}; try { cfg = await getConfig(); } catch { /* default */ }
  if (typeof cfg.appUrl === 'string' && /^https:\/\//.test(cfg.appUrl)) return cfg.appUrl;
  try { return appUrlParam().value(); } catch { return ''; }
}
function apiBase() {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.TELEGRAM_API_BASE) return process.env.TELEGRAM_API_BASE.replace(/\/$/, '');
  return 'https://api.telegram.org';
}
const HOLD_FROM = 2, HOLD_TO = 8;          // KST hours: [02:00, 08:00) nothing is sent
const inHold = (nowMs) => { const h = kd.kst(nowMs).hour; return h >= HOLD_FROM && h < HOLD_TO; };
const KIND_ORDER = Object.keys(KIND);

/** Digest text for queued entries [{kind, n}] (exported for tests). One line per kind, max count per kind. */
function digestText(entries, appUrl) {
  const by = new Map();
  for (const e of entries) if (KIND[e.kind]) by.set(e.kind, Math.max(by.get(e.kind) || 0, Number(e.n) || 0));
  const kinds = [...by.keys()].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  if (kinds.length === 1) return messageText(kinds[0], by.get(kinds[0]), appUrl);
  const lines = kinds.map((k) => `· ${KIND[k]}${by.get(k) > 0 ? ` · 주의 신호 ${by.get(k)}건` : ''}`);
  return `🧠 오늘의 두뇌 산책\n${lines.join('\n')}\n${appUrl}`;
}

/** Raw send. Returns true when Telegram accepted. Never throws, never logs the token or the text. */
async function deliver(text, kindForLog) {
  const token = secret('TELEGRAM_BOT_TOKEN'), chat = secret('TELEGRAM_CHAT_ID');
  if (!token || !chat || token === 'unset' || chat === 'unset') { log.warn('telegram_skip', { kind: kindForLog, reason: 'no_secret' }); return false; }
  try {
    const r = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    log.info('telegram', { kind: kindForLog, status: r.status });
    return r.ok;
  } catch (e) {
    log.warn('telegram_failed', { kind: kindForLog, code: e && e.name ? e.name : 'error' });
    return false;
  }
}

/** Put a message in tgOutbox (delivered by flushOutbox). */
async function enqueue(kind, orangeCount, nowMs) {
  const { db, FieldValue, expireIn } = require('./fb.js');
  await db().collection('tgOutbox').add({ kind, n: Number(orangeCount) || 0, date: kd.kst(nowMs).date, status: 'queued', createdTs: FieldValue.serverTimestamp(), expireAt: expireIn(7, nowMs) });
  log.info('telegram_queued', { kind });
  return 'queued';
}

/**
 * Every server Telegram goes through here. Returns 'sent' | 'failed' | 'queued'.
 * opts.holdUntil8: also queue before 08:00 outside the 02–08 window (morning/weekly report announcements).
 */
async function sendTelegram(kind, orangeCount = 0, nowMs = Date.now(), opts = {}) {
  if (inHold(nowMs) || (opts.holdUntil8 && kd.kst(nowMs).hour < HOLD_TO)) return enqueue(kind, orangeCount, nowMs);
  return (await deliver(messageText(kind, orangeCount, await appUrl()), kind)) ? 'sent' : 'failed';
}

/** Send everything queued as ONE digest (08:00 schedule; aiTick backstop). Does nothing inside the hold window. */
async function flushOutbox(nowMs = Date.now()) {
  if (inHold(nowMs)) return { held: true };
  const { db } = require('./fb.js');
  const s = await db().collection('tgOutbox').where('status', '==', 'queued').limit(200).get();
  if (s.empty) return { sent: 0 };
  const entries = s.docs.map((d) => ({ kind: d.get('kind'), n: d.get('n') }));
  const ok = await deliver(digestText(entries, await appUrl()), 'digest');
  if (ok) { const b = db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  log.info('telegram_digest', { ok, queued: s.size });
  return { sent: ok ? 1 : 0, merged: s.size };
}

module.exports = { sendTelegram, flushOutbox, digestText, messageText, inHold, KIND };
