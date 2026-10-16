// AI 문제 은행·리포트 화면 시험 공용 도우미 (체험 모드 + 예시 자료). 사용법은 tests/README.md
import { weekKey } from '../js/ai/kdate.js';
import { BASE, SHOTS, done, errors, launch, must, newPage, noHScroll, out, startDemo, vis } from './e2e-lib.mjs';
export { BASE, SHOTS, done, errors, launch, must, newPage, noHScroll, out, startDemo, vis };

export const ACK = () => ({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: Date.now() });
/* 체험 모드(훈련하는 분)에서 게임 하나만 하는 계획 + 안내는 이미 본 것으로. extra: 더 넣을 localdb 문서 */
export const planOf = (id, extra = {}, rounds = null) => ({ 'bw.aiDemo': true, 'bw.localdb': Object.assign({ 'trainees/local/state/plan': Object.assign({ gamesPerDay: 1, order: 'fixed', fixedOrder: [id], games: { [id]: { on: true } }, checkin: false, autoNextSec: 0 }, rounds ? { roundsPerGame: rounds } : {}), 'consents/local': ACK() }, extra) });
export const readDb = page => page.evaluate(() => JSON.parse(localStorage.getItem('bw.localdb') || '{}'));
export const logsOf = async page => { const db = await readDb(page); return Object.keys(db).filter(k => k.startsWith('itemLogs/')).map(k => Object.assign({ _id: k.slice(9) }, db[k])); };
export const packItems = async (page, id) => { const db = await readDb(page); const d = db['trainees/local/aiPacks/' + id]; return d ? JSON.parse(d.itemsJson) : []; };
export const measureItems = async page => { const db = await readDb(page); const k = Object.keys(db).filter(x => x.startsWith('trainees/local/aiPacks/measure-')).sort()[0]; return { ref: JSON.parse(db[k].referenceJson), anchor: JSON.parse(db[k].anchorJson) }; };
/* 한 문제를 풀어요 (보이는 화면에 맞춰). 단어 기억은 본 낱말을 골라요. */
export async function solveRound(page, o = {}) {
  await page.waitForSelector('#btn-memorized, .choice:not([disabled]), .gopt:not([disabled]), #btn-story-done, #btn-mem-ready, .stepbtn, #nexttarget, #oddgrid .cell, #board .cell, #fgrid, #btn-next:not([hidden])', { timeout: 8000 });
  if (await vis(page, '#btn-next:not([hidden])')) return 'done';
  if (await vis(page, '#btn-memorized')) {
    const targets = await page.$$eval('#shown .chip', els => els.map(e => e.textContent));
    await page.click('#btn-memorized');
    const chips = page.locator('#pool .chip');
    const n = await chips.count();
    for (let i = 0; i < n; i++) { const w = await chips.nth(i).getAttribute('data-w'); if (targets.includes(w)) await chips.nth(i).click(); }
    await page.click('#btn-check'); return 'words';
  }
  if (await vis(page, '#btn-story-done')) {
    await page.click('#btn-story-done');
    for (let k = 0; k < 6; k++) {
      await page.waitForSelector('.choice:not([disabled])'); await page.locator('.choice:not([disabled])').nth(o.pickIdx || 0).click();
      if (await vis(page, '#btn-next:not([hidden])')) break;
      if (await vis(page, '#btn-q-next')) await page.click('#btn-q-next');
      await page.waitForTimeout(80);
      if (await vis(page, '#btn-next:not([hidden])')) break;
    }
    return 'story';
  }
  if (await vis(page, '#btn-mem-ready')) { await page.click('#btn-mem-ready'); await page.waitForSelector('.gopt', { timeout: 9000 }); await page.locator('.gopt').nth(o.pickIdx || 0).click(); return 'gridmem'; }
  if (await page.locator('.choice:not([disabled])').count()) { await page.locator('.choice:not([disabled])').nth(o.pickIdx || 0).click(); return 'choice'; }
  if (await page.locator('.gopt:not([disabled])').count()) { await page.locator('.gopt:not([disabled])').nth(o.pickIdx || 0).click(); return 'grid'; }
  if (await page.locator('.stepbtn').count()) {   // 순서 맞추기: 맞는 순서대로 (data-i 가 단계 번호, 끼어든 단계는 -1)
    for (let k = 0; k < 8; k++) {
      if (await vis(page, '#btn-next:not([hidden])')) break;
      const want = await page.evaluate(() => Math.min.apply(null, [...document.querySelectorAll('.stepbtn')].map(b => +b.dataset.i).filter(i => i >= 0)));
      await page.locator('.stepbtn[data-i="' + want + '"]').click(); await page.waitForTimeout(60);
    }
    return 'seq';
  }
  return 'unknown';
}
/* 지금 게임을 끝까지 풀어요. 돌려주는 값: 푼 라운드 종류들 */
export async function playGame(page, o = {}) {
  await page.waitForSelector('#g-title', { timeout: 8000 });
  const kinds = [];
  for (let i = 0; i < 14; i++) {
    const kind = await solveRound(page, o); kinds.push(kind);
    if (o.onRound) await o.onRound(i, kind);
    await page.waitForSelector('#btn-next:not([hidden])', { timeout: 8000 });
    const label = await page.innerText('#btn-next');
    await page.click('#btn-next');
    if (!/다음 문제/.test(label)) break;
    await page.waitForSelector('#g-title');
  }
  return kinds;
}

/* 직접 꾸민 은행 문서 (체험 모드 예시 자료를 넣지 않게 aiState/demoSeed 표시를 함께 넣어요) */
export const ymdNow = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const pack = (cd, lv, items) => ({ ['trainees/local/aiPacks/' + cd + '-L' + lv]: { v: 1, cd, lv, n: items.length, itemsJson: JSON.stringify(items), builtTs: Date.now() } });
export const measure = (ref, anchor = [], plan = {}) => ({ ['trainees/local/aiPacks/measure-' + weekKey(ymdNow())]: { v: 1, week: weekKey(ymdNow()), nRef: ref.length, nAnchor: anchor.length, referenceJson: JSON.stringify(ref), anchorJson: JSON.stringify(anchor), anchorSet: anchor.length ? 'A' : null, plan: Object.assign({ perDay: 9, firstPosition: 1 }, plan), noFeedback: true, ready: true, builtTs: Date.now() } });
export const noSeed = () => ({ 'aiState/demoSeed': { v: 1, date: ymdNow() } });
let n = 0;
export const bk = (o) => Object.assign({ id: 'bk_' + (0xabc000 + ++n).toString(16).padStart(20, '0'), role: 'training', specVer: null, theme: null, prompt: null, speak: null, body: {}, choices: null, options: null, present: null, explain: null, validFrom: null, validTo: null, noFeedback: false }, o);
export const choiceItem = (o) => bk(Object.assign({ format: 'lang_category', cdomain: 'language', level: 1, prompt: '다음 중 ‘과일’이 아닌 것을 골라 주세요.', body: { category: '과일', mode: 'odd_one_out', members: ['사과', '포도'], odd: '의자' }, choices: [{ t: '사과', err: 'SEM_FAR' }, { t: '의자', ok: true }, { t: '포도', err: 'SEM_FAR' }] }, o));
