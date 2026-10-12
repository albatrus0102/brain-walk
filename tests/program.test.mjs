/* 순수 로직 시험: js/program.js (훈련 계획·화면 설정·코스·난이도·요일·점검 주기·오늘 상태)
 * 실행: cd tests && npm run test:unit   (= node --test program.test.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_DEFAULTS, DISPLAY_DEFAULTS, normalizePlan, normalizeGame, planProblems, planDoc, normalizeDisplay, displayDoc, effectiveDisplay,
  roundsFor, buildCourse, estimateMinutes, effectiveLevel, nextLevelFor, isTrainingDay, nextTrainingDate, checkDue,
  progressStart, progressFinish, progressId, deriveToday, weekStrip, presenceState, shouldBeat, PAUSED_AFTER_MS
} from '../js/program.js';
import { DOMAINS } from '../js/games/registry.js';
import { dayNum, addDays, parseYmd } from '../js/util.js';

/* 실제 registry 순서와 같은 게임 목록 (js/games/index.js 의 import 순서) */
const CAT = [
  { id: 'cards', domain: 'memory', rounds: 2 }, { id: 'words', domain: 'memory', rounds: 3 },
  { id: 'odd', domain: 'attention', rounds: 5 }, { id: 'trail', domain: 'attention', rounds: 3 },
  { id: 'shop', domain: 'executive', rounds: 5 }, { id: 'order', domain: 'executive', rounds: 3 },
  { id: 'today', domain: 'orientation', rounds: 5 }, { id: 'proverb', domain: 'orientation', rounds: 5 },
  { id: 'flash', domain: 'speed', rounds: 5 }
];
const IDS = CAT.map(g => g.id);
/* 예전 session.courseGames (바뀌기 전 그대로) */
function legacyCourse(d) {
  const n = dayNum(d), order = DOMAINS.map(x => x.id), k = order.length;
  const rot = n % k, rotated = order.slice(rot).concat(order.slice(0, rot));
  const gamesOf = dom => CAT.filter(g => g.domain === dom).map(g => g.id);
  return rotated.map(dom => { const gs = gamesOf(dom); return gs[(n + order.indexOf(dom)) % gs.length]; });
}

/* ------------------------------------------------------------ defaults */
test('defaults: missing plan → every game on, auto 1–5, 5 a day, rotate, all days, 4 weeks, check-in on, score hidden', () => {
  const p = normalizePlan(undefined, CAT);
  assert.equal(p.gamesPerDay, 5); assert.equal(p.roundsPerGame, null); assert.equal(p.targetMin, 15);
  assert.equal(p.order, 'rotate'); assert.deepEqual(p.weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(p.checkEveryWeeks, 4); assert.equal(p.checkin, true); assert.equal(p.showScore, false);
  assert.deepEqual(Object.keys(p.games), IDS);
  IDS.forEach(id => assert.deepEqual(p.games[id], { on: true, mode: 'auto', min: 1, max: 5, level: 2 }));
  assert.deepEqual(p.fixedOrder, IDS);
  assert.equal(PLAN_DEFAULTS.showScore, false);
});
test('normalize clamps ranges and fixes types', () => {
  const p = normalizePlan({ gamesPerDay: 42, roundsPerGame: 1, targetMin: 999, weekdays: [9, -1, '2', 2, 3.5], checkEveryWeeks: 5, order: 'zigzag', showScore: 'yes', checkin: false,
    games: { cards: { on: false, mode: 'fixed', level: 9 }, odd: { min: 4, max: 2 }, nope: { on: true } }, fixedOrder: ['flash', 'flash', 'nope', 'odd'] }, CAT);
  assert.equal(p.gamesPerDay, 9); assert.equal(p.roundsPerGame, 3); assert.equal(p.targetMin, 60);
  assert.deepEqual(p.weekdays, [2]); assert.equal(p.checkEveryWeeks, 4); assert.equal(p.order, 'rotate');
  assert.equal(p.showScore, false); assert.equal(p.checkin, false);
  assert.deepEqual(p.games.cards, { on: false, mode: 'fixed', min: 1, max: 5, level: 5 });
  assert.deepEqual([p.games.odd.min, p.games.odd.max], [2, 4]);          // swapped
  assert.ok(!('nope' in p.games));
  assert.deepEqual(p.fixedOrder.slice(0, 2), ['flash', 'odd']); assert.equal(p.fixedOrder.length, IDS.length);
  assert.equal(normalizePlan({ gamesPerDay: 0, roundsPerGame: 77, targetMin: 1, checkEveryWeeks: 7 }, CAT).gamesPerDay, 1);
  assert.equal(normalizePlan({ roundsPerGame: 77 }, CAT).roundsPerGame, 10);
  assert.equal(normalizePlan({ targetMin: 1 }, CAT).targetMin, 5);
  assert.equal(normalizePlan({ targetMin: 23 }, CAT).targetMin, 25);
  assert.equal(normalizePlan({ checkEveryWeeks: 7 }, CAT).checkEveryWeeks, 8);
  assert.equal(normalizePlan({ checkEveryWeeks: 0 }, CAT).checkEveryWeeks, 0);
  assert.equal(normalizePlan({ weekdays: [] }, CAT).weekdays.length, 7);        // learner never ends up with no days
  assert.equal(normalizePlan({ roundsPerGame: null }, CAT).roundsPerGame, null);
});
test('all games off → treated as all on (learner never gets an empty course); planProblems reports it', () => {
  const raw = { games: Object.fromEntries(IDS.map(id => [id, { on: false }])), weekdays: [] };
  assert.ok(IDS.every(id => normalizePlan(raw, CAT).games[id].on));
  assert.deepEqual(planProblems(raw, CAT), ['게임을 하나 이상 골라 주세요.', '훈련 요일을 하루 이상 골라 주세요.']);
  assert.deepEqual(planProblems(normalizePlan({}, CAT), CAT), []);
  assert.deepEqual(planProblems({ games: { odd: { min: 4, max: 2 } } }, CAT), ['가장 쉬운 단계가 가장 어려운 단계보다 높아요.']);
});
test('planDoc carries author and time and is idempotent', () => {
  const d = planDoc({ gamesPerDay: 3 }, CAT, 'mA', 1700000000000);
  assert.equal(d.updatedBy, 'mA'); assert.equal(d.updatedTs, 1700000000000); assert.equal(d.v, 1);
  const { updatedBy, updatedTs, ...rest } = d;
  assert.deepEqual(normalizePlan(rest, CAT), rest);
});
test('display: defaults, clamping, effective display per device', () => {
  assert.deepEqual(normalizeDisplay(null), { v: 1, font: 'pretendard', size: 'large', contrast: false, voice: true, rate: 0.9 });
  assert.deepEqual(normalizeDisplay({ font: 'comic', size: 'huge', contrast: 1, voice: false, rate: 5 }), { v: 1, font: 'pretendard', size: 'large', contrast: false, voice: false, rate: 1.2 });
  assert.equal(normalizeDisplay({ rate: 0.1 }).rate, 0.6);
  assert.equal(normalizeDisplay({ rate: 0.77 }).rate, 0.75);
  assert.equal(normalizeDisplay({ size: 'max' }).size, 'max');
  const remote = { font: 'noto', size: 'max', contrast: true, voice: true, rate: 0.75 }, local = { font: 'system', size: 'normal', contrast: false, voice: false };
  assert.equal(effectiveDisplay(remote, local, true).size, 'max');           // learner device: admin's choice wins
  assert.equal(effectiveDisplay(remote, local, false).size, 'normal');       // family device: own choice
  assert.equal(effectiveDisplay(null, local, true).font, 'system');           // no remote doc yet: keep the device's own (back-compat)
  assert.equal(effectiveDisplay(null, {}, false).size, 'normal');
  assert.equal(displayDoc({ size: 'xlarge' }, 'mB', 1).updatedBy, 'mB');
  assert.equal(DISPLAY_DEFAULTS.font, 'pretendard');
});

/* ----------------------------------------------------- course builder */
test('rotate with defaults is identical to the legacy courseGames for 2 years of dates', () => {
  let d = new Date(2025, 0, 1);
  for (let i = 0; i < 730; i++) {
    assert.deepEqual(buildCourse(undefined, d, CAT), legacyCourse(d), 'day ' + i);
    assert.deepEqual(buildCourse(PLAN_DEFAULTS, d, CAT), legacyCourse(d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
});
test('accepts YYYY-MM-DD strings as well as Date', () => {
  assert.deepEqual(buildCourse({}, '2026-10-12', CAT), buildCourse({}, new Date(2026, 9, 12), CAT));
});
test('rotate: fewer games per day takes the first domains of the rotated order', () => {
  const d = '2026-10-12';
  for (let n = 1; n <= 5; n++) assert.deepEqual(buildCourse({ gamesPerDay: n }, d, CAT), legacyCourse(parseYmd(d)).slice(0, n));
});
test('rotate: more than 5 a day adds second games per domain, never repeats within a day', () => {
  for (let i = 0; i < 60; i++) {
    const d = addDays('2026-01-01', i);
    const c9 = buildCourse({ gamesPerDay: 9 }, d, CAT);
    assert.equal(c9.length, 9); assert.equal(new Set(c9).size, 9);
    assert.deepEqual(c9.slice(0, 5), legacyCourse(parseYmd(d)));
    const c7 = buildCourse({ gamesPerDay: 7 }, d, CAT);
    assert.equal(new Set(c7).size, 7); assert.deepEqual(c7, c9.slice(0, 7));
  }
});
test('rotate: disabled games are skipped, domain with none is skipped, capped at enabled count', () => {
  const plan = { gamesPerDay: 9, games: { cards: { on: false }, words: { on: false }, flash: { on: false } } };
  for (let i = 0; i < 30; i++) {
    const c = buildCourse(plan, addDays('2026-03-01', i), CAT);
    assert.equal(c.length, 6); assert.ok(!c.some(id => ['cards', 'words', 'flash'].includes(id)));
    assert.equal(new Set(c).size, 6);
  }
  const only = { games: Object.fromEntries(IDS.map(id => [id, { on: id === 'shop' }])) };
  assert.deepEqual(buildCourse(only, '2026-03-01', CAT), ['shop']);
});
test('rotate: course changes from day to day (variety)', () => {
  const seen = new Set(); for (let i = 0; i < 10; i++) seen.add(buildCourse({}, addDays('2026-05-01', i), CAT).join(','));
  assert.ok(seen.size >= 5);
});
test('fixed order: same every day, enabled only, first N', () => {
  const plan = { order: 'fixed', gamesPerDay: 3, fixedOrder: ['flash', 'cards', 'shop', 'odd'], games: { cards: { on: false } } };
  assert.deepEqual(buildCourse(plan, '2026-10-12', CAT), ['flash', 'shop', 'odd']);
  assert.deepEqual(buildCourse(plan, '2026-10-13', CAT), ['flash', 'shop', 'odd']);
  assert.deepEqual(buildCourse({ order: 'fixed', gamesPerDay: 9 }, '2026-10-13', CAT), IDS);
});
test('roundsFor scales relative to a 5-round game', () => {
  const g5 = CAT.find(g => g.id === 'odd'), g2 = CAT.find(g => g.id === 'cards'), g3 = CAT.find(g => g.id === 'trail');
  assert.equal(roundsFor(g5, { roundsPerGame: null }), 5); assert.equal(roundsFor(g2, {}), 2);
  assert.equal(roundsFor(g5, { roundsPerGame: 3 }), 3); assert.equal(roundsFor(g5, { roundsPerGame: 10 }), 10);
  assert.equal(roundsFor(g2, { roundsPerGame: 10 }), 4); assert.equal(roundsFor(g2, { roundsPerGame: 3 }), 1);
  assert.equal(roundsFor(g3, { roundsPerGame: 10 }), 6); assert.equal(roundsFor(g3, { roundsPerGame: 3 }), 2);
});
test('estimateMinutes ≈ 3 min per default game', () => {
  assert.equal(estimateMinutes({}, '2026-10-12', CAT), 15);
  assert.equal(estimateMinutes({ gamesPerDay: 2 }, '2026-10-12', CAT), 6);
  assert.equal(estimateMinutes({ order: 'fixed', fixedOrder: ['odd'], gamesPerDay: 1, roundsPerGame: 10 }, '2026-10-12', CAT), 6);
});

/* ------------------------------------------------------------- levels */
test('effectiveLevel: fixed wins; auto clamps adaptive history to bounds', () => {
  const plan = { games: { odd: { mode: 'fixed', level: 4 }, shop: { mode: 'auto', min: 2, max: 3 } } };
  assert.equal(effectiveLevel('odd', plan, 1), 4);
  assert.equal(effectiveLevel('shop', plan, 1), 2); assert.equal(effectiveLevel('shop', plan, 5), 3); assert.equal(effectiveLevel('shop', plan, 3), 3);
  assert.equal(effectiveLevel('flash', plan, 4), 4); assert.equal(effectiveLevel('flash', undefined, 9), 1);
  assert.equal(effectiveLevel('flash', null, undefined), 1);
});
test('nextLevelFor: same as logic.nextLevel inside bounds', () => {
  assert.deepEqual(nextLevelFor('odd', {}, 2, 0.9, null), { level: 3, kind: 'up', store: true });
  assert.deepEqual(nextLevelFor('odd', {}, 2, 0.4, null), { level: 1, kind: 'down', store: true });
  assert.deepEqual(nextLevelFor('odd', {}, 3, 0.4, 0.3), { level: 2, kind: 'down2', store: true });
  assert.deepEqual(nextLevelFor('odd', {}, 3, 0.6, null), { level: 3, kind: 'same', store: true });
  assert.deepEqual(nextLevelFor('odd', {}, 5, 0.9, null), { level: 5, kind: 'max', store: true });
  assert.deepEqual(nextLevelFor('odd', {}, 1, 0.1, null), { level: 1, kind: 'min', store: true });
});
test('nextLevelFor: bounds stop the climb and the fall; fixed never stores', () => {
  const plan = { games: { odd: { min: 2, max: 3 }, shop: { mode: 'fixed', level: 2 } } };
  assert.deepEqual(nextLevelFor('odd', plan, 3, 1, null), { level: 3, kind: 'max', store: true });
  assert.deepEqual(nextLevelFor('odd', plan, 2, 0, 0), { level: 2, kind: 'min', store: true });
  assert.deepEqual(nextLevelFor('odd', plan, 5, 0.6, null), { level: 3, kind: 'same', store: true });   // history above max is pulled in
  assert.deepEqual(nextLevelFor('odd', plan, 2, 0.9, null), { level: 3, kind: 'up', store: true });
  assert.deepEqual(nextLevelFor('shop', plan, 4, 1, null), { level: 2, kind: 'fixed', store: false });
});

/* --------------------------------------------------- weekday / checks */
test('training weekdays', () => {
  const plan = { weekdays: [1, 3, 5] };                            // 월 수 금
  assert.equal(isTrainingDay(plan, '2026-10-12'), true);           // 월
  assert.equal(isTrainingDay(plan, '2026-10-13'), false);          // 화
  assert.equal(isTrainingDay({}, '2026-10-13'), true);
  assert.equal(nextTrainingDate(plan, '2026-10-13'), '2026-10-14');
  assert.equal(nextTrainingDate(plan, '2026-10-16'), '2026-10-19');
  assert.equal(nextTrainingDate({ weekdays: [1] }, '2026-10-12'), '2026-10-19');
});
test('monthly check interval', () => {
  assert.deepEqual(checkDue({ checkEveryWeeks: 0 }, '2026-01-01', '2026-10-12', true), { state: 'off' });
  assert.equal(checkDue({}, null, '2026-10-12', false).state, 'none');
  assert.deepEqual(checkDue({}, null, '2026-10-12', true), { state: 'due', first: true, days: null, interval: 28 });
  assert.equal(checkDue({}, '2026-09-14', '2026-10-12', true).state, 'due');                    // exactly 28 days
  assert.deepEqual(checkDue({}, '2026-09-15', '2026-10-12', true), { state: 'wait', days: 27, remain: 1, interval: 28 });
  assert.equal(checkDue({ checkEveryWeeks: 2 }, '2026-09-28', '2026-10-12', true).state, 'due');
  assert.equal(checkDue({ checkEveryWeeks: 8 }, '2026-09-28', '2026-10-12', true).remain, 42);
});

/* ------------------------------------------------- progress reducers */
const T0 = 1760000000000;
test('progress: start → finish → … → done, ids and shape', () => {
  assert.equal(progressId('2026-10-12', 'mA'), '2026-10-12-mA');
  let p = progressStart(null, { userId: 'mA', date: '2026-10-12', planned: ['odd', 'shop'], gameId: 'odd', now: T0 });
  assert.deepEqual(p, { userId: 'mA', date: '2026-10-12', v: 1, kind: 'course', planned: ['odd', 'shop'], idx: 0, results: [], status: 'started', startTs: T0, doneTs: null, current: 'odd', currentTs: T0, updatedTs: T0 });
  p = progressFinish(p, { gameId: 'odd', result: { acc: 0.8333, correct: 5, total: 6, sec: 61.4, level: 2 }, now: T0 + 60e3 });
  assert.equal(p.idx, 1); assert.equal(p.current, null); assert.equal(p.status, 'started');
  assert.deepEqual(p.results[0], { g: 'odd', acc: 0.833, c: 5, t: 6, sec: 61, lv: 2, ts: T0 + 60e3 });
  p = progressStart(p, { userId: 'mA', date: '2026-10-12', planned: ['odd', 'shop'], gameId: 'shop', now: T0 + 70e3 });
  assert.equal(p.idx, 1); assert.equal(p.current, 'shop'); assert.equal(p.startTs, T0);
  p = progressFinish(p, { gameId: 'shop', result: { acc: 1, correct: 5, total: 5, sec: 40, level: 3 }, now: T0 + 120e3 });
  assert.equal(p.status, 'done'); assert.equal(p.doneTs, T0 + 120e3); assert.equal(p.idx, 2);
  // 다시 하기(완료 뒤)는 상태를 되돌리지 않아요
  const again = progressStart(p, { userId: 'mA', date: '2026-10-12', planned: ['flash'], gameId: 'flash', now: T0 + 200e3 });
  assert.equal(again.status, 'done'); assert.deepEqual(again.planned, ['odd', 'shop']);
  // 다음 날은 새 문서
  const next = progressStart(p, { userId: 'mA', date: '2026-10-13', planned: ['flash'], gameId: 'flash', now: T0 + 864e5 });
  assert.equal(next.date, '2026-10-13'); assert.equal(next.results.length, 0);
  // 결과는 13개를 넘지 않아요 (규칙의 목록 상한)
  let q = progressStart(null, { userId: 'mA', date: '2026-10-12', kind: 'check', planned: Array(20).fill('x'), now: T0 });
  assert.equal(q.planned.length, 13); assert.equal(q.kind, 'check');
  for (let i = 0; i < 20; i++) q = progressFinish(q, { gameId: 'x', result: {}, now: T0 + i });
  assert.equal(q.results.length, 13); assert.equal(q.status, 'done');
});

/* ------------------------------------------------- dashboard status */
const plan3 = { order: 'fixed', fixedOrder: ['odd', 'shop', 'flash'], gamesPerDay: 3, weekdays: [1, 2, 3, 4, 5] };
test('deriveToday: not started / rest day', () => {
  assert.equal(deriveToday({ progress: null, plan: plan3, today: '2026-10-12', now: T0, catalog: CAT }).state, 'notStarted');
  const r = deriveToday({ progress: null, plan: plan3, today: '2026-10-11', now: T0, catalog: CAT });   // 일요일
  assert.equal(r.state, 'rest'); assert.equal(r.N, 3); assert.deepEqual(r.planned, ['odd', 'shop', 'flash']);
});
test('deriveToday: in progress with current game, then paused after 30 min idle', () => {
  let p = progressStart(null, { userId: 'mA', date: '2026-10-12', planned: ['odd', 'shop', 'flash'], gameId: 'odd', now: T0 });
  p = progressFinish(p, { gameId: 'odd', result: { acc: 0.8, correct: 4, total: 5, sec: 50, level: 2 }, now: T0 + 60e3 });
  p = progressStart(p, { userId: 'mA', date: '2026-10-12', planned: ['odd', 'shop', 'flash'], gameId: 'shop', now: T0 + 65e3 });
  const r = deriveToday({ progress: p, plan: plan3, today: '2026-10-12', now: T0 + 90e3, catalog: CAT });
  assert.equal(r.state, 'inProgress'); assert.equal(r.n, 1); assert.equal(r.N, 3); assert.equal(r.current, 'shop'); assert.equal(r.currentSince, T0 + 65e3);
  assert.deepEqual(r.results[0], { gameId: 'odd', acc: 0.8, correct: 4, total: 5, sec: 50, level: 2, ts: T0 + 60e3 });
  assert.equal(r.lastTs, T0 + 65e3);
  assert.equal(deriveToday({ progress: p, plan: plan3, today: '2026-10-12', now: T0 + 65e3 + PAUSED_AFTER_MS + 1, catalog: CAT }).state, 'paused');
  // 서버 시간(sts, Timestamp 모양)이 더 늦으면 그걸 써요
  const withSts = Object.assign({}, p, { sts: { toMillis: () => T0 + 100e3 } });
  assert.equal(deriveToday({ progress: withSts, plan: plan3, today: '2026-10-12', now: T0 + 100e3, catalog: CAT }).lastTs, T0 + 100e3);
});
test('deriveToday: done; yesterday\'s doc is ignored', () => {
  let p = progressStart(null, { userId: 'mA', date: '2026-10-12', planned: ['odd'], gameId: 'odd', now: T0 });
  p = progressFinish(p, { gameId: 'odd', result: { acc: 1, correct: 5, total: 5, sec: 30, level: 1 }, now: T0 + 30e3 });
  const r = deriveToday({ progress: p, plan: plan3, today: '2026-10-12', now: T0 + 9e6, catalog: CAT });
  assert.equal(r.state, 'done'); assert.equal(r.N, 1); assert.equal(r.doneTs, T0 + 30e3); assert.equal(r.current, null);
  assert.equal(deriveToday({ progress: p, plan: plan3, today: '2026-10-13', now: T0, catalog: CAT }).state, 'notStarted');
});
test('deriveToday: legacy app (sessions only, no progress doc)', () => {
  const s = (g, ts) => ({ date: '2026-10-12', inCourse: true, gameId: g, ts, accuracy: 0.6, correct: 3, total: 5, durationSec: 40, level: 2 });
  const r = deriveToday({ progress: null, plan: plan3, today: '2026-10-12', now: T0 + 1000, sessionsToday: [s('odd', T0), { date: '2026-10-12', inCourse: false, gameId: 'x', ts: T0 }], catalog: CAT });
  assert.equal(r.state, 'inProgress'); assert.equal(r.legacy, true); assert.equal(r.n, 1);
  const done = deriveToday({ progress: null, plan: plan3, today: '2026-10-12', now: T0 + 1000, sessionsToday: [s('odd', T0), s('shop', T0 + 1), s('flash', T0 + 2)], catalog: CAT });
  assert.equal(done.state, 'done');
});
test('weekStrip: 7 days ending today with done / partial / missed / rest / today-open', () => {
  const pd = (date, n, status) => ({ date, planned: ['odd', 'shop', 'flash'], results: Array(n).fill({ g: 'odd' }), status });
  const strip = weekStrip({ plan: plan3, today: '2026-10-12', catalog: CAT,
    progressList: [pd('2026-10-06', 3, 'done'), pd('2026-10-07', 1, 'started')],
    sessions: [{ date: '2026-10-08', inCourse: true, gameId: 'odd' }, { date: '2026-10-08', inCourse: true, gameId: 'shop' }, { date: '2026-10-08', inCourse: true, gameId: 'flash' }] });
  assert.deepEqual(strip.map(d => d.date), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(strip.map(d => d.state), ['done', 'partial', 'done', 'missed', 'rest', 'rest', 'today-open']);
  assert.equal(strip[6].isToday, true); assert.equal(strip[1].n, 1); assert.equal(strip[1].N, 3);
});
test('presence and heartbeat throttle', () => {
  assert.deepEqual(presenceState(null, T0), { state: 'never', mins: null });
  assert.equal(presenceState(T0 - 60e3, T0).state, 'online');
  assert.deepEqual(presenceState(T0 - 10 * 60e3, T0), { state: 'recent', mins: 10 });
  assert.equal(presenceState({ toMillis: () => T0 - 3 * 3600e3 }, T0).state, 'away');
  assert.equal(shouldBeat(0, T0, true, true), true);
  assert.equal(shouldBeat(T0 - 30e3, T0, true, true), false);
  assert.equal(shouldBeat(T0 - 61e3, T0, true, true), true);
  assert.equal(shouldBeat(T0 - 61e3, T0, false, true), false);
  assert.equal(shouldBeat(T0 - 61e3, T0, true, false), false);
});
test('normalizeGame tolerates garbage', () => {
  assert.deepEqual(normalizeGame('x'), { on: true, mode: 'auto', min: 1, max: 5, level: 2 });
  assert.deepEqual(normalizeGame({ on: 0, level: '4', min: '3', max: 'z' }), { on: true, mode: 'auto', min: 3, max: 5, level: 4 });
});
