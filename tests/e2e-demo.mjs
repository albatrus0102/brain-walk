// 체험 모드 화면 흐름 시험 (Playwright + 로컬 서버).  사용법은 tests/README.md
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const vis = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const must = async (cond, msg) => { if (!cond) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };

await page.goto(BASE);
await page.waitForSelector('#setup-h');
await must((await page.innerText('#setup-h')).includes('관리자 설정이 필요해요'), '설정 안내 화면');
await must((await page.innerText('#screen')).includes('README'), 'README 안내 문구');
await page.click('#btn-demo');
await page.waitForSelector('#btn-start-course, .dialog');
if (await vis('.dialog')) { out('dialog:', await page.innerText('#dlg-title')); await page.click('#dlg-btn-0'); }
if (await vis('.dialog')) { out('dialog:', await page.innerText('#dlg-title')); await page.click('#dlg-btn-1'); }
await must(await vis('#btn-start-course'), '홈 훈련 시작 버튼');

async function playRound() {
  if (await page.locator('.choice:not([disabled])').count()) { await page.locator('.choice:not([disabled])').first().click(); return true; }
  if (await vis('#btn-memorized')) { await page.click('#btn-memorized'); const t = await page.locator('#cnt').innerText(); const n = +t.match(/\/ (\d+)/)[1]; const chips = page.locator('#pool .chip'); for (let i = 0; i < n; i++) await chips.nth(i).click(); await page.click('#btn-check'); return true; }
  return false;
}
await page.click('#btn-start-course');
await page.waitForSelector('#g-title');
let steps = 0;
while (steps++ < 80 && !(await vis('#res-score'))) {
  if (await vis('#btn-next')) { await page.click('#btn-next'); continue; }
  const did = await playRound();
  if (!did) { // 알 수 없는 게임: 문제 영역의 아무 버튼이나 눌러 보고 그만하기
    const b = page.locator('#box button:not([disabled])'); if (await b.count()) await b.first().click({ timeout: 1500 }).catch(() => {}); else break;
  }
  await page.waitForTimeout(30);
}
await must(await vis('#res-score') || await vis('#btn-next'), '게임 한 판 진행/결과');
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/game.png' : '/tmp/game.png' });
await page.click('#btn-home').catch(() => {});
await page.evaluate(() => { location.hash = ''; });
await page.goto(BASE); await page.waitForSelector('#btn-start-course, .dialog');
if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-family'); await page.waitForSelector('#fam-h');
await must(true, '가족 기록 화면');
await page.click('#nav-pick').catch(() => {});
await page.click('#nav-home').catch(() => {});
await page.click('#btn-settings'); await page.waitForSelector('#set-main-h');
await must(await vis('#btn-delete-local'), '설정: 체험 모드 안내/삭제 버튼');
await must(await vis('#btn-ics'), '설정: ICS 버튼');
const dl = page.waitForEvent('download');
await page.click('#btn-ics'); const d = await dl; await must(d.suggestedFilename().endsWith('.ics'), 'ICS 실제 다운로드 ' + d.suggestedFilename());
await page.click('#btn-delete-local'); await must(await vis('#dlg-title'), '삭제 확인 대화상자(M3)'); await page.click('#dlg-btn-0');
await page.click('#nav-chat').catch(() => {});
await page.goBack().catch(() => {});
out('ERRORS:', JSON.stringify(errors));
await browser.close();
process.exit(errors.length ? 1 : 0);
