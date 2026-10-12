// 훈련하는 분 화면: 큰 버튼 하나, 하단 메뉴 없음, 게임 사이 쉬는 화면과 자동 넘김, 처음으로 하나, 톱니바퀴 확인, 쉬는 날, 점검 날, 점수 숨김.
// 체험 모드(훈련하는 분 역할)로 돌려요. 사용법은 tests/README.md
import { BASE, SHOTS, done, errors, finishGame, launch, must, newPage, noHScroll, out, startDemo, vis } from './e2e-lib.mjs';
const browser = await launch();
const plan = o => ({ 'bw.localdb': { 'state/plan': o } });

/* ---------- 1) 기본 홈 + 톱니바퀴 ---------- */
{
  const { page } = await newPage(browser, { tag: 'home' });
  await startDemo(page);
  must(!(await vis(page, '#navbar')) && (await page.locator('.nav-item').count()) === 0, '하단 메뉴가 없어요');
  must(/^\d{1,2}월 \d{1,2}일 [일월화수목금토]요일$/.test((await page.innerText('#hello')).replace(/\s+/g, ' ').trim()), '홈 날짜 한 줄 (연도 없음)');
  must((await page.innerText('#btn-main')).trim() === '오늘 훈련 시작' && /^게임 5개 · 약 \d+분$/.test((await page.innerText('#main-sub')).trim()), '큰 버튼 "오늘 훈련 시작" + 게임 5개 · 약 N분');
  must((await page.locator('#btn-main').boundingBox()).height >= 120, '큰 버튼 높이 120px 이상');
  must(!(await vis(page, '#btn-settings')) && await vis(page, '#btn-gear'), '설정은 글자 없는 톱니바퀴만');
  must((await page.getAttribute('#btn-gear', 'aria-label')) === '설정 (가족용)', '톱니바퀴 aria-label');
  must((await page.locator('#screen .card').count()) <= 2 && !(await vis(page, '#btn-checkin')) && !(await vis(page, '#install-card')), '홈에는 카드 하나(와 가족 한마디)뿐');
  await noHScroll(page, '홈');
  must(await vis(page, '#cheer-card') && await vis(page, '#btn-family-chat') && (await page.locator('#btn-family-chat').boundingBox()).height >= 64, '홈: "가족 대화" 버튼은 늘 있어요 (체험 모드에서도)');
  await page.screenshot({ path: SHOTS + '/learner-home.png' });
  await page.click('#btn-family-chat'); await page.waitForSelector('#chat-h');
  must((await page.innerText('#screen')).includes('가족방을 만들거나') && (await page.innerText('#btn-back')).includes('처음으로'), '체험 모드의 가족 대화: 가족방 안내 + "처음으로"');
  await page.click('#btn-back'); await page.waitForSelector('#btn-main');
  await page.click('#btn-gear'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-title')) === '설정을 열까요?' && (await page.innerText('#dlg-text')).includes('가족이 도와줄 때만'), '톱니바퀴: 확인 창');
  await page.click('#dlg-btn-0'); await page.waitForTimeout(100);
  must((await page.innerText('#appbar-title')) === '오늘의 두뇌 산책' && !(await vis(page, '#set-main-h')), '"닫기"를 누르면 홈에 그대로');
  await page.click('#btn-gear'); await page.click('#dlg-btn-1'); await page.waitForSelector('#set-main-h');
  must((await page.innerText('#set-main-h')).includes('이 기기는 아버지 훈련용이에요'), '설정 열기: 훈련용 기기 안내');
  must((await page.locator('#btn-set-home').count()) === 1 && !(await vis(page, '#alarm-time')), '훈련하는 분 설정: 처음으로 버튼, 알람·역할 바꾸기 없음');
  await page.screenshot({ path: SHOTS + '/learner-settings.png', fullPage: true });
  await page.click('#btn-set-home'); await page.waitForSelector('#btn-main');
  await page.close();
}

/* ---------- 2) 2개짜리 코스: 쉬는 화면 → 5초 뒤 저절로 다음 → 생활 체크 건너뛰기 → 축하 → 처음으로 하나 ---------- */
{
  const { page } = await newPage(browser, { tag: 'course2', seed: plan({ gamesPerDay: 2, autoNextSec: 5 }) });
  await page.clock.install();
  await startDemo(page);
  must(/^게임 2개 · 약 \d+분$/.test((await page.innerText('#main-sub')).trim()), '계획대로 게임 2개');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must((await page.innerText('#appbar-title')) === '오늘의 훈련 1/2', '게임 제목 "오늘의 훈련 1/2"');
  must(!/단계/.test(await page.innerText('.prog-label >> nth=1')), '점수 숨김: 게임 중 "n단계" 없음');
  await noHScroll(page, '게임');
  await finishGame(page);
  await page.waitForSelector('#brk-h');
  must(/^다음은 ‘.+’(예요|이에요)$|^다음은 ‘.+’ 게임이에요$/.test((await page.innerText('#brk-next .t-title')).trim()), '쉬는 화면: "다음은 ‘…’예요"');
  must(!(await vis(page, '#brk-score')), '쉬는 화면: 점수는 숨김');
  must((await page.locator('#screen .btn.filled').count()) === 1 && (await page.innerText('#btn-brk-next')) === '다음', '쉬는 화면: 주 버튼은 "다음" 하나');
  must((await page.locator('#btn-brk-next').boundingBox()).height >= 96, '"다음" 버튼 96px 이상');
  await noHScroll(page, '쉬는 화면');
  await page.screenshot({ path: SHOTS + '/learner-between-games.png' });
  await page.clock.runFor(3500);
  must(/\d초 뒤에 저절로 시작해요/.test(await page.innerText('#brk-count')), '읽어 준 뒤 카운트다운이 시작돼요');
  await page.clock.runFor(1500);
  must(/오늘의 훈련 1\/2/.test(await page.innerText('#appbar-title')) === false, '5초가 지나자 저절로 다음으로 넘어가요 (쉬는 화면 아님)');
  await page.waitForSelector('#g-title');
  must((await page.innerText('#appbar-title')) === '오늘의 훈련 2/2', '두 번째 게임이 저절로 시작');
  await finishGame(page);
  await page.waitForSelector('#ci-h');
  must((await page.innerText('#screen')).includes('건너뛰어도 괜찮아요') && (await page.innerText('#btn-ci-save')) === '저장하고 마치기', '마지막 게임 뒤: 생활 체크가 흐름 안에 (쉬는 화면 없이)');
  await page.screenshot({ path: SHOTS + '/learner-checkin-flow.png' });
  await page.click('#btn-ci-skip'); await page.waitForSelector('#done-h');
  must((await page.innerText('#done-h')).includes('오늘 훈련을 모두 마치셨어요'), '축하 화면');
  must((await page.locator('#screen .btn').count()) === 1 && (await page.innerText('#btn-done-home')) === '처음으로', '끝 화면: 버튼은 "처음으로" 하나');
  must(!/정답률|정답/.test(await page.innerText('#screen')), '점수 숨김: 끝 화면에 점수 없음');
  await noHScroll(page, '끝 화면');
  await page.screenshot({ path: SHOTS + '/learner-end.png' });
  await page.click('#btn-done-home'); await page.waitForSelector('#btn-main');
  must((await page.innerText('#btn-main')).trim() === '오늘 완료 ✓' && (await page.innerText('#main-sub')).includes('내일 또 만나요'), '홈: 오늘 완료 ✓');
  await page.click('#btn-main'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-title')) === '오늘 훈련을 다 하셨어요', '완료 후 누르면 "한 번 더" 확인');
  await page.click('#dlg-btn-0'); await page.waitForTimeout(100);
  must(await vis(page, '#btn-main'), '"아니요, 쉴게요"');
  // 진행 현황이 기록돼요 (체험 모드에서는 이 기기의 로컬 문서)
  const prog = await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('bw.localdb')); const k = Object.keys(db).find(x => x.startsWith('progress/')); return k ? db[k] : null; });
  must(prog && prog.status === 'done' && prog.results.length === 2 && prog.planned.length === 2 && prog.kind === 'course', '진행 문서: 2개 모두 끝남 (planned 2, results 2, done)');
  await page.close();
}

/* ---------- 3) 3개짜리: 화면을 누르면 저절로 넘어가기가 멈춰요 → 오늘은 여기까지 → 이어서 하기 ---------- */
{
  const { page } = await newPage(browser, { tag: 'course3', seed: plan({ gamesPerDay: 3, autoNextSec: 10 }) });
  await page.clock.install();
  await startDemo(page);
  await page.click('#btn-main'); await finishGame(page); await page.waitForSelector('#brk-h');
  await page.clock.runFor(3500);
  must(/초 뒤에 저절로 시작해요/.test(await page.innerText('#brk-count')), '카운트다운 중');
  await page.click('#brk-h');
  must((await page.innerText('#brk-count')).includes('‘다음’을 누르면 시작해요.'), '배경을 누르면 멈추고 안내가 바뀌어요');
  await page.clock.runFor(30000);
  must(await vis(page, '#btn-brk-next') && !(await vis(page, '#g-title')), '멈춘 뒤에는 저절로 넘어가지 않아요');
  await page.click('#btn-brk-stop'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-title')) === '오늘은 여기까지 할까요?', '오늘은 여기까지: 확인 창');
  await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-main');
  must((await page.innerText('#btn-main')).trim() === '이어서 하기' && (await page.innerText('#main-sub')).trim() === '3개 중 1개 했어요', '홈: 이어서 하기 · 3개 중 1개 했어요');
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must((await page.innerText('#appbar-title')) === '오늘의 훈련 2/3', '이어서 하면 둘째 게임부터');
  await page.click('#btn-quit'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-title')) === '게임을 그만둘까요?', '게임 중 그만하기: "게임을 그만둘까요?"');
  await page.click('#dlg-btn-0');
  await page.close();
}

/* ---------- 4) 자동 넘김 끔 ---------- */
{
  const { page } = await newPage(browser, { tag: 'auto0', seed: plan({ gamesPerDay: 2, autoNextSec: 0 }) });
  await page.clock.install();
  await startDemo(page);
  await page.click('#btn-main'); await finishGame(page); await page.waitForSelector('#brk-h');
  await page.clock.runFor(30000);
  must((await page.innerText('#brk-count')).trim() === '' && await vis(page, '#btn-brk-next'), '자동 넘김 끔: 카운트다운 없이 "다음"을 기다려요');
  await page.click('#btn-brk-next'); await page.waitForSelector('#g-title');
  must((await page.innerText('#appbar-title')) === '오늘의 훈련 2/2', '"다음"을 누르면 시작');
  await page.close();
}

/* ---------- 5) 점수 보이기 켬 ---------- */
{
  const { page } = await newPage(browser, { tag: 'score', seed: plan({ gamesPerDay: 2, autoNextSec: 0, showScore: true, checkin: false }) });
  await startDemo(page);
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must(/\d단계/.test(await page.innerText('.prog-label >> nth=1')), '점수 켬: 게임 중 "n단계"');
  await finishGame(page); await page.waitForSelector('#brk-h');
  must(/^정답 (\d+) \/ \1$/.test((await page.innerText('#brk-score')).trim()), '점수 켬: 쉬는 화면에 정답 수');
  await page.click('#btn-brk-next'); await finishGame(page);
  await page.waitForSelector('#done-h');
  must(/평균 정답률/.test(await page.innerText('#screen')), '점수 켬: 끝 화면에 평균 정답률 (생활 체크 끔이라 바로 축하)');
  await page.close();
}

/* ---------- 6) 쉬는 날 ---------- */
{
  const today = new Date().getDay(), wd = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== today);
  const { page } = await newPage(browser, { tag: 'rest', seed: plan({ weekdays: wd }) });
  await startDemo(page);
  must((await page.innerText('#btn-main')).trim() === '가볍게 해 보기' && /오늘은 쉬는 날이에요\. 다음 훈련은 [일월화수목금토]요일이에요\./.test(await page.innerText('#main-sub')), '쉬는 날: "가볍게 해 보기" + 다음 훈련 요일');
  await page.screenshot({ path: SHOTS + '/learner-restday.png' });
  await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must(true, '쉬는 날에도 가볍게 해 볼 수 있어요');
  await page.close();
}

/* ---------- 7) 점검 날 ---------- */
{
  const ago = new Date(Date.now() - 30 * 864e5), ds = ago.getFullYear() + '-' + String(ago.getMonth() + 1).padStart(2, '0') + '-' + String(ago.getDate()).padStart(2, '0');
  const { page } = await newPage(browser, { tag: 'check', seed: { 'bw.assess': [{ id: '1', date: ds, ts: ago.getTime(), scores: { memory: 60, attention: 60, executive: 60, orientation: 60, speed: 60 }, total: 60 }] } });
  await startDemo(page);
  must((await page.innerText('#btn-main')).trim() === '오늘 점검 시작' && (await page.innerText('#main-sub')).includes('한 달에 한 번 하는 두뇌 점검이에요'), '점검 날: "오늘 점검 시작"');
  await page.click('#btn-main'); await page.waitForSelector('#ci-intro-h');
  must((await page.innerText('#ci-intro-h')).includes('오늘은 두뇌 점검 날이에요') && await vis(page, '#btn-check-skip'), '점검 안내 화면');
  await page.screenshot({ path: SHOTS + '/learner-check-intro.png' });
  await page.click('#btn-check-skip'); await page.waitForSelector('#g-title');
  must((await page.innerText('#appbar-title')).startsWith('오늘의 훈련'), '"오늘은 평소 훈련만 할게요": 평소 코스로');
  await page.click('#btn-quit'); await page.click('#dlg-btn-1'); await page.waitForSelector('#btn-main');
  must((await page.innerText('#btn-main')).trim() !== '오늘 점검 시작', '그날은 점검을 다시 내밀지 않아요');
  await page.close();
}

/* ---------- 8) 점검을 끄면: 점검 안내도, 첫 점검 권유도 없어요 ---------- */
{
  const { page } = await newPage(browser, { tag: 'checkoff', seed: Object.assign(plan({ checkEveryWeeks: 0 }), { 'bw.offered': false }) });
  await startDemo(page);
  await page.waitForTimeout(300);
  must(!(await vis(page, '.dialog')) && (await page.innerText('#btn-main')).trim() === '오늘 훈련 시작', '점검을 끄면 첫 점검 권유도 없어요');
  await page.close();
}

/* ---------- 9) 점검을 마친 날의 "한 번 더": 점검 과제가 아니라 오늘의 코스 ---------- */
{
  const n = new Date(), today = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  const planned = ['words', 'odd', 'shop', 'today', 'flash', 't_words', 't_trails_a', 't_trails_b', 't_digits', 't_reaction', 't_stroop', 't_fluency', 't_delayed'];
  const results = planned.map(g => ({ g, acc: 1, c: 1, t: 1, sec: 30, lv: 1, ts: Date.now() - 6e5 }));
  const prog = { userId: 'local', date: today, v: 1, kind: 'check', planned, idx: 13, current: null, currentTs: null, results, status: 'done', startTs: Date.now() - 9e5, updatedTs: Date.now() - 6e5, doneTs: Date.now() - 6e5, sts: Date.now() - 6e5 };
  const { page } = await newPage(browser, { tag: 'checkreplay', seed: { 'bw.localdb': { ['progress/' + today + '-local']: prog } } });
  await startDemo(page);
  must((await page.innerText('#btn-main')).trim() === '오늘 완료 ✓', '점검을 마친 날: "오늘 완료 ✓"');
  await page.click('#btn-main'); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-1'); await page.waitForSelector('#g-title');
  const st = await page.evaluate(() => ({ title: document.getElementById('appbar-title').innerText, games: window.__S.course.games, id: window.__S.sess.g.id, assess: window.__S.sess.assess }));
  must(st.games.length === 5 && st.games.every(g => !/^t_/.test(g)) && !st.assess && /^오늘의 훈련 1\/5$/.test(st.title), '"한 번 더"는 오늘의 코스 5개 (점검 과제 아님) ' + JSON.stringify(st));
  await page.close();
}
await done(browser);
