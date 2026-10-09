// 체험 모드(가족 화면): 치매안심센터 카드, 병원·센터 검사 기록 폼, 가족 기록의 검사 구역, 채팅 공유 확인창
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const vis = sel => page.locator(sel).first().isVisible().catch(() => false);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
await page.goto(BASE); await page.waitForSelector('#btn-demo'); await page.click('#btn-demo');
await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); if (await vis('.dialog')) await page.click('#dlg-btn-1');
await page.evaluate(() => { localStorage.setItem('bw.role', JSON.stringify('family')); }); await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-assess'); await page.waitForSelector('#center-card');
must((await page.getAttribute('#btn-center-find', 'href')) === 'https://www.nid.or.kr', '센터 찾기 링크(중앙치매센터)');
must((await page.innerText('#center-card')).includes('1899-9988') && (await page.innerText('#center-card')).includes('만 60세 이상'), '센터 카드: 60세 이상 무료 CIST, 1899-9988');
await page.screenshot({ path: SHOTS + '/center-card.png', fullPage: true });
await page.click('#btn-center-done'); await page.waitForSelector('#clf-h');
must((await page.inputValue('#cl-max')) === '30', 'CIST 만점 30 미리 채움');
await page.selectOption('#cl-test', 'cdr'); must((await page.inputValue('#cl-max')) === '3', 'CDR 만점 3 미리 채움');
await page.selectOption('#cl-test', 'cist');
await page.fill('#cl-score', '31'); await page.click('#btn-cl-save'); must(await vis('#clf-h'), '점수가 만점보다 크면 저장 안 됨');
await page.fill('#cl-score', '25');
must(!(await page.locator('#cl-place').isVisible()), '기관·결과·메모는 "더 입력하기" 안에 숨김');
await page.click('#cl-more-sum'); await page.fill('#cl-place', '○○구 치매안심센터'); await page.click('#cl-res-0'); await page.fill('#cl-memo', '2년 뒤 다시 받기');
await page.click('#btn-cl-save'); await page.waitForSelector('#clin-h');
const rep = await page.innerText('#clinical-report');
must(rep.includes('25 / 30점') && rep.includes('정상') && rep.includes('○○구 치매안심센터'), '기록 저장/표시');
const d2 = new Date(); d2.setFullYear(d2.getFullYear() + 2); const due = d2.toISOString().slice(0, 10);
must(rep.includes('CIST 다음 검사') && rep.includes(due), '2년 뒤 재검 알림 ' + due);
// 두 번째 기록 (과거 날짜) → 추세
await page.click('#btn-clinical-add'); await page.waitForSelector('#clf-h'); await page.fill('#cl-date', '2024-05-01'); await page.fill('#cl-score', '22'); await page.click('#btn-cl-save'); await page.waitForSelector('#clin-h');
must((await page.innerText('#clinical-report')).includes('높아요'), '지난번과 비교(중립 문구)');
// 채팅 공유 확인창
const id = await page.evaluate(() => document.querySelector('[id^="clshare-"]').id);
await page.click('#' + id); await page.waitForSelector('#dlg-title');
must((await page.innerText('#dlg-title')).includes('도 대화방을 보세요. 공유할까요?'), '채팅 공유 전 확인창: ' + (await page.innerText('#dlg-title')));
await page.click('#dlg-btn-0');
// 가족 기록 화면
await page.click('#btn-back'); await page.waitForSelector('#nav-family'); await page.click('#nav-family'); await page.waitForSelector('#clinical-report');
await page.locator('#clinical-report').scrollIntoViewIfNeeded(); await page.screenshot({ path: SHOTS + '/clinical-report.png' });
must(!(await vis('#clshare-x')), '가족 기록에는 삭제/공유 버튼 없음');
// 훈련하는 분으로 보면 숨김
await page.evaluate(() => { localStorage.setItem('bw.role', JSON.stringify('trainee')); }); await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-family').catch(() => {}); 
must(!(await page.locator('#clinical-report').count()) && !(await page.locator('#survey-report').count()), '훈련하는 분 화면에는 검사·설문 결과가 없음');
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
