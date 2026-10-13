// 서비스 워커 업데이트: 새 버전은 바로 켜지고, 안전한 화면(처음·홈)에서는 딱 한 번 새로고침, 게임 같은 화면에서는 새로고침하지 않아요.
// 이 시험은 자기 서버를 띄워서 배포마다 sw.js 의 VERSION 이 바뀌는 것(pages.yml)을 흉내 내요. BASE 는 쓰지 않아요.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, errors, launch, must } from './e2e-lib.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let ver = 'aaaa1111';
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/brain-walk/')) { res.writeHead(404); return res.end(); }
    p = p.slice('/brain-walk/'.length) || 'index.html'; if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(ROOT, p)); if (!f.startsWith(ROOT) || /(^|\/)(tests|functions|node_modules|\.git)\//.test(f.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
    let buf = await readFile(f);
    if (p === 'sw.js') buf = Buffer.from(buf.toString().replace("const VERSION = '__BUILD__';", "const VERSION = '" + ver + "';"));
    if (p === 'firebase-config.js') buf = Buffer.from(buf.toString().replace(/apiKey:\s*"[^"]*"/, 'apiKey: "REPLACE_ME"'));
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(buf);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://localhost:' + server.address().port + '/brain-walk/';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { window.__DEBUG = true; try { localStorage.setItem('bw.aiDemo', 'false'); localStorage.setItem('bw.offered', 'true'); } catch (e) {} });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
const caches_ = () => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('bw-shell-')).sort());
const bump = async v => { ver = v; await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); }); };
const waitCache = async v => { for (let i = 0; i < 60; i++) { if ((await caches_()).join() === 'bw-shell-' + v) return true; await page.waitForTimeout(100); } return false; };

// 1) 처음 설치: 새로고침하지 않아요
await page.goto(BASE); await page.waitForSelector('#setup-h');
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
must(await waitCache('aaaa1111'), '처음 설치: 캐시 bw-shell-aaaa1111, 서비스 워커가 페이지를 제어해요');
await page.waitForTimeout(800);
must(navs === 1, '처음 설치에는 새로고침하지 않아요 (이동 ' + navs + '번)');

// 2) 안전한 화면(설정 안내)에서 새 버전: 바로 켜지고 한 번만 새로고침
await bump('bbbb2222');
for (let i = 0; i < 60 && navs < 2; i++) await page.waitForTimeout(100);
await page.waitForSelector('#setup-h');
must(navs === 2, '안전한 화면에서 새 버전이 켜지면 새로고침 한 번 (이동 ' + navs + '번)');
must(await waitCache('bbbb2222'), '옛 캐시(aaaa1111)는 지워지고 새 캐시만 남아요: ' + (await caches_()).join());
await page.waitForTimeout(1500);
must(navs === 2, '반복 새로고침 없음 (이동 ' + navs + '번)');
const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: !!r.active, waiting: !!r.waiting, ctrl: !!navigator.serviceWorker.controller }; });
must(st.active && !st.waiting && st.ctrl, '기다리는 서비스 워커 없이 새 버전이 활성: ' + JSON.stringify(st));

// 3) 안전하지 않은 화면(훈련 고르기)에서 새 버전: 새로고침하지 않고, 다음에 열 때 새 버전
await page.click('#btn-demo'); await page.waitForSelector('#appbar-title');
await page.evaluate(() => window.__go('settings')); await page.waitForTimeout(150);
const navs0 = navs;
await bump('cccc3333');
must(await waitCache('cccc3333'), '다른 화면에서도 새 서비스 워커는 바로 켜져요: ' + (await caches_()).join());
await page.waitForTimeout(1500);
{ const sc = await page.evaluate(() => window.__S.screen); must(navs === navs0 && sc === 'settings', '설정 화면(안전하지 않은 화면)에서는 새로고침하지 않아요 (화면 ' + sc + ', 이동 ' + (navs - navs0) + ')'); }
await page.reload(); await page.waitForSelector('#appbar-title');
must((await caches_()).join() === 'bw-shell-cccc3333', '다음에 앱을 열면 새 버전으로 열려요 (새로고침 한 번만 더 늘었어요)');
await page.waitForTimeout(1200);
must(navs === navs0 + 1, '다시 열린 뒤 추가 새로고침 없음 (이동 ' + navs + '번)');

// 4) 60초 안 반복 방지: 방금 새로고침한 것으로 기록하고 안전한 화면에서 또 바꿔도 새로고침하지 않아요
await page.evaluate(() => { sessionStorage.setItem('bw.swReloadAt', String(Date.now())); window.__go('home'); });
await page.waitForTimeout(150); const navs1 = navs;
await bump('dddd4444'); must(await waitCache('dddd4444'), '네 번째 버전 활성');
await page.waitForTimeout(1500);
must(navs === navs1, '60초 안에는 다시 새로고침하지 않아요 (반복 방지)');
server.close(); await done(browser);
