import { dbReady, isTrainee, todayS, traineeId } from '../data.js';
import { effectiveSound, synth } from '../sound.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { codeItemId, codeRole, entryOf, logDocs } from './itemlog-doc.js';

/* ================= 문항별 기록 itemLogs (CLIENT-CONTRACT §1) =================
 * 게임 한 판 = 문서 하나(문항이 20개를 넘으면 -1, -2 로 나눠요). 훈련하는 분으로 지정된 기기만 써요.
 * 점수·정답을 글로 남기지 않고 숫자·코드만 남겨요. 문항 글 자체는 id 로만 이어져요. */
export { LOG_V, entryOf } from './itemlog-doc.js';
export const deviceKind = () => { const u = (typeof navigator !== 'undefined' && navigator.userAgent) || ''; return /Android/i.test(u) ? 'android' : /iPhone|iPad|iPod/i.test(u) ? 'ios' : 'desktop'; };
/* 이 기기가 문항 기록을 써도 되는지: 체험 모드의 훈련하는 분 역할, 또는 가족방에서 지정된 훈련하는 분 본인의 기기 */
export function canLog() {
  if (!isTrainee()) return false;
  if (Store.mode === 'local') return true;
  return Store.mode === 'firebase' && !!S.myId && traineeId() === S.myId;
}
/* 이 판의 기록 쌓기 */
export function pushEntry(s, o) { (s.items = s.items || []).push(entryOf(o)); }

/* 앱이 백그라운드로 갔다 오면 지금 문항에 표시해요 (intr) */
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden && S.sess) S.sess.intr = true; });

/* 판이 끝났을 때(또는 그만둘 때) 한 번: 문서를 써요. 같은 판은 두 번 쓰지 않아요. */
export function flushItemLog(s, abandoned, sid) {
  if (!s || s.logged) return; s.logged = true;
  if (s.assess || !canLog()) return;
  let items = (s.items || []).slice();
  if (abandoned) {
    // 풀다 만 문항은 ABANDON 으로 표시해요 (정답률에서 빠져요)
    const c = s.cur;
    items.push(entryOf({ id: c ? c.id : codeItemId(s.g.id, s.level, s.idx), role: c ? c.role : codeRole(s.g.id), fmt: c ? c.fmt : s.g.id, cd: c ? c.cd : (s.g.cd || ''), lv: c ? c.lv : s.level, score: 0, ok: false, err: ['ABANDON'], pos: s.idx }));
  }
  if (!items.length) return;
  writeDocs(s, items, abandoned, sid || (s.sid || (Date.now() + '-' + Math.random().toString(36).slice(2, 8))));
}
export function writeDocs(s, items, abandoned, sid) {
  const docs = logDocs({ s: Object.assign({}, s, { date: s.date || todayS() }), items, abandoned, sid, uid: S.myId || 'local', speechOn: !!(synth && effectiveSound()), size: (S.eff && S.eff.size) || S.prefs.size, device: deviceKind(), now: new Date() });
  // 저장 실패(규칙이 아직 올라가지 않은 경우 등)는 조용히 넘겨요: 훈련 흐름과 "저장 문제" 안내에 영향이 없어야 해요
  docs.forEach(d => dbReady.then(async () => { if (!Store.adapter) return; try { await Store.setDoc('itemLogs/' + d.id, d.data); } catch (e) {} }));
}
