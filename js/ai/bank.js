import { S } from '../state.js';
import { LS, shuffle, ymd } from '../util.js';
import { weekKey } from './kdate.js';

/* ================= AI 문제 은행: 받아서 기기에 저장하고, 꺼내 쓰기 (CLIENT-CONTRACT §2) =================
 * families/{fid}/aiPacks 를 한 번 구독해요 (data.js 가 startBank 를 불러요). 받은 묶음은 localStorage 에도 저장해서 오프라인에서도 써요.
 *   훈련 묶음 '{영역}-L{단계}'   : itemsJson (문자열) = 아직 안 본 훈련 문항 최대 40개
 *   기준·앵커 묶음 'measure-{주}': referenceJson / anchorJson (문자열)
 * 문항 글은 모두 "자료"예요. 이 파일은 글을 해석만 하고, 화면에 그릴 때는 늘 textContent 로만 넣어요. */
export const CACHE_KEY = 'bw.aiPacks', SEEN_KEY = 'bw.aiSeen', MDAY_KEY = 'bw.aiMeasureDay';
export const CDS = ['memory', 'attention', 'executive', 'language', 'visuospatial', 'orientation'];
export const AI = { packs: {}, measure: {}, ready: false, subscribed: false, fromCache: false, builtMs: 0 };

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const okItem = it => isObj(it) && typeof it.id === 'string' && it.id.length <= 80 && typeof it.format === 'string' && typeof it.cdomain === 'string' && Number.isInteger(it.level) && it.level >= 1 && it.level <= 5;
function parseList(json) { try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter(okItem) : []; } catch (e) { return []; } }
export const todayYmd = () => ymd(new Date());

/* ---- 받은 문서 → 메모리 (문서 모양이 깨져 있어도 앱이 멈추지 않게 건너뛰어요) ---- */
function put(doc) {
  if (!isObj(doc) || typeof doc.id !== 'string') return;
  const mm = /^measure-(\d{4}-W\d{2})$/.exec(doc.id);
  if (mm) {
    AI.measure[mm[1]] = { id: doc.id, week: mm[1], start: doc.start || null, anchorSet: doc.anchorSet || null, ready: doc.ready !== false, plan: isObj(doc.plan) ? doc.plan : {}, noFeedback: doc.noFeedback !== false,
      referenceJson: String(doc.referenceJson || '[]'), anchorJson: String(doc.anchorJson || '[]'), example: !!doc.example,
      ref: parseList(doc.referenceJson).map(x => Object.assign({}, x, { role: 'reference', noFeedback: true })),
      anchor: parseList(doc.anchorJson).map(x => Object.assign({}, x, { role: 'anchor', noFeedback: true })) };
    return;
  }
  const m = /^([a-z]+)-L([1-5])$/.exec(doc.id);
  if (m) AI.packs[doc.id] = { id: doc.id, cd: m[1], lv: Number(m[2]), itemsJson: String(doc.itemsJson || '[]'), items: parseList(doc.itemsJson), builtMs: tsMs(doc.builtTs), example: !!doc.example };
}
const tsMs = t => (typeof t === 'number' ? t : (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.seconds === 'number') ? t.seconds * 1000 : 0);

let saveT = null, lastSig = '';
/* 바뀐 것이 있을 때만 저장해요 (같은 묶음이 다시 와도 다시 쓰지 않아요) */
const signature = () => Object.keys(AI.packs).sort().map(k => k + '|' + AI.packs[k].builtMs + '|' + AI.packs[k].itemsJson.length).join(',') + ';' + Object.keys(AI.measure).sort().map(k => k + '|' + AI.measure[k].referenceJson.length + '|' + AI.measure[k].anchorJson.length).join(',');
function saveCache() {
  const sig = signature(); if (sig === lastSig) return; lastSig = sig;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const packs = {}, measure = {};
    Object.keys(AI.packs).forEach(k => { const p = AI.packs[k]; packs[k] = { itemsJson: p.itemsJson, builtMs: p.builtMs, example: p.example }; });
    const keepFrom = weekKey(todayYmd());
    Object.keys(AI.measure).forEach(k => { if (k >= keepFrom) { const m = AI.measure[k]; measure[k] = { start: m.start, anchorSet: m.anchorSet, ready: m.ready, plan: m.plan, referenceJson: m.referenceJson, anchorJson: m.anchorJson, example: m.example }; } });
    LS.set(CACHE_KEY, { v: 1, savedMs: Date.now(), packs, measure });
  }, 800);
}
function loadCache() {
  const c = LS.get(CACHE_KEY, null);
  if (!isObj(c) || c.v !== 1) return;
  Object.keys(c.packs || {}).forEach(id => put(Object.assign({ id }, c.packs[id])));
  Object.keys(c.measure || {}).forEach(wk => put(Object.assign({ id: 'measure-' + wk }, c.measure[wk])));
  AI.fromCache = Object.keys(AI.packs).length > 0 || Object.keys(AI.measure).length > 0;
  lastSig = signature();
}
loadCache();

/* 구독 한 번: list = aiPacks 문서들 (id 포함). 삭제된 문서는 지워요. */
export function ingest(list) {
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(d => { if (d && d.id) { seen.add(d.id); put(d); } });
  Object.keys(AI.packs).forEach(id => { if (!seen.has(id)) delete AI.packs[id]; });
  Object.keys(AI.measure).forEach(wk => { if (!seen.has('measure-' + wk)) delete AI.measure[wk]; });
  AI.ready = true; AI.fromCache = false;
  saveCache();
}
/* 훈련하는 분 기기에서만 구독해요. subscribeFn(path, opts, cb) = data.js 의 subscribe */
export function startBank(subscribeFn) {
  if (AI.subscribed) return; AI.subscribed = true;
  subscribeFn('aiPacks', {}, ingest);
}
export function stopBank() { AI.subscribed = false; }

/* ---- 이미 본 문항 ---- */
let seenMem = null;
function seenMap() {
  if (seenMem) return seenMem;
  const m = LS.get(SEEN_KEY, {}); seenMem = isObj(m) ? m : {};
  const cut = Date.now() - 400 * 864e5; let n = 0;
  Object.keys(seenMem).forEach(k => { if (!(seenMem[k] > cut)) delete seenMem[k]; else n++; });
  if (n > 3000) Object.keys(seenMem).sort((a, b) => seenMem[a] - seenMem[b]).slice(0, n - 3000).forEach(k => delete seenMem[k]);
  return seenMem;
}
const baseId = id => String(id).split('#')[0];
export const isSeen = id => !!seenMap()[baseId(id)];
export function markSeen(id) { seenMap()[baseId(id)] = Date.now(); LS.set(SEEN_KEY, seenMem); }
export function resetSeen() { seenMem = {}; LS.set(SEEN_KEY, {}); }

/* ---- 훈련 문항 꺼내기: 영역·단계로. 본 문항·이 판에서 쓴 문항·날짜 범위 밖 문항은 건너뛰어요. 칸이 비면 이웃 단계(-1, +1), 그래도 없으면 null (게임은 코드 문항으로 가요) */
const inWindow = (it, today) => (!it.validFrom || it.validFrom <= today) && (!it.validTo || it.validTo >= today);
export function pool(cd, level, formats, used) {
  const today = todayYmd(), u = used || [];
  const fits = it => !isSeen(it.id) && !u.includes(it.id) && inWindow(it, today) && (!formats || formats.includes(it.format)) && it.role !== 'reference' && it.role !== 'anchor';
  const order = cd === 'reminiscence' ? [2, 1, 3, 4, 5] : [level, level - 1, level + 1];    // 옛날 이야기는 2단계 묶음 하나뿐
  for (const lv of order) {
    if (lv < 1 || lv > 5) continue;
    const p = AI.packs[cd + '-L' + lv]; if (!p) continue;
    const xs = p.items.filter(fits); if (xs.length) return xs;
  }
  return [];
}
/* 잊지 말고 누르기(prospective): 메모리 묶음 어느 단계에든 있는 안 본 문항 하나 (코스당 하나) */
export function drawPm() {
  const today = todayYmd();
  for (const lv of [2, 1, 3, 4, 5]) {
    const p = AI.packs['memory-L' + lv]; if (!p) continue;
    const xs = p.items.filter(it => it.format === 'prospective' && !isSeen(it.id) && inWindow(it, today) && it.body && /^(after_last_item|after_game:[1-9])$/.test(String(it.body.event)));
    if (xs.length) return shuffle(xs)[0];
  }
  return null;
}
/* 이 영역에 (어느 단계든) 쓸 수 있는 안 본 문항이 있는지: 새 AI 게임을 오늘 코스에 넣을지 정할 때 */
export function hasAny(cd, formats) { for (let lv = 1; lv <= 5; lv++) if (pool(cd, lv, formats).length) return true; return false; }
export const available = (cd, level, formats, used) => pool(cd, level, formats, used).length > 0;
export function draw(cd, level, formats, used) {
  const xs = pool(cd, level, formats, used); if (!xs.length) return null;
  return shuffle(xs)[0];
}
export function countUnseen(cd, lv) { const p = AI.packs[cd + '-L' + lv]; return p ? p.items.filter(it => !isSeen(it.id) && inWindow(it, todayYmd())).length : 0; }

/* ---- 이번 주 기준·앵커 문항 ---- */
export const measureDoc = () => AI.measure[weekKey(todayYmd())] || null;
const dayCount = () => { const d = LS.get(MDAY_KEY, null); return d && d.date === todayYmd() ? d.n : 0; };
export const bumpMeasureDay = () => LS.set(MDAY_KEY, { date: todayYmd(), n: dayCount() + 1 });
/* cds: 이 게임이 맡는 영역들. 하루 분량(plan.perDay, 기본 5)을 넘기지 않아요. 앵커가 있으면 앵커 먼저. */
export function measureNext(cds, used) {
  const d = measureDoc(); if (!d) return null;
  const perDay = Math.max(1, Number(d.plan.perDay) || 5);
  if (dayCount() >= perDay) return null;
  const u = used || [];
  const fits = it => cds.includes(it.cdomain) && !isSeen(it.id) && !u.includes(it.id) && inWindow(it, todayYmd());
  const a = d.anchor.filter(fits); if (a.length) return a[0];       // 앵커: 저장된 순서 그대로
  const r = d.ref.filter(fits); return r.length ? shuffle(r)[0] : null;
}
export const measureFirstPos = () => { const d = measureDoc(); const p = d && Number(d.plan.firstPosition); return Number.isInteger(p) && p >= 0 && p <= 3 ? p : 1; };
