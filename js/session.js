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
    if (s.g.task) S.assess.tasks[s.g.id] = { domain: s.g.domain, score: Math.round(acc * 100), m: s.taskMetrics || {} };
    else S.assess.scores[s.key] = Math.round(acc * 100);
    S.assess.idx++;
    if (S.assess.idx >= ASSESS_STEPS.length) completeAssessment();
    else if (ASSESS_STEPS[S.assess.idx].part === 2 && ASSESS_STEPS[S.assess.idx - 1].part === 1) go('assessBreak');   // 1부분이 끝남: 쉬었다 이어서 / 내일 이어서
    else go('assessStep');
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

/* ================= 두뇌 건강 점검 (고정 난이도) =================
 * 1부분: 기존 다섯 영역 게임(약 8분). 2부분: 자체 과제 8개(약 7분, 한 번에 이어서).
 * 영역 점수(기억/집중/계산·순서/날짜·시간/반응)는 같은 영역 과제 점수들의 평균이에요. 규준·기준점은 없고 본인의 처음 기록과만 비교해요.
 * 두 번에 나눠 하려면 1부분이 끝났을 때 "내일 이어서 하기"를 눌러요 (3일 안에 이어서 해야 해요). */
export const ASSESS_STEPS = [
  { key: 'memory', gameId: 'words', level: 2, rounds: 2, part: 1 },
  { key: 'attention', gameId: 'odd', level: 3, rounds: 4, part: 1 },
  { key: 'executive', gameId: 'shop', level: 3, rounds: 4, part: 1 },
  { key: 'orientation', gameId: 'today', level: 3, rounds: 5, part: 1 },
  { key: 'speed', gameId: 'flash', level: 3, rounds: 5, part: 1 },
  { key: 'memory', gameId: 't_words', level: 1, rounds: 1, part: 2, task: true },
  { key: 'speed', gameId: 't_trails_a', level: 1, rounds: 1, part: 2, task: true },
  { key: 'executive', gameId: 't_trails_b', level: 1, rounds: 1, part: 2, task: true },
  { key: 'attention', gameId: 't_digits', level: 1, rounds: 1, part: 2, task: true },
  { key: 'speed', gameId: 't_reaction', level: 1, rounds: 1, part: 2, task: true },
  { key: 'attention', gameId: 't_stroop', level: 1, rounds: 1, part: 2, task: true },
  { key: 'orientation', gameId: 't_fluency', level: 1, rounds: 1, part: 2, task: true },
  { key: 'memory', gameId: 't_delayed', level: 1, rounds: 1, part: 2, task: true }   // 맨 끝: 처음 본 낱말 지연 회상
];
const DRAFT_DAYS = 3;
export const assessDraft = () => { const d = LS.get('bw.assessDraft', null); return d && d.ts && Date.now() - d.ts < DRAFT_DAYS * 864e5 && d.idx > 0 ? d : null; };
export function startAssessment() { S.assess = { idx: 0, scores: {}, tasks: {}, t0: Date.now(), memo: null }; LS.set('bw.assessDraft', null); go('assessStep'); }
export function resumeAssessment() {
  const d = assessDraft(); if (!d) return startAssessment();
  S.assess = { idx: d.idx, scores: d.scores || {}, tasks: d.tasks || {}, t0: Date.now(), memo: null }; go('assessStep');
}
export function saveAssessLater() { LS.set('bw.assessDraft', { ts: Date.now(), idx: S.assess.idx, scores: S.assess.scores, tasks: S.assess.tasks }); }
export function beginAssessStep() { const st = ASSESS_STEPS[S.assess.idx]; startSession(st.gameId, { assess: true, level: st.level, rounds: st.rounds, key: st.key }); }
/* 영역 점수 = 그 영역 게임 점수와 과제 점수의 평균 */
export function domainScores(scores, tasks) {
  const out = {};
  DOMAINS.forEach(d => {
    const xs = []; if (scores[d.id] != null) xs.push(Number(scores[d.id]));
    Object.keys(tasks || {}).forEach(k => { if (tasks[k].domain === d.id) xs.push(Number(tasks[k].score)); });
    if (xs.length) out[d.id] = Math.round(mean(xs));
  });
  return out;
}
export function completeAssessment() {
  const prev = allAssessments()[0] || null, now = new Date(), ts = Date.now(), tasks = S.assess.tasks || {};
  const scores = domainScores(S.assess.scores, tasks);
  const rec = { date: ymd(now), ts, scores, total: assessTotal(scores), userId: S.myId || null };
  S.assessLocal.push(Object.assign({ id: String(ts) }, rec)); S.assessLocal = S.assessLocal.slice(-60); LS.set('bw.assess', S.assessLocal);
  remoteSet('assessments/' + ts, rec);
  if (Object.keys(tasks).length) remoteSet('taskRuns/' + ts, { date: rec.date, ts, userId: S.myId || null, v: 1, tasks }, true);
  LS.set('bw.assessDraft', null);
  S.lastAssess = { rec, prev }; go('assessDone');
}
