// AI 문제 은행 (앱 쪽) 화면 시험: 안내 한 번, 문항 기록 모양, 묶음 꺼내기와 대체, 기준 문항 정답 숨김, 새 게임, 이야기 늦게 묻기, 잊지 말고 누르기, XSS, 가장 큰 글자.
// 체험 모드(예시 자료)로 돌려요. 사용법은 tests/README.md
import { finishGame } from './e2e-lib.mjs';
import { ACK, SHOTS, bk, choiceItem, done, errors, launch, logsOf, measure, measureItems, must, newPage, noHScroll, noSeed, out, pack, packItems, planOf, playGame, readDb, solveRound, startDemo, vis, ymdNow } from './e2e-ai-lib.mjs';
const browser = await launch();
const NEUTRAL = '잘하셨어요, 다음 문제로 가요.';
const KEYS = ['v', 'userId', 'date', 'ts', 'sts', 'gameId', 'inCourse', 'level', 'speechOn', 'size', 'device', 'hour', 'abandoned', 'items'];
const ITEM_KEYS = ['id', 'role', 'fmt', 'cd', 'lv', 'score', 'ok', 'rt', 'rtStart', 'err', 'pick', 'intr', 'pos'];
const openCourse = async (page) => { await startDemo(page); await page.waitForSelector('#btn-main'); await page.click('#btn-main'); await page.waitForSelector('#g-title'); if (await vis(page, '.dialog')) await page.click('#dlg-btn-0'); };

/* ---------- 1) 안내 화면: 처음 한 번만, 문구·소리·서버 시각 ---------- */
{
  const { page } = await newPage(browser, { tag: 'consent', seed: { 'bw.aiDemo': true } });
  await startDemo(page);
  await page.waitForSelector('#cons-h');
  must((await page.innerText('#cons-h')) === '가족이 함께 살펴볼게요', '안내: 제목');
  const body = await page.innerText('.consent');
  must(body.includes('아버지가 푸신 문제의 맞힌 개수와 걸린 시간을 가족이 살펴봐요.') && body.includes('컴퓨터 프로그램(AI)이 숫자만 보고 가족에게 쉬운 설명을 써 줘요.') && body.includes('아버지 이름이나 하신 말씀은 보내지 않아요. 이 프로그램은 외국 회사 서버에서 돌아가요.') && body.includes('병을 판단하는 것이 아니에요.') && body.includes('싫으시면 언제든 가족에게 말씀해 주세요.'), '안내: §8.6 문구 그대로');
  must((await page.innerText('#btn-consent-ok')) === '알겠어요' && (await page.locator('#btn-consent-ok').boundingBox()).height >= 64, '안내: 큰 "알겠어요" 버튼');
  await noHScroll(page, '안내'); await page.screenshot({ path: SHOTS + '/ai-consent.png' });
  await page.click('#btn-consent-ok'); await page.waitForSelector('#btn-main');
  const c = (await readDb(page))['consents/local'];
  must(c && c.kind === 'ai-report-notice' && c.version === '2026-11-v1' && typeof c.ackTs === 'number' && c.withFamily === undefined && !c.withdrawnTs, '안내: consents/{id} 에 kind·version·ackTs 기록');
  await page.reload(); await page.waitForSelector('#btn-main', { timeout: 8000 });
  must(!(await vis(page, '#cons-h')) && (await page.evaluate(() => window.__S.screen)) === 'home', '안내: 다시 열어도 또 나오지 않아요 (한 번만)');
  await page.close();
  // 가족과 함께 봤어요 + 철회 뒤에는 다시
  const { page: p2 } = await newPage(browser, { tag: 'consent2', seed: { 'bw.aiDemo': true } });
  await startDemo(p2); await p2.waitForSelector('#cons-h'); await p2.click('#btn-consent-fam'); await p2.waitForSelector('#btn-main');
  must((await readDb(p2))['consents/local'].withFamily === true, '안내: "가족과 함께 봤어요" 는 withFamily:true');
  await p2.evaluate(async () => { const m = await import(location.origin + '/brain-walk/js/ai/consent.js'); await m.withdraw(); });
  must(!!(await readDb(p2))['consents/local'].withdrawnTs, '철회: withdrawnTs 만 더해요 (문서는 남아요)');
  await p2.reload(); await p2.waitForSelector('#btn-main', { timeout: 8000 }); await p2.waitForTimeout(800);
  must(!(await vis(p2, '#cons-h')), '철회한 뒤에는 열 때마다 다시 묻지 않아요');
  await p2.evaluate(() => window.__go('settings')); await p2.waitForSelector('#btn-ai-again');
  must((await p2.innerText('#aic-state')).includes('멈춰 있어요') && !(await vis(p2, '#btn-ai-withdraw')), '설정: 멈춰 있다고 보이고 "다시 살펴봐도 돼요" 버튼');
  await p2.click('#btn-ai-again'); await p2.waitForSelector('#cons-h');
  await p2.click('#btn-consent-ok'); await p2.waitForSelector('#btn-main');
  const c2 = (await readDb(p2))['consents/local'];
  must(!c2.withdrawnTs && c2.version === '2026-11-v1', '다시 알겠어요: 철회 표시를 지우고 다시 기록');
  await p2.close();
}

/* ---------- 2) 단어 기억하기: 은행에서 꺼내고, 기록 모양, 기준 문항은 정답을 알리지 않아요 ---------- */
{
  const { page } = await newPage(browser, { tag: 'words', seed: planOf('words') });
  await openCourse(page);
  const packW = (await packItems(page, 'memory-L1')).concat(await packItems(page, 'memory-L2'));
  const ids = new Set(packW.map(i => i.id));
  const shown0 = await page.$$eval('#shown .chip', els => els.map(e => e.textContent));
  must(packW.some(i => JSON.stringify(i.body.targets) === JSON.stringify(shown0)), '첫 문제: 은행의 낱말 목록(' + shown0.join(',') + ')을 보여 줘요');
  const fbs = [];
  const kinds = await playGame(page, { onRound: async (i) => { fbs.push({ fb: await page.innerText('#fb-card'), marks: await page.locator('#box .right, #box .missed, #box .wrongpick').count() }); } });
  must(fbs[1].fb === NEUTRAL && fbs[1].marks === 0, '기준·앵커 문항: "잘하셨어요, 다음 문제로 가요." 만, 맞고 틀림 표시 없음 (' + fbs[1].fb + ')');
  must(fbs[0].fb !== NEUTRAL && fbs[0].marks > 0, '훈련 문항: 맞고 틀림을 알려 줘요');
  must(kinds.length === 3 && kinds[1] === 'words', '3문제를 풀었어요');
  const logs = await logsOf(page);
  must(logs.length === 1, '게임 한 판 = 문서 하나 (' + logs.length + ')');
  const L = logs[0];
  must(Object.keys(L).filter(k => k !== '_id').every(k => KEYS.includes(k)) && ['v', 'userId', 'date', 'ts', 'sts', 'gameId', 'items'].every(k => k in L), '문서 키가 계약과 같아요');
  must(L.v === 1 && L.userId === 'local' && L.gameId === 'words' && L.inCourse === true && /^\d{4}-\d{2}-\d{2}$/.test(L.date) && typeof L.ts === 'number' && typeof L.sts === 'number', 'v/userId/gameId/inCourse/date/ts/sts');
  must(Number.isInteger(L.hour) && L.hour >= 0 && L.hour <= 23 && L.abandoned === false && typeof L.speechOn === 'boolean' && typeof L.size === 'string' && L.size.length <= 10 && ['android', 'ios', 'desktop'].includes(L.device) && typeof L.level === 'number', 'hour/abandoned/speechOn/size/device/level');
  must(L.items.length === 3 && L.items.every(it => Object.keys(it).every(k => ITEM_KEYS.includes(k))), '문항 3개, 키는 계약 안에서');
  const [a, b, c] = L.items;
  must(a.role === 'training' && a.fmt === 'word_recog' && a.cd === 'memory' && /^bk_[0-9a-f]{20}$/.test(a.id) && a.score === 1 && a.ok === true && a.pos === 0 && Array.isArray(a.err) && Array.isArray(a.pick) && a.pick.length === shown0.length && typeof a.rt === 'number' && a.intr === false, '첫 문항: 훈련·word_recog·memory·score 1·pos 0·pick');
  must(['reference', 'anchor'].includes(b.role) && b.pos === 1 && /^bk_/.test(b.id), '둘째 문항은 기준·앵커 문항 (첫 문제 다음 자리, role ' + b.role + ')');
  must(c.pos === 2 && c.role === 'training', '셋째 문항: 훈련');
  must(new Set(L.items.map(x => x.id)).size === 3, '같은 문항이 되풀이되지 않아요');
  must(a.rtStart === 'display' && a.rt >= 0, 'rt: 소리 목소리가 없으면 화면이 보인 때부터 (rtStart display)');
  must(a.cd === 'memory' && ids.has(a.id) && ids.has(c.id), '훈련 문항 id 는 묶음에 있던 것');
  await page.close();
}

/* ---------- 3) 기준·앵커 문항 (장보기): 정답을 알리지 않고, 앵커는 저장된 모양 그대로 ---------- */
{
  const shopQ = (name, prompt, choices, o = {}) => bk(Object.assign({ format: 'shop_calc', cdomain: 'executive', level: 3, prompt, body: { scene: name, shops: [{ name: '채소 가게', lines: [{ item: '두부', price: 2000, qty: 1, unit: '모' }, { item: '콩나물', price: 1000, qty: 2, unit: '봉지' }] }], ask: 'total' }, choices }, o));
  const anchor = shopQ('동네 시장', '합계는 얼마일까요?', [{ t: '3,000원', err: 'CALC_NOQTY' }, { t: '4,000원', ok: true }, { t: '5,000원', err: 'CALC_NEAR' }], { role: 'anchor', noFeedback: true });
  const ref = shopQ('마트', '합계는 얼마일까요?', [{ t: '6,000원', err: 'CALC_NEAR' }, { t: '4,000원', ok: true }, { t: '2,000원', err: 'CALC_STEP_SKIP' }], { role: 'reference', noFeedback: true });
  const train = shopQ('시장', '합계는 얼마일까요?', [{ t: '4,000원', ok: true }, { t: '3,000원', err: 'CALC_NOQTY' }, { t: '5,000원', err: 'CALC_NEAR' }], { level: 1 });
  const { page } = await newPage(browser, { tag: 'measure', seed: planOf('shop', Object.assign({}, noSeed(), pack('executive', 1, [train, Object.assign({}, train, { id: 'bk_' + 'a'.repeat(20) })]), measure([ref], [anchor]))) });
  await openCourse(page);
  const shots = [];
  await playGame(page, { onRound: async (i, kind) => { shots.push({ i, kind, fb: await page.innerText('#fb-card'), right: await page.locator('#box .choice.right, #box .choice[data-tag*="정답"]').count(), sel: await page.locator('#box .choice.sel').count(), order: await page.$$eval('#box .choice', els => els.map(e => e.textContent)) }); } });
  must(shots.length === 5, '장보기 5문제');
  must(shots[1].fb === NEUTRAL && shots[1].right === 0 && shots[1].sel === 1, '앵커 문항: 정답 표시 없이 "잘하셨어요, 다음 문제로 가요." (고른 것만 중립 표시)');
  must(JSON.stringify(shots[1].order) === JSON.stringify(['3,000원', '4,000원', '5,000원']), '앵커 문항: 저장된 보기 순서 그대로 (섞지 않아요)');
  must(shots[2].fb === NEUTRAL && shots[2].right === 0 && JSON.stringify(shots[2].order) === JSON.stringify(['6,000원', '4,000원', '2,000원']), '기준 문항: 정답을 알리지 않아요');
  must(shots[0].fb !== NEUTRAL && shots[0].right === 1, '훈련 문항: 정답을 알려 줘요');
  const L = (await logsOf(page))[0], it = L.items;
  must(it[1].role === 'anchor' && it[1].pos === 1 && it[1].err.join() === 'CALC_NOQTY' && it[1].pick.join() === '0' && it[1].ok === false && it[1].score === 0 && it[1].fmt === 'shop_calc' && it[1].cd === 'executive', '앵커 기록: role anchor, 고른 보기의 err(CALC_NOQTY)·pick [0]');
  must(it[2].role === 'reference' && it[2].pos === 2 && it[2].err.join() === 'CALC_NEAR' && it[2].pick.join() === '0', '기준 기록: role reference, err CALC_NEAR');
  must(it[0].role === 'training' && it[0].ok === true && it[0].score === 1 && it[0].lv === 1, '훈련 기록: ok, lv 1');
  must(it.length === 5 && it[3].role === 'training' && it[4].role === 'training' && /^code:shop:L\d:4$/.test(it[4].id) && it[4].fmt === 'shop' && it[4].cd === 'executive', '묶음이 바닥나면 코드가 만든 문항(role training, id code:…, fmt=게임 id)으로 이어져요');
  await page.close();
}

/* ---------- 4) 묶음이 없거나 문항이 깨졌을 때: 코드가 만든 문항 (앱은 멈추지 않아요) ---------- */
{
  const { page } = await newPage(browser, { tag: 'fallback', seed: planOf('words', noSeed()) });
  await openCourse(page);
  await playGame(page);
  const L = (await logsOf(page))[0];
  must(L.items.length === 3 && L.items.every(i => i.role === 'training' && i.fmt === 'words' && i.cd === 'memory' && /^code:words:L\d:\d$/.test(i.id)), '묶음이 비어 있으면 코드 문항: role training, id code:words:… (속도 과제만 proc)');
  must(L.items.every(i => typeof i.score === 'number' && typeof i.ok === 'boolean' && Array.isArray(i.err) && Array.isArray(i.pick)), '코드 문항도 같은 모양으로 기록');
  await page.close();
  const bad = bk({ format: 'word_recog', cdomain: 'memory', level: 1, body: {} });
  const { page: p2 } = await newPage(browser, { tag: 'fallback2', seed: planOf('words', Object.assign({}, noSeed(), pack('memory', 1, [bad]))) });
  await openCourse(p2);
  const k = await playGame(p2);
  const L2 = (await logsOf(p2))[0];
  must(k.length === 3 && L2.items[0].role === 'training' && /^code:words:/.test(L2.items[0].id), '깨진 문항: 그리지 못하면 코드 문항으로 이어져요 (게임이 멈추지 않아요)');
  await p2.close();
  // 이웃 단계: 게임 1단계인데 1단계 칸이 비어 있고 2단계에 있으면 2단계 문항을 써요 (정확한 단계를 기록)
  const w2 = bk({ format: 'word_recog', cdomain: 'memory', level: 2, prompt: null, body: { targets: ['감자', '당근', '오이', '호박'], foils: [{ t: '의자', err: 'INTR_UNREL' }, { t: '기차', err: 'INTR_UNREL' }, { t: '우산', err: 'INTR_UNREL' }, { t: '시계', err: 'INTR_UNREL' }] }, present: { grid: ['의자', '감자', '기차', '당근', '우산', '오이', '시계', '호박'] } });
  const { page: p3 } = await newPage(browser, { tag: 'neighbor', seed: planOf('words', Object.assign({}, noSeed(), pack('memory', 2, [w2]))) });
  await openCourse(p3);
  const shown = await p3.$$eval('#shown .chip', els => els.map(e => e.textContent));
  must(JSON.stringify(shown) === JSON.stringify(['감자', '당근', '오이', '호박']), '이웃 단계(2단계) 문항을 써요');
  const grid = await p3.evaluate(() => { document.querySelector('#btn-memorized').click(); return [...document.querySelectorAll('#pool .chip')].map(c => c.dataset.w); });
  must(JSON.stringify(grid) === JSON.stringify(['의자', '감자', '기차', '당근', '우산', '오이', '시계', '호박']), '확인 화면의 낱말 순서는 묶음의 present.grid 그대로');
  await p3.close();
}

/* ---------- 5) 영역·단계로 꺼내기, 본 문항은 다시 안 나와요, 날짜 범위 밖 문항은 건너뛰어요 ---------- */
{
  const today = ymdNow(), yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const dq = (prompt, ans, o = {}) => bk(Object.assign({ format: 'date_q', cdomain: 'orientation', level: 3, prompt, body: { query: { type: 'season_of', ref: 'today' } }, choices: [{ t: '봄', err: 'SEASON' }, { t: ans, ok: true }, { t: '겨울', err: 'SEASON' }], validFrom: today, validTo: today }, o));
  const old = dq('지난 날짜 문항', '여름', { validFrom: yest, validTo: yest }), cur = dq('오늘 날짜 문항', '가을');
  const { page: p } = await newPage(browser, { tag: 'datewin', seed: Object.assign(planOf('today', Object.assign({}, noSeed(), pack('orientation', 3, [old, cur]))), {}) });
  await startDemo(p);
  // 오늘은 며칠? 게임을 3단계 고정으로
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('bw.localdb')); db['state/plan'].games.today = { on: true, mode: 'fixed', level: 3 }; localStorage.setItem('bw.localdb', JSON.stringify(db)); });
  await p.reload(); await p.waitForSelector('#btn-main'); await p.click('#btn-main'); await p.waitForSelector('#g-title');
  const seen = [];
  await playGame(p, { onRound: async () => { seen.push(await p.innerText('#prompt')); } });
  must(seen.includes('오늘 날짜 문항') && !seen.includes('지난 날짜 문항'), '날짜 문항: 범위(validFrom~validTo) 안의 것만 써요 (' + seen[1] + ')');
  must(seen.filter(t => t === '오늘 날짜 문항').length === 1, '본 문항은 다시 나오지 않아요');
  const L = (await logsOf(p))[0];
  must(L.level === 3 && L.items.filter(i => i.fmt === 'date_q').length === 1 && L.items.find(i => i.fmt === 'date_q').cd === 'orientation' && L.items.find(i => i.fmt === 'date_q').lv === 3, '영역(orientation)·단계(3)로 꺼내요');
  must(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bw.aiSeen') || '{}')).length) >= 1, '쓴 문항은 기기에 기억해요 (bw.aiSeen)');
  // 묶음은 기기에도 저장돼서 오프라인에서 써요
  await p.waitForTimeout(1200);   // 저장은 0.8초 모아서 해요
  must(await p.evaluate(() => !!JSON.parse(localStorage.getItem('bw.aiPacks') || 'null') && Object.keys(JSON.parse(localStorage.getItem('bw.aiPacks')).packs).includes('orientation-L3')), '받은 묶음을 localStorage(bw.aiPacks)에 저장');
  await p.close();
}

/* ---------- 6) 새 게임 여섯 개: 기본 계획에는 없고, 켜면 큰 버튼으로 끝까지 할 수 있어요 ---------- */
{
  const { page } = await newPage(browser, { tag: 'newgames-default', seed: { 'bw.aiDemo': true, 'bw.localdb': { 'consents/local': ACK() } } });
  await startDemo(page); await page.waitForSelector('#btn-main');
  const games = await page.evaluate(() => { const c = window.__S.plan; return Object.keys(c.games).filter(k => c.games[k].on); });
  must(!['story', 'shapes', 'route', 'think', 'letters', 'olden'].some(g => games.includes(g)) && games.length === 9, '기본 계획: 새 게임 여섯 개는 꺼져 있고 기존 아홉 개만 켜져 있어요 (' + games.length + ')');
  const course = await page.evaluate(async () => { const m = await import(location.origin + '/brain-walk/js/program.js'); const r = await import(location.origin + '/brain-walk/js/games/registry.js'); return { ids: r.GAME_ORDER, c: m.buildCourse(null, '2027-03-15', r.catalog()) }; });
  must(course.ids.slice(-6).join() === 'story,shapes,route,think,letters,olden' && course.c.length === 5 && !course.c.some(g => ['story', 'shapes', 'route', 'think', 'letters', 'olden'].includes(g)), '새 게임은 목록 끝에 덧붙고, 기본 코스는 그대로 5개');
  await page.close();
}
const NEW = [
  { id: 'story', name: '이야기 듣기', fmts: ['story_recall'] },
  { id: 'shapes', name: '모양 퍼즐', fmts: ['grid_memory', 'grid_pattern', 'grid_rotate'] },
  { id: 'route', name: '길 찾기', fmts: ['route'] },
  { id: 'think', name: '생각 퍼즐', fmts: ['logic', 'schedule'] },
  { id: 'letters', name: '글자 찾기', fmts: ['letter_search'] },
  { id: 'olden', name: '옛날 이야기', fmts: ['reminiscence'] }
];
for (const g of NEW.flatMap(x => [x, Object.assign({}, x, { dark: true })])) {
  const { page } = await newPage(browser, { tag: g.id + (g.dark ? '-dark' : ''), w: 360, dark: !!g.dark, seed: Object.assign(planOf(g.id), { 'bw.size': 'max' }) });
  await startDemo(page); await page.waitForSelector('#btn-main');
  must((await page.innerText('#main-sub')).includes('게임 1개'), g.name + ': 계획에서 켜면 코스에 들어가요');
  await page.click('#btn-main'); await page.waitForSelector('#g-title'); if (await vis(page, '.dialog')) await page.click('#dlg-btn-0');
  must((await page.innerText('#g-title')) === g.name, g.name + ': 게임 이름');
  await noHScroll(page, g.name + ' 첫 화면(360px 최대 글자' + (g.dark ? '·다크' : '') + ')');
  await page.screenshot({ path: SHOTS + '/ai-game-' + g.id + (g.dark ? '-dark' : '') + '.png' });
  const kinds = [];
  await playGame(page, { onRound: async (i, k) => { kinds.push(k); await noHScroll(page, g.name + ' ' + (i + 1) + '번째 문제 뒤'); } });
  const logs = await logsOf(page), L = logs.find(l => l.gameId === g.id);
  must(L && L.items.length >= 2 && L.items.some(it => g.fmts.includes(it.fmt)), g.name + ': 끝까지 했고 문항 기록에 ' + g.fmts.join('/') + ' (' + (L && L.items.map(i => i.fmt).join(',')) + ')');
  must(L.items.every(it => it.role !== 'proc' || it.fmt === g.id), g.name + ': 은행 문항은 id 가 bk_… 로 기록돼요');
  const real = L.items.filter(it => g.fmts.includes(it.fmt));
  must(real.every(it => /^bk_[0-9a-f]{20}(#q\d)?$/.test(it.id) && ['training', 'reference', 'anchor'].includes(it.role) && Array.isArray(it.pick) && it.pick.length >= 1), g.name + ': 은행 문항 기록 모양 (id, role, pick)');
  await page.close();
}

/* ---------- 7) 이야기 듣기: 바로 묻는 질문은 이야기 직후, 늦게 묻는 질문은 코스의 마지막 게임 뒤 ---------- */
{
  const story = bk({ format: 'story_recall', cdomain: 'memory', level: 1, body: { story: '토요일 아침, 영수 씨는 손녀와 함께 시장에 갔어요. 생선 가게에서 고등어를 샀어요.', facts: [{ slot: 'with', v: '손녀' }, { slot: 'bought', v: '고등어' }], questions: [
    { q: '영수 씨는 누구와 함께 갔나요?', slot: 'with', delayed: false, choices: [{ t: '손녀', ok: true }, { t: '아들', err: 'INTR_SEM' }, { t: '친구', err: 'INTR_UNREL' }] },
    { q: '생선 가게에서 무엇을 샀나요?', slot: 'bought', delayed: false, choices: [{ t: '갈치', err: 'INTR_SEM' }, { t: '고등어', ok: true }, { t: '두부', err: 'INTR_UNREL' }] },
    { q: '영수 씨는 누구와 함께 갔었나요? (다시)', slot: 'with', delayed: true, choices: [{ t: '아들', err: 'INTR_SEM' }, { t: '손녀', ok: true }, { t: '친구', err: 'INTR_UNREL' }] }] } });
  const { page } = await newPage(browser, { tag: 'delayed', w: 360, seed: Object.assign(planOf('story', Object.assign({}, noSeed(), pack('memory', 1, [story]))), { 'bw.size': 'max' }) });
  await openCourse(page);
  await page.waitForSelector('#btn-story-done');
  must((await page.innerText('#story-text')).includes('영수 씨는 손녀와 함께'), '이야기를 보여 줘요 (읽어 드리고 글로도)');
  await page.click('#btn-story-done');
  must((await page.innerText('#prompt')) === '영수 씨는 누구와 함께 갔나요?' && (await page.locator('#story-text').count()) === 0, '이야기는 숨기고 바로 묻는 질문 (늦게 묻는 질문은 아직 안 물어요)');
  await noHScroll(page, '이야기 질문(360px 최대 글자)');
  await page.screenshot({ path: SHOTS + '/ai-story-question.png' });
  await page.locator('.choice').nth(0).click();             // 손녀: 맞음
  await page.click('#btn-q-next'); await page.waitForSelector('.choice:not([disabled])');
  await page.locator('.choice').nth(1).click();             // 고등어: 맞음 (마지막 바로 묻는 질문)
  await page.waitForSelector('#btn-next:not([hidden])');
  must((await page.innerText('#fb-card')).includes('이야기를 잘 기억하셨어요'), '바로 묻는 질문 끝: 칭찬');
  await page.click('#btn-next');                           // 둘째 라운드: 이야기가 더 없어요
  await page.waitForSelector('#btn-next:not([hidden])'); must((await page.innerText('#prompt')).includes('준비된 문제가 아직 없어요'), '은행에 이야기가 더 없으면 "준비된 문제가 아직 없어요"로 부드럽게 넘어가요 (기록 없음)');
  await page.click('#btn-next');
  await page.waitForSelector('#g-title'); must((await page.innerText('#g-title')) === '이야기 다시 떠올리기', '코스의 마지막 게임이 끝나자 늦게 묻는 질문이 이어져요');
  must((await page.innerText('#prompt')) === '영수 씨는 누구와 함께 갔었나요? (다시)', '늦게 묻는 질문 글');
  await page.locator('.choice').nth(0).click();             // 아들: 틀림 (바로는 맞혔어요 → DELAY_LOSS)
  await page.waitForSelector('#btn-next:not([hidden])');
  must((await page.innerText('#btn-next')) === '마치기', '늦게 묻는 질문 끝: "마치기"');
  await page.click('#btn-next'); await page.waitForSelector('#done-h');
  const logs = await logsOf(page);
  const imm = logs.find(l => l.items.some(i => /#q0$/.test(i.id))), del = logs.find(l => l.items.some(i => /#q2$/.test(i.id)));
  must(imm && imm.items.length === 2 && imm.items.every(i => i.fmt === 'story_recall' && i.cd === 'memory' && i.ok === true && i.pos === 0) && /#q0$/.test(imm.items[0].id) && /#q1$/.test(imm.items[1].id), '바로 묻는 질문: 문항마다 기록 한 줄 (bk_…#q0, #q1)');
  must(del && del.gameId === 'story' && del.inCourse === true && del.items.length === 1 && del.items[0].ok === false && del.items[0].err.join() === 'INTR_SEM,DELAY_LOSS', '늦게 묻는 질문: 기록 (#q2), 오답 꼬리표 + DELAY_LOSS (바로는 맞히고 나중에 틀림)');
  await page.close();
}

/* ---------- 8) 잊지 말고 누르기 (🌼 단추) ---------- */
{
  const pm = (o = {}) => bk({ format: 'prospective', cdomain: 'memory', level: 2, body: Object.assign({ cue: '🌼', event: 'after_last_item', instruction: '오늘 마지막 문제가 끝나면 화면 아래 🌼 단추를 눌러 주세요.', reminderMid: false }, o.body || {}) , level: o.level || 2 });
  const mk = async (tag, item, plan) => { const { page } = await newPage(browser, { tag, seed: planOf('words', Object.assign({}, noSeed(), pack('memory', item.level, [item])), null) }); void plan; return page; };
  let page = await mk('pm1', pm());
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('.dialog');
  must((await page.innerText('#dlg-text')).includes('마지막 문제가 끝나면') && (await page.innerText('#dlg-text')).includes('🌼') && (await page.innerText('#dlg-text')).includes('화면 위쪽'), '코스 시작: 부탁 안내 (단추는 위쪽 바에 있어요)');
  await page.click('#dlg-btn-0'); await page.waitForSelector('#g-title');
  must(await vis(page, '#btn-pm-cue') && (await page.locator('#btn-pm-cue').boundingBox()).width >= 56, '🌼 단추가 위쪽 바에 늘 있어요 (크기 56px 이상)');
  await page.click('#btn-pm-cue');                           // 일찍 누르기
  must(/아직이에요/.test(await page.innerText('#snackbar')), '일찍 누르면 "아직이에요"');
  await finishGame(page);
  await page.waitForSelector('#done-h');
  must(await vis(page, '#btn-pm-cue'), '코스가 끝난 화면에도 🌼 단추가 있어요');
  await page.click('#btn-pm-cue');
  await page.waitForTimeout(200);
  let L = (await logsOf(page)).find(l => l.gameId === 'prospective');
  must(L && L.items.length === 1 && L.items[0].fmt === 'prospective' && L.items[0].cd === 'memory' && L.items[0].ok === true && L.items[0].score === 1 && L.items[0].err.length === 0, '마지막에 누르면 맞음: 기록 prospective ok (일찍 한 번 눌렀어도 제때 누르면 맞아요)');
  must(!(await vis(page, '#btn-pm-cue')), '한 코스에 한 번 (누른 뒤에는 단추가 사라져요)');
  await page.close();
  page = await mk('pm2', pm());
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); await page.waitForSelector('#g-title');
  await finishGame(page); await page.waitForSelector('#done-h');
  await page.click('#btn-done-home'); await page.waitForSelector('#btn-main');
  L = (await logsOf(page)).find(l => l.gameId === 'prospective');
  must(L && L.items[0].ok === false && L.items[0].err.join() === 'PM_MISS', '안 누르고 나가면 PM_MISS');
  await page.close();
  page = await mk('pm3', pm({ level: 5 }));
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); await page.waitForSelector('#g-title');
  must(await vis(page, '#btn-pm-other'), '5단계: 닮은 🌻 단추도 함께 있어요');
  await page.click('#btn-pm-other'); await finishGame(page); await page.waitForSelector('#done-h'); await page.click('#btn-pm-cue'); await page.waitForTimeout(200);
  L = (await logsOf(page)).find(l => l.gameId === 'prospective');
  must(L && L.items[0].ok === true && L.items[0].err.join() === 'PM_WRONG_CUE', '다른 단추를 먼저 누르면 PM_WRONG_CUE 를 더해서 기록');
  await page.close();
  // 팩에 이 문항이 없으면 단추도 부탁도 없어요
  page = await newPage(browser, { tag: 'pm4', seed: planOf('words', noSeed()) }).then(x => x.page);
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('#g-title');
  must(!(await vis(page, '.dialog')) && !(await vis(page, '#pm-wrap')), '묶음에 잊지 말고 누르기가 없으면 부탁도 단추도 없어요');
  await page.close();
}

/* ---------- 9) XSS: 은행·리포트의 글은 글자로만 보여요 (<img onerror> 가 실행되지 않아요) ---------- */
{
  const evil = '<img src=x onerror="window.__xss=1">';
  const lc = bk({ format: 'lang_complete', cdomain: 'language', level: 1, prompt: '빈칸에 알맞은 말을 골라 주세요. ' + evil, body: { sentence: '비가 와서 ____ ' + evil, answer: '우산' }, choices: [{ t: '우산' + evil, ok: true }, { t: '모자', err: 'SEM_NEAR' }, { t: '수박', err: 'SEM_FAR' }], explain: '해설 ' + evil });
  const wr = bk({ format: 'word_recog', cdomain: 'memory', level: 1, body: { targets: ['사과' + evil, '두부', '우유'], foils: [{ t: '의자', err: 'INTR_UNREL' }, { t: '구름', err: 'INTR_UNREL' }, { t: '시계', err: 'INTR_UNREL' }] }, present: { grid: ['사과' + evil, '의자', '두부', '구름', '우유', '시계'] } });
  const { page } = await newPage(browser, { tag: 'xss', seed: planOf('proverb', Object.assign({}, noSeed(), pack('language', 1, [lc]), pack('memory', 1, [wr]))) });
  await openCourse(page);
  let found = false;
  await playGame(page, { onRound: async () => { if (await page.locator('#sentence').count()) { found = true; const t = await page.innerText('#sentence'); must(t.includes('<img src=x') && (await page.locator('#box img, #prompt img, #fb img').count()) === 0, '문장 빈칸 문항: <img onerror> 는 글자 그대로 (그림 요소 없음)'); must((await page.innerText('#fb-card')).includes('<img'), '해설도 글자로'); } } });
  must(found, '말 놀이: 은행 문장 완성 문항을 만났어요');
  must(await page.evaluate(() => window.__xss === undefined), '말 놀이: onerror 가 실행되지 않았어요');
  await page.close();
  const { page: p2 } = await newPage(browser, { tag: 'xss2', seed: planOf('words', Object.assign({}, noSeed(), pack('memory', 1, [wr]))) });
  await openCourse(p2);
  const w = await p2.$$eval('#shown .chip', els => els.map(e => e.textContent)); must(w.some(x => x.includes('<img')) && (await p2.locator('#shown img').count()) === 0, '단어 기억: 낱말 칩에도 글자로');
  await p2.click('#btn-memorized'); must((await p2.locator('#pool img').count()) === 0 && await p2.evaluate(() => window.__xss === undefined), '단어 기억: 확인 화면에서도 실행되지 않아요');
  await p2.close();
}

/* ---------- 9-1) XSS: 은행의 주제 카드(card_theme)·이모지 묶음(emoji_set)도 글자로만 (카드 짝 맞추기·다른 그림 찾기·번쩍 찾기) ---------- */
{
  const evil = n => '<img src=x onerror="window.__xss=' + n + '">';
  const cardT = bk({ format: 'card_theme', cdomain: 'memory', level: 1, body: { theme: '과일', cards: [[evil(2), '사과' + evil(3)], ['🍌', '바나나'], ['🍇', '포도']] } });
  const { page } = await newPage(browser, { tag: 'xss-cards', seed: planOf('cards', Object.assign({}, noSeed(), pack('memory', 1, [cardT]))) });
  await openCourse(page);
  for (let i = 0; i < 6; i++) await page.click('#card-' + i).catch(() => {});
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => [...document.querySelectorAll('#board .mcard')].map(b => b.textContent).join(' '));
  must(t.includes('<img') && (await page.locator('#board img').count()) === 0 && await page.evaluate(() => window.__xss === undefined), '카드 짝 맞추기: 은행 카드의 그림·이름은 글자로 (실행 안 됨)');
  await page.close();
  const emo = bk({ format: 'emoji_set', cdomain: 'attention', level: 1, body: { pairs: [[evil(4), '🙂']] } });
  for (const gid of ['odd', 'flash']) {
    const { page: p2 } = await newPage(browser, { tag: 'xss-' + gid, seed: planOf(gid, Object.assign({}, noSeed(), pack('attention', 1, [emo]))) });
    await openCourse(p2);
    if (gid === 'flash') { await p2.click('#btn-ready'); await p2.waitForSelector('#fc-0', { timeout: 5000 }); }
    const txt = await p2.evaluate(() => document.querySelector('#box').textContent);
    must(txt.includes('<img') && (await p2.locator('#box img').count()) === 0 && await p2.evaluate(() => window.__xss === undefined), (gid === 'odd' ? '다른 그림 찾기' : '번쩍 찾기') + ': 은행 이모지 묶음은 글자로 (실행 안 됨)');
    await p2.close();
  }
}

/* ---------- 9-2) 앵커는 12주마다 같은 문항을 다시 풀어요: 예전에 봤어도 이번 주에 안 풀었으면 나와요 ---------- */
{
  const shopQ = (o = {}) => bk(Object.assign({ format: 'shop_calc', cdomain: 'executive', level: 1, prompt: '합계는 얼마일까요?', body: { scene: '시장', shops: [{ name: '채소 가게', lines: [{ item: '두부', price: 2000, qty: 1, unit: '모' }] }], ask: 'total' }, choices: [{ t: '2,000원', ok: true }, { t: '3,000원', err: 'CALC_NEAR' }] }, o));
  const anchor = shopQ({ role: 'anchor', noFeedback: true, level: 3 }), train = shopQ(), train2 = shopQ();
  const run = async (tag, seenMs) => {
    const { page } = await newPage(browser, { tag, seed: Object.assign(planOf('shop', Object.assign({}, noSeed(), pack('executive', 1, [train, train2]), measure([], [anchor]))), { 'bw.aiSeen': { [anchor.id]: seenMs } }) });
    await openCourse(page); await playGame(page);
    const L = (await logsOf(page))[0]; await page.close(); return L.items;
  };
  let it = await run('anchor-again', Date.now() - 21 * 864e5);
  must(it[1] && it[1].role === 'anchor' && it[1].id === anchor.id, '예전 주에 푼 앵커 문항(기기에 "본 문항"으로 남아 있어도): 이번 주에 다시 나와요 (role anchor)');
  it = await run('anchor-thisweek', Date.now());
  must(!it.some(x => x.role === 'anchor'), '이번 주에 이미 푼 앵커 문항은 같은 주에 되풀이되지 않아요');
  const old = Date.now() - 61 * 864e5;
  const { page } = await newPage(browser, { tag: 'reactivated', seed: Object.assign(planOf('shop', Object.assign({}, noSeed(), pack('executive', 1, [train]))), { 'bw.aiSeen': { [train.id]: old } }) });
  await openCourse(page); await playGame(page);
  must((await logsOf(page))[0].items[0].id === train.id, '60일 넘게 안 나온 훈련 문항을 서버가 묶음에 다시 넣으면 다시 써요');
  await page.close();
}

/* ---------- 9-3) 🌼 단추는 위쪽 바 안에 있고 답 고르는 곳·제목·뒤로 버튼과 겹치지 않아요 (360px·최대 글자·밝은/어두운) ---------- */
for (const dark of [false, true]) {
  const pm = bk({ format: 'prospective', cdomain: 'memory', level: 5, body: { cue: '🌼', event: 'after_last_item', instruction: '오늘 마지막 문제가 끝나면 화면 아래 🌼 단추를 눌러 주세요.', reminderMid: false } });
  const { page } = await newPage(browser, { tag: 'pm-layout' + (dark ? '-dark' : ''), w: 360, dark, seed: Object.assign(planOf('shop', Object.assign({}, noSeed(), pack('memory', 5, [pm]))), { 'bw.size': 'max' }) });
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-0'); await page.waitForSelector('.choice');
  const r = await page.evaluate(() => {
    const box = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const hit = (a, b) => !!(a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1);
    const pmb = [box('#btn-pm-cue'), box('#btn-pm-other')], bar = box('.appbar'), title = box('#appbar-title'), back = box('#btn-back');
    const answers = [...document.querySelectorAll('.choice, #prompt, #btn-replay')].map(e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
    return { inBar: pmb.every(p => p && p.t >= bar.t - 1 && p.b <= bar.b + 1 && p.l >= 0 && p.r <= innerWidth - 15), overlap: pmb.some(p => hit(p, title) || hit(p, back) || answers.some(a => hit(p, a))), w: innerWidth };
  });
  must(r.inBar && !r.overlap, '🌼·🌻 단추: 위쪽 바 안, 제목·뒤로·문제·보기와 안 겹쳐요 (360px 최대' + (dark ? '·다크' : '') + ')');
  await noHScroll(page, '🌼 단추가 있는 게임 화면');
  await page.screenshot({ path: SHOTS + '/ai-pm-360-max' + (dark ? '-dark' : '') + '.png' });
  await page.close();
}

/* ---------- 10) 가장 큰 글자(최대)·360px: 기존 게임에서도 가로 스크롤이 없어요 ---------- */
for (const id of ['words', 'shop', 'order', 'proverb', 'today']) {
  const { page } = await newPage(browser, { tag: 'max-' + id, w: 360, seed: Object.assign(planOf(id), { 'bw.size': 'max' }) });
  await startDemo(page); await page.click('#btn-main'); await page.waitForSelector('#g-title'); if (await vis(page, '.dialog')) await page.click('#dlg-btn-0');
  await playGame(page, { onRound: async (i) => { await noHScroll(page, id + ' ' + (i + 1) + '번째 문제 뒤(최대 글자·360px)'); } });
  await page.close();
}
{
  const { page } = await newPage(browser, { tag: 'max-consent', w: 360, seed: { 'bw.aiDemo': true, 'bw.size': 'max' } });
  await startDemo(page); await page.waitForSelector('#cons-h'); await noHScroll(page, '안내 화면(최대 글자·360px)');
  must((await page.locator('#btn-consent-ok').boundingBox()).width <= 360, '안내 버튼이 화면 안에 들어와요');
  await page.screenshot({ path: SHOTS + '/ai-consent-max-360.png', fullPage: true });
  await page.close();
}
await done(browser);
