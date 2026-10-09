// 체험 모드: 설문(KDSQ-C)·PHQ-9 9번 안내 창·가족 결과 구역을 눌러서 확인
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const vis = sel => page.locator(sel).first().isVisible().catch(() => false);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
await page.goto(BASE); await page.waitForSelector('#btn-demo'); await page.click('#btn-demo');
await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); if (await vis('.dialog')) await page.click('#dlg-btn-1');
// 가족 화면으로 바꾸기
await page.click('#btn-settings'); await page.click('#btn-role-switch'); await page.click('#dlg-btn-1');
await page.click('#btn-back').catch(() => {});
await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-assess'); await page.waitForSelector('#hub-h'); must(true, '가족 점검 탭(목록)');
await page.click('#hub-surveys'); await page.waitForSelector('#sv-h');
must(await vis('#sv-open-iqcode') && await vis('#sv-open-phq9'), '설문 목록 5종');
// KDSQ-C 가족 응답
await page.click('#sv-open-kdsq'); await page.waitForSelector('#svi-h');
must(await page.locator('#btn-sv-start').isDisabled(), '관계 선택 전에는 시작 불가');
await page.click('#rel-0'); await page.click('#btn-sv-start'); await page.waitForSelector('#q-text');
must((await page.innerText('#q-text')).includes('오늘이 몇 월이고, 무슨 요일인지를 모른다.'), 'KDSQ-C 1번 원문');
for (let i = 0; i < 15; i++) { await page.click('#ans-' + (i % 3 === 0 ? 2 : 0)); await page.waitForTimeout(40); }
await page.waitForSelector('#svd-h'); must((await page.innerText('#svd-h')).includes('저장했어요'), 'KDSQ-C 저장');
const sc = await page.innerText('#svd-score'); must(/^10/.test(sc), 'KDSQ-C 점수 합산 ' + sc.replace(/\s+/g, ''));
must((await page.innerText('#svd-band')).includes('참고 기준'), '참고 기준 문구(중립)');
must((await page.innerText('#screen')).includes('참고용이며 진단이 아닙니다'), '진단 아님 문구');
// PHQ-9: 9번 > 0 이면 즉시 안내
await page.click('#btn-svd-list'); await page.click('#sv-open-phq9'); await page.waitForSelector('#svi-h');
await page.click('#btn-sv-start'); await page.waitForSelector('#q-text');
for (let i = 0; i < 8; i++) { await page.click('#ans-0'); await page.waitForTimeout(30); }
must((await page.innerText('#q-text')).startsWith('9.'), 'PHQ-9 9번 화면');
await page.click('#ans-1'); await page.waitForSelector('#crisis-box');
const crisis = await page.innerText('#crisis-box'); must(crisis.includes('109') && crisis.includes('1577-0199'), '109 / 1577-0199 안내 창');
await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/phq-crisis.png' });
await page.click('#dlg-btn-0'); await page.waitForSelector('#q-text');
must((await page.innerText('#q-text')).includes('만일 당신이 위의 문제'), 'PHQ-9 10번(점수 제외)');
await page.click('#ans-0'); await page.waitForSelector('#svd-h');
must((await page.innerText('#svd-h')).includes('수고하셨어요'), '본인 답은 격려 문구만 (점수 숨김)');
must(!(await page.innerText('#screen')).includes('/ 27'), '본인 답 화면에 점수 없음');
// 가족 기록에서 결과 구역
await page.click('#btn-svd-home'); await page.click('#nav-family'); await page.waitForSelector('#survey-report');
{ const f = await page.locator('#flag-phq9').innerText().catch(() => ''); must(f.includes('9번') && f.includes('109') && f.includes('1577-0199'), '가족 기록 맨 위: PHQ-9 9번 안내'); }
const rep = await page.innerText('#survey-report'); must(rep.includes('KDSQ-C') && rep.includes('10') && rep.includes('PHQ-9'), '가족 기록의 설문 결과 구역');
await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/survey-report.png', fullPage: false });
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
