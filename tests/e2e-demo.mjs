// 체험 모드 화면 흐름 시험 (Playwright + 로컬 서버).  사용법은 tests/README.md
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { try { localStorage.setItem('bw.aiDemo', 'false'); } catch (e) {} });   // 체험 모드의 AI 예시 자료·안내는 AI 시험(e2e-ai*.mjs)에서만 켜요
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const vis = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const must = async (cond, msg) => { if (!cond) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };

await page.goto(BASE);
await page.waitForSelector('#setup-h');
await must((await page.innerText('#setup-h')).includes('관리자 설정이 필요해요'), '설정 안내 화면');
await must(!/README|의료기기/.test(await page.innerText('#screen')), '설정 안내 화면: 제목 + 체험 버튼만');
await page.click('#btn-demo');
await page.waitForSelector('#btn-main, .dialog');
if (await vis('.dialog')) { out('dialog:', await page.innerText('#dlg-title')); await page.click('#dlg-btn-1'); }
await must(await vis('#btn-main'), '홈 훈련 시작 버튼');

async function playRound() {
  // 번쩍 찾기: 잠깐 나타나는 가운데 그림과 별 칸을 DOM 에서 읽어 두었다가 그대로 눌러요 (오늘의 첫 게임이 flash 일 수 있어요)
  if (await vis('#btn-ready')) {
    const seen = page.evaluate(() => new Promise(res => {
      const g = document.querySelector('#fgrid'); let mo;
      const chk = () => { const c = document.querySelector('#fcell-4').textContent.trim(), si = [...g.children].findIndex(x => x.textContent.includes('⭐')); if (si >= 0 && c && c !== '＋') { mo.disconnect(); res({ c, si }); } };
      mo = new MutationObserver(chk); mo.observe(g, { subtree: true, childList: true, characterData: true });
    }));
    await page.click('#btn-ready');
    const { c, si } = await seen;
    await page.locator('.choice:not([disabled])', { hasText: c }).first().click({ timeout: 3000 });
    await page.click('#fpos-' + si, { timeout: 3000 });
    return true;
  }
  // 숫자 순서대로 누르기: "다음: N" 에 맞는 칸을 눌러요 (오늘의 코스 첫 게임이 날짜마다 달라져요)
  if (await vis('#nexttarget')) { const want = (await page.innerText('#nexttarget')).replace('다음:', '').trim(); await page.locator('#trailgrid button:not([disabled])', { hasText: new RegExp('^\\s*' + want + '\\s*$') }).first().click({ timeout: 1500 }).catch(() => {}); return true; }
  if (await page.locator('.choice:not([disabled])').count()) { await page.locator('.choice:not([disabled])').first().click(); return true; }
  if (await vis('#btn-memorized')) { await page.click('#btn-memorized'); const t = await page.locator('#cnt').innerText(); const n = +t.match(/\/ (\d+)/)[1]; const chips = page.locator('#pool .chip'); for (let i = 0; i < n; i++) await chips.nth(i).click(); await page.click('#btn-check'); return true; }
  return false;
}
await page.click('#btn-main');
await page.waitForSelector('#g-title');
let steps = 0, fbHidden = 0;
while (steps++ < 80 && !(await vis('#brk-h'))) {
  if (await vis('#btn-next')) {
    // 답한 뒤 안내 글은 위 앱 바와 아래 고정 버튼 사이에 보여야 해요 (예전에는 고정 버튼 밑에 숨었어요)
    await page.waitForTimeout(150);
    const fbOk = await page.evaluate(() => { const f = document.querySelector('#fb-card'); if (!f) return true; const r = f.getBoundingClientRect(), bar = document.querySelector('.appbar').getBoundingClientRect(), cta = document.querySelector('#game-cta'); const ct = getComputedStyle(cta).position === 'sticky' ? cta.querySelector('#btn-next').getBoundingClientRect().top : innerHeight; return r.top >= bar.bottom - 1 && r.bottom <= ct + 1; });
    if (!fbOk) fbHidden++;
    await page.click('#btn-next'); continue;
  }
  const did = await playRound();
  if (!did) { // 알 수 없는 게임: 문제 영역의 아무 버튼이나 눌러 보고 그만하기
    const b = page.locator('#box button:not([disabled])'); if (await b.count()) await b.first().click({ timeout: 1500 }).catch(() => {}); else break;
  }
  await page.waitForTimeout(30);
}
await must(await vis('#brk-h'), '게임 한 판을 끝내면 쉬는 화면 (다음은 ‘…’)');
await must(fbHidden === 0, '답한 뒤 안내 글이 고정 버튼에 가려지지 않음 (가려진 횟수 ' + fbHidden + ')');
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/game.png' : '/tmp/game.png' });
await page.click('#btn-brk-stop'); await page.click('#dlg-btn-1');
await page.waitForSelector('#btn-main');
must((await page.locator('.nav-item').count()) === 0, '훈련하는 분 화면에는 하단 메뉴가 없어요');
must((await page.innerText('#btn-main')).trim() === '이어서 하기', '홈: 이어서 하기');
await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/home-trainee.png' });
// 가족(관리자) 화면으로 바꿔서 설정·채팅 확인
await page.click('#btn-gear'); await page.click('#dlg-btn-1'); await page.waitForSelector('#set-main-h');
await page.click('#btn-role-switch'); await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-settings');
await page.click('#btn-settings'); await page.waitForSelector('#set-main-h');
await must(await vis('#btn-delete-local'), '설정: 체험 모드 안내/삭제 버튼');
await page.click('#row-plan'); await page.waitForSelector('#plan-h');
await page.click('#xp-p2');
await must(await vis('#btn-ics'), '훈련 계획: ICS 버튼');
const dl = page.waitForEvent('download');
await page.click('#btn-ics'); const d = await dl; await must(d.suggestedFilename().endsWith('.ics'), 'ICS 실제 다운로드 ' + d.suggestedFilename());
await page.click('#btn-back'); await page.waitForSelector('#set-main-h');
await page.click('#btn-delete-local'); await must(await vis('#dlg-title'), '삭제 확인 대화상자(M3)'); await page.click('#dlg-btn-0');
await page.click('#nav-chat'); await page.waitForSelector('#chat-h'); must(!(await page.innerText('#screen')).includes('claude.ai') && (await page.innerText('#screen')).includes('가족방이 없어요'), '채팅(체험 모드): 짧은 안내만, claude.ai 없음');
out('ERRORS:', JSON.stringify(errors));
await browser.close();
process.exit(errors.length ? 1 : 0);
