import { isAdmin, isTrainee, subscribe } from '../data.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { render } from '../ui/shell.js';

/* ================= 관리자 AI 리포트 자료 (CLIENT-CONTRACT §3, §4) =================
 * 규칙상 관리자(가족 역할, 훈련하는 분이 아닌 기기)만 읽어요. 화면에 처음 들어올 때 한 번만 구독하고 계속 둬요(해제는 가족방을 나갈 때).
 * 서버가 쓰는 문서이고, 앱은 읽기만 해요. 쓰는 것은 메모(aiNotes), 관심사 낱말(aiState/themes), AI 끄기(aiState/switch), 검토 결정(aiReview) 뿐이에요. */
export const AD = {
  reports: [], stats: null, plan: null, themes: null, sw: null, notes: [], signals: [], health: null, wakes: null, bank: null, review: null, thresholds: null, decisions: [], consents: [],
  denied: false, ready: {}, subscribed: false, weekDocs: {}
};
/* 이 기기에서 AI 리포트를 볼 수 있는지: 'ok' | 'notAdmin' (관리자만 볼 수 있어요) | 'trainee' (훈련하는 분 기기) */
export function aiAccess() {
  if (!isAdmin()) return 'notAdmin';
  if (Store.mode === 'firebase' && isTrainee()) return 'trainee';
  return 'ok';
}
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
const refresh = () => { if (String(S.screen).indexOf('ai') === 0 && S.screen !== 'aiConsent' && !typing()) render(true); };
export function ensureAdminSubs() {
  if (AD.subscribed || aiAccess() !== 'ok' || !Store.adapter) return;
  AD.subscribed = true;
  const opt = { onError: () => { AD.denied = true; refresh(); } };
  const doc = (path, key) => subscribe(path, opt, d => { AD[key] = d; AD.ready[key] = true; refresh(); });
  const list = (path, o, key) => subscribe(path, Object.assign({}, opt, o), l => { AD[key] = l; AD.ready[key] = true; refresh(); });
  list('aiReports', { orderBy: ['ts', 'desc'], limit: 40 }, 'reports');
  doc('aiStats/summary', 'stats'); doc('aiState/plan', 'plan'); doc('aiState/themes', 'themes'); doc('aiState/switch', 'sw');
  list('aiNotes', { orderBy: ['from', 'desc'], limit: 60 }, 'notes');
  list('aiSignals', { limit: 30 }, 'signals');
  doc('aiOps/health', 'health'); doc('aiOps/wakes', 'wakes'); doc('aiOps/bank', 'bank'); doc('aiOps/review', 'review'); doc('aiOps/thresholds', 'thresholds');
  list('aiReview', { limit: 80 }, 'decisions');
  list('consents', { limit: 10 }, 'consents');
}
/* 주별 원자료(aiStats/{주}): 앵커 나란히 보기에서 필요할 때만 한 번 읽어요 */
export async function weekDoc(wk) {
  if (AD.weekDocs[wk]) return AD.weekDocs[wk];
  try { const d = await Store.getDoc('aiStats/' + wk); AD.weekDocs[wk] = d || { anchorRows: [] }; } catch (e) { AD.weekDocs[wk] = { anchorRows: [], failed: true }; }
  return AD.weekDocs[wk];
}
export const msOf = t => (t == null ? 0 : typeof t === 'number' ? t : (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.seconds === 'number') ? t.seconds * 1000 : 0);
export function parseItems(doc) { try { const a = JSON.parse(doc && doc.itemsJson); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
export const isExample = () => Store.mode === 'local' || !!(AD.reports[0] && AD.reports[0].example);
