import { dbReady, myTrainee, remoteSet, tdata, todayS } from './data.js';
import { HEARTBEAT_MS, progressFinish, progressId, progressStart, shouldBeat } from './program.js';
import { ASSESS_STEPS } from './session.js';
import { S } from './state.js';
import { Store } from './store/store.js';

/* ================= 훈련하는 분 기기가 쓰는 진행 상황·접속 기록 (DESIGN.md §4.4) =================
 * progress/{날짜}-{내 id}: 게임을 시작할 때와 끝낼 때. presence/{내 id}: 앱이 보이는 동안 60초마다. */
const me = () => S.myId || 'local';
export const progressDocId = () => progressId(todayS(), me());
/* 오늘 내 진행 문서: 서버에서 온 것과 방금 쓴 것(낙관적) 중 더 새것 */
export function todayProgress() {
  const id = progressDocId(), srv = (tdata(me()).progressList || []).find(p => p.id === id) || null, loc = S._progLocal && S._progLocal.date === todayS() ? S._progLocal : null;
  if (srv && loc) return (loc.updatedTs || 0) > (srv.updatedTs || 0) ? loc : srv;
  return srv || loc || null;
}
const strip = p => { if (!p) return null; const o = Object.assign({}, p); delete o.id; return o; };
const canWrite = () => !!Store.adapter && !!myTrainee();
function write(doc) {
  S._progLocal = doc;      // 낙관적: 스냅샷이 오면 서버 것이 이어받아요
  remoteSet('progress/' + progressId(doc.date, me()), doc, true);
}
export function progressGameStart(gameId, kind) {
  if (!canWrite()) return;
  kind = kind || 'course';
  const prev = strip(todayProgress()), planned = kind === 'check' ? ASSESS_STEPS.map(s => s.gameId) : ((S.course && S.course.games) || []);
  write(progressStart(prev, { userId: me(), date: todayS(), kind, planned, gameId, now: Date.now() }));
}
export function progressGameFinish(gameId, result) {
  if (!canWrite()) return;
  const prev = strip(todayProgress()); if (!prev) return;
  write(progressFinish(prev, { gameId, result, now: Date.now() }));
}

/* 점검을 중간에 마쳤을 때(여기서 마치기): 진행 문서를 '끝남'으로 */
export function progressMarkDone() {
  if (!canWrite()) return;
  const prev = strip(todayProgress()); if (!prev || prev.kind !== 'check' || prev.status === 'done') return;
  const now = Date.now();
  write(Object.assign({}, prev, { status: 'done', doneTs: now, updatedTs: now, current: null, currentTs: null }));
}

/* ---- 하트비트 ---- */
let timer = null, last = 0;
const deviceLabel = () => { try { const p = navigator.userAgent; return (/iPhone|iPad/.test(p) ? 'iPhone/iPad' : /Android/.test(p) ? 'Android' : '컴퓨터').slice(0, 40); } catch (e) { return ''; } };
export function beat(force) {
  if (!canWrite()) return;
  const now = Date.now();
  if (!force && !shouldBeat(last, now, document.visibilityState === 'visible', navigator.onLine)) return;
  last = now;
  dbReady.then(() => Store.setDoc('presence/' + me(), { ts: now, screen: String(S.screen || '').slice(0, 20), device: deviceLabel() })).catch(() => {});
}
const onVis = () => beat();
export function startHeartbeat() {
  if (timer) return;
  beat(); timer = setInterval(beat, 15e3); document.addEventListener('visibilitychange', onVis);
}
export function stopHeartbeat() { if (!timer) return; clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVis); }
export const heartbeatRunning = () => !!timer;
export { HEARTBEAT_MS };
