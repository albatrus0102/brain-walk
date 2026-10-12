import { DOMAINS } from './games/registry.js';
import { addDays, clampLv, daysBetween, dayNum, parseYmd, ymd } from './util.js';
import { nextLevel } from './logic.js';

/* =============================================================================
 * 훈련 계획(관리자가 정함)과 아버지 화면 설정, 오늘 진행 상황을 다루는 순수 함수 모음.
 * DOM·Firestore 를 쓰지 않아서 노드에서 바로 시험해요 (tests/program.test.mjs).
 * 저장 위치와 규칙: DESIGN.md §2 (families/{fid}/state/plan, state/display, progress/{date}-{memberId}, presence/{memberId})
 *
 * catalog: 훈련 게임 목록 [{ id, domain, rounds }] (GAME_ORDER 순서). 앱에서는 session.js 가 registry 로 만들어 넘겨요.
 * ========================================================================== */

export const PLAN_V = 1;
export const GAMES_PER_DAY = { min: 1, max: 9, def: 5 };
export const ROUNDS = { min: 3, max: 10, base: 5 };          // null = 게임마다 정해진 기본 분량
export const TARGET_MIN = { min: 5, max: 60, step: 5, def: 15 };
export const CHECK_WEEKS = [0, 2, 4, 8];                       // 0 = 월간 점검 끔
export const LEVEL = { min: 1, max: 5 };
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];                 // 0 = 일요일 (Date.getDay)
export const MIN_PER_GAME = 3;                                  // 기본 분량 게임 하나 ≈ 3분 (5개 ≈ 15분)

export const PLAN_DEFAULTS = Object.freeze({
  v: PLAN_V, gamesPerDay: GAMES_PER_DAY.def, roundsPerGame: null, targetMin: TARGET_MIN.def,
  games: {}, order: 'rotate', fixedOrder: [], weekdays: ALL_DAYS, checkEveryWeeks: 4, checkin: true, showScore: false
});
export const GAME_DEFAULT = Object.freeze({ on: true, mode: 'auto', min: 1, max: 5, level: 2 });

export const FONTS = ['pretendard', 'noto', 'system'];
export const SIZES = ['normal', 'large', 'xlarge', 'max'];
export const RATE = { min: 0.6, max: 1.2, def: 0.9 };
export const DISPLAY_DEFAULTS = Object.freeze({ v: 1, font: 'pretendard', size: 'large', contrast: false, voice: true, rate: RATE.def });

/* ---------------------------------------------------------------- helpers */
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const toInt = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(Number(v)) ? Math.round(Number(v)) : null;
export const clampInt = (v, lo, hi, def) => { const n = toInt(v); return n == null ? def : Math.max(lo, Math.min(hi, n)); };
const asDate = d => (d instanceof Date ? d : parseYmd(d));
const msOf = t => (t == null ? null : typeof t === 'number' ? t : (t && typeof t.toMillis === 'function') ? t.toMillis() : (t instanceof Date ? t.getTime() : null));

/* ------------------------------------------------------- plan: normalize */
/* 아무 값(없음, 옛 문서, 잘못된 값)이 와도 쓸 수 있는 완전한 계획으로 바꿔요. 범위 밖 값은 가장 가까운 값으로 맞춰요. */
export function normalizeGame(raw) {
  const g = isObj(raw) ? raw : {};
  let min = clampInt(g.min, LEVEL.min, LEVEL.max, GAME_DEFAULT.min), max = clampInt(g.max, LEVEL.min, LEVEL.max, GAME_DEFAULT.max);
  if (min > max) { const t = min; min = max; max = t; }
  return { on: g.on !== false, mode: g.mode === 'fixed' ? 'fixed' : 'auto', min, max, level: clampInt(g.level, LEVEL.min, LEVEL.max, GAME_DEFAULT.level) };
}
export function normalizePlan(raw, catalog) {
  const p = isObj(raw) ? raw : {}, ids = (catalog || []).map(g => g.id);
  const games = {};
  ids.forEach(id => { games[id] = normalizeGame(isObj(p.games) ? p.games[id] : null); });
  // 모든 게임을 끄면 아버지 화면이 비어요. 그럴 때는 모두 켠 것으로 봐요 (관리자 화면은 planProblems 로 막아요).
  if (ids.length && !ids.some(id => games[id].on)) ids.forEach(id => { games[id].on = true; });
  const fixedOrder = [];
  (Array.isArray(p.fixedOrder) ? p.fixedOrder : []).forEach(id => { if (ids.includes(id) && !fixedOrder.includes(id)) fixedOrder.push(id); });
  ids.forEach(id => { if (!fixedOrder.includes(id)) fixedOrder.push(id); });      // 빠진 게임(새로 추가된 게임 등)은 끝에
  let weekdays = Array.from(new Set((Array.isArray(p.weekdays) ? p.weekdays : ALL_DAYS).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  if (!weekdays.length) weekdays = ALL_DAYS.slice();
  const rpg = p.roundsPerGame == null || p.roundsPerGame === '' ? null : clampInt(p.roundsPerGame, ROUNDS.min, ROUNDS.max, null);
  const tm = clampInt(p.targetMin, TARGET_MIN.min, TARGET_MIN.max, TARGET_MIN.def);
  const cw = toInt(p.checkEveryWeeks);
  return {
    v: PLAN_V,
    gamesPerDay: clampInt(p.gamesPerDay, GAMES_PER_DAY.min, GAMES_PER_DAY.max, GAMES_PER_DAY.def),
    roundsPerGame: rpg,
    targetMin: Math.round(tm / TARGET_MIN.step) * TARGET_MIN.step,
    games, order: p.order === 'fixed' ? 'fixed' : 'rotate', fixedOrder, weekdays,
    checkEveryWeeks: CHECK_WEEKS.includes(cw) ? cw : (cw == null ? PLAN_DEFAULTS.checkEveryWeeks : CHECK_WEEKS.reduce((a, b) => (Math.abs(b - cw) < Math.abs(a - cw) ? b : a))),
    checkin: p.checkin == null ? PLAN_DEFAULTS.checkin : p.checkin === true,
    showScore: p.showScore === true
  };
}
/* 관리자 화면에서 저장하기 전에 보여 줄 문제 (빈 배열이면 저장 가능). 원본(raw) 기준으로 봐요. */
export function planProblems(raw, catalog) {
  const p = isObj(raw) ? raw : {}, out = [], ids = (catalog || []).map(g => g.id);
  const on = ids.filter(id => !(isObj(p.games) && isObj(p.games[id]) && p.games[id].on === false));
  if (!on.length) out.push('게임을 하나 이상 골라 주세요.');
  if (Array.isArray(p.weekdays) && !p.weekdays.length) out.push('훈련 요일을 하루 이상 골라 주세요.');
  ids.forEach(id => { const g = isObj(p.games) ? p.games[id] : null; if (isObj(g) && g.mode !== 'fixed' && toInt(g.min) != null && toInt(g.max) != null && toInt(g.min) > toInt(g.max)) out.push('가장 쉬운 단계가 가장 어려운 단계보다 높아요.'); });
  return Array.from(new Set(out));
}
/* Firestore 에 쓸 문서 (규칙의 state/plan 과 같은 모양). */
export function planDoc(plan, catalog, by, nowMs) {
  return Object.assign(normalizePlan(plan, catalog), { updatedBy: by, updatedTs: nowMs });
}

/* --------------------------------------------------- display: normalize */
export function normalizeDisplay(raw) {
  const d = isObj(raw) ? raw : {};
  const r = Number(d.rate);
  return {
    v: 1,
    font: FONTS.includes(d.font) ? d.font : DISPLAY_DEFAULTS.font,
    size: SIZES.includes(d.size) ? d.size : DISPLAY_DEFAULTS.size,
    contrast: d.contrast === true,
    voice: d.voice !== false,
    rate: isFinite(r) && r > 0 ? Math.round(Math.max(RATE.min, Math.min(RATE.max, r)) * 20) / 20 : RATE.def
  };
}
export function displayDoc(d, by, nowMs) { return Object.assign(normalizeDisplay(d), { updatedBy: by, updatedTs: nowMs }); }
/* 이 기기에 실제로 쓸 화면 설정: 훈련하는 분의 기기는 관리자가 정한 값(있으면), 나머지는 이 기기의 값. */
export function effectiveDisplay(remote, local, isTraineeDevice) {
  const loc = normalizeDisplay(Object.assign({}, DISPLAY_DEFAULTS, { size: 'normal', font: 'pretendard' }, local || {}));
  return isTraineeDevice && isObj(remote) ? normalizeDisplay(remote) : loc;
}

/* ------------------------------------------------------- course builder */
/* 게임 하나의 문제 수. roundsPerGame=null 이면 게임 기본값. 숫자면 '문제 5개짜리 게임' 기준이라,
 * 한 판이 긴 게임(카드 2판, 순서·단어·숫자 잇기 3판)은 비율대로 줄여요: round(N × 기본 / 5), 최소 1. */
export function roundsFor(game, plan) {
  const base = Math.max(1, Number(game && game.rounds) || ROUNDS.base);
  const n = plan && plan.roundsPerGame;
  if (n == null) return base;
  return Math.max(1, Math.round(n * base / ROUNDS.base));
}
/* 오늘(date)의 게임 순서. 반환: [gameId], 길이 = min(gamesPerDay, 켠 게임 수).
 *  rotate: 지금까지와 같은 규칙(영역 순서를 날마다 돌리고, 영역 안에서도 게임을 돌려요)을 켠 게임에 적용하고,
 *          하루 게임 수가 영역 수보다 많으면 같은 순서로 두 번째, 세 번째 게임을 더해요. 하루 안에서는 겹치지 않아요.
 *          기본값(5개, 모두 켬)이면 예전 courseGames 와 똑같아요 (진행 중인 코스와 기록이 이어져요).
 *  fixed:  관리자가 정한 순서(fixedOrder)에서 켠 게임만, 앞에서부터. */
export function buildCourse(planRaw, date, catalog) {
  const plan = normalizePlan(planRaw, catalog), d = asDate(date), n = dayNum(d);
  const on = (catalog || []).filter(g => plan.games[g.id].on);
  const want = Math.min(plan.gamesPerDay, on.length);
  if (plan.order === 'fixed') return plan.fixedOrder.filter(id => plan.games[id].on).slice(0, want);
  const order = DOMAINS.map(x => x.id), k = order.length, rot = n % k;
  const rotated = order.slice(rot).concat(order.slice(0, rot));
  const per = {}; order.forEach(dom => { per[dom] = on.filter(g => g.domain === dom).map(g => g.id); });
  // 등록된 영역이 아닌 게임(있다면)은 맨 끝 '기타' 영역으로
  const extra = on.filter(g => !order.includes(g.domain)).map(g => g.id);
  const out = [];
  for (let pass = 0; out.length < want; pass++) {
    let added = false;
    for (const dom of rotated) {
      const gs = per[dom]; if (!gs.length || pass >= gs.length) continue;
      out.push(gs[(n + order.indexOf(dom) + pass) % gs.length]); added = true;
      if (out.length >= want) break;
    }
    if (!added) break;
  }
  for (const id of extra) { if (out.length >= want) break; out.push(id); }
  return out;
}
/* 대략 걸리는 시간(분): 기본 분량 게임 하나 ≈ 3분 */
export function estimateMinutes(planRaw, date, catalog) {
  const plan = normalizePlan(planRaw, catalog), by = Object.fromEntries((catalog || []).map(g => [g.id, g]));
  const mins = buildCourse(plan, date, catalog).reduce((a, id) => a + MIN_PER_GAME * roundsFor(by[id], plan) / Math.max(1, by[id].rounds || ROUNDS.base), 0);
  return Math.max(1, Math.round(mins));
}

/* ----------------------------------------------------------------- levels */
/* 이번 판의 난이도: 고정이면 그 단계, 자동이면 적응 기록(adaptive)을 관리자가 정한 범위로 맞춘 값 */
export function effectiveLevel(gameId, planRaw, adaptive) {
  const g = normalizeGame(isObj(planRaw) && isObj(planRaw.games) ? planRaw.games[gameId] : null);
  if (g.mode === 'fixed') return g.level;
  const a = clampLv(adaptive);                 // 저장된 값이 1~5 밖이면 깨진 값으로 보고 1 (data.getLevel 과 같아요)
  return Math.max(g.min, Math.min(g.max, a));
}
/* 판이 끝난 뒤 다음 난이도. store=false 면 적응 기록(state/levels)을 바꾸지 않아요 (고정 난이도).
 * kind: up/down/down2/same 은 logic.nextLevel 과 같고, 범위 끝에 닿으면 max/min, 고정이면 fixed. */
export function nextLevelFor(gameId, planRaw, played, acc, prevAcc) {
  const g = normalizeGame(isObj(planRaw) && isObj(planRaw.games) ? planRaw.games[gameId] : null);
  if (g.mode === 'fixed') return { level: g.level, kind: 'fixed', store: false };
  const cur = Math.max(g.min, Math.min(g.max, clampLv(played)));
  const r = nextLevel(cur, acc, prevAcc);
  let { level, kind } = r;
  if (level > g.max) { level = g.max; kind = 'max'; }
  if (level < g.min) { level = g.min; kind = 'min'; }
  return { level, kind, store: true };
}

/* ------------------------------------------------------- weekday / check */
export const isTrainingDay = (planRaw, date) => normalizePlan(planRaw, []).weekdays.includes(asDate(date).getDay());
/* 다음 훈련 요일 (오늘 이후 7일 안). 쉬는 날 화면의 "다음 훈련은 ○요일이에요" 용. */
export function nextTrainingDate(planRaw, date) {
  const wd = normalizePlan(planRaw, []).weekdays, s = ymd(asDate(date));
  for (let i = 1; i <= 7; i++) { const k = addDays(s, i); if (wd.includes(parseYmd(k).getDay())) return k; }
  return null;
}
/* 월간 점검을 오늘 권할지.
 *  off  : 관리자가 끔
 *  none : 아직 한 번도 안 했고, 첫 훈련도 아직이에요 (첫날부터 점검을 내밀지 않아요)
 *  due  : 할 때가 됐어요 (first=true 면 첫 점검)
 *  wait : remain 일 뒤 */
export function checkDue(planRaw, lastCheckDate, today, hasTrained) {
  const weeks = normalizePlan(planRaw, []).checkEveryWeeks;
  if (!weeks) return { state: 'off' };
  if (!lastCheckDate) return hasTrained ? { state: 'due', first: true, days: null, interval: weeks * 7 } : { state: 'none', interval: weeks * 7 };
  const days = daysBetween(lastCheckDate, ymd(asDate(today))), interval = weeks * 7;
  return days >= interval ? { state: 'due', first: false, days, interval } : { state: 'wait', days, remain: interval - days, interval };
}

/* ------------------------------------------------- progress doc reducers */
/* progress/{date}-{memberId} 문서를 만드는 함수 (Firestore 쓰기 직전에 sts 를 붙여요). prev 가 다른 날이면 새로 시작. */
export const progressId = (date, memberId) => date + '-' + memberId;
export function progressStart(prev, o) {
  const fresh = !isObj(prev) || prev.date !== o.date || prev.userId !== o.userId || (o.kind && prev.kind !== o.kind);
  const base = fresh
    ? { userId: o.userId, date: o.date, v: 1, kind: o.kind === 'check' ? 'check' : 'course', planned: (o.planned || []).slice(0, 13), idx: 0, results: [], status: 'started', startTs: o.now, doneTs: null }
    : Object.assign({}, prev, { results: (prev.results || []).slice() });
  if (!fresh && Array.isArray(o.planned) && o.planned.length && base.status !== 'done') base.planned = o.planned.slice(0, 13);
  base.idx = base.results.length;
  base.current = o.gameId || null;
  base.currentTs = o.gameId ? o.now : null;
  base.updatedTs = o.now;
  return base;
}
export function progressFinish(prev, o) {
  const p = Object.assign({}, prev, { results: ((prev && prev.results) || []).slice() });
  const r = o.result || {};
  if (p.results.length < 13) {
    p.results.push({ g: o.gameId, acc: Math.round((Number(r.acc) || 0) * 1000) / 1000, c: Number(r.correct) || 0, t: Number(r.total) || 0, sec: Math.round(Number(r.sec) || 0), lv: r.level == null ? null : Number(r.level), ts: o.now });
  }
  p.idx = p.results.length;
  p.current = null; p.currentTs = null; p.updatedTs = o.now;
  const planned = Array.isArray(p.planned) ? p.planned.length : 0;
  if (p.status !== 'done' && planned && p.idx >= planned) { p.status = 'done'; p.doneTs = o.now; }
  return p;
}

/* ------------------------------------------------ dashboard derivations */
export const PAUSED_AFTER_MS = 30 * 60e3;   // 진행 중인데 30분 동안 움직임이 없으면 '쉬는 중'
export const ONLINE_MS = 150e3;            // 하트비트 60초 + 여유
export const RECENT_MS = 30 * 60e3;
/* 오늘 상태 (가족 화면).
 * in: { progress: 오늘 문서|null, plan, today:'YYYY-MM-DD', now: ms, sessionsToday: 오늘 inCourse 세션들(옛 앱 대비), catalog, names?: {id:name} }
 * out.state: rest | notStarted | inProgress | paused | done */
export function deriveToday(o) {
  const plan = normalizePlan(o.plan, o.catalog), p = o.progress, now = o.now;
  const plannedToday = buildCourse(plan, o.today, o.catalog);
  if (isObj(p) && p.date === o.today) {
    const results = (Array.isArray(p.results) ? p.results : []).map(r => ({ gameId: r.g, acc: r.acc, correct: r.c, total: r.t, sec: r.sec, level: r.lv, ts: r.ts }));
    const N = Array.isArray(p.planned) && p.planned.length ? p.planned.length : plannedToday.length;
    const last = Math.max(msOf(p.updatedTs) || 0, msOf(p.sts) || 0, msOf(p.currentTs) || 0);
    const base = { kind: p.kind || 'course', n: Math.min(results.length, N), N, results, planned: p.planned || plannedToday, lastTs: last || null, current: p.current || null, currentSince: msOf(p.currentTs) };
    if (p.status === 'done' || results.length >= N) return Object.assign(base, { state: 'done', doneTs: msOf(p.doneTs) || last || null, current: null });
    return Object.assign(base, { state: last && now - last > PAUSED_AFTER_MS ? 'paused' : 'inProgress' });
  }
  // progress 문서가 없으면: 옛 앱(진행 상황을 쓰지 않는 버전)의 세션 기록으로 짐작해요.
  const ss = (o.sessionsToday || []).filter(s => s && s.date === o.today && s.inCourse);
  const N = plannedToday.length;
  if (ss.length) {
    const ids = Array.from(new Set(ss.map(s => s.gameId))), last = Math.max.apply(null, ss.map(s => Number(s.ts) || 0));
    const results = ss.slice().sort((a, b) => a.ts - b.ts).map(s => ({ gameId: s.gameId, acc: s.accuracy, correct: s.correct, total: s.total, sec: s.durationSec, level: s.level, ts: s.ts }));
    const st = ids.length >= N ? 'done' : (now - last > PAUSED_AFTER_MS ? 'paused' : 'inProgress');
    return { state: st, kind: 'course', legacy: true, n: Math.min(ids.length, N), N, results, planned: plannedToday, lastTs: last, current: null, currentSince: null, doneTs: st === 'done' ? last : null };
  }
  return { state: plan.weekdays.includes(parseYmd(o.today).getDay()) ? 'notStarted' : 'rest', kind: 'course', n: 0, N, results: [], planned: plannedToday, lastTs: null, current: null, currentSince: null };
}
/* 최근 7일 띠 (오늘이 맨 오른쪽). state: done | partial | missed | rest | today-open
 * progressList: progress 문서들 (여러 날), sessions: 세션 기록(옛 앱 대비) */
export function weekStrip(o) {
  const plan = normalizePlan(o.plan, o.catalog), byDate = {};
  (o.progressList || []).forEach(p => { if (isObj(p) && p.date) byDate[p.date] = p; });
  const ses = {}; (o.sessions || []).forEach(s => { if (s && s.inCourse && s.date) (ses[s.date] ||= new Set()).add(s.gameId); });
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(o.today, -i), wd = parseYmd(date).getDay(), p = byDate[date];
    const N = (p && Array.isArray(p.planned) && p.planned.length) || buildCourse(plan, date, o.catalog).length || 1;
    const n = p ? (p.results || []).length : (ses[date] ? ses[date].size : 0);
    let state;
    if ((p && p.status === 'done') || n >= N) state = 'done';
    else if (n > 0 || (p && p.status === 'started')) state = 'partial';
    else if (!plan.weekdays.includes(wd)) state = 'rest';
    else state = i === 0 ? 'today-open' : 'missed';
    out.push({ date, wd, state, n: Math.min(n, N), N, isToday: i === 0 });
  }
  return out;
}
/* 마지막으로 본 시간 → 상태. online: 지금 앱을 보고 계세요 / recent: n분 전 / away / never */
export function presenceState(lastSeen, now) {
  const t = msOf(lastSeen);
  if (!t) return { state: 'never', mins: null };
  const d = Math.max(0, now - t), mins = Math.floor(d / 60e3);
  return { state: d <= ONLINE_MS ? 'online' : d <= RECENT_MS ? 'recent' : 'away', mins };
}
/* 하트비트를 지금 보낼지: 화면이 보이고, 온라인이고, 마지막으로 보낸 지 60초가 지났을 때 */
export const HEARTBEAT_MS = 60e3;
export const shouldBeat = (lastSentMs, now, visible, online) => !!visible && online !== false && (!lastSentMs || now - lastSentMs >= HEARTBEAT_MS);
