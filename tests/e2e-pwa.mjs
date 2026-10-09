// PWA: 매니페스트, 서비스 워커 등록, 오프라인에서 앱 껍데기 열림 (설정이 비어 있는 상태)
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/brain-walk/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const errors = [], out = (...a) => console.log(...a);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const must = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); out('FAIL', msg); } else out('ok  ', msg); };
await page.goto(BASE); await page.waitForSelector('#setup-h');
const mf = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
must(mf.short_name === '두뇌산책' && mf.name === '오늘의 두뇌 산책' && mf.display === 'standalone' && mf.theme_color === '#386A20' && mf.scope === './' && mf.start_url.startsWith('./'), '매니페스트');
for (const i of mf.icons) { const r = await page.evaluate(async u => (await fetch(u)).status, new URL(i.src, BASE).href); must(r === 200, '아이콘 ' + i.src); }
must((await page.evaluate(async () => (await fetch(document.querySelector('link[rel=apple-touch-icon]').href)).status)) === 200, 'apple-touch-icon');
const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
must(reg.active && reg.scope.endsWith('/brain-walk/'), '서비스 워커 활성, scope ' + reg.scope);
await page.reload(); await page.waitForSelector('#setup-h');
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('#setup-h', { timeout: 10000 });
must(true, '오프라인에서도 앱이 열려요 (' + (await page.evaluate(() => navigator.serviceWorker.controller ? 'SW 제어 중' : 'SW 없음')) + ')');
out('ERRORS:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
