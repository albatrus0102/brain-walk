import { allAssessments, chatAvail, getLevel, remoteSet, saveSession, todayS } from './data.js';
import { DOMAINS, GAMES, gamesOf } from './games/registry.js';
import { assessTotal, nextLevel } from './logic.js';
import { sendMessage } from './messages.js';
import { S } from './state.js';
import { go } from './ui/shell.js';
import { LS, dayNum, mean, rnd, ymd } from './util.js';

/* ================= 세션 진행 ================= */
export const COURSE_N = DOMAINS.length;
export function startSession(id, opts) {
  opts = opts || {};
  const g = GAMES[id];
  S.sess = { g, level: opts.level || getLevel(id), idx: 0, correct: 0, total: 0, t0: Date.now(), inCourse: !!opts.inCourse, assess: !!opts.assess, key: opts.key || null, rounds: opts.rounds || g.rounds, mem: {}, roundSec: [] };
  go('game');
}
export function finishSession() {
  const s = S.sess, now = new Date();
  const total = Math.max(1, s.total), acc = s.correct / total, dur = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
  if (s.assess) {
    S.assess.scores[s.key] = Math.round(acc * 100); S.assess.idx++;
    if (S.assess.idx >= ASSESS_STEPS.length) completeAssessment(); else go('assessStep');
    return;
  }
  const hist = Array.isArray(S.hist[s.g.id]) ? S.hist[s.g.id] : [];
  const prevAcc = hist.length ? hist[hist.length - 1] : null;
  const nl = nextLevel(s.level, acc, prevAcc);
  S.hist[s.g.id] = hist.concat([acc]).slice(-3); LS.set('bw.hist', S.hist);
  const rec = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), date: ymd(now), ts: Date.now(), gameId: s.g.id, gameName: s.g.name, domain: s.g.domain,
    level: s.level, correct: s.correct, total: s.total, accuracy: Math.round(acc * 1000) / 1000, durationSec: dur, inCourse: s.inCourse, roundSec: s.roundSec, userId: S.myId || null };
  saveSession(rec, nl.level);
  S.last = { rec, old: s.level, nl: nl.level, kind: nl.kind, score: Math.round(acc * 100) };
  if (s.inCourse && S.course) {
    S.course.results.push({ gameId: s.g.id, correct: s.correct, total: s.total, acc, dur });
    LS.set('bw.course', { date: S.course.date, results: S.course.results });
  }
  go('result');
}
const PRAISE = ['잘하셨어요!', '아주 좋아요!', '역시 대단하세요!', '정말 훌륭해요!'];
export const praise = () => PRAISE[rnd(0, PRAISE.length - 1)];
export function courseGames(d) {
  const n = dayNum(d), order = DOMAINS.map(x => x.id), k = order.length;
  const rot = n % k, rotated = order.slice(rot).concat(order.slice(0, rot));
  return rotated.map(dom => { const gs = gamesOf(dom); return gs[(n + order.indexOf(dom)) % gs.length]; });
}
export function startCourse() {
  const now = new Date(), today = ymd(now), saved = LS.get('bw.course', null), games = courseGames(now);
  let results = [];
  if (saved && saved.date === today && Array.isArray(saved.results) && saved.results.length < COURSE_N) results = saved.results;
  S.course = { date: today, games, results };
  nextCourseStep();
}
export function nextCourseStep() {
  if (S.course.results.length >= COURSE_N) { S.notifyPending = true; return go('courseDone'); }
  startSession(S.course.games[S.course.results.length], { inCourse: true });
}
export function maybeNotify() {
  if (!S.notifyPending) return; S.notifyPending = false;
  if (!S.notifyFamily || !chatAvail() || !S.course) return;
  const res = S.course.results, avg = res.length ? Math.round(mean(res.map(r => r.acc || 0)) * 100) : 0;
  sendMessage({ kind: 'system', text: '오늘 훈련 ' + COURSE_N + '개를 모두 마쳤어요 (정답률 ' + avg + '%)', record: { type: 'course', ref: todayS(), title: '오늘의 훈련', score: avg } });
}

/* ================= 두뇌 건강 점검 (고정 난이도) ================= */
export const ASSESS_STEPS = [
  { key: 'memory', gameId: 'words', level: 2, rounds: 2 },
  { key: 'attention', gameId: 'odd', level: 3, rounds: 4 },
  { key: 'executive', gameId: 'shop', level: 3, rounds: 4 },
  { key: 'orientation', gameId: 'today', level: 3, rounds: 5 },
  { key: 'speed', gameId: 'flash', level: 3, rounds: 5 }
];
export function startAssessment() { S.assess = { idx: 0, scores: {}, t0: Date.now() }; go('assessStep'); }
export function beginAssessStep() { const st = ASSESS_STEPS[S.assess.idx]; startSession(st.gameId, { assess: true, level: st.level, rounds: st.rounds, key: st.key }); }
function completeAssessment() {
  const prev = allAssessments()[0] || null, now = new Date(), ts = Date.now();
  const rec = { date: ymd(now), ts, scores: Object.assign({}, S.assess.scores), total: assessTotal(S.assess.scores), userId: S.myId || null };
  S.assessLocal.push(Object.assign({ id: String(ts) }, rec)); S.assessLocal = S.assessLocal.slice(-60); LS.set('bw.assess', S.assessLocal);
  remoteSet('assessments/' + ts, rec);
  S.lastAssess = { rec, prev }; go('assessDone');
}
