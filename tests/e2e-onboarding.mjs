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
async function dismiss(pg) { await pg.waitForSelector('#appbar-title', { timeout: 8000 }); await pg.waitForTimeout(250); if (await pg.locator('.dialog').count() && await pg.locator('.dialog').first().isVisible()) await pg.click('#dlg-btn-1').catch(() => pg.click('#dlg-btn-0')); }   // 처음 안내 창은 없어요. 점검 권유 창이 뜨면 닫아요
async function open(ua) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('bw.aiDemo', 'false'); } catch (e) {} });   // 체험 모드의 AI 예시 자료·안내는 AI 시험(e2e-ai*.mjs)에서만 켜요
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
await page.evaluate(() => window.__go('ob-start')); must((await page.innerText('#screen')).includes('가족방 만들기') && !(await page.innerText('#screen')).includes('새 가족 만들기') && (await page.innerText('#screen')).includes('가족 코드로 들어가기'), '처음 화면: 새 가족 만들기 / 가족 코드로 들어가기');
{ const t0 = await page.innerText('#screen'); must(!/의료기기|저장되는 정보|치료|진단|치매|\d{4}-\d{4}/.test(t0) && !(await page.locator('#disclaimer, .foot').count()), '처음 화면: 면책 카드·저장되는 정보 카드·꼬리말 없음'); }
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
const t = await ios.innerText('#screen'); must(t.includes('XYZ789') && await ios.locator('#btn-install-ios').isVisible() && !t.includes('공유 → 홈 화면에 추가'), 'iOS: "📲 홈 화면에 설치" 버튼 하나 + 큰 코드 (설명 글 없음)');
await ios.click('#btn-install-ios'); must((await ios.innerText('#ios-steps')).includes('공유 버튼'), 'iOS: 버튼을 누르면 그림 안내가 창으로 나와요'); await ios.click('#dlg-btn-0');
await ios.screenshot({ path: SHOTS + '/onboarding-ios.png' });

// ---- 가족방 만들기 코드 (체험 모드가 같은 검사를 흉내 내요): 방 주인이 설정에서 코드를 정하고, 만들기 화면이 그 코드를 물어봐요
{
  const fam = await open();
  await fam.addInitScript(() => { try { localStorage.setItem('bw.role', JSON.stringify('family')); } catch (e) {} });
  await fam.goto(BASE); await fam.waitForSelector('#err-h'); await fam.click('#btn-demo'); await dismiss(fam);
  const vis = sel => fam.locator(sel).first().isVisible().catch(() => false);
  // 처음 화면: 가족 코드로 들어가기가 크게, 만들기는 작은 글자 버튼
  await fam.evaluate(() => window.__go('ob-start')); await fam.waitForSelector('#ob-start-h');
  const geo = await fam.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { join: r('btn-join'), create: r('btn-create'), cls: document.getElementById('btn-create').className }; });
  must(/\btext\b/.test(geo.cls) && geo.join.height >= geo.create.height && geo.join.top < geo.create.top, '처음 화면: "가족 코드로 들어가기"가 크게, "가족방 만들기"는 작은 글자 버튼');
  // 코드를 정하기 전에는 아무도 못 만들어요
  await fam.click('#btn-create'); await fam.waitForSelector('#create-code');
  must(!(await fam.locator('#screen p:not([hidden])').count()), '만들기 코드 화면: 설명 글 없음');
  await fam.fill('#create-code', 'abcdefgh1'); await fam.click('#btn-ccode-next'); await fam.waitForSelector('#ob-err:not([hidden])');
  must((await fam.innerText('#ob-err')) === '만들기 코드가 맞지 않아요.' && !(await vis('#ob-name-input')), '코드를 정하기 전에는 어떤 코드도 거절');
  // 설정에서 방 주인이 '새 코드 만들기' — 앱이 12글자 코드를 만들어 한 번만 보여 줘요
  await fam.evaluate(() => window.__go('settings')); await fam.waitForSelector('#set-main-h');
  must((await fam.innerText('#btn-create-code')).includes('새 코드 만들기'), '설정: "새 코드 만들기" 줄');
  await fam.click('#btn-create-code'); await fam.waitForSelector('#ccnew-code');
  const shown = (await fam.innerText('#ccnew-code')).trim();
  must(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(shown), '만들어진 코드: XXXX-XXXX-XXXX, 0/O/1/I/L 없음');
  const sheetParts = await fam.evaluate(() => { const c = document.getElementById('ccnew-code').parentElement; return { n: c.children.length, ps: c.querySelectorAll('p').length, btns: [...c.querySelectorAll('button')].map(b => b.textContent.trim()) }; });
  must(sheetParts.ps === 1 && sheetParts.n === 3 && sheetParts.btns.join() === '복사,닫기', '창에는 코드, [복사], [닫기]만 있어요');
  await fam.click('#ccnew-copy'); await fam.waitForTimeout(150);
  must(((await fam.innerText('#snackbar')) || '').length > 0, '복사 누르면 알림 (클립보드가 막혀도 글자를 선택해 둬요)');
  const stored = await fam.evaluate(async () => window.__Store.getDoc('appConfig/creation'));
  const dbl = await fam.evaluate(async c => { const h = async t => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), b => b.toString(16).padStart(2, '0')).join(''); return await h(await h(c.replace(/-/g, ''))); }, shown);
  must(stored && stored.codeHash === dbl && !JSON.stringify(stored).includes(shown.replace(/-/g, '')), '저장된 것은 이중 해시뿐이고 원래 코드는 없어요');
  await fam.click('#ccnew-close'); await fam.waitForSelector('#ccnew-code', { state: 'detached' });
  must(!(await fam.evaluate(c => document.body.innerText.includes(c), shown)), '닫으면 코드가 화면에서 사라져요');
  // 새로 만들면 이전 코드는 바로 못 써요
  await fam.click('#btn-create-code'); await fam.waitForSelector('#ccnew-code');
  const shown2 = (await fam.innerText('#ccnew-code')).trim(); await fam.click('#ccnew-close');
  must(shown2 !== shown, '다시 만들면 다른 코드');
  // 틀린 코드는 거절, 맞는 코드는 (소문자·공백·줄표로 쳐도) 이름 화면으로
  await fam.evaluate(() => { window.__S.ob = {}; window.__go('ob-start'); }); await fam.waitForSelector('#ob-start-h');
  await fam.click('#btn-create'); await fam.fill('#create-code', shown); await fam.click('#btn-ccode-next'); await fam.waitForSelector('#ob-err:not([hidden])');
  must((await fam.innerText('#ob-err')) === '만들기 코드가 맞지 않아요.' && !(await vis('#ob-name-input')), '이전 코드: 짧은 오류');
  await fam.fill('#create-code', ' ' + shown2.toLowerCase().replace(/-/g, ' ') + ' '); await fam.click('#btn-ccode-next'); await fam.waitForSelector('#ob-name-input');
  must(true, '맞는 만들기 코드(소문자·공백으로 쳐도): 이름 화면으로');
  await fam.click('#name-chip-0'); await fam.click('#btn-name-next'); await fam.waitForSelector('#ob-role-h'); must(await vis('#role-family'), '이어서 역할 화면');
  await fam.screenshot({ path: SHOTS + '/onboarding-ccode.png' });
}
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
