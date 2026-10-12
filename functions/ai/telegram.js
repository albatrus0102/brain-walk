'use strict';
/**
 * Telegram notifier (DESIGN-AI G.3). Messages carry NO health content: a fixed kind sentence, an optional
 * count of orange signals and the app link. Bot token and chat id come from Secret Manager.
 * In the Functions emulator only, TELEGRAM_API_BASE may point at a local mock (tests).
 */
const { secret, getConfig, appUrlParam } = require('./config.js');
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
/** Returns true when Telegram accepted the message. Never throws, never logs the token or text. */
async function sendTelegram(kind, orangeCount = 0) {
  const token = secret('TELEGRAM_BOT_TOKEN'), chat = secret('TELEGRAM_CHAT_ID');
  if (!token || !chat) { log.warn('telegram_skip', { kind, reason: 'no_secret' }); return false; }
  const text = messageText(kind, orangeCount, await appUrl());
  try {
    const r = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    log.info('telegram', { kind, status: r.status });
    return r.ok;
  } catch (e) {
    log.warn('telegram_failed', { kind, code: e && e.name ? e.name : 'error' });
    return false;
  }
}
module.exports = { sendTelegram, messageText, KIND };
