// 뒤로 가기 가장자리 시험: 칸이 새지 않는지, 겹친 창, 터치 첫 누름, 빠른 Back 연타, 가족 코드(?join=) 시작
import { BASE, done, launch, must, newPage, out, startDemo, vis } from './e2e-lib.mjs';
const browser = await launch();
const dlgTitle = page => page.innerText('#dlg-title').catch(() => '');
const back = async (page, ms = 350) => { await page.goBack().catch(() => {}); await page.waitForTimeout(ms); };
const gone = page => page.url() === 'about:blank';
const mk = async (role = 'family', o = {}) => { const { page } = await newPage(browser, { tag: 'edge', seed: { 'bw.role': role }, ...o }); await startDemo(page); await page.waitForSelector(role === 'trainee' ? '#btn-main' : '#btn-settings'); return page; };
const hs = page => page.evaluate(() => ({ len: history.length, st: history.state }));

/* 1) 화면을 50번 바꿔도 칸이 늘지 않아요 */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  const base = (await hs(page)).len;
  const names = ['pick', 'family', 'settings', 'home', 'chat', 'assess', 'surveys', 'clocks'];
  for (let n = 0; n < 50; n++) { await page.evaluate(s => window.__go(s), names[n % names.length]); await page.waitForTimeout(40); }
  await page.waitForTimeout(800);
  const r = await hs(page);
  must(r.len - base <= names.length + 1, '화면 50번 이동 뒤 history 길이 증가가 화면 수 이하: +' + (r.len - base));
  // 하나씩 Back 하면 결국 앱 닫기 확인에 닿고, 그 사이 앱을 나가지 않아요
  let guard = 0; while (!(await vis(page, '.dialog')) && guard++ < 30 && !gone(page)) await back(page, 250);
  must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', 'Back 을 계속 눌러도 앱을 나가기 전에 닫기 확인에 닿아요 (' + guard + '번)');
  await page.close();
}

/* 2) 열기·닫기를 반복해도 칸이 새지 않아요 (버튼 닫기, Back 닫기, Escape 닫기 섞어서) */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  const base = await hs(page);
  for (let n = 0; n < 12; n++) {
    await page.evaluate(() => import('./js/ui/dom.js').then(m => m.dialog('시험', '본문', [{ label: '확인', kind: 'filled' }])));
    await page.waitForSelector('.dialog');
    if (n % 3 === 0) await page.click('#dlg-btn-0'); else if (n % 3 === 1) await back(page); else await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  const r = await hs(page);
  must(r.st.i === base.st.i && r.len <= base.len + 1, '창 12번 열고 닫은 뒤 번호가 그대로, 앞쪽 칸이 쌓이지 않아요 (' + base.len + '/' + base.st.i + ' → ' + r.len + '/' + r.st.i + ')');
  await back(page);
  must(await dlgTitle(page) === '앱을 닫을까요?', '그 뒤 Back 한 번이면 닫기 확인');
  await page.close();
}

/* 3) 시트 위에 창 (겹친 창): Back 은 창, 시트 순서로 한 칸씩 */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  const base = await hs(page);
  await page.evaluate(() => import('./js/ui/dom.js').then(m => m.openSheet('시트', b => b.append(m.h('button', { class: 'btn filled', id: 'sh-btn', type: 'button' }, '버튼')))));
  await page.waitForSelector('#sheet .sheet');
  await page.evaluate(() => import('./js/ui/dom.js').then(m => m.dialog('겹침', '본문', [{ label: '확인', kind: 'filled' }])));
  await page.waitForSelector('.dialog');
  await back(page);
  must(!(await vis(page, '.dialog')) && await vis(page, '#sheet .sheet'), '겹침: Back 한 번 → 창만 닫혀요, 시트는 그대로');
  await back(page);
  must(!(await vis(page, '#sheet .sheet')) && !gone(page) && await vis(page, '#btn-settings'), '겹침: Back 두 번째 → 시트가 닫혀요');
  must((await hs(page)).st.i === base.st.i, '겹침: 번호 그대로');
  // 창을 버튼으로 닫고 시트를 Back 으로 닫기
  await page.evaluate(() => import('./js/ui/dom.js').then(m => { m.openSheet('시트', b => b.append(m.h('button', { class: 'btn filled', type: 'button' }, 'x'))); m.dialog('겹침', '본문', [{ label: '확인', kind: 'filled' }]); }));
  await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); await page.waitForTimeout(400);
  must(await vis(page, '#sheet .sheet') && !(await vis(page, '.dialog')), '겹침: 버튼으로 창만 닫으면 시트는 그대로');
  await back(page);
  must(!(await vis(page, '#sheet .sheet')) && !gone(page) && !(await vis(page, '.dialog')), '겹침: 그 뒤 Back → 시트만 닫혀요 (앱 안 나감)');
  must((await hs(page)).st.i === base.st.i, '겹침(버튼): 번호 그대로');
  // 시트를 코드로 닫고(화면 이동) 창이 남은 경우
  await page.evaluate(() => import('./js/ui/dom.js').then(m => { m.openSheet('시트', b => {}); m.dialog('겹침', '본문', [{ label: '확인', kind: 'filled' }]); m.closeSheet(); }));
  await page.waitForTimeout(400);
  await back(page);
  must(!gone(page) && !(await vis(page, '.dialog')) && await vis(page, '#btn-settings'), '겹침: 시트를 먼저 닫고 Back → 창만 닫히고 앱에 남아요');
  await back(page);
  must(await dlgTitle(page) === '앱을 닫을까요?', '겹침: 다음 Back → 닫기 확인 (칸이 안 어긋나요)');
  await page.close();
}

/* 4) 창 위에 창 (앞 창을 바꿔 끼움) */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  const base = await hs(page);
  await page.evaluate(() => import('./js/ui/dom.js').then(m => { m.dialog('첫째', 'a', [{ label: '확인' }]); m.dialog('둘째', 'b', [{ label: '확인' }]); }));
  await page.waitForTimeout(400);
  must(await dlgTitle(page) === '둘째' && (await hs(page)).st.i === base.st.i + 1, '창을 바꿔 끼워도 번호는 한 칸만 올라가요');
  await back(page);
  must(!(await vis(page, '.dialog')) && !gone(page), '바꿔 낀 창: Back 한 번이면 닫혀요');
  must((await hs(page)).st.i === base.st.i, '바꿔 낀 창: 번호가 원래대로');
  await page.close();
}

/* 5) 터치 첫 누름: 지킴이 칸은 사용자 활성화(sticky activation) 뒤에 쌓아야 Chrome 이 Back 으로 건너뛰지 않아요 */
{
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await tctx.addInitScript(() => { window.__DEBUG = true; try { localStorage.setItem('bw.seenDisc', 'true'); localStorage.setItem('bw.offered', 'true'); localStorage.setItem('bw.aiDemo', 'false'); localStorage.setItem('bw.role', '"family"'); } catch (e) {} });
  const page = await tctx.newPage();
  await page.addInitScript(() => { const p = history.pushState.bind(history); window.__pushAct = []; history.pushState = function (...a) { window.__pushAct.push(navigator.userActivation.hasBeenActive); return p(...a); }; });
  await page.goto(BASE); await page.waitForSelector('#btn-demo');
  const bb = await page.locator('#btn-demo').boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForSelector('#appbar-title'); await page.waitForTimeout(300);
  const acts = await page.evaluate(() => window.__pushAct);
  must(acts.length >= 1 && acts[0], '터치: 지킴이 칸을 쌓을 때 이미 사용자 활성화됨 ' + JSON.stringify(acts));
  await page.close();
}

/* 6) Back 연타: 빠르게 두 번 눌러도 앱을 바로 나가지 않아요 (게임 중, 화면 이동 중) */
{
  const page = await mk('family');
  await page.evaluate(() => window.__go('pick')); await page.waitForSelector('[data-act="game"]'); await page.click('[data-act="game"]'); await page.waitForSelector('#g-title');
  await page.goBack().catch(() => {}); await page.goBack().catch(() => {}); await page.waitForTimeout(900);
  must(!gone(page), '게임 중 Back 연타: 앱을 나가지 않아요');
  await page.close();
}

/* 7) 데스크톱 앞으로 가기: 앱 안 상태가 어긋나지 않아요 */
{
  const page = await mk('family');
  await page.click('#btn-settings'); await page.waitForSelector('#set-main-h');
  await back(page);
  await page.goForward().catch(() => {}); await page.waitForTimeout(400);
  must(!gone(page) && await vis(page, '#btn-settings') && !(await vis(page, '#set-main-h')), '앞으로 가기: 원래 자리(홈)로 되돌려요');
  await back(page);
  must(await dlgTitle(page) === '앱을 닫을까요?', '앞으로 가기 뒤 Back: 닫기 확인');
  await page.close();
}

/* 8) beforeunload 는 게임 중에만. 결과·홈·창 위에서는 조용히 */
{
  const page = await mk('trainee', { w: 1100, h: 800 });
  const bu = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  await page.evaluate(() => window.__go('home')); await page.waitForTimeout(300);
  must(!(await bu()), 'beforeunload: 게임을 나온 뒤 홈에서는 조용해요');
  await page.close();
}

/* 9) 가족 코드 링크(?join=)로 시작: 안내 화면에서 Back 은 앱 닫기 확인, 주소 상태는 깨끗 */
{
  const { page } = await newPage(browser, { tag: 'edge-join', seed: {} });
  await page.goto(BASE + '?join=ABC234'); await page.waitForTimeout(1500);
  const shown = await vis(page, '#join-h') || await vis(page, '#btn-join-next') || await vis(page, '#join-code');
  out('info join screen visible:', shown, await page.evaluate(() => window.__S && window.__S.screen));
  if (shown) {
    await page.mouse.click(5, 400); await page.waitForTimeout(200);
    await back(page);
    must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', '?join= 화면에서 Back → 앱 닫기 확인');
    await page.click('#dlg-btn-0'); await page.waitForTimeout(300);
    must(await vis(page, '#join-code') || await vis(page, '#btn-join-next'), '?join= 계속하기 → 가입 화면에 그대로');
  }
  await page.close();
}
/* 10) 앱 닫기 확인창이 떠 있다가 다른 창(알림 등)이 대신 뜨고 닫혀도, 지킴이 칸은 다시 생겨요 */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  await back(page);
  must(await dlgTitle(page) === '앱을 닫을까요?', '닫기 확인창이 떠 있어요');
  await page.evaluate(() => import('./js/ui/dom.js').then(m => m.dialog('알림', '본문', [{ label: '확인', kind: 'filled' }])));
  await page.waitForSelector('#dlg-btn-0'); await page.click('#dlg-btn-0'); await page.waitForTimeout(500);
  await back(page, 600);
  must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', '다른 창을 닫은 뒤 Back → 다시 닫기 확인 (바로 나가지 않아요)');
  await page.close();
}
/* 11) 맨 앞 칸 위에 시트를 열었다 Back 으로 닫아도 지킴이 칸이 남아요 */
{
  const page = await mk('family');
  await page.mouse.click(5, 400); await page.waitForTimeout(200);
  await back(page);
  await page.evaluate(() => import('./js/ui/dom.js').then(m => m.openSheet('시트', b => b.append(m.h('button', { class: 'btn', type: 'button' }, 'x')))));
  await page.waitForSelector('#sheet .sheet'); await page.click('#dlg-btn-0'); await page.waitForTimeout(300);
  await back(page, 500);
  must(!gone(page) && !(await vis(page, '#sheet .sheet')), '시트를 Back 으로 닫아도 앱에 남아요');
  await back(page, 600);
  must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', '그 뒤 Back → 닫기 확인');
  await page.close();
}
out('back edge tests finished');
await done(browser);
