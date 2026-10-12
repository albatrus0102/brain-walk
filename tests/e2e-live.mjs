// 실시간 동기 시험 (Firestore + Auth 에뮬레이터, 실제 앱 화면 3대):
//  관리자(가족) 기기 · 훈련하는 분 기기 · 관리자가 아닌 가족 기기
//  - 관리자가 화면 설정을 저장하면 훈련하는 분 기기가 아무것도 누르지 않아도 바뀐다
//  - 훈련 계획이 바로 코스에 반영되고, 훈련 진행이 관리자 홈에 실시간으로 나타난다
//  - 관리자가 아닌 가족에게는 읽기 전용, 관리자는 구성원을 내보낼 수 있다
// 실행: npm run test:live   (에뮬레이터 + 인터넷의 gstatic 에서 Firebase SDK 를 받아요. 못 받으면 SKIP)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium, done, errors, must, out } from './e2e-lib.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/brain-walk\//, '/'); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/brain-walk/';
const CONFIG = 'self.BW_CONFIG={firebase:{apiKey:"fake-key",authDomain:"demo-bw.firebaseapp.com",projectId:"demo-bw",appId:"1:1:web:1"},emulator:{host:"127.0.0.1",firestorePort:8080,authPort:9099},vapidKey:"",appCheckSiteKey:""};';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const IGNORE = /Failed to load resource|net::ERR|fonts\.g|jsdelivr|Notification|messaging|serviceWorker|push/i;

async function open(tag) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, proxy, ignoreHTTPSErrors: !!proxy, serviceWorkers: 'block', permissions: [] });
  await ctx.addInitScript(() => { window.__DEBUG = true; localStorage.setItem('bw.seenDisc', 'true'); localStorage.setItem('bw.offered', 'true'); localStorage.setItem('bw.pushDismiss', 'true'); });
  await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, r => r.abort());
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  return page;
}
const text = (p, s) => p.innerText(s).then(t => t.replace(/\s+/g, ' ').trim());
const until = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);

const admin = await open('admin');
await admin.goto(BASE);
if (!(await admin.waitForSelector('#btn-create', { timeout: 20000 }).then(() => true).catch(() => false))) {
  out('SKIP: Firebase SDK 를 받을 수 없어요 (인터넷 필요) —', await admin.innerText('body').then(t => t.slice(0, 80)).catch(() => ''));
  await browser.close(); server.close(); process.exit(0);
}
/* 1) 관리자(가족)가 가족방 만들기 */
await admin.click('#btn-create'); await admin.fill('#ob-name-input', '형'); await admin.click('#btn-name-next');
await admin.click('#role-family'); await admin.waitForSelector('#inv-code');
const code = (await admin.innerText('#inv-code')).trim();
must(/^[2-9A-HJ-NP-Z]{6}$/.test(code), '가족방을 만들고 코드를 받아요 ' + code);
await admin.click('#btn-inv-done'); await admin.waitForSelector('#dash');
must((await text(admin, '#dash')).includes('아직 훈련하는 분이 없어요') && await admin.locator('#btn-dash-assign').isVisible(), '관리자 홈: 훈련하는 분이 아직 없어요 → 구성원에서 정하기 버튼');

/* 2) 훈련하는 분 기기가 코드로 들어가기 */
const learner = await open('learner');
await learner.goto(BASE + '?join=' + code); await learner.waitForSelector('#btn-join-next');
await learner.click('#btn-join-next'); await learner.fill('#ob-name-input', '아버지'); await learner.click('#btn-name-next');
await learner.click('#role-trainee');
/* AI 리포트 안내(처음 한 번, DESIGN-AI §8.6): 훈련하는 분 기기에만 나와요. "알겠어요" → consents/{id} (서버 시각) */
must(await learner.waitForSelector('#btn-consent-ok', { timeout: 20000 }).then(() => true).catch(() => false) && (await text(learner, '#cons-h')) === '가족이 함께 살펴볼게요', '훈련하는 분 기기: 처음 한 번 AI 리포트 안내가 나와요');
await learner.click('#btn-consent-ok'); await learner.waitForSelector('#btn-main', { timeout: 20000 });
must(!(await learner.locator('#navbar').isVisible()) && (await text(learner, '#btn-main')) === '오늘 훈련 시작', '훈련하는 분 기기: 큰 버튼 하나, 하단 메뉴 없음');
must(await until(admin, () => document.querySelector('#dash-status') && document.querySelector('#dash-status').innerText.includes('아직 시작 전')), '관리자 홈에 아버지의 현황이 나타나요 (시작 전)');
must(await until(admin, () => /지금 앱을 보고 계세요/.test((document.querySelector('#dash-presence') || {}).innerText || '')), '접속 기록(하트비트): ● 지금 앱을 보고 계세요');
await admin.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/live-dashboard-idle.png' });

/* 3) 관리자: 화면 설정 → 훈련하는 분 기기에 눌러 보지 않아도 적용 */
await admin.click('#btn-settings'); await admin.waitForSelector('#set-main-h');
await admin.click('#xp-mgmt'); await admin.click('#row-display'); await admin.waitForSelector('#dd-h');
await admin.click('#dd-font-noto'); await admin.click('#dd-size-max'); await admin.click('#dd-save');
await admin.waitForSelector('#snackbar:not([hidden])');
must((await admin.innerText('#snackbar')).includes('지금 아버지가 앱을 보고 계셔서 바로 바뀌어요'), '접속 중이면 "바로 바뀌어요" 안내');
must(await until(learner, () => document.documentElement.dataset.size === 'max' && document.documentElement.dataset.font === 'noto', null, 5000), '훈련하는 분 기기에 글꼴·최대 글자가 3초 안에 저절로 적용 (입력 없음)');
must(await learner.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Noto Sans KR')), '글꼴이 타이포 토큰으로 바뀌었어요');
must((await admin.evaluate(() => document.documentElement.dataset.size)) === 'normal', '관리자 기기의 글자 크기는 그대로');
await learner.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/live-learner-max.png' });

/* 4) 관리자: 훈련 계획 (하루 2개, 자동 넘김 끔) → 훈련하는 분 홈에 바로 */
await admin.click('#btn-back'); await admin.click('#row-plan'); await admin.waitForSelector('#plan-h');
while ((await admin.innerText('#plan-gpd')) !== '2') await admin.click('#gpd-minus');
if (await admin.locator('#plan-more').getAttribute('open') === null) await admin.click('#plan-more-sum');
await admin.click('#plan-auto-0'); await admin.click('#plan-save');
await admin.waitForSelector('#snackbar:not([hidden])');
must(await until(learner, () => /^게임 2개/.test((document.querySelector('#main-sub') || {}).innerText || '')), '훈련하는 분 홈이 바로 "게임 2개"로 바뀌어요 (다시 열지 않아도)');

/* 5) 훈련하는 분이 시작 → 관리자 홈에 실시간 */
await learner.click('#btn-main'); await learner.waitForSelector('#g-title');
await admin.click('#btn-back'); await admin.click('#btn-back').catch(() => {}); await admin.waitForSelector('#dash');
must(await until(admin, () => (document.querySelector('#dash-status') || {}).innerText === '훈련 중 · 2개 중 0개'), '관리자 홈: 훈련 중 · 2개 중 0개');
must(await until(admin, () => /^지금: .+\(.+부터\)$/.test(((document.querySelector('#dash-sub') || {}).innerText || '').trim())), '관리자 홈: 지금: 게임 이름 (○부터)');
await learner.evaluate(async () => { for (let i = 0; i < 12; i++) { const c = window.__S.ctx; if (c && !c.finished) c.finish({ correct: 1, total: 1, ok: true, msg: '좋아요' }); const b = document.querySelector('#btn-next'); if (!b || b.hidden) break; const last = !/다음 문제/.test(b.textContent); b.click(); if (last) break; await new Promise(r => setTimeout(r, 120)); } });
must(await until(admin, () => (document.querySelector('#dash-status') || {}).innerText === '훈련 중 · 2개 중 1개'), '게임이 끝나자 2개 중 1개로');
must(await until(admin, () => /정답 100%/.test((document.querySelector('#dash-games li.done') || {}).innerText || '')), '게임별 결과가 끝나는 대로 보여요 (정답 100%)');
await admin.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/live-dashboard-progress.png', fullPage: true });
await learner.waitForSelector('#brk-h'); await learner.click('#btn-brk-next'); await learner.waitForSelector('#g-title');
await learner.evaluate(async () => { for (let i = 0; i < 12; i++) { const c = window.__S.ctx; if (c && !c.finished) c.finish({ correct: 1, total: 1, ok: true, msg: '좋아요' }); const b = document.querySelector('#btn-next'); if (!b || b.hidden) break; const last = !/다음 문제/.test(b.textContent); b.click(); if (last) break; await new Promise(r => setTimeout(r, 120)); } });
await learner.waitForSelector('#ci-h'); await learner.click('#btn-ci-skip'); await learner.waitForSelector('#done-h');
must(await until(admin, () => /^오늘 완료 ✓/.test((document.querySelector('#dash-status') || {}).innerText || '')), '끝나면 관리자 홈: 오늘 완료 ✓');
must(await until(admin, () => [...document.querySelectorAll('#dash-week li')].pop().dataset.state === 'done'), '7일 띠: 오늘 완료');

/* 5-1) AI: 실제 앱이 쓴 문항 기록·안내 동의가 실제 규칙을 통과했고, 서버 정리 함수가 하나도 버리지 않아요 */
{
  const dadId = await learner.evaluate(() => window.__S.myId);
  const got = await admin.evaluate(async () => { const l = await window.__Store.query('itemLogs', { limit: 50 }); return l.map(d => Object.assign({}, d, { sts: d.sts && typeof d.sts.toMillis === 'function' ? 'server-ts' : String(d.sts) })); });
  must(got.length === 2 && got.every(d => d.userId === dadId && d.sts === 'server-ts' && d.inCourse === true && d.items.length >= 1), '훈련하는 분 기기가 게임마다 itemLogs 문서를 썼고 규칙이 받아들였어요 (' + got.length + '개, 서버 시각)');
  const KEYS = ['id', 'v', 'userId', 'date', 'ts', 'sts', 'gameId', 'inCourse', 'level', 'speechOn', 'size', 'device', 'hour', 'abandoned', 'items'];
  must(got.every(d => Object.keys(d).every(k => KEYS.includes(k))), 'itemLogs 문서 키는 계약 안에서');
  const { createRequire } = await import('node:module');
  const SR = createRequire(path.join(ROOT, 'functions/package.json'))('./ai/core/series.js');
  const san = got.map(d => SR.sanitizeLog(d, d.id));
  must(san.every((x, i) => x && x.items.length === got[i].items.length && x.items.every((it, j) => it.role === got[i].items[j].role && JSON.stringify(it.err) === JSON.stringify(got[i].items[j].err))), '서버(aiOnItemLog·집계)의 sanitizeLog 가 문서·문항을 하나도 버리지 않아요');
  const cons = await admin.evaluate(async id => { const d = await window.__Store.getDoc('consents/' + id); return d && { kind: d.kind, version: d.version, server: !!(d.ackTs && d.ackTs.toMillis), withdrawn: 'withdrawnTs' in d }; }, dadId);
  must(cons && cons.kind === 'ai-report-notice' && cons.version === '2026-11-v1' && cons.server && !cons.withdrawn, '안내 동의: consents/{아버지} 에 서버 시각으로 기록 (관리자가 읽어요)');
  await learner.reload(); await learner.waitForSelector('#btn-main', { timeout: 20000 }); await learner.waitForTimeout(1500);
  must(!(await learner.locator('#cons-h').count()), '다시 열어도 안내는 또 나오지 않아요 (한 번만)');
  // 훈련하는 분 기기는 AI 리포트 화면에 못 가고, 직접 읽어도 규칙이 막아요
  await learner.evaluate(() => window.__go('aiReports'));
  must((await learner.evaluate(() => window.__S.screen)) === 'home', '훈련하는 분 기기: AI 리포트 화면으로 가면 홈으로 돌아와요');
  must(await learner.evaluate(async () => { try { await window.__Store.query('aiReports', { limit: 1 }); return false; } catch (e) { return e.code === 'permission-denied'; } }), '훈련하는 분이 AI 리포트를 직접 읽으면 규칙이 거부해요');
  // 관리자: 루틴 상태에 안내 확인, 메모 저장(화면에서)
  await admin.evaluate(() => window.__go('aiOps')); await admin.waitForSelector('#ai-st-cons');
  must(await until(admin, () => /확인하셨어요/.test(document.querySelector('#ai-st-cons').innerText)) && !(await admin.locator('#ai-denied, #ai-blocked').count()), '관리자 루틴 상태: 아버지 안내 확인 시각이 보여요 (읽기 거부 없음)');
  await admin.evaluate(() => window.__go('aiNotes')); await admin.waitForSelector('#ai-n-save');
  await admin.click('#ai-n-c-illness'); await admin.fill('#ai-n-text', '기침약'); await admin.click('#ai-n-save');
  must(await until(admin, () => /메모를 저장했어요/.test((document.querySelector('#snackbar') || {}).innerText || '')), '관리자 메모: 화면에서 저장하면 규칙이 받아들여요');
  const notes = await admin.evaluate(async () => (await window.__Store.query('aiNotes', { limit: 5 })).map(n => ({ codes: n.codes, to: n.to, text: n.text })));
  must(notes.length === 1 && notes[0].codes.join() === 'illness' && notes[0].text === '기침약', '메모 문서: 분류·날짜·글');
  await admin.evaluate(() => window.__go('home')); await admin.waitForSelector('#dash');
}

/* 6) 관리자가 아닌 가족: 읽기 전용 */
const fam = await open('family');
await fam.goto(BASE + '?join=' + code); await fam.waitForSelector('#btn-join-next');
await fam.click('#btn-join-next'); await fam.fill('#ob-name-input', '동생'); await fam.click('#btn-name-next');
await fam.click('#role-family'); await fam.waitForSelector('#dash', { timeout: 20000 });
await fam.click('#btn-settings'); await fam.waitForSelector('#set-main-h');
must(!(await fam.locator('#admin-chip').count()) && !(await fam.locator('#owner-slot').count()), '관리자 표시·방 주인 전용 칸이 없어요');
await fam.click('#xp-mgmt'); await fam.click('#row-plan'); await fam.waitForSelector('#plan-h');
must((await text(fam, '#admin-note')) === '관리자만 바꿀 수 있어요. 관리자: 형', '관리자가 아닌 가족: "관리자만 바꿀 수 있어요. 관리자: 형"');
for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) if ((await fam.getAttribute('#xpc-' + k, 'open')) === null) await fam.click('#xp-' + k);
const live = await fam.evaluate(() => [...document.querySelectorAll('#screen button[data-act^="pl-"], #screen select, #screen input[type=time]')].filter(e => !e.disabled).length);
must(live === 0 && !(await fam.locator('#plan-save').count()), '모든 입력이 꺼져 있고 저장 버튼이 없어요');
must((await text(fam, '#plan-sum')).includes('하루 2개'), '값은 보여요 (관리자가 정한 하루 2개)');
await fam.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/live-plan-readonly.png', fullPage: true });
must(await fam.evaluate(() => window.__Store.explain({ code: 'permission-denied' }, true)) === '관리자만 바꿀 수 있어요', '거부되면 "관리자만 바꿀 수 있어요" 안내 문구');
// 관리자가 아닌 사람이 억지로 써 보면 규칙이 막아요
const denied = await fam.evaluate(async () => { try { await window.__Store.setDoc('state/display', { v: 1, font: 'system', size: 'normal', contrast: false, voice: true, rate: 0.9, updatedBy: window.__S.myId, updatedTs: Date.now() }); return 'allowed'; } catch (e) { return e.code; } });
must(denied === 'permission-denied', '관리자가 아닌 가족이 직접 써도 규칙이 거부해요 (' + denied + ')');
// 관리자 홈: 구성원 목록
await admin.click('#btn-back').catch(() => {});
await admin.evaluate(() => window.__go('members')); await admin.waitForSelector('#mem-list');
must((await admin.locator('#mem-list li').count()) === 3, '구성원 3명 (형·아버지·동생)');
const rows = await admin.evaluate(() => [...document.querySelectorAll('#mem-list li')].map(li => li.innerText.replace(/\s+/g, ' ')));
must(rows[0].includes('형') && rows[0].includes('방 주인') && rows[0].includes('관리자') && rows[1].includes('아버지') && rows[1].includes('훈련하는 분'), '방 주인 → 훈련하는 분 순서 + 배지');
await admin.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/live-members.png' });
// 동생을 관리자로 → 읽기 전용이 풀려요
await admin.click('#mem-2'); await admin.click('#mem-grant'); await admin.click('#dlg-btn-1'); await admin.waitForSelector('#snackbar:not([hidden])');
await fam.evaluate(() => window.__go('settings')); await fam.waitForSelector('#admin-chip');
must(true, '동생에게 "관리자" 표시가 나타나요');
// 훈련하는 분 바꾸기: 두 기기 모두 다시 열지 않고 새 역할을 따라가요 (관리자가 정한 화면 설정, 가족 홈)
const [famMid, dadMid] = await Promise.all([fam.evaluate(() => window.__S.myId), learner.evaluate(() => window.__S.myId)]);
await Promise.all([learner.evaluate(() => window.__go('home')), fam.evaluate(() => window.__go('home'))]);
await admin.evaluate(async ([a, b]) => { const m = await import('./js/store/membership.js'); await m.assignTrainee(a, '아버지', b); }, [famMid, dadMid]);
must(await until(fam, () => !!document.getElementById('btn-main') && document.documentElement.dataset.size === 'max' && document.documentElement.dataset.font === 'noto'), '훈련하는 분이 된 기기: 큰 버튼 홈 + 관리자가 정한 화면 설정이 바로 적용');
must(await until(learner, () => !!document.getElementById('dash') && document.documentElement.dataset.size !== 'max'), '가족이 된 기기: 가족 홈 + 자기 화면 설정으로 돌아가요');
await admin.evaluate(async ([a, b]) => { const m = await import('./js/store/membership.js'); await m.assignTrainee(a, '아버지', b); }, [dadMid, famMid]);
must(await until(learner, () => !!document.getElementById('btn-main') && document.documentElement.dataset.size === 'max'), '되돌리면 아버지 기기도 바로 훈련 화면');
await admin.evaluate(() => window.__go('members')); await admin.waitForSelector('#mem-list');
// 모르는 사람 내보내기
await admin.click('#mem-2'); await admin.click('#mem-remove'); await admin.click('#dlg-btn-1');
must(await until(admin, () => document.querySelectorAll('#mem-list li').length === 2), '내보내면 목록에서 사라져요');
await fam.reload(); must(await fam.waitForSelector('#btn-create', { timeout: 20000 }).then(() => true).catch(() => false), '내보내진 기기는 다시 열면 가족방이 닫혀 처음 화면이 나와요');
await done(browser).finally(() => server.close());
