// 뒤로 가기(Back) 시험: 앱 안에서 먼저 한 칸 돌아가고, 게임 중이나 첫 화면에서는 바로 나가지 않고 물어요.
// page.goBack() 은 사용자 입력(클릭) 뒤에 불러서 실제 Back 버튼을 흉내 내요. 사용법은 tests/README.md
import { BASE, done, launch, must, newPage, out, startDemo, vis } from './e2e-lib.mjs';
const browser = await launch();
const dlgTitle = page => page.innerText('#dlg-title').catch(() => '');
const back = async page => { await page.goBack().catch(() => {}); await page.waitForTimeout(350); };
const gone = page => page.url() === 'about:blank';

async function common(role, tag) {
  const home = role === 'trainee' ? '#btn-main' : '#btn-settings';
  const mk = async () => { const { page } = await newPage(browser, { tag: tag, seed: { 'bw.role': role } }); await startDemo(page); await page.waitForSelector(home); return page; };
  const toSettings = async page => { if (role === 'trainee') { await page.click('#btn-gear'); await page.click('#dlg-btn-1'); } else await page.click('#btn-settings'); await page.waitForSelector('#set-main-h'); };

  /* 1) 홈 → 설정 → Back = 홈 (앱을 나가지 않아요) */
  { const page = await mk();
    await toSettings(page);
    await back(page);
    must(!gone(page) && await vis(page, home) && !(await vis(page, '#set-main-h')), role + ': 홈 → 설정 → Back 하면 홈');
    must(!(await vis(page, '.dialog')), role + ': 설정에서 돌아올 땐 물어보지 않아요');
    await page.close(); }

  /* 2) 창이 열려 있으면 Back 은 창부터 닫아요 (Escape 도 같아요) */
  { const page = await mk();
    if (role === 'trainee') {
      await page.click('#btn-gear'); await page.waitForSelector('.dialog');
      await back(page);
      must(!(await vis(page, '.dialog')) && await vis(page, home), role + ': 톱니바퀴 확인창 → Back 하면 창만 닫혀요');
      await page.click('#btn-gear'); await page.waitForSelector('.dialog'); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
      must(!(await vis(page, '.dialog')) && await vis(page, home), role + ': Escape 도 창을 닫아요');
      await back(page);
      must(await dlgTitle(page) === '앱을 닫을까요?', role + ': 창을 닫은 뒤 Back 은 앱 닫기 확인 (칸이 맞아요)');
    } else {
      await toSettings(page);
      await page.click('#btn-delete-local'); await page.waitForSelector('.dialog');
      await back(page);
      must(!(await vis(page, '.dialog')) && await vis(page, '#set-main-h'), role + ': 삭제 확인창 → Back 하면 창만 닫히고 설정에 그대로');
      await page.click('#btn-delete-local'); await page.click('#dlg-btn-0'); await page.waitForTimeout(350);
      await back(page);
      must(await vis(page, home) && !(await vis(page, '.dialog')), role + ': 버튼으로 창을 닫은 뒤 Back 하면 한 칸만 돌아가 홈');
    }
    await page.close(); }

  /* 3) 게임 중 Back = "게임을 그만둘까요?" → 계속하기는 게임에 그대로, 그만두기는 홈 */
  { const page = await mk();
    if (role === 'trainee') await page.click('#btn-main');
    else { await page.evaluate(() => window.__go('pick')); await page.waitForSelector('[data-act="game"]'); await page.click('[data-act="game"]'); }
    await page.waitForSelector('#g-title');
    await back(page);
    must(!gone(page) && await dlgTitle(page) === '게임을 그만둘까요?', role + ': 게임 중 Back → "게임을 그만둘까요?"');
    must((await page.innerText('#dlg-btn-0')).trim() === '계속하기' && (await page.innerText('#dlg-btn-1')).trim() === '그만두기' && /filled/.test(await page.getAttribute('#dlg-btn-0', 'class')), role + ': 계속하기(눈에 띄는 버튼) / 그만두기');
    await page.click('#dlg-btn-0'); await page.waitForTimeout(300);
    must(await vis(page, '#g-title') && !(await vis(page, '.dialog')), role + ': 계속하기 → 게임에 그대로');
    await back(page);
    must(await dlgTitle(page) === '게임을 그만둘까요?', role + ': 계속한 뒤 Back 을 또 눌러도 다시 물어요');
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    must(await vis(page, '#g-title') && !(await vis(page, '.dialog')), role + ': Escape = 계속하기');
    await back(page);
    await page.click('#dlg-btn-1'); await page.waitForTimeout(350);
    must(!gone(page) && await vis(page, home) && !(await vis(page, '#g-title')), role + ': 그만두기 → 홈');
    await back(page);
    must(await dlgTitle(page) === '앱을 닫을까요?', role + ': 그만둔 뒤 홈에서 Back → 앱 닫기 확인 (칸이 쌓이지 않아요)');
    await page.close(); }

  /* 4) 첫 화면(홈)에서 Back = "앱을 닫을까요?" → 계속하기는 그대로, 다시 Back 하면 확인, 확인창에서 또 Back 하면 나가요 */
  { const page = await mk();
    await back(page);
    must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', role + ': 홈에서 Back → "앱을 닫을까요?"');
    must((await page.innerText('#dlg-btn-0')).trim() === '계속하기' && (await page.innerText('#dlg-btn-1')).trim() === '닫기' && /filled/.test(await page.getAttribute('#dlg-btn-0', 'class')), role + ': 계속하기(눈에 띄는 버튼) / 닫기');
    await page.click('#dlg-btn-0'); await page.waitForTimeout(300);
    must(!gone(page) && await vis(page, home) && !(await vis(page, '.dialog')), role + ': 계속하기 → 앱에 그대로');
    await back(page);
    must(!gone(page) && await dlgTitle(page) === '앱을 닫을까요?', role + ': 계속하기 뒤에 다시 지켜요 (Back → 또 확인)');
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    must(!gone(page) && !(await vis(page, '.dialog')), role + ': Escape = 계속하기');
    await back(page); await back(page);
    must(gone(page), role + ': 확인창이 떠 있을 때 Back 을 또 누르면 앱을 나가요 (두 번 누르면 종료)');
    await page.close(); }
  { const page = await mk();
    await back(page); await page.click('#dlg-btn-1'); await page.waitForTimeout(800);
    must(gone(page), role + ': 닫기 → 앱에서 나가요');
    await page.close(); }
}
await common('trainee', 'back-trainee');
await common('family', 'back-family');

/* 5) 데스크톱: 게임 중에만 beforeunload, 그 밖에는 조용히 */
{
  const { page } = await newPage(browser, { tag: 'back-bu', seed: { 'bw.role': 'trainee' }, w: 1100, h: 800 });
  await startDemo(page); await page.waitForSelector('#btn-main');
  const bu = async () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  must(!(await bu()), '데스크톱: 홈에서는 beforeunload 를 쓰지 않아요');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must(await bu(), '데스크톱: 게임 중에는 beforeunload 로 한 번 물어요');
  await page.close();
}

/* 6) 딥링크(?join=)와 시작 주소는 그대로, 주소에 상태를 넣지 않아요 */
{
  const { page } = await newPage(browser, { tag: 'back-url', seed: { 'bw.role': 'trainee' } });
  await startDemo(page); await page.waitForSelector('#btn-main');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must(page.url() === BASE || page.url() === BASE + 'index.html', '주소(URL)는 그대로: ' + page.url());
  const st = await page.evaluate(() => history.state);
  must(st && st.bw === 1, 'history.state 로만 상태를 관리해요');
  await page.close();
}
out('back tests finished');
await done(browser);
