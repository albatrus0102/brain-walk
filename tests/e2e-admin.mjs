// 관리자 화면(체험 모드는 관리자이자 훈련하는 분): 설정 칸, 훈련 계획, 훈련하는 분 화면 설정, 계획이 코스·난이도에 반영, 읽기 전용,
// 가족 홈의 실시간 현황(체험 모드에서 흉내), 아주 크게/최대·다크에서 가로 스크롤 없음.  사용법은 tests/README.md
import { BASE, SHOTS, done, errors, finishGame, launch, must, newPage, noHScroll, startDemo, vis } from './e2e-lib.mjs';
const browser = await launch();
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('bw.localdb') || '{}'));
const mod = (page, f) => page.evaluate(async f => import(new URL('js/' + f, document.baseURI).href).then(m => Object.keys(m)), f);
const text = (page, sel) => page.innerText(sel).then(t => t.replace(/\s+/g, ' ').trim());
const openPlan = async page => { await page.click('#btn-settings'); await page.waitForSelector('#set-main-h'); if (!(await page.getAttribute('#xpc-mgmt', 'open') !== null)) await page.click('#xp-mgmt'); await page.click('#row-plan'); await page.waitForSelector('#plan-h'); };
const openCard = async (page, k) => { if ((await page.getAttribute('#xpc-' + k, 'open')) === null) await page.click('#xp-' + k); };

/* ---------- 1) 설정 칸과 훈련 계획 ---------- */
{
  const { page } = await newPage(browser, { tag: 'plan', seed: { 'bw.role': 'family' } });
  await startDemo(page);
  await page.click('#btn-settings'); await page.waitForSelector('#set-main-h');
  must((await page.locator('details.xp').count()) >= 2 && (await page.getAttribute('#xpc-mine', 'open')) !== null, '설정: 펼치는 카드 (내 화면은 펼쳐져 있어요)');
  must((await text(page, '#xpv-mgmt')) === '하루 5개 · 약 15분 · 매일 · 난이도 자동 · 점검 4주마다', '아버지 기기 관리 요약 한 줄');
  await page.click('#xp-mgmt');
  must(await vis(page, '#row-display') && await vis(page, '#row-plan') && await vis(page, '#btn-role-switch'), '화면·계획 줄과 체험 모드 미리보기 전환');
  await page.click('#row-plan'); await page.waitForSelector('#plan-h');
  must((await text(page, '#plan-sum')).startsWith('하루 5개 · 약 15분 · 매일'), '계획 요약 카드');
  // 하루 게임 수 1~9
  for (let i = 0; i < 6; i++) await page.click('#gpd-minus', { force: true }).catch(() => {});
  must((await page.innerText('#plan-gpd')) === '1' && await page.isDisabled('#gpd-minus'), '게임 수는 1에서 멈춰요');
  for (let i = 0; i < 12; i++) if (!(await page.isDisabled('#gpd-plus'))) await page.click('#gpd-plus');
  must((await page.innerText('#plan-gpd')) === '9' && await page.isDisabled('#gpd-plus'), '게임 수는 9에서 멈춰요');
  // 켠 게임 수보다 많게 정하면 안내
  await openCard(page, 'p3');
  const ids = await page.evaluate(() => [...document.querySelectorAll('#plan-games .grow')].map(x => x.dataset.g));
  for (const id of ids.slice(0, 5)) await page.click('#plan-on-' + id);
  must((await text(page, '#plan-cap')).includes('켠 게임이 4개라 하루 최대 4개예요.'), '켠 게임 수 안내');
  for (const id of ids.slice(5)) await page.click('#plan-on-' + id);
  must((await text(page, '#plan-problems')).includes('게임을 하나 이상 골라 주세요.') && await page.isDisabled('#plan-save'), '게임을 모두 끄면 문제 안내 + 저장 막힘');
  await page.screenshot({ path: SHOTS + '/admin-plan-problem.png', fullPage: true });
  for (const id of ids) await page.click('#plan-on-' + id);
  must(!(await vis(page, '#plan-problems')), '다시 켜면 안내가 사라져요');
  // 정한 순서: 위로/아래로, 오늘/내일 줄이 바뀌어요
  await page.click('#plan-order-fixed');
  const before = await text(page, '#plan-today2');
  await page.click('#plan-down-' + ids[0]);
  const order2 = await page.evaluate(() => [...document.querySelectorAll('#plan-games .grow')].map(x => x.dataset.g));
  must(order2[1] === ids[0] && order2[0] === ids[1], '아래로: 순서가 바뀌어요');
  must((await text(page, '#plan-today2')) !== before, '오늘 줄이 바뀐 순서를 보여 줘요');
  must(await page.isDisabled('#plan-up-' + order2[0]), '맨 위 게임의 "위로"는 막혀요');
  // 하루 2개, 문제 수 3, 자동 넘김 15초, 요일 월~금, 알람 08:30, 점검 끔
  await openCard(page, 'p1');
  while ((await page.innerText('#plan-gpd')) !== '2') await page.click((+(await page.innerText('#plan-gpd')) > 2) ? '#gpd-minus' : '#gpd-plus');
  await page.click('#plan-more-sum'); await page.selectOption('#plan-rounds', '3'); await page.click('#plan-auto-15'); await page.click('#plan-target-10');
  await openCard(page, 'p2');
  for (const d of [0, 6]) await page.click('#plan-day-' + d);
  await page.fill('#plan-alarm-time', '08:30');
  await openCard(page, 'p5'); await page.click('#plan-check-0'); await page.click('#plan-score');
  must(!(await page.isDisabled('#plan-save')), '고치면 저장이 켜져요');
  must((await text(page, '#xpv-p2')) === '평일 · 오전 8:30' && (await text(page, '#xpv-p5')).includes('점검 끔') && (await text(page, '#xpv-p5')).includes('자동 넘김 15초'), '카드 요약이 지금 값을 보여 줘요');
  await page.screenshot({ path: SHOTS + '/admin-plan-sections.png', fullPage: true });
  // 저장: 계획과 알람이 한 번에
  await page.click('#plan-save'); await page.waitForSelector('#snackbar:not([hidden])');
  must((await page.innerText('#snackbar')).includes('저장했어요. 아버지 휴대폰에 곧 적용돼요.'), '저장 안내 문구');
  const d = await db(page), p = d['state/plan'], a = d['state/alarm'];
  must(p && p.gamesPerDay === 2 && p.roundsPerGame === 3 && p.autoNextSec === 15 && p.checkEveryWeeks === 0 && p.showScore === true && p.targetMin === 10 && JSON.stringify(p.weekdays) === '[1,2,3,4,5]' && p.order === 'fixed', 'state/plan 저장 내용');
  must(a && a.time === '08:30' && JSON.stringify(a.days) === '[1,2,3,4,5]', 'state/alarm 도 함께 저장 (시간·요일)');
  must(await page.isDisabled('#plan-save'), '저장한 뒤에는 저장 버튼이 꺼져요');
  // 저장하지 않고 나가기
  await page.click('#plan-score'); await page.click('#btn-back'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-title')) === '저장하지 않고 나갈까요?', '저장하지 않고 나갈까요? 확인 창');
  await page.click('#dlg-btn-0'); must(await vis(page, '#plan-h'), '계속 고치기');
  await page.click('#plan-revert'); await page.click('#btn-back'); await page.waitForSelector('#set-main-h'); must(true, '되돌리기 뒤에는 바로 나가요');
  // 훈련하는 분 화면으로: 계획이 코스에 반영
  await page.click('#btn-role-switch'); await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-main');
  must((await text(page, '#main-sub')).startsWith('게임 2개 · 약 '), '훈련하는 분 홈: 게임 2개 (계획 반영)');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  const r = await page.evaluate(() => { const s = window.__S.sess; return { rounds: s.rounds, base: s.g.rounds, n: window.__S.course.games.length }; });
  must(r.n === 2 && r.rounds === Math.max(1, Math.round(3 * r.base / 5)), '문제 수 3 → 게임별 비율 (' + r.rounds + '/' + r.base + ')');
  await page.close();
}

/* ---------- 2) 난이도: 고정과 범위가 실제 게임에 ---------- */
{
  const { page } = await newPage(browser, { tag: 'level', seed: { 'bw.role': 'family', 'bw.levels': { cards: 1, words: 1, odd: 1, trail: 1, shop: 1, order: 1, today: 1, proverb: 1, flash: 1 } } });
  await startDemo(page);
  const first2 = await page.evaluate(async () => { const P = await import(new URL('js/program.js', document.baseURI).href), R = await import(new URL('js/games/registry.js', document.baseURI).href); const t = new Date(), ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); return P.buildCourse({ gamesPerDay: 2 }, ds, R.catalog()); });
  await openPlan(page);
  while ((await page.innerText('#plan-gpd')) !== '2') await page.click('#gpd-minus');
  await openCard(page, 'p4'); await page.click('#plan-lv-sum');
  await page.click('#plan-mode-' + first2[0] + '-fixed'); await page.click('#plan-lvl-' + first2[0] + '-4');
  await page.selectOption('#plan-min-' + first2[1], '3'); await page.selectOption('#plan-max-' + first2[1], '4');
  must((await text(page, '#xpv-p4')) === '1개 고정', '난이도 요약: 1개 고정');
  await page.screenshot({ path: SHOTS + '/admin-plan-levels.png', fullPage: true });
  await page.click('#plan-save'); await page.waitForSelector('#snackbar:not([hidden])');
  await page.click('#btn-back'); await page.click('#btn-role-switch'); await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-main');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  let lv = await page.evaluate(() => ({ id: window.__S.sess.g.id, level: window.__S.sess.level }));
  must(lv.id === first2[0] && lv.level === 4, '고정 4단계로 시작 (적응 기록은 1단계)');
  await finishGame(page, false); await page.waitForSelector('#brk-h');
  must(!(await vis(page, '#brk-level')) , '고정 난이도: 단계 안내 말 없음');
  const lv0 = await page.evaluate(() => JSON.parse(localStorage.getItem('bw.levels')).__none || 0);
  const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('bw.levels'))[id], first2[0]);
  must(stored === 1, '고정 난이도는 적응 기록을 바꾸지 않아요 (' + stored + ')'); void lv0;
  await page.click('#btn-brk-next'); await page.waitForSelector('#g-title');
  lv = await page.evaluate(() => ({ id: window.__S.sess.g.id, level: window.__S.sess.level }));
  must(lv.id === first2[1] && lv.level === 3, '자동 3~4단계: 적응 1단계여도 가장 쉬운 3단계로');
  await page.close();
}

/* ---------- 3) 훈련하는 분 화면 설정 ---------- */
{
  const { page } = await newPage(browser, { tag: 'display', seed: { 'bw.role': 'family' } });
  await startDemo(page);
  await page.click('#btn-settings'); await page.click('#xp-mgmt'); await page.click('#row-display'); await page.waitForSelector('#dd-h');
  must((await page.innerText('#dd-nodoc')).includes('아직 정하지 않았어요'), '정하지 않았을 때 안내');
  must((await text(page, '#dd-lead')).includes('휴대폰에 바로 적용돼요'), '안내 문구');
  const fs0 = await page.evaluate(() => parseFloat(document.querySelector('#disp-preview').style.fontSize));
  await page.click('#dd-font-noto'); await page.click('#dd-size-max');
  const st = await page.evaluate(() => { const s = document.querySelector('#disp-preview').style; return { fontFamily: s.fontFamily, fontSize: s.fontSize }; });
  must(/Noto Sans KR/.test(st.fontFamily) && parseFloat(st.fontSize) > fs0 * 1.2, '미리보기가 글꼴과 크기를 따라가요');
  await page.click('#dd-contrast'); await page.click('[id="dd-rate-1.05"]');
  must(await vis(page, '#dd-hear'), '말 빠르기 + 들어 보기');
  await page.click('#dd-hear');
  await page.screenshot({ path: SHOTS + '/admin-display.png', fullPage: true });
  await page.click('#dd-save'); await page.waitForSelector('#snackbar:not([hidden])');
  must((await page.innerText('#snackbar')).includes('저장했어요. 아버지 휴대폰에 곧 적용돼요.'), '저장 안내 (접속 중이 아니면)');
  const d = (await db(page))['state/display'];
  must(d && d.font === 'noto' && d.size === 'max' && d.contrast === true && d.voice === true && d.rate === 1.05, 'state/display 저장 내용');
  must((await page.evaluate(() => document.documentElement.getAttribute('data-size'))) === 'normal', '이 기기(가족)의 글자 크기는 그대로');
  await page.click('#btn-back'); await page.click('#btn-role-switch'); await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-main');
  const at = await page.evaluate(() => ({ s: document.documentElement.dataset.size, f: document.documentElement.dataset.font, c: document.documentElement.dataset.contrast }));
  must(at.s === 'max' && at.f === 'noto' && at.c === 'high', '훈련하는 분 화면에 글꼴·최대·고대비가 눌러 보지 않아도 적용');
  must((await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Noto Sans KR'), '글꼴이 타이포 토큰으로 바뀌어요');
  await noHScroll(page, '최대: 홈'); await page.screenshot({ path: SHOTS + '/learner-home-max.png' });
  await page.click('#btn-gear'); await page.click('#dlg-btn-1'); await page.waitForSelector('#set-main-h');
  must(await vis(page, '#prefs-remote') && (await page.innerText('#prefs-remote')).includes('가족(관리자)이 정해요'), '훈련하는 분 설정: 관리자가 정했다는 안내');
  await noHScroll(page, '최대: 설정'); await page.click('#btn-set-home');
  await page.click('#btn-main'); await page.waitForSelector('#g-title'); await noHScroll(page, '최대: 게임');
  await finishGame(page); await page.waitForSelector('#brk-h'); await noHScroll(page, '최대: 쉬는 화면');
  await page.screenshot({ path: SHOTS + '/learner-between-games-max.png' });
  await page.close();
}

/* ---------- 4) 내 화면(이 기기만): 글꼴·크기 ---------- */
{
  const { page } = await newPage(browser, { tag: 'mine', seed: { 'bw.role': 'family' } });
  await startDemo(page); await page.click('#btn-settings'); await page.waitForSelector('#size-max');
  await page.click('#font-noto'); await page.click('#size-max');
  const a = await page.evaluate(() => [document.documentElement.dataset.font, document.documentElement.dataset.size, localStorage.getItem('bw.font'), localStorage.getItem('bw.size')]);
  must(a.join() === 'noto,max,"noto","max"', '내 화면: 글꼴·크기가 이 기기에 저장');
  await noHScroll(page, '최대: 가족 설정'); await page.click('#xp-mgmt'); await page.click('#row-plan'); await page.waitForSelector('#plan-h');
  for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) await openCard(page, k);
  await noHScroll(page, '최대: 훈련 계획'); await page.screenshot({ path: SHOTS + '/admin-plan-max.png', fullPage: true });
  await page.close();
}

/* ---------- 5) 관리자가 아니면 읽기 전용 ---------- */
{
  const { page } = await newPage(browser, { tag: 'readonly', seed: { 'bw.role': 'family' } });
  await startDemo(page);
  await page.evaluate(() => { window.__S.debugNonAdmin = true; });
  await page.click('#btn-settings'); await page.click('#xp-mgmt');
  must((await text(page, '#mgmt-body')).includes('관리자만 바꿀 수 있어요'), '설정: 관리자만 바꿀 수 있어요');
  await page.click('#row-plan'); await page.waitForSelector('#plan-h');
  must((await text(page, '#admin-note')).startsWith('관리자만 바꿀 수 있어요. 관리자:'), '계획: 읽기 전용 안내');
  for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) await openCard(page, k);
  const dis = await page.evaluate(() => [...document.querySelectorAll('#screen button[data-act^="pl-"], #screen select, #screen input[type=time]')].filter(e => !e.disabled).map(e => e.id));
  must(dis.length === 0, '계획: 모든 입력이 꺼져 있어요 (' + dis.slice(0, 3) + ')');
  must(!(await vis(page, '#plan-save')) && (await text(page, '#plan-sum')).includes('하루 5개'), '저장 버튼 없음, 값은 보여요');
  await page.screenshot({ path: SHOTS + '/admin-plan-readonly.png', fullPage: true });
  await page.click('#btn-back'); await page.click('#row-display'); await page.waitForSelector('#dd-h');
  const dis2 = await page.evaluate(() => [...document.querySelectorAll('#screen .seg button, #screen .switch')].filter(e => !e.disabled).length);
  must(dis2 === 0 && !(await vis(page, '#dd-save')) && (await text(page, '#admin-note')).includes('관리자만'), '화면 설정도 읽기 전용');
  await page.click('#dd-font-system', { force: true }).catch(() => {});
  must(!(await db(page))['state/display'], '눌러도 저장되지 않아요');
  await page.close();
}

/* ---------- 6) 가족 홈의 현황 (체험 모드에서 상태를 흉내) ---------- */
{
  const { page } = await newPage(browser, { tag: 'dash', seed: { 'bw.role': 'family' } });
  await startDemo(page);
  const put = (path, doc) => page.evaluate(async ([p, d]) => window.__Store.setDoc(p, d), [path, doc]);
  const ymdOf = off => page.evaluate(o => { const t = new Date(); t.setDate(t.getDate() + o); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }, off);
  const today = await ymdOf(0);
  const P = (fn, args) => page.evaluate(async ([fn, args]) => { const m = await import(new URL('js/program.js', document.baseURI).href); return m[fn](...args); }, [fn, args]);
  const planned = ['odd', 'words', 'shop'];
  must((await text(page, '#dash-status')) === '아직 시작 전이에요' && (await text(page, '#dash-presence')) === '아직 접속 기록이 없어요', '현황: 시작 전 + 접속 기록 없음');
  const subs0 = await page.evaluate(() => window.__Store.adapter._subs.length);
  // 진행 중: 0개, 지금 하는 게임
  const now = Date.now();
  let doc = await P('progressStart', [null, { userId: 'local', date: today, planned, gameId: 'odd', now }]);
  await put('progress/' + today + '-local', doc);
  await page.waitForSelector('#dash[data-state="inProgress"]');
  must((await text(page, '#dash-status')) === '훈련 중 · 3개 중 0개' && (await text(page, '#dash-sub')).startsWith('지금: 다른 그림 찾기 ('), '현황: 훈련 중 · 3개 중 0개, 지금: 게임 이름');
  must((await page.locator('#dash-games li.cur').count()) === 1 && (await page.locator('#dash-games li.pending').count()) === 2, '게임 줄: 하는 중 1, 대기 2');
  // 하나 끝남: 결과가 바로 한 줄로
  doc = await P('progressFinish', [doc, { gameId: 'odd', result: { acc: 0.8, correct: 4, total: 5, sec: 95, level: 2 }, now: Date.now() }]);
  await put('progress/' + today + '-local', doc);
  await page.waitForFunction(() => document.querySelector('#dash-status').innerText.includes('3개 중 1개'));
  must((await text(page, '#dash-games li.done')).includes('정답 80%') && (await text(page, '#dash-games li.done')).includes('1분 35초') && (await text(page, '#dash-games li.done')).includes('2단계'), '게임 결과가 끝나는 대로: 정답 80% · 1분 35초 · 2단계');
  // 접속 상태
  await put('presence/local', { ts: Date.now(), lastSeen: Date.now() });
  await page.waitForFunction(() => document.querySelector('#dash-presence').innerText.includes('지금 앱을 보고 계세요'));
  must(await page.locator('#dash-dot.online').count() === 1, '접속 중: 초록 점');
  await put('presence/local', { ts: Date.now(), lastSeen: Date.now() - 10 * 60e3 });
  await page.waitForFunction(() => /10분 전에 앱을 보셨어요/.test(document.querySelector('#dash-presence').innerText));
  must(true, '10분 전에 앱을 보셨어요');
  await put('presence/local', { ts: Date.now(), lastSeen: Date.now() - 5 * 3600e3 });
  await page.waitForFunction(() => /오늘 .+에 마지막으로 보셨어요/.test(document.querySelector('#dash-presence').innerText)); must(true, '오늘 ○○에 마지막으로 보셨어요');
  // 쉬는 중 (30분 넘게 움직임 없음)
  const old = Date.now() - 50 * 60e3;
  const pd = await P('progressStart', [null, { userId: 'local', date: today, planned, gameId: 'odd', now: old }]);
  await put('progress/' + today + '-local', Object.assign(await P('progressFinish', [pd, { gameId: 'odd', result: { acc: 1, correct: 5, total: 5, sec: 60, level: 1 }, now: old }]), { sts: old }));
  await page.waitForSelector('#dash[data-state="paused"]');
  must((await text(page, '#dash-status')).startsWith('쉬는 중 · 3개 중 1개') && (await text(page, '#dash-sub')).startsWith('마지막 움직임'), '현황: 쉬는 중 + 마지막 움직임');
  // 끝남 + 7일 띠
  let full = await P('progressStart', [null, { userId: 'local', date: today, planned: ['odd'], gameId: 'odd', now: Date.now() }]);
  full = await P('progressFinish', [full, { gameId: 'odd', result: { acc: 1, correct: 5, total: 5, sec: 60, level: 1 }, now: Date.now() }]);
  await put('progress/' + today + '-local', full);
  for (const [off, n] of [[-1, 'done'], [-2, 'partial']]) {
    const dt = await ymdOf(off), pl = ['odd', 'words'];
    let x = await P('progressStart', [null, { userId: 'local', date: dt, planned: pl, gameId: 'odd', now: Date.now() - 864e5 * -off }]);
    x = await P('progressFinish', [x, { gameId: 'odd', result: { acc: 1, correct: 1, total: 1, sec: 5, level: 1 }, now: Date.now() - 864e5 * -off }]);
    if (n === 'done') x = await P('progressFinish', [await P('progressStart', [x, { userId: 'local', date: dt, planned: pl, gameId: 'words', now: Date.now() - 864e5 * -off }]), { gameId: 'words', result: { acc: 1, correct: 1, total: 1, sec: 5, level: 1 }, now: Date.now() - 864e5 * -off }]);
    await put('progress/' + dt + '-local', x);
  }
  await page.waitForSelector('#dash[data-state="done"]');
  must((await text(page, '#dash-status')).startsWith('오늘 완료 ✓'), '현황: 오늘 완료 ✓ 시각');
  const strip = await page.evaluate(() => [...document.querySelectorAll('#dash-week li')].map(li => li.dataset.state));
  must(strip.length === 7 && strip[6] === 'done' && strip[5] === 'done' && strip[4] === 'partial', '7일 띠: 오늘·어제 완료, 그제 일부 (' + strip + ')');
  must((await page.evaluate(() => document.querySelector('#dash-week li:nth-child(5)').getAttribute('aria-label'))).includes('1/2'), '띠 접근성 이름: "○요일 1/2"');
  must(!(await vis(page, '#btn-fam-nudge')), '끝났으면 훈련 알림 버튼 없음');
  await noHScroll(page, '현황'); await page.screenshot({ path: SHOTS + '/dashboard-done.png', fullPage: true });
  // 구독은 하나씩: 화면을 여러 번 다시 그려도, 데이터가 계속 와도 늘지 않아요
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__render(true)); await put('progress/' + today + '-local', full); }
  const subs1 = await page.evaluate(() => window.__Store.adapter._subs.length);
  must(subs1 === subs0 + 1 || subs1 === subs0, '구독 개수가 늘지 않아요 (' + subs0 + ' → ' + subs1 + ': 접속 기록 구독 1개만)');
  // 쉬는 날
  const wd = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== new Date().getDay());
  await put('state/plan', { weekdays: wd }); await put('progress/' + today + '-local', Object.assign({}, full, { status: 'started', results: [], idx: 0 }));
  await page.evaluate(async t => { const s = window.__Store; await s.deleteDoc('progress/' + t + '-local'); }, today);
  await page.waitForSelector('#dash[data-state="rest"]'); must((await text(page, '#dash-status')) === '오늘은 쉬는 날이에요', '현황: 쉬는 날');
  await page.close();
}

/* ---------- 7) 다크 + 아주 크게/최대: 관리자 화면들 ---------- */
for (const size of ['xlarge', 'max']) {
  const { page } = await newPage(browser, { tag: 'dark-' + size, dark: true, seed: { 'bw.role': 'family', 'bw.size': size } });
  await startDemo(page);
  await noHScroll(page, size + ' 다크 가족 홈'); await page.screenshot({ path: SHOTS + '/dashboard-dark-' + size + '.png' });
  await page.click('#btn-settings'); await page.click('#xp-mgmt'); await noHScroll(page, size + ' 다크 설정'); await page.screenshot({ path: SHOTS + '/admin-settings-dark-' + size + '.png', fullPage: true });
  await page.click('#row-display'); await page.waitForSelector('#dd-h'); await noHScroll(page, size + ' 다크 화면 설정'); await page.screenshot({ path: SHOTS + '/admin-display-dark-' + size + '.png', fullPage: true });
  await page.click('#btn-back'); await page.click('#row-plan'); await page.waitForSelector('#plan-h');
  for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) await openCard(page, k);
  await noHScroll(page, size + ' 다크 훈련 계획'); await page.screenshot({ path: SHOTS + '/admin-plan-dark-' + size + '.png', fullPage: true });
  await page.close();
}
await done(browser);
