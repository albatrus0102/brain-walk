// 체험 모드: 일상생활 체크(가족), 잠 기록(생활 체크) → 가족 화면에서 확인
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); await ctx0.addInitScript(() => { window.__DEBUG = true; try { localStorage.setItem('bw.aiDemo', 'false'); } catch (e) {} });
const page = await ctx0.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const vis = sel => page.locator(sel).first().isVisible().catch(() => false);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
await page.goto(BASE); await page.waitForSelector('#btn-demo'); await page.click('#btn-demo');
await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); if (await vis('.dialog')) await page.click('#dlg-btn-1');
// 1) 생활 체크 + 잠 기록 (훈련하는 분)
await page.evaluate(() => window.__go('checkin')); await page.waitForSelector('#ci-h');
await page.click('#ci-mood-4'); await page.click('#ci-sleep-7'); await page.click('#ci-exercise-yes'); await page.click('#ci-social-no'); await page.click('#ci-meals-yes');
await page.click('#sl-summary'); await page.fill('#sl-bed', '22:30'); await page.fill('#sl-wake', '06:40'); await page.click('#ci-wk-2');
must((await page.inputValue('#sl-bed')) === '22:30', '잠든 시각 유지(다시 그려도)');
await page.click('#btn-ci-save'); await page.waitForSelector('#btn-main');
must(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bw.localdb'))).some(k => k.startsWith('sleeplogs/'))), '수면 기록 저장');
// 2) 가족으로 전환 → 일상생활 체크, 잠 기록
await page.evaluate(() => { localStorage.setItem('bw.role', JSON.stringify('family')); }); await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-family'); await page.waitForSelector('#tab-assess'); await page.click('#tab-assess'); await page.waitForSelector('#hub-h');
await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-family'); await page.waitForSelector('#tab-assess'); await page.click('#tab-assess'); await page.click('#hub-iadl'); await page.waitForSelector('#svi-h');
await page.click('#rel-1'); await page.click('#btn-sv-start'); await page.waitForSelector('#q-text');
must((await page.innerText('#q-stem')).includes('요즘'), '일상생활 체크 안내문');
for (let i = 0; i < 8; i++) await page.click('#ans-' + (i % 4)); await page.waitForSelector('#svd-h');
must(/^12/.test((await page.innerText('#svd-score')).trim()), '일상생활 체크 점수 12 (0+1+2+3)×2');
await page.click('#btn-svd-home'); await page.click('#nav-family'); await page.waitForSelector('#sleep-report');
// 리포트 아래쪽 구역은 접힌 카드: 펼쳐서 확인
must(!(await page.locator('#sleep-report').evaluate(d => d.open)), '잠 기록 카드는 처음에 접혀 있음');
await page.click('#xp-sleep-report'); await page.click('#xp-survey-report');
must((await page.innerText('#sleep-report')).includes('22:30 → 06:40'), '가족 기록: 잠 기록');
must((await page.innerText('#survey-report')).includes('일상생활 체크'), '가족 기록: 일상생활 체크 결과');
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
