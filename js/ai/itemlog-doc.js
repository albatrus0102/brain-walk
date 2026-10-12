import { SERVER_TS } from '../util.js';

/* ================= 문항별 기록 문서 만들기 (CLIENT-CONTRACT §1) — 순수 함수 =================
 * 화면·저장소와 상관없이 "어떤 문서를 쓰는지"만 정해요. 앱(itemlog.js, pm.js)과 에뮬레이터 시험
 * (tests/ai-client-contract.test.mjs)이 같은 함수를 써서, 앱이 만드는 모양이 규칙과 서버(aiOnItemLog)를 통과하는지 확인해요. */
export const LOG_V = 1;
export const ROLES = ['training', 'reference', 'anchor', 'proc'];
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const ERR_RE = /^[A-Z_]{2,24}$/;
/* 문항 한 개의 기록. o: { id, role, fmt, cd, lv, score(0~1), ok, rt, rtStart, err[], pick[], intr, pos } */
export function entryOf(o) {
  const e = { id: String(o.id || '').slice(0, 80), role: ROLES.includes(o.role) ? o.role : 'proc', fmt: String(o.fmt || '').slice(0, 24), cd: String(o.cd || '').slice(0, 16) };
  if (o.lv >= 1 && o.lv <= 5) e.lv = Math.round(o.lv);
  e.score = Math.max(0, Math.min(1, Math.round((Number(o.score) || 0) * 1000) / 1000));
  e.ok = !!o.ok;
  if (o.rt != null && isFinite(o.rt)) { e.rt = clampI(o.rt, 0, 600000); e.rtStart = o.rtStart === 'speech_end' ? 'speech_end' : 'display'; }
  e.err = (Array.isArray(o.err) ? o.err : []).filter((x, i, a) => typeof x === 'string' && ERR_RE.test(x) && a.indexOf(x) === i).slice(0, 4);
  e.pick = (Array.isArray(o.pick) ? o.pick : []).filter(n => Number.isInteger(n) && n >= 0 && n < 20).slice(0, 14);
  e.intr = !!o.intr;
  if (Number.isInteger(o.pos) && o.pos >= 0) e.pos = Math.min(50, o.pos);
  return e;
}
/* 코드가 만든 문항의 역할: 속도 과제(숫자 순서·번쩍 찾기·다른 그림)만 'proc', 나머지는 'training' (CLIENT-CONTRACT §1 의 역할 표) */
export const SPEED_GAMES = ['trail', 'flash', 'odd'];
export const codeRole = gameId => (SPEED_GAMES.includes(gameId) ? 'proc' : 'training');
export const codeItemId = (gameId, level, pos) => (codeRole(gameId) === 'proc' ? 'proc:' : 'code:') + gameId + ':L' + level + ':' + pos;

/* 게임 한 판 → 문서들 (20문항마다 나눠요: sid, sid-1, sid-2 …).
 * m: { s(판: g.id, date, level, inCourse, hour, logGameId, logInCourse), items, abandoned, sid, uid, speechOn, size, device, now(Date) }
 * sts 는 SERVER_TS 표시예요: 저장소가 serverTimestamp() 로 바꿔요. */
export function logDocs(m) {
  const s = m.s, now = m.now || new Date(), out = [];
  for (let i = 0, k = 0; i < m.items.length; i += 20, k++) {
    const data = { v: LOG_V, userId: m.uid, date: s.date, ts: now.getTime(), sts: SERVER_TS, gameId: String(s.logGameId || s.g.id).slice(0, 40), inCourse: s.logInCourse != null ? !!s.logInCourse : !!s.inCourse,
      speechOn: !!m.speechOn, size: String(m.size || '').slice(0, 10), device: String(m.device || '').slice(0, 20), hour: s.hour != null ? s.hour : now.getHours(), abandoned: !!m.abandoned, items: m.items.slice(i, i + 20) };
    if (Number.isFinite(s.level)) data.level = s.level;
    out.push({ id: k ? m.sid + '-' + k : m.sid, data });
  }
  return out;
}
