import { focusId, isAdmin, isTrainee, traineeLabel } from '../data.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { fillWho } from '../trainees.js';
import { render } from '../ui/shell.js';

/* ================= 관리자 AI 리포트 자료 (CLIENT-CONTRACT §3, §4, DESIGN-MULTI §1.2) =================
 * 규칙상 AI 관리자(가족 역할, 훈련하는 분 목록에 없는 기기)만 읽어요. 고른 훈련하는 분(AD.mid)의 trainees/{mid}/ai* 를 구독하고,
 * 고른 사람이 바뀌면 다시 구독해요. 문제 은행(aiOps/bank·review)·검토 결정·AI 끄기는 가족 전체 것이에요.
 * 서버가 쓰는 문서이고, 앱은 읽기만 해요. 쓰는 것은 메모(aiNotes), 관심사 낱말(aiState/themes), AI 끄기(aiState/switch), 검토 결정(aiReview) 뿐이에요. */
const fresh = () => ({
  reports: [], stats: null, plan: null, themes: null, sw: null, famHealth: null, notes: [], signals: [], health: null, wakes: null, bank: null, review: null, thresholds: null, decisions: [], consents: [],
  denied: false, ready: {}, subscribed: false, weekDocs: {}, mid: null, latest: {}
});
export const AD = fresh();
let unsubs = [], latestUnsubs = {};
/* 구독을 모두 끊고 처음 상태로: 가족방을 나가거나, 이 기기의 역할이 바뀌었을 때(관리자 ↔ 훈련하는 분) data.js 가 불러요.
 * (거부된 구독은 Firestore 가 끊어 버리니까, 다시 관리자가 되면 새로 구독해야 해요) */
export function resetAdminSubs() {
  unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  Object.keys(latestUnsubs).forEach(k => { try { latestUnsubs[k](); } catch (e) {} }); latestUnsubs = {};
  Object.assign(AD, fresh());
}
/* 이 기기에서 AI 리포트를 볼 수 있는지: 'ok' | 'notAdmin' (관리자만 볼 수 있어요) | 'trainee' (훈련하는 분 기기) */
export function aiAccess() {
  if (!isAdmin()) return 'notAdmin';
  if (Store.mode === 'firebase' && isTrainee()) return 'trainee';
  return 'ok';
}
export const tpath = (mid, rest) => 'trainees/' + mid + '/' + rest;
/* 리포트 글의 {{who}} 를 그 분의 호칭으로 (리포트 문서의 글 칸만, 화면에는 textContent 로만 넣어요) */
function fillDeep(v, label) {
  if (typeof v === 'string') return fillWho(v, label);
  if (Array.isArray(v)) return v.map(x => fillDeep(x, label));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = fillDeep(v[k], label); }); return o; }
  return v;
}
export const withWho = (r, mid) => (r && r.report ? Object.assign({}, r, { report: fillDeep(r.report, traineeLabel(mid)) }) : r);
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
const refresh = () => { if ((String(S.screen).indexOf('ai') === 0 || S.screen === 'home') && !typing()) render(true); };
export function ensureAdminSubs() {
  const mid = focusId();
  if (aiAccess() !== 'ok' || !Store.adapter || !mid) return;
  if (AD.subscribed && AD.mid === mid) return;
  if (AD.subscribed) { unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); const keep = AD.latest; Object.assign(AD, fresh()); AD.latest = keep; }
  AD.subscribed = true; AD.mid = mid;
  const opt = { onError: () => { AD.denied = true; refresh(); } };
  const sub = (path, o, cb) => { try { unsubs.push(Store.subscribe(path, o, cb)); } catch (e) { AD.denied = true; } };
  const doc = (path, key) => sub(path, opt, d => { AD[key] = d; AD.ready[key] = true; refresh(); });
  const list = (path, o, key, map) => sub(path, Object.assign({}, opt, o), l => { AD[key] = map ? l.map(map) : l; AD.ready[key] = true; refresh(); });
  const T = rest => tpath(mid, rest);
  list(T('aiReports'), { orderBy: ['ts', 'desc'], limit: 40 }, 'reports', r => withWho(r, mid));
  doc(T('aiStats/summary'), 'stats'); doc(T('aiState/plan'), 'plan'); doc(T('aiState/themes'), 'themes');
  list(T('aiNotes'), { orderBy: ['from', 'desc'], limit: 60 }, 'notes');
  list(T('aiSignals'), { limit: 30 }, 'signals');
  doc(T('aiOps/health'), 'health'); doc(T('aiOps/wakes'), 'wakes'); doc(T('aiOps/thresholds'), 'thresholds');
  // 가족 전체
  doc('aiState/switch', 'sw'); doc('aiOps/bank', 'bank'); doc('aiOps/review', 'review'); doc('aiOps/health', 'famHealth');   // famHealth.gen = 문제 만들기 루틴 (가족 전체)
  list('aiReview', { limit: 80 }, 'decisions');
  list('consents', { limit: 20 }, 'consents');
}
/* 가족 대시보드 '모두' 타일의 신호등: 훈련하는 분마다 마지막 리포트 하나 */
export function ensureLatestReports(ids) {
  if (aiAccess() !== 'ok' || !Store.adapter) return;
  Object.keys(latestUnsubs).forEach(id => { if (!ids.includes(id)) { try { latestUnsubs[id](); } catch (e) {} delete latestUnsubs[id]; delete AD.latest[id]; } });
  ids.forEach(id => {
    if (latestUnsubs[id]) return;
    try { latestUnsubs[id] = Store.subscribe(tpath(id, 'aiReports'), { orderBy: ['ts', 'desc'], limit: 1, onError: () => {} }, l => { AD.latest[id] = l[0] || null; refresh(); }); } catch (e) {}
  });
}
/* 주별 원자료(trainees/{mid}/aiStats/{주}): 앵커 나란히 보기에서 필요할 때만 한 번 읽어요 */
export async function weekDoc(wk) {
  if (AD.weekDocs[wk]) return AD.weekDocs[wk];
  try { const d = await Store.getDoc(tpath(AD.mid, 'aiStats/' + wk)); AD.weekDocs[wk] = d || { anchorRows: [] }; } catch (e) { AD.weekDocs[wk] = { anchorRows: [], failed: true }; }
  return AD.weekDocs[wk];
}
export const msOf = t => (t == null ? 0 : typeof t === 'number' ? t : (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.seconds === 'number') ? t.seconds * 1000 : 0);
export function parseItems(doc) { try { const a = JSON.parse(doc && doc.itemsJson); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
export const isExample = () => Store.mode === 'local' || !!(AD.reports[0] && AD.reports[0].example);
