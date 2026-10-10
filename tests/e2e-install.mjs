// 홈 화면 설치 안내: 설치 버튼(beforeinstallprompt) / 앱 안 브라우저(카카오톡) / 아이폰 사파리 안내 / 설정의 "앱 설치" 줄.
// 체험 모드로 들어가 화면만 확인해요 (firebase-config.js 가 비어 있는 상태).
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
const UA_KAKAO_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-S918N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.4.0';
const UA_KAKAO_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0';
const UA_NAVER_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const FILLED = 'self.BW_CONFIG={firebase:{apiKey:"k",authDomain:"x.firebaseapp.com",projectId:"x",storageBucket:"x",messagingSenderId:"1",appId:"1:1:web:1"},vapidKey:"v",appCheckSiteKey:""};';
async function dismissDisc(pg) { await pg.waitForSelector('.dialog', { timeout: 8000 }); await pg.click('#dlg-btn-0'); await pg.waitForTimeout(150); if (await pg.locator('.dialog').count() && await pg.locator('.dialog').first().isVisible()) await pg.click('#dlg-btn-1'); }
async function open(ua, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, colorScheme: o.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: FILLED }));
  await page.route('https://www.gstatic.com/**', r => r.abort());
  await page.addInitScript(o2 => { window.__DEBUG = true; if (o2.size) localStorage.setItem('bw.size', JSON.stringify(o2.size)); if (o2.standalone) Object.defineProperty(navigator, 'standalone', { value: true }); }, o);
  return page;
}
/* 연결 실패 → 체험 모드로 앱을 열어요 (url 은 ?join=… 처럼 주소 확인용) */
async function enter(page, query = '') {
  await page.goto(BASE + query); await page.waitForSelector('#err-h'); await page.click('#btn-demo'); await dismissDisc(page); await page.waitForSelector('#hello');
}
const fakeEvent = () => { const e = new Event('beforeinstallprompt', { cancelable: true }); window.__prompted = 0; e.prompt = () => { window.__prompted++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' }); window.dispatchEvent(e); };
const vis = (pg, sel) => pg.locator(sel).first().isVisible().catch(() => false);
const noHScroll = async pg => must(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '가로 스크롤 없음 (390px)');

/* ---------- 1. 설치 버튼 (안드로이드 크롬) ---------- */
let pg = await open(UA_ANDROID);
await enter(pg);
must(!(await vis(pg, '#install-card')), '이벤트 전에는 설치 카드가 없어요');
await pg.evaluate(fakeEvent); await pg.waitForSelector('#install-card');
let t = await pg.innerText('#install-card');
must(t.includes('📲 홈 화면에 앱 설치') && t.includes('다음부터 아이콘만 누르면 열려요') && t.includes('설치하기') && t.includes('닫기'), '홈: 이벤트가 늦게 와도 카드가 나타나요');
await pg.screenshot({ path: SHOTS + '/install-prompt-home-light.png' }); await noHScroll(pg);
await pg.click('#btn-install'); await pg.waitForFunction(() => !document.getElementById('install-card'));
must((await pg.evaluate(() => window.__prompted)) === 1, '설치하기 → prompt() 호출');
must((await pg.innerText('#snackbar')).includes("설치했어요. 홈 화면의 '두뇌산책' 아이콘으로 열어 주세요"), '수락하면 스낵바 안내');
must(!(await vis(pg, '#install-card')), '수락 후 카드가 사라져요');
// 설정: 설치됨 ✓ (방금 설치함)
await pg.click('#btn-settings'); await pg.waitForSelector('#install-done');
must((await pg.innerText('#install-slot')).includes('설치됨 ✓'), '설정: 설치됨 ✓');
await pg.close();

pg = await open(UA_ANDROID); await enter(pg);
await pg.evaluate(fakeEvent); await pg.waitForSelector('#install-card');
await pg.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await pg.waitForFunction(() => !document.getElementById('install-card'));
must(true, 'appinstalled 이벤트로 카드가 사라져요');
await pg.close();

// 닫기 → 7일 숨김, 설정에는 계속 있음
pg = await open(UA_ANDROID); await enter(pg);
await pg.evaluate(fakeEvent); await pg.waitForSelector('#install-card'); await pg.click('#install-dismiss');
await pg.waitForFunction(() => !document.getElementById('install-card'));
const until = await pg.evaluate(() => JSON.parse(localStorage.getItem('bw.installDismiss')));
const days = (until - Date.now()) / 86400000; must(days > 6.9 && days <= 7.01, '닫기는 7일 동안 숨겨요 (' + days.toFixed(2) + '일)');
await pg.evaluate(() => window.__go('settings')); await pg.waitForSelector('#btn-install');
must(true, '설정의 앱 설치 줄에는 버튼이 계속 있어요');
await pg.evaluate(() => { localStorage.setItem('bw.installDismiss', JSON.stringify(Date.now() - 1000)); window.__go('home'); }); await pg.waitForSelector('#install-card');
must(true, '7일이 지나면 다시 나와요');
// 처음 화면
await pg.evaluate(() => window.__go('ob-start')); await pg.waitForSelector('#ob-start-h');
must(await vis(pg, '#install-card #btn-install'), '처음 화면에도 설치 카드');
await pg.screenshot({ path: SHOTS + '/install-prompt-start-light.png' });
await pg.close();

/* ---------- 2. 카카오톡 안 (안드로이드) ---------- */
pg = await open(UA_KAKAO_ANDROID); await enter(pg, '?join=ABC234');
await pg.evaluate(() => { history.replaceState(null, '', '?join=ABC234'); window.__S.ob = { code: 'ABC234', fromLink: true }; window.__go('ob-join'); });
await pg.waitForSelector('#install-card');
t = await pg.innerText('#install-card');
must(t.includes('카카오톡 안에서는 앱 설치가 안 돼요'), '카카오톡 카드 제목');
const kHref = await pg.getAttribute('#btn-open-external', 'href');
must(kHref.startsWith('kakaotalk://web/openExternal?url=') && decodeURIComponent(kHref.split('url=')[1]).endsWith('/brain-walk/?join=ABC234'), 'kakaotalk:// 링크가 ?join= 을 지켜요: ' + kHref);
must((await pg.evaluate(() => document.querySelector('#btn-open-external').tagName)) === 'A', '진짜 <a href> 링크');
must(!(await vis(pg, '#btn-install')), '설치 버튼은 없어요');
await pg.screenshot({ path: SHOTS + '/install-kakao-android-join-light.png' }); await noHScroll(pg);
// 같은 기기에서 안드로이드 크롬 intent 링크 (네이버 앱 안)
await pg.close();
pg = await open(UA_NAVER_ANDROID); await enter(pg);
await pg.evaluate(() => { history.replaceState(null, '', '/brain-walk/?join=ABC234'); window.__go('ob-start'); }); await pg.waitForSelector('#install-card');
must((await pg.innerText('#install-card')).includes('네이버 안에서는 앱 설치가 안 돼요'), '네이버 앱 안 카드');
const iHref = await pg.getAttribute('#btn-open-chrome', 'href');
must(iHref === 'intent://albatrus0102.github.io/brain-walk/?join=ABC234#Intent;scheme=https;package=com.android.chrome;end', 'intent:// 크롬 링크: ' + iHref);
must((await pg.innerText('#btn-open-chrome')) === '크롬으로 열기', '크롬으로 열기 버튼');
await pg.evaluate(() => { history.replaceState(null, '', '/brain-walk/'); window.__go('home'); }); await pg.waitForSelector('#install-card');
must((await pg.getAttribute('#btn-open-chrome', 'href')) === 'intent://albatrus0102.github.io/brain-walk/#Intent;scheme=https;package=com.android.chrome;end', '쿼리가 없으면 경로만');
await pg.close();

/* ---------- 3. 카카오톡 안 (아이폰) / 다른 iOS 앱 안 ---------- */
pg = await open(UA_KAKAO_IOS); await enter(pg);
await pg.evaluate(() => window.__go('ob-start')); await pg.waitForSelector('#btn-open-external');
must((await pg.getAttribute('#btn-open-external', 'href')).startsWith('kakaotalk://web/openExternal?url='), 'iOS 카카오톡도 kakaotalk:// 링크');
must(!(await vis(pg, '#ios-steps')), '앱 안 브라우저에서는 사파리 안내 목록을 보이지 않아요');
await pg.close();
pg = await open(UA_IPHONE.replace('Version/17.4 Mobile/15E148 Safari/604.1', 'Mobile/15E148 Instagram 300.0.0.0'));
await enter(pg); await pg.evaluate(() => window.__go('ob-start')); await pg.waitForSelector('#inapp-guide');
must((await pg.innerText('#inapp-guide')).includes("오른쪽 아래 ⋯ 또는 공유 버튼 → 'Safari로 열기'"), 'iOS 앱 안(인스타그램): Safari로 열기 안내');
await pg.close();

/* ---------- 4. 아이폰 사파리 ---------- */
pg = await open(UA_IPHONE); await enter(pg);
await pg.waitForSelector('#install-card #ios-steps');
t = await pg.innerText('#install-card');
must(t.includes('홈 화면에 앱 설치') && t.includes('공유 버튼') && t.includes('"홈 화면에 추가"') && !(await vis(pg, '#btn-install')), '아이폰: 설치 버튼 대신 번호 안내');
must((await pg.locator('#ios-steps li').count()) === 4 && (await pg.locator('#ios-steps svg').count()) === 2, '번호 4단계 + 그림 2개');
must((await pg.locator('#ios-steps').count()) === 1, '#ios-steps 는 하나만 (알림 카드와 합쳐졌어요)');
must(!(await vis(pg, '#push-card')), '홈: 아이폰 알림 카드는 설치 카드와 합쳐요');
await pg.screenshot({ path: SHOTS + '/install-ios-home-light.png' }); await noHScroll(pg);
await pg.evaluate(() => { window.__S.ob = { code: 'XYZ789' }; window.__go('ob-join'); }); await pg.waitForSelector('#ob-ios-code');
must((await pg.innerText('#ob-ios-code')) === 'XYZ789' && (await pg.locator('#ios-steps').count()) === 1, '가입 화면: 안내 + 큰 코드가 한 카드에');
await pg.evaluate(() => window.__go('settings')); await pg.waitForSelector('#install-slot #ios-steps');
must((await pg.locator('#ios-steps').count()) === 1, '설정: 아이폰 안내 하나');
await pg.screenshot({ path: SHOTS + '/install-ios-settings-light.png' });
await pg.close();
// 홈 화면 앱으로 열면
pg = await open(UA_IPHONE, { standalone: true }); await enter(pg);
must(!(await vis(pg, '#install-card')), '설치된 앱(standalone)에서는 카드가 없어요');
await pg.evaluate(() => window.__go('settings')); await pg.waitForSelector('#install-done');
must((await pg.innerText('#install-slot')).trim() === '설치됨 ✓', '설정: 설치됨 ✓ (standalone)');
await pg.close();
// 설치 이벤트가 없는 PC/안드로이드: 설정에만 메뉴 안내
pg = await open(UA_ANDROID); await enter(pg);
must(!(await vis(pg, '#install-card')), '이벤트가 없으면 홈에는 카드가 없어요');
await pg.evaluate(() => window.__go('settings')); await pg.waitForSelector('#install-menu');
must((await pg.innerText('#install-menu')).includes('앱 설치'), '설정: 브라우저 메뉴 안내');
await pg.close();

/* ---------- 5. 가장 큰 글자 + 다크, 390px ---------- */
for (const dark of [false, true]) {
  const tag = dark ? 'dark' : 'light';
  pg = await open(UA_ANDROID, { dark, size: 'xlarge' }); await enter(pg);
  await pg.evaluate(fakeEvent); await pg.waitForSelector('#install-card'); await noHScroll(pg);
  await pg.screenshot({ path: SHOTS + '/install-prompt-home-xlarge-' + tag + '.png' });
  await pg.close();
  pg = await open(UA_KAKAO_ANDROID, { dark, size: 'xlarge' }); await enter(pg);
  await pg.waitForSelector('#install-card'); await noHScroll(pg);
  await pg.screenshot({ path: SHOTS + '/install-kakao-home-xlarge-' + tag + '.png' });
  await pg.close();
  pg = await open(UA_IPHONE, { dark, size: 'xlarge' }); await enter(pg);
  await pg.waitForSelector('#install-card'); await noHScroll(pg);
  await pg.screenshot({ path: SHOTS + '/install-ios-home-xlarge-' + tag + '.png', fullPage: true });
  await pg.close();
}
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
