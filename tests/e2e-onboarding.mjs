// 설정이 채워졌다고 가정(가짜 값)하고 Firebase SDK 로드를 막아 "연결 실패 → 체험 모드" 경로와,
// 가입 화면(처음/코드 입력/이름/역할/초대)의 화면·복사 동작을 확인해요. 실제 가입 동작은 adapter-smoke 가 에뮬레이터로 확인해요.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
const FILLED = 'self.BW_CONFIG={firebase:{apiKey:"k",authDomain:"x.firebaseapp.com",projectId:"x",storageBucket:"x",messagingSenderId:"1",appId:"1:1:web:1"},vapidKey:"v",appCheckSiteKey:""};';
async function dismiss(pg) { await pg.waitForSelector('.dialog', { timeout: 8000 }).catch(async e => { console.log('NO DIALOG', await pg.evaluate(() => [window.__S.screen, document.getElementById('scrim').hidden, document.getElementById('scrim').innerHTML.length, localStorage.getItem('bw.seenDisc'), document.getElementById('screen').innerText.slice(0, 60)])); throw e; }); await pg.click('#dlg-btn-0'); await pg.waitForTimeout(150); if (await pg.locator('.dialog').count() && await pg.locator('.dialog').first().isVisible()) await pg.click('#dlg-btn-1'); }
async function open(ua) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: FILLED }));
  await page.route('https://www.gstatic.com/**', r => r.abort());
  await page.addInitScript(() => { window.__DEBUG = true; });
  return page;
}
let page = await open();
await page.goto(BASE + '?join=ABC234'); await page.waitForSelector('#err-h');
must((await page.innerText('#err-h')).includes('연결하지 못했어요'), '연결 실패 화면');
await page.click('#btn-demo'); await dismiss(page); must(true, '실패 화면에서 체험 모드로 진입');
// 가입 화면들 (연결 없이 화면만)
await page.evaluate(() => { window.__S.ob = { code: 'ABC234', fromLink: true }; window.__go('ob-join'); });
must((await page.inputValue('#join-code')) === 'ABC234', '?join=CODE 로 코드 미리 입력');
await page.fill('#join-code', 'ab0 c23'); await page.click('#btn-join-next'); must((await page.innerText('#ob-err')).includes('0(영)·O, 1·I는 코드에 쓰지 않아요'), '0/O/1/I 안내');
await page.evaluate(() => window.__go('ob-start')); must((await page.innerText('#screen')).includes('새 가족 만들기') && (await page.innerText('#screen')).includes('가족 코드로 들어가기'), '처음 화면: 새 가족 만들기 / 가족 코드로 들어가기');
must((await page.innerText('#screen')).includes('의료기기가 아니에요'), '의료기기 아님 안내');
await page.evaluate(() => { window.__S.ob = { flow: 'create' }; window.__go('ob-name'); }); await page.click('#name-chip-0'); must((await page.inputValue('#ob-name-input')) === '아버지', '이름 예시 칩');
await page.click('#btn-name-next'); await page.waitForSelector('#ob-role-h'); must(await page.locator('#role-trainee').isVisible() && await page.locator('#role-family').isVisible(), '역할: 훈련하는 분 / 가족');
await page.evaluate(() => { window.__S.ob = { invite: { code: 'ABC234' } }; window.__go('ob-invite'); });
must((await page.innerText('#inv-code')).replace(/\s/g, '') === 'ABC234', '가족 코드 큰 글자 표시');
await page.click('#inv-copy-code'); must((await page.evaluate(() => navigator.clipboard.readText())) === 'ABC234', '코드 복사');
await page.click('#inv-copy-link'); const link = await page.evaluate(() => navigator.clipboard.readText()); must(link.endsWith('/brain-walk/?join=ABC234'), '초대 링크 복사: ' + link);
await page.click('#inv-kakao'); const kt = await page.evaluate(() => navigator.clipboard.readText()); must(kt.includes('?join=ABC234') && kt.includes('초대'), '카톡으로 초대 보내기: 초대 문구(링크 포함) 복사');
await page.screenshot({ path: SHOTS + '/onboarding-invite.png' });
// 클립보드를 막았을 때 대체 복사
await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true }); });
await page.click('#inv-kakao'); await page.waitForTimeout(100); must(await page.locator('#inv-textbox').isVisible(), '클립보드가 안 되면 직접 복사용 상자를 보여 줘요');
// iOS(홈 화면 앱이 아닐 때): 설치 안내
const ios = await open('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
await ios.goto(BASE + '?join=XYZ789'); await ios.waitForSelector('#err-h'); await ios.click('#btn-demo'); await dismiss(ios);
await ios.evaluate(() => { window.__S.ob = { code: 'XYZ789' }; window.__go('ob-join'); });
const t = await ios.innerText('#screen'); must(t.includes('공유 → 홈 화면에 추가 후 알림을 켤 수 있어요') && t.includes('XYZ789'), 'iOS: 홈 화면에 추가 안내 + 큰 코드');
await ios.screenshot({ path: SHOTS + '/onboarding-ios.png' });
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
