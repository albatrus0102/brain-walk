// 화면 시험 공용 도우미 (Playwright 는 /opt/node-tools, 크롬은 /opt/pw-browsers/chromium).  사용법은 tests/README.md
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
export const { chromium } = require('playwright');
export const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
export const SHOTS = process.env.SHOT_DIR || '/tmp';
export const errors = [];
export const out = (...a) => console.log(...a);
export const must = (cond, msg) => { if (!cond) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
export const launch = () => chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });

/* 새 화면(컨텍스트+페이지). seed: { 키: 값 } 을 localStorage 에 먼저 넣어요 (JSON). dark: 다크 화면. 콘솔 오류는 모두 errors 에 모아요. */
export async function newPage(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, colorScheme: o.dark ? 'dark' : 'light', acceptDownloads: true });
  await ctx.addInitScript(s => {
    window.__DEBUG = true;
    try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); Object.keys(s).forEach(k => localStorage.setItem(k, JSON.stringify(s[k]))); } } catch (e) {}
  }, Object.assign({ 'bw.seenDisc': true, 'bw.offered': true, 'bw.alarm': { time: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } }, o.seed || {}));
  const page = await ctx.newPage();
  const tag = o.tag || 'page';
  page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  return { ctx, page };
}
export const vis = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
export const noHScroll = async (page, msg) => { const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })); must(r.sw <= r.cw + 1 && r.bw <= r.cw + 1, (msg || '') + ' 가로 스크롤 없음 (' + r.sw + '/' + r.cw + ')'); };
/* 체험 모드로 시작 (설정 안내 화면의 버튼) */
export async function startDemo(page) { await page.goto(BASE); await page.waitForSelector('#btn-demo'); await page.click('#btn-demo'); await page.waitForSelector('#appbar-title'); }
/* 지금 게임을 빨리 끝내요: 모든 문제를 맞힌 것으로 처리 (게임 안의 실제 플레이는 e2e-demo 등이 확인해요) */
export async function finishGame(page, correct = true) {
  await page.waitForSelector('#g-title', { timeout: 5000 });
  for (let i = 0; i < 12; i++) {
    const rounds = await page.evaluate(() => window.__S.sess ? window.__S.sess.rounds : 0);
    await page.evaluate(ok => { const c = window.__S.ctx; if (c && !c.finished) c.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '좋아요' : '괜찮아요' }); }, correct);
    await page.waitForSelector('#btn-next:not([hidden])', { timeout: 3000 });
    const label = await page.innerText('#btn-next');
    await page.click('#btn-next');
    if (!/다음 문제/.test(label)) break;
    void rounds;
    await page.waitForSelector('#g-title', { timeout: 3000 }).catch(() => {});
  }
}
export const done = async (browser) => { out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0); };
