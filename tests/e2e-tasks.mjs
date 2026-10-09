// 체험 모드: 월간 점검 2부분(자체 과제 8개)을 직접 눌러 끝까지 진행. 시간은 20배 빠르게(타이머만) 돌려요.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  window.__DEBUG = true;
  const st = window.setTimeout, si = window.setInterval; const f = d => (d >= 400 ? d / 20 : d);
  window.setTimeout = (fn, d, ...a) => st(fn, f(d), ...a); window.setInterval = (fn, d, ...a) => si(fn, f(d), ...a);
});
const vis = sel => page.locator(sel).first().isVisible().catch(() => false);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
await page.goto(BASE); await page.waitForSelector('#btn-demo'); await page.click('#btn-demo');
await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); if (await vis('.dialog')) await page.click('#dlg-btn-1');
// 1부분을 마친 상태로 만들고: 쉬는 화면 → "내일 이어서 하기" → 점검 화면의 이어서 하기 카드
await page.evaluate(() => { const S = window.__S; S.assess = { idx: 5, scores: { memory: 70, attention: 60, executive: 55, orientation: 80, speed: 65 }, tasks: {}, t0: Date.now(), memo: null }; window.__go('assessBreak'); });
await page.waitForSelector('#ab-h'); must(await vis('#btn-ab-continue') && await vis('#btn-ab-later') && await vis('#btn-ab-end'), '쉬는 화면: 이어서/내일/마치기');
await page.click('#btn-ab-later'); await page.waitForSelector('#btn-start-course');
must(await page.evaluate(() => !!JSON.parse(localStorage.getItem('bw.assessDraft')).idx), '초안 저장(내일 이어서)');
await page.click('#nav-assess'); await page.waitForSelector('#assess-resume'); await page.click('#btn-assess-resume'); await page.waitForSelector('#ast-h');
must((await page.innerText('#ast-h')).includes('낱말'), '이어서 하기 → 2부분 첫 과제');
const next = async () => { await page.waitForSelector('#btn-next:not([hidden])', { timeout: 15000 }); await page.click('#btn-next'); };
const begin = async name => { await page.waitForSelector('#btn-assess-begin'); out('--', await page.innerText('#ast-h')); await page.click('#btn-assess-begin'); await page.waitForSelector('#g-title'); must((await page.innerText('#g-title')).includes(name), '과제 화면: ' + name); };
const memoWords = () => page.evaluate(() => window.__S.assess.memo.words);
// 낱말 기억 (바로)
await begin('낱말 기억하기'); await page.click('#btn-words-start'); await page.waitForSelector('#recall-grid', { timeout: 20000 });
let words = await memoWords(); const chips = await page.locator('#recall-grid .chip').allInnerTexts();
for (let i = 0; i < chips.length; i++) if (words.slice(0, 6).includes(chips[i])) await page.click('#rw-' + i);
await page.click('#btn-recall-done'); must((await page.innerText('#fb-card')).includes('6개'), '낱말 6개 골랐어요'); await next();
// 점 잇기 A / B
for (const [seq, name] of [[['1', '2', '3', '4', '5', '6', '7', '8'], '점 잇기 (숫자)'], [['1', '가', '2', '나', '3', '다', '4', '라'], '점 잇기 (숫자와 글자)']]) {
  await begin(name); await page.click('#btn-trail-start');
  await page.click('#trail-field button[data-t="' + seq[1] + '"]'); // 일부러 틀리게 한 번
  for (const t of seq) await page.click('#trail-field button[data-t="' + t + '"]');
  must((await page.innerText('#fb-card')).includes('초 걸렸어요'), name + ' 완료'); await next();
}
// 숫자 기억: 앞으로 3개 성공 → 4개 두 번 실패, 거꾸로 2개 성공 → 3개 두 번 실패
await begin('숫자 기억하기');
async function readDigits(len) { await page.waitForSelector('#digit-now'); const seen = []; for (let k = 0; k < 400 && !(await vis('#digit-pad')); k++) { const t = (await page.innerText('#digit-now').catch(() => '')).trim(); if (t && seen[seen.length - 1] !== t + '#' + seen.length) { if (!seen.length || true) seen.push(t); } await page.waitForTimeout(15); } return seen; }
async function round(len, back, correct) {
  await page.waitForSelector('#digit-now'); const seq = []; let last = null;
  for (let k = 0; k < 2000 && !(await vis('#digit-pad')); k++) { const t = (await page.innerText('#digit-now').catch(() => '')).trim(); if (t) { if (last === null) { seq.push(t); last = t; } } else last = null; await page.waitForTimeout(8); }
  const want = back ? seq.slice().reverse() : seq; const typed = correct ? want : want.map(d => String((Number(d) + 1) % 10));
  for (const d of typed) await page.click('#dp-' + d); await page.click('#dp-확인');
  return seq.length;
}
await page.click('#btn-digits-go'); must((await round(3, false, true)) === 3, '숫자 3개 표시/성공');
await round(4, false, false); await round(4, false, false);
await page.waitForSelector('#btn-digits-go'); await page.click('#btn-digits-go'); await round(2, true, true); await round(3, true, false); await round(3, true, false);
await page.waitForSelector('#fb-card'); must((await page.innerText('#fb-card')).includes('앞으로 3개, 거꾸로 2개'), '숫자 기억 결과'); await next();
// 반응 속도
await begin('반응 속도'); await page.click('#react-pad');
for (let i = 0; i < 5; i++) { await page.waitForFunction(() => document.querySelector('#react-pad').textContent.includes('지금'), null, { timeout: 8000 }); await page.dispatchEvent('#react-pad', 'pointerdown'); if (i < 4) { await page.dispatchEvent('#react-pad', 'pointerdown'); } }
must((await page.innerText('#fb-card')).includes('밀리초'), '반응 속도 결과'); await next();
// 색 고르기: 연습 2 + 10
await begin('색 고르기'); for (let i = 0; i < 12; i++) { await page.click('#sc-' + (i % 4)); }
must((await page.innerText('#fb-card')).includes('10개 중'), '색 고르기 결과'); await next();
// 동물 이름
await begin('동물 이름 대기'); await page.click('#btn-flu-start'); for (let i = 0; i < 7; i++) await page.click('#flu-plus'); await page.click('#flu-minus');
await page.waitForSelector('#flu-total', { timeout: 15000 }); must((await page.inputValue('#flu-total')) === '6', '동물 6마리 (+7, −1)'); await page.click('#btn-flu-save');
must((await page.innerText('#fb-card')).includes('6마리'), '동물 이름 결과'); await next();
// 지연 회상 (마지막)
await begin('아까 낱말'); const chips2 = await page.locator('#recall-grid .chip').allInnerTexts();
for (let i = 0; i < chips2.length; i++) if (words.slice(0, 4).includes(chips2[i])) await page.click('#rw-' + i);
await page.click('#btn-recall-done'); must((await page.innerText('#fb-card')).includes('4개'), '지연 회상 4개'); await next();
await page.waitForSelector('#ad-h'); must(true, '점검 완료 화면');
const saved = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bw.localdb') || '{}')).filter(k => k.startsWith('taskRuns/')).length);
must(saved === 1, 'taskRuns 저장 ' + saved);
const dom = await page.evaluate(() => window.__S.lastAssess.rec.scores); must(Object.keys(dom).length === 5, '영역 점수 5개 유지 ' + JSON.stringify(dom));
// 가족 화면에서 상세
await page.evaluate(() => { localStorage.setItem('bw.role', JSON.stringify('family')); }); await page.goto(BASE); await page.waitForSelector('#appbar-title'); if (await vis('.dialog')) await page.click('#dlg-btn-1').catch(() => {});
await page.click('#nav-family'); await page.waitForSelector('#task-report'); const rep = await page.innerText('#task-report');
must(rep.includes('점 잇기') && rep.includes('동물 이름') && rep.includes('기준점은 없어요'), '가족 기록의 점검 과제 상세');
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
