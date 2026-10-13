// 깔끔한 화면: 처음·가입·홈·점검·설문·설정 어디에도 면책/저장 정보/위기 안내/출처/긴 설명이 없고, 제목과 버튼(과 게임·문항 내용)만 있어요.
// 설정에도 "앱 정보" 칸이 없어요. 390px 화면을 SHOT_DIR/clean 에 저장해요.
import { mkdirSync } from 'node:fs';
import { BASE, SHOTS, done, errors, launch, must, newPage, startDemo, vis } from './e2e-lib.mjs';
const DIR = (process.env.SHOT_DIR || SHOTS) + '/clean'; mkdirSync(DIR, { recursive: true });
const BAD = /의료기기|저장되는 정보|치료를 대신|진단이 아니|참고용이며|치매안심|1899|병원에서 상담|서울 리전|자살예방|1577|109\b|119에|출처|공공누리|앱 정보/;
const FILLED = 'self.BW_CONFIG={firebase:{apiKey:"k",authDomain:"x.firebaseapp.com",projectId:"x",storageBucket:"x",messagingSenderId:"1",appId:"1:1:web:1"},vapidKey:"v",appCheckSiteKey:""};';
const browser = await launch();
const body = page => page.innerText('body');
/* 제목·버튼 밖의 문단(p) 글: 일상 화면에는 없어야 해요. 인사말(.greet)·현황 카드(#dash)·설치 카드 안의 큰 코드는 제외 */
const paras = page => page.evaluate(() => [...document.querySelectorAll('#screen p')].filter(p => p.innerText.trim() && !p.closest('#dash, .hero, button, .sr') && !p.classList.contains('greet') && !/^아직 .{1,10}$/.test(p.innerText.trim())).map(p => p.innerText.trim().slice(0, 40)));   // "아직 없어요" 같은 빈 상태 한 줄은 허용

/* 1) 가입 화면들 (연결 정보가 채워져 있고 SDK 가 막힌 상태 → 연결 실패 → 화면만 확인) */
{
  const { page } = await newPage(browser, { tag: 'onb' });
  await page.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: FILLED }));
  await page.route('https://www.gstatic.com/**', r => r.abort());
  await page.goto(BASE); await page.waitForSelector('#err-h');
  must(!BAD.test(await body(page)) && (await paras(page)).length === 0, '연결 실패 화면: 제목 + 버튼만 ' + JSON.stringify(await paras(page)));
  await page.evaluate(() => window.__go('ob-start')); await page.waitForSelector('#ob-start-h');
  const t = await body(page);
  must(!BAD.test(t) && !(await page.locator('#disclaimer, .foot, .card').count()), '처음 화면: 면책 카드·저장되는 정보 카드·꼬리말 없음');
  must((await paras(page)).length === 0, '처음 화면: 문단 글 없음 ' + JSON.stringify(await paras(page)));
  must(await vis(page, '#btn-create') && await vis(page, '#btn-join') && await vis(page, '#btn-have-transfer'), '처음 화면: 제목 + 버튼 3개');
  await page.screenshot({ path: DIR + '/onboarding.png' });
  for (const [scr, ob] of [['ob-join', { code: '', fromLink: true }], ['ob-transfer', {}], ['ob-name', { flow: 'create' }], ['ob-role', { flow: 'create', name: '나' }], ['ob-invite', { invite: { code: 'ABC234' }, role: 'trainee' }]]) {
    await page.evaluate(([s, o]) => { window.__S.ob = o; window.__go(s); }, [scr, ob]);
    await page.waitForTimeout(80);
    const ps = (await paras(page)).filter(x => !/^[A-Z0-9 ]{6,}$/.test(x) && x !== '가족 코드');
    must(!BAD.test(await body(page)) && ps.length === 0, scr + ': 설명 글 없음 ' + JSON.stringify(ps));
  }
  await page.evaluate(() => { window.__S.ob = { flow: 'create' }; window.__go('ob-role'); }); await page.screenshot({ path: DIR + '/onboarding-role.png' });
}

/* 2) 설정 안내 → 체험 모드 가족 홈 → 여러 화면 → 설정 */
{
  const { page } = await newPage(browser, { tag: 'fam', seed: { 'bw.role': 'family', 'bw.aiDemo': true } });
  await page.goto(BASE); await page.waitForSelector('#btn-demo');
  must(!BAD.test(await body(page)) && (await paras(page)).length === 0, '설정 안내 화면: 제목 + 버튼만');
  await page.click('#btn-demo'); await page.waitForSelector('#appbar-title');
  await page.evaluate(() => window.__go('home')); await page.waitForTimeout(150);
  must(!BAD.test(await body(page)) && !(await page.locator('#disclaimer, .foot').count()), '가족 홈: 면책·꼬리말 없음');
  must((await paras(page)).length === 0, '가족 홈: 문단 글 없음 ' + JSON.stringify(await paras(page)));
  await page.screenshot({ path: DIR + '/family-home.png' });
  for (const s of ['family', 'assess', 'surveys', 'clinical', 'assessView', 'clocks', 'pick', 'members', 'adminDisplay', 'adminPlan', 'aiReports', 'aiSettings']) {
    await page.evaluate(x => window.__go(x), s); await page.waitForTimeout(200);
    const ps = await paras(page);
    must(!BAD.test(await body(page)), s + ': 면책·위기·출처 글 없음');
    if (['surveys', 'assess', 'pick', 'clocks', 'members'].includes(s)) must(ps.length === 0, s + ': 문단 글 없음 ' + JSON.stringify(ps));
    await page.screenshot({ path: DIR + '/sweep-' + s + '.png' });
  }
  // 설문: 출처 접는 칸 없음
  await page.evaluate(() => window.__go('surveys')); await page.waitForTimeout(100);
  must((await page.locator('details.src').count()) === 0, '설문 목록: 출처 칸 없음');
  await page.click('#sv-open-kdsq'); await page.waitForSelector('#svi-h');
  must((await page.locator('details.src').count()) === 0 && !(await page.innerText('#screen')).includes('공공누리'), '설문 소개: 출처 칸·글 없음');
  // 설정: 앱 정보 없음, AI 기록 관찰 스위치
  await page.evaluate(() => window.__go('settings')); await page.waitForSelector('#set-main-h');
  must((await page.locator('#xpc-about, #about-privacy, #about-disclaimer').count()) === 0 && !/앱 정보|저장되는 정보|의료기기/.test(await body(page)), '설정: 앱 정보·면책·저장 정보 없음');
  await page.screenshot({ path: DIR + '/settings.png' });
}

/* 3) 훈련하는 분 홈·설정 */
{
  const { page } = await newPage(browser, { tag: 'tr', seed: { 'bw.role': 'trainee' } });
  await startDemo(page); await page.waitForSelector('#btn-main');
  must(!BAD.test(await body(page)) && !(await page.locator('#disclaimer, .foot').count()), '훈련하는 분 홈: 면책·꼬리말 없음');
  must((await paras(page)).length === 0, '훈련하는 분 홈: 문단 글 없음 ' + JSON.stringify(await paras(page)));
  await page.screenshot({ path: DIR + '/learner-home.png' });
  await page.evaluate(() => window.__go('settings')); await page.waitForSelector('#set-main-h');
  must(!BAD.test(await body(page)) && !/가족이 숫자를 살펴보는 것/.test(await body(page)), '훈련하는 분 기기 설정: 앱 정보·동의 카드 없음');
  await page.evaluate(() => window.__go('aiConsent')); await page.waitForTimeout(150);
  must(!(await page.locator('#btn-consent-ok').count()), '아버지 안내(동의) 화면은 없어요');
}
errors.splice(0, errors.length, ...errors.filter(e => !/^onb console: Failed to load resource/.test(e)));   // 막아 둔 SDK 주소의 로드 실패는 예상된 일
await done(browser);
