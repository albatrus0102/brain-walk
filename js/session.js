import { hasAny } from './ai/bank.js';
import { flushItemLog } from './ai/itemlog.js';
import { pmMidReminder, pmStart } from './ai/pm.js';
import { allAssessments, allCheckins, chatAvail, courseStatus, getLevel, getPlan, isTrainee, myTrainee, remoteSet, saveSession, todayProgressDoc, todayS } from './data.js';
import { DOMAINS, GAMES, catalog } from './games/registry.js';
import { assessTotal } from './logic.js';
import { sendMessage } from './messages.js';
import { buildCourse, effectiveLevel, estimateMinutes, nextLevelFor, roundsFor } from './program.js';
import { progressGameFinish, progressGameStart, progressMarkDone } from './progress.js';
import { S } from './state.js';
import { go } from './ui/shell.js';
import { LS, mean, rnd, ymd } from './util.js';

/* 오늘 코스: 계획대로 만들되, 문제 은행이 비어 있는 새 AI 게임은 빼요 (은행이 비면 앱은 예전처럼 돌아가요) */
export function buildToday(plan, date, cat) {
  const base = buildCourse(plan, date, cat), ok = base.filter(id => !GAMES[id].bank || hasAny(GAMES[id].cd, GAMES[id].formats));
  if (ok.length === base.length) return base;
  return ok.length ? ok : buildCourse(plan, date, cat.filter(g => !GAMES[g.id].bank));
}

/* ================= 세션 진행 ================= */
export { catalog };
/* 오늘 코스의 게임 수: 시작한 코스가 있으면 그 길이(진행 중에는 계획이 바뀌어도 그대로), 아니면 계획대로 */
export const courseLen = id => ((id == null || id === myTrainee()) && S.course && S.course.date === todayS() && S.course.games ? S.course.games.length : buildToday(getPlan(id == null ? undefined : id), todayS(), catalog()).length);
/* opts: inCourse(오늘의 코스로 기록), flow(코스 흐름 안: 끝나면 쉬는 화면), assess, level, rounds, key */
export function startSession(id, opts) {
  opts = opts || {};
  const g = GAMES[id], plan = getPlan();
  S.sess = { g, level: opts.level || effectiveLevel(id, plan, getLevel(id)), idx: 0, correct: 0, total: 0, t0: Date.now(), inCourse: !!opts.inCourse, flow: !!(opts.flow || opts.inCourse), assess: !!opts.assess, key: opts.key || null,
    rounds: opts.rounds || roundsFor(g, plan), mem: {}, roundSec: [], items: [], date: todayS(), hour: new Date().getHours(), logged: false };
  if (S.sess.inCourse) progressGameStart(id, 'course'); else if (S.sess.assess) progressGameStart(id, 'check');
  go('game');
}
export function finishSession() {
  const s = S.sess, now = new Date();
  // 코스 끝의 "늦게 묻는 이야기 질문"이 끝났어요: 기록만 남기고 코스를 마무리해요
  if (s.delayed) { s.sid = s.sid || Date.now() + '-d'; s.logGameId = 'story'; s.logInCourse = true; flushItemLog(s, false, s.sid); S.course.delayed = []; S.course.delayedDone = true; return finishCourse(); }
  const total = Math.max(1, s.total), acc = s.total ? s.correct / total : 0.7, dur = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
  if (s.assess) {
    progressGameFinish(s.g.id, { acc, correct: s.correct, total: s.total, sec: dur, level: s.level });
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
  const nl = nextLevelFor(s.g.id, getPlan(), s.level, acc, prevAcc);
  S.hist[s.g.id] = hist.concat([acc]).slice(-3); LS.set('bw.hist', S.hist);
  const rec = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), date: ymd(now), ts: Date.now(), gameId: s.g.id, gameName: s.g.name, domain: s.g.domain,
    level: s.level, correct: s.correct, total: s.total, accuracy: Math.round(acc * 1000) / 1000, durationSec: dur, inCourse: s.inCourse, roundSec: s.roundSec, userId: S.myId || null };
  saveSession(rec, nl.level, nl.store);
  s.sid = rec.id; flushItemLog(s, false, rec.id);       // 문항별 기록 (AI 리포트용, 훈련하는 분 기기만)
  S.last = { rec, old: s.level, nl: nl.level, kind: nl.kind, score: Math.round(acc * 100) };
  if (s.flow && S.course) {
    S.course.results.push({ gameId: s.g.id, correct: s.correct, total: s.total, acc, dur, kind: nl.kind });
    if (s.inCourse) {
      LS.set('bw.course', { date: S.course.date, games: S.course.games, results: S.course.results });
      progressGameFinish(s.g.id, { acc, correct: s.correct, total: s.total, sec: dur, level: s.level });
    }
    if (isTrainee()) { if (S.course.results.length < S.course.games.length) pmMidReminder(); return S.course.results.length >= S.course.games.length ? finishCourse() : go('courseBreak'); }
  }
  go('result');
}
const PRAISE = ['잘하셨어요!', '아주 좋아요!', '역시 대단하세요!', '정말 훌륭해요!'];
export const praise = () => PRAISE[rnd(0, PRAISE.length - 1)];
/* 오늘 이어서 할 코스를 정해요. 우선순위: 오늘 진행 문서(시작한 코스) → 이 기기에 저장된 코스 → 옛 형식 저장분 → 새로 */
function resumeSource(today) {
  const p = todayProgressDoc();
  if (p && p.kind === 'course' && p.status === 'started' && Array.isArray(p.planned) && p.planned.length && Array.isArray(p.results)) {
    return { games: p.planned.slice(), results: p.results.map(r => ({ gameId: r.g, correct: r.c, total: r.t, acc: r.acc, dur: r.sec })) };
  }
  const saved = LS.get('bw.course', null);
  if (saved && saved.date === today && Array.isArray(saved.results)) {
    if (Array.isArray(saved.games) && saved.games.length) { if (saved.results.length < saved.games.length) return { games: saved.games.slice(), results: saved.results }; }
    else { const games = buildToday(getPlan(), today, catalog()); if (saved.results.length < games.length) return { games, results: saved.results }; }
  }
  return null;
}
/* 홈 화면용 오늘 코스 요약: 끝났는지, 몇 개 중 몇 개 했는지, 예상 시간 */
export function courseInfo() {
  const today = todayS(), plan = getPlan(), cat = catalog(), r = resumeSource(today), cs = courseStatus(), p = todayProgressDoc();
  const N = r ? r.games.length : (p && p.kind === 'course' && Array.isArray(p.planned) && p.planned.length ? p.planned.length : buildToday(plan, today, cat).length);
  const n = r ? r.results.length : 0;
  return { done: cs.done, n, N, started: n > 0, minutes: estimateMinutes(plan, today, cat) };
}
/* 오늘의 코스 시작/이어하기. opts.replay: 이미 마친 코스를 한 번 더 (오늘 기록에 더하지 않고, 진행 상황도 쓰지 않아요) */
export function startCourse(opts) {
  const today = todayS(), p = todayProgressDoc(), done = !!(p && p.kind === 'course' && p.status === 'done');
  const replay = !!((opts && opts.replay) || done);
  let games, results = [];
  // 점검 날(진행 문서가 'check')의 "한 번 더"는 점검 과제가 아니라 오늘의 코스를 해요
  if (replay) games = (p && p.kind === 'course' && Array.isArray(p.planned) && p.planned.length ? p.planned.slice() : buildToday(getPlan(), today, catalog()));
  else { const r = resumeSource(today); games = r ? r.games : buildToday(getPlan(), today, catalog()); results = r ? r.results : []; }
  S.course = { date: today, games, results, replay, delayed: [] };
  pmStart(!replay && !results.length);
  nextCourseStep();
}
export function nextCourseStep() {
  const c = S.course;
  if (c.results.length >= c.games.length) return finishCourse();
  startSession(c.games[c.results.length], { inCourse: !c.replay, flow: true });
}
/* 코스의 마지막 게임 뒤: (켜져 있고 오늘 아직이면) 생활 체크를 흐름 안에서 묻고, 그다음 축하 화면 */
export function finishCourse() {
  const c = S.course;
  // 이야기 듣기에서 모아 둔 "늦게 묻는 질문"을 마지막 게임 뒤에 물어요 (약 10분 뒤 회상)
  if (!c.replay && !c.delayedDone && c.delayed && c.delayed.length && isTrainee()) return startDelayed();
  if (!c.replay) S.notifyPending = true;
  if (!c.replay && isTrainee() && getPlan().checkin && !allCheckins()[todayS()]) { S.ciFlow = true; S.ci = {}; return go('checkin'); }
  S.ciFlow = false; go('courseDone');
}
function startDelayed() {
  const c = S.course;
  S.sess = { g: GAMES.delayedq, level: 1, idx: 0, correct: 0, total: 0, t0: Date.now(), inCourse: false, flow: false, assess: false, key: null, delayed: true, rounds: c.delayed.length, mem: {}, roundSec: [], items: [], date: todayS(), hour: new Date().getHours(), logged: false };
  go('game');
}
export function maybeNotify() {
  if (!S.notifyPending) return; S.notifyPending = false;
  if (!S.notifyFamily || !chatAvail() || !S.course) return;
  const res = S.course.results, avg = res.length ? Math.round(mean(res.map(r => r.acc || 0)) * 100) : 0;
  sendMessage({ kind: 'system', text: '오늘 훈련 ' + S.course.games.length + '개를 모두 마쳤어요 (정답률 ' + avg + '%)', record: { type: 'course', ref: todayS(), title: '오늘의 훈련', score: avg } });
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
  progressMarkDone();
  S.lastAssess = { rec, prev }; go('assessDone');
}
