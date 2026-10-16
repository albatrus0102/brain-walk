import { alarmTick } from './alarm.js';
import { resetAdminSubs, aiAccess } from './ai/admin-data.js';
import { startBank, stopBank } from './ai/bank.js';
import { seedDemo } from './ai/seed.js';
import { applyDisplay } from './display.js';
import { GAMES, catalog } from './games/registry.js';
import { checkNudgeDialog } from './nudge.js';
import { Platform } from './platform.js';
import { normalizePlan, progressId } from './program.js';
import { startHeartbeat, stopHeartbeat } from './progress.js';
import { inSet, labelOf, normalizeTrainees, pickOne, pickSel } from './trainees.js';
import { courseLen } from './session.js';
import { S } from './state.js';
import { FirebaseAdapter } from './store/firebase-adapter.js';
import { Store } from './store/store.js';
import { refreshChat } from './ui/chat.js';
import { toast } from './ui/dom.js';
import { render, renderChrome } from './ui/shell.js';
import { LS, clampLv, ymd } from './util.js';

/* ================= 훈련하는 분 (DESIGN-MULTI §1.4) =================
 * S.trainees = { ids, labels }  (state/trainees)
 * S.T[mid]   = { planRaw, plan, display, alarm, levels, program, progressList, sessions, assess, checkins, presence }
 * 훈련하는 분 기기는 자기 것만, 가족 기기는 훈련하는 분마다 구독해요. 화면은 focusId() (기기 주인 / 고른 사람) 를 봐요. */
const EMPTY_T = Object.freeze({ planRaw: null, plan: null, display: null, alarm: null, levels: null, program: null, progressList: [], sessions: [], assess: [], checkins: [], presence: null });
const freshT = () => ({ planRaw: null, plan: null, display: null, alarm: null, levels: null, program: null, progressList: [], sessions: [], assess: [], checkins: [], presence: null, levelsSeen: false, programSeen: false });
export const tdata = id => (id && S.T[id]) || EMPTY_T;
export const trainees = () => S.trainees.ids;
export const isTraineeId = id => inSet(S.trainees, id);
/* 이 기기의 사람 (체험 모드는 'local') */
export const meId = () => S.myId || 'local';
/* 이 기기의 사람이 훈련하는 분이면 그 id */
export function myTrainee() {
  if (Store.mode === 'firebase') {
    if (!S.tsReady) return S.roleLocal === 'trainee' && S.myId ? S.myId : null;
    return S.myId && isTraineeId(S.myId) ? S.myId : null;
  }
  return S.roleLocal === 'family' ? null : 'local';
}
/* 역할은 'trainee' 인데 아직 목록에 없는 기기 ("준비 중") */
export const isPending = () => Store.mode === 'firebase' && !!S.tsReady && !!S.myId && !isTraineeId(S.myId) && myMemberRole() === 'trainee';
export function role() { return myTrainee() || isPending() ? 'trainee' : 'family'; }
export const isTrainee = () => role() === 'trainee';
/* 가족 화면의 고른 사람: 'all' | mid | null */
export const selTrainee = () => (isTrainee() ? myTrainee() : pickSel(S.trainees, S.selT));
/* 한 사람을 보는 화면이 보는 사람 */
export function focusId() {
  if (isTrainee()) return myTrainee() || (isPending() ? S.myId : null);
  return pickOne(S.trainees, S.selT, S.lastT);
}
export const traineeId = () => focusId();
export function setSelT(v) {
  S.selT = v; try { LS.set('bw.selT', v); } catch (e) {}
  if (v && v !== 'all') { S.lastT = v; try { LS.set('bw.selT1', v); } catch (e) {} }
  onData();
}
/* 한 사람을 보는 화면을 그 사람으로 ('모두' 보기는 그대로 둬요) */
export function focusOn(id) {
  if (!isTraineeId(id)) return;
  S.lastT = id; try { LS.set('bw.selT1', id); } catch (e) {}
  if (S.selT && S.selT !== 'all') { S.selT = id; try { LS.set('bw.selT', id); } catch (e) {} }
}
export const traineeLabel = (id = focusId()) => (id && isTraineeId(id) ? labelOf(S.trainees, id) : '훈련하는 분');
const DEFAULT_PLAN = () => S._defPlan || (S._defPlan = normalizePlan(null, catalog()));
export function getPlan(id = focusId()) { const t = id && S.T[id]; if (!t) return DEFAULT_PLAN(); return t.plan || (t.plan = normalizePlan(t.planRaw, catalog())); }
export const planRawOf = (id = focusId()) => tdata(id).planRaw;
export const displayOf = (id = focusId()) => tdata(id).display;
export const alarmOf = (id = focusId()) => tdata(id).alarm;
/* 프로그램 시작일: 내 기기는 이 기기에 저장된 것, 다른 사람은 그 사람의 문서 */
export function programStart(id = focusId()) {
  const p = (!id || id === myTrainee()) ? S.program : tdata(id).program;
  return (p && p.startDate) || (S.program && S.program.startDate) || todayS();
}
/* 적응 난이도: 이 기기 사람(훈련하는 분)은 기기에 저장된 값, 다른 사람은 그 사람의 문서 */
export function getLevel(gameId, id = focusId()) {
  if (!id || id === meId()) return clampLv(S.levels[gameId] || 1);
  const l = tdata(id).levels; return clampLv((l && l[gameId]) || 1);
}
export const levelsOf = (id = focusId()) => (!id || id === meId()) ? S.levels : (tdata(id).levels || {});
export const todayS = () => ymd(new Date());
/* 관리자 설정 (훈련 계획)은 훈련하는 분마다예요. 문서가 없어도 기본값으로 완전한 계획이 나와요. */
export function setPlanRaw(raw, id) { if (!id) { S._defPlan = null; return; } const t = S.T[id] || (S.T[id] = freshT()); t.planRaw = raw || null; t.plan = null; }
/* 방 주인 / 관리자. 체험 모드는 한 사람이 관리자이자 훈련하는 분이라 늘 관리자예요. */
export function isOwnerNow() { return Store.mode !== 'firebase' || (!!S.myId && S.family.ownerMemberId === S.myId); }
export function isAdmin() {
  if (S.debugNonAdmin) return false;            // 시험용(window.__DEBUG): 관리자가 아닌 사람 화면을 체험 모드에서 확인해요
  if (Store.mode !== 'firebase') return true;
  const me = S.myId; if (!me) return false;
  if (S.family.ownerMemberId === me) return true;
  return (S.family.admins || []).includes(me) && myMemberRole() === 'family';
}
/* 관리자 이름들 ("관리자만 바꿀 수 있어요. 관리자: ○○, ○○" 에 써요) */
export function adminNames() {
  if (Store.mode !== 'firebase') return [];
  const ms = FirebaseAdapter.members(), ids = [S.family.ownerMemberId].concat(S.family.admins || []).filter(Boolean);
  return Array.from(new Set(ids)).filter(id => ms[id] && !ms[id].leftTs && (id === S.family.ownerMemberId || ms[id].role === 'family')).map(id => String(ms[id].name || '가족'));
}
export const chatAvail = () => !!(Store.shared && S.myId);
export function nameOf(id) { if (!id) return '가족'; const p = S.profiles[id]; return (p && p.name) || (id === S.myId && S.me && S.me.name) || '가족'; }
export async function ensureProfiles(ids) {
  try {
    if (!Store.shared) return;
    S.profP = S.profP || {};
    const uniq = Array.from(new Set(ids.filter(Boolean))), need = uniq.filter(i => !(i in S.profiles) && !S.profP[i]);
    if (need.length) {
      const p = Store.profiles(need).then(ps => { need.forEach(i => { S.profiles[i] = (ps && ps[i]) ? { name: String(ps[i].name || '') } : { name: '' }; }); return true; })
        .catch(() => { need.forEach(i => { S.profiles[i] = { name: '' }; }); return true; });
      need.forEach(i => { S.profP[i] = p; });
    }
    const waits = uniq.map(i => S.profP[i]).filter(Boolean);
    if (waits.length) await Promise.all(waits);
    if (need.length) { if (S.screen === 'chat') refreshChat(); else if (S.screen === 'home' || S.screen === 'family') render(true); }
  } catch (e) {}
}
/* 기록의 주인: 체험 모드의 예전 기록(userId 없음)은 이 기기 사람 */
const ownerOf = x => (x && x.userId) || meId();
export function allSessions(id = focusId()) {
  if (!id) return [];
  const map = new Map();
  if (id === meId()) S.local.forEach(s => { if (s && s.id && (!Store.shared || s.userId) && ownerOf(s) === id) map.set(s.id, s); });
  tdata(id).sessions.forEach(s => { if (s && s.id && ownerOf(s) === id) map.set(s.id, s); });
  return Array.from(map.values()).filter(s => s && typeof s.ts === 'number' && s.date).sort((a, b) => b.ts - a.ts);
}
export function allAssessments(id = focusId()) {
  if (!id) return [];
  const map = new Map();
  if (id === meId()) S.assessLocal.forEach(a => { if (a && a.ts && (!Store.shared || a.userId) && ownerOf(a) === id) map.set(String(a.ts), a); });
  tdata(id).assess.forEach(a => { if (a && a.ts && ownerOf(a) === id) map.set(String(a.ts), a); });
  return Array.from(map.values()).filter(a => a.scores && a.total != null).sort((a, b) => b.ts - a.ts);
}
export function allCheckins(id = focusId()) {
  const map = {}; if (!id) return map;
  if (id === meId()) Object.keys(S.ciLocal).map(k => S.ciLocal[k]).filter(c => c && (!Store.shared || c.userId) && ownerOf(c) === id).forEach(c => { if (c.date) map[c.date] = c; });
  tdata(id).checkins.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(c => { if (c && c.date && ownerOf(c) === id) map[c.date] = c; });
  return map;
}
export function streakOf(list, today) {
  const ds = dateSet(list); let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!ds.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0; while (ds.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const dateSet = list => new Set(list.map(s => s.date));
/* 연속 훈련일: 훈련 기록이 있는 날 + 두뇌 점검을 한 날 */
export const streakNow = (now, id = focusId()) => streakOf(allSessions(id).concat(allAssessments(id)), now || new Date());
/* 오늘의 코스 상태: 진행 문서(progress)를 먼저 보고, 없으면(옛 앱) 세션 기록으로 짐작해요 */
export function todayProgressDoc(tid = focusId()) {
  if (!tid) return null;
  const id = progressId(todayS(), tid), srv = (tdata(tid).progressList || []).find(p => p.id === id) || null;
  const loc = S._progLocal && S._progLocal.date === todayS() && S._progLocal.userId === tid ? S._progLocal : null;
  return srv && loc ? ((loc.updatedTs || 0) > (srv.updatedTs || 0) ? loc : srv) : (srv || loc);
}
export function courseStatus(id = focusId()) {
  const t = todayS(), N = courseLen(id), p = todayProgressDoc(id), all = allSessions(id), ss = all.filter(s => s.date === t && s.inCourse);
  const ids = new Set(ss.map(s => s.gameId));
  const pn = p ? (p.results || []).length : 0, pdone = !!(p && p.status === 'done');
  const ts = Math.max(p ? (Number(p.doneTs) || Number(p.updatedTs) || 0) : 0, ss.length ? Math.max.apply(null, ss.map(s => s.ts)) : 0);
  return { done: pdone || ids.size >= N, ts, any: !!p || all.some(s => s.date === t), count: Math.min(Math.max(pn, ids.size), N) };
}
function syncNoteText() {
  if (S.dbState === 'ready' && (S.dbError || S.writeFailed || S.canWrite === false)) return '가족과 함께 저장하는 데 문제가 있어요. 인터넷 연결을 확인해 주세요.';
  return '';
}
export function updateSyncNote() { document.querySelectorAll('.sync-note').forEach(el => { el.textContent = syncNoteText(); }); }
export const NO_WRITE_MSG = '지금은 저장하지 못했어요. 인터넷 연결을 확인하고 다시 해 보세요.';
/* 저장 실패 문구: 어댑터가 오류 종류를 보고 알맞은 말로 바꿔 줘요 */
export const writeErrMsg = (e, admin) => (Store.mode === 'firebase' ? Store.explain(e, admin) : NO_WRITE_MSG);

/* ================= 저장 ================= */
export function remoteSet(path, data, quiet) {
  return dbReady.then(async () => {
    if (!Store.adapter) return false;
    if (S.canWrite === false) { S.writeFailed = true; updateSyncNote(); return false; }
    try { await Store.setDoc(path, data); return true; }
    catch (e) { S.writeFailed = true; updateSyncNote(); if (!quiet) toast(Store.shared ? writeErrMsg(e) : '기록은 이 기기에만 저장돼요.'); return false; }
  });
}
/* store=false: 관리자가 난이도를 고정한 게임이라 적응 기록(state/levels)을 바꾸지 않아요.
 * state/levels 는 규칙상 훈련하는 분 기기(또는 관리자)만 써요. 가족이 '나도 훈련해 보기'를 해도 아버지 단계는 그대로예요. */
export function saveSession(rec, newLevel, store) {
  S.local.push(rec); if (S.local.length > 400) S.local = S.local.slice(-400);
  LS.set('bw.sessions', S.local);
  if (store !== false) { S.levels[rec.gameId] = newLevel; LS.set('bw.levels', S.levels); }
  const doc = Object.assign({}, rec); delete doc.id;
  const me = myTrainee();
  remoteSet('sessions/' + rec.id, doc).then(ok => { if (ok && store !== false && me) remoteSet('trainees/' + me + '/state/levels', { levels: S.levels, updatedTs: Date.now() }, true); });
}
export function ensureProgram() {
  if (!S.program || !S.program.startDate) { S.program = { startDate: todayS() }; LS.set('bw.program', S.program); }
}

/* ================= 저장소 초기화 (화면은 먼저 그리고, 준비되면 켜기) ================= */
const dbUnsubs = [];
export function subscribe(target, opts, cb) {
  try { dbUnsubs.push(Store.subscribe(target, Object.assign({ onError: () => { S.dbError = true; updateSyncNote(); } }, opts), cb)); } catch (e) { S.dbError = true; }
}
export function subscribeMessages() {
  if (S.msgUnsub) { try { S.msgUnsub(); } catch (e) {} S.msgUnsub = null; }
  try {
    S.msgUnsub = Store.subscribe('messages', { orderBy: ['ts', 'desc'], limit: S.msgLimit, onError: () => { S.msgsReady = true; } }, list => {
      S.dbMsgs = list; S.msgHasMore = list.length >= S.msgLimit; S.msgsReady = true;
      rebuildMessages(); onData();
    });
  } catch (e) { S.msgsReady = true; }
}
export function rebuildMessages() {
  const map = new Map();
  S.dbMsgs.forEach(m => { if (m && m.ts && m.authorId) map.set(m.id, m); });
  Object.keys(S.pendingMsgs).forEach(id => { if (map.has(id)) delete S.pendingMsgs[id]; else map.set(id, S.pendingMsgs[id]); });
  S.messages = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}
let resolveReady = null;
/* Store 가 준비되고(가입 완료 포함) connectData() 가 끝나면 풀려요. remoteSet 이 이걸 기다려요. */
export const dbReady = new Promise(res => { resolveReady = res; });
/* 저장소를 화면에 연결: 프로필·구독 시작. 앱 시작 시 Store.init() 결과가 'ready' 일 때 한 번 불러요. */
export async function connectData() {
  try {
    await Platform.init();
    S.dbState = Store.shared ? 'ready' : 'none';
    S.canWrite = Store.canWrite();
    const me = Store.me();
    if (Store.shared && me && me.id) { S.me = me; S.myId = me.id; if (me.name) S.profiles[me.id] = { name: me.name }; }
    if (Store.mode === 'local') { try { await seedLocalTrainees(); } catch (e) {} }   // 체험 모드: 예시 훈련하는 분 두 명
    try { S.trainees = normalizeTrainees(await Store.getDoc('state/trainees')); S.tsReady = true; } catch (e) {}
    subscribe('state/trainees', {}, d => { S.trainees = normalizeTrainees(d); S.tsReady = true; syncTraineeSubs(); onData(); });
    try { dbUnsubs.push(Store.watchFamily(f => { S.family = f; applyDisplay(); onData(); })); } catch (e) {}
    if (Store.shared && S.myId) {
      subscribe('reads', {}, list => { S.reads = {}; list.forEach(d => { S.reads[d.id] = Number(d.lastReadTs) || 0; }); onData(); });
      subscribeMessages();
      try { const d = await Store.getDoc('reminders/' + S.myId); if (d) { S.myReminder = d; LS.set('bw.reminder', d); } } catch (e) {}
    }
    if (Store.mode === 'local') { try { await seedDemo(); } catch (e) {} }   // 체험 모드: 예시 문제 은행·리포트를 넣어 둬요 (예시라고 표시돼요)
    syncTraineeSubs(); syncBank();
    // 첫 화면과 첫 안내(점검 권유 등)가 기본값이 아니라 이 분의 계획·화면 설정·점검 기록으로 정해지도록, 구독이 오기 전에 한 번 읽어 둬요
    try {
      const mt = myTrainee(), T0 = mt && S.T[mt];
      if (T0) {
        const st = 'trainees/' + mt + '/state/';
        try { T0.planRaw = await Store.getDoc(st + 'plan'); T0.plan = null; } catch (e) {}
        try { T0.display = await Store.getDoc(st + 'display'); } catch (e) {}
        try { T0.assess = await Store.query('assessments', { where: [['userId', '==', mt]], orderBy: ['ts', 'desc'], limit: 60 }); } catch (e) {}
      }
    } catch (e) {}
    connectFamilyOnly(); wasTrainee = isTrainee();
    // 내 역할(members.role)은 목록보다 늦게 올 수 있어요: 바뀌었을 때만 다시 맞춰요
    try { if (Store.adapter && Store.adapter.onMembers) dbUnsubs.push(Store.adapter.onMembers(() => { if (roleChanged()) onData(); })); } catch (e) {}
    updateSyncNote(); applyDisplay({ noRender: true }); onData();
  } catch (e) { S.dbState = 'none'; try { console.warn('저장소 초기화 실패', e); } catch (x) {} }
  resolveReady();
}
/* ---- 훈련하는 분마다의 구독 (최대 4명 × 약 10개) ---- */
const tSubs = {};
function wantIds() {
  if (!Store.adapter) return [];
  const me = myTrainee(); if (me) return [me];
  if (isTrainee()) return [];                 // 준비 중인 기기: 아무것도 구독하지 않아요
  return S.trainees.ids.slice();
}
function dropTrainee(id) { (tSubs[id] || []).forEach(u => { try { u(); } catch (e) {} }); delete tSubs[id]; delete S.T[id]; }
function syncTraineeSubs() {
  const want = wantIds();
  Object.keys(tSubs).forEach(id => { if (!want.includes(id)) dropTrainee(id); });
  want.forEach(id => {
    if (tSubs[id]) return;
    const T = S.T[id] = S.T[id] || freshT(), us = tSubs[id] = [], mine = () => id === myTrainee();
    const sub = (target, opts, cb) => { try { us.push(Store.subscribe(target, Object.assign({ onError: () => { S.dbError = true; updateSyncNote(); } }, opts), cb)); } catch (e) { S.dbError = true; } };
    const st = 'trainees/' + id + '/state/', who = [['userId', '==', id]];
    sub(st + 'plan', {}, d => { T.planRaw = d; T.plan = null; onData(); });
    sub(st + 'display', {}, d => { T.display = d; applyDisplay(); if (S.screen === 'settings') render(true); });
    sub(st + 'alarm', {}, d => { T.alarm = d; alarmTick(); if (S.screen === 'settings') render(true); });
    sub(st + 'levels', {}, d => {
      const lv = {}; if (d && d.levels && typeof d.levels === 'object') Object.keys(GAMES).forEach(k => { if (d.levels[k] != null) lv[k] = clampLv(d.levels[k]); });
      T.levels = lv;
      // 내 기기는 처음 한 번만 서버 값을 받아요 (그다음부터는 이 기기가 쓰는 쪽이에요)
      if (mine() && !T.levelsSeen) { T.levelsSeen = true; Object.assign(S.levels, lv); LS.set('bw.levels', S.levels); }
      if (['family', 'adminPlan', 'pick'].includes(S.screen)) onData();
    });
    sub(st + 'program', {}, d => {
      const ok = d && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '');
      T.program = ok ? { startDate: d.startDate } : null;
      if (mine() && !T.programSeen) {
        T.programSeen = true;
        if (ok) { S.program = { startDate: d.startDate }; LS.set('bw.program', S.program); }
        else if (S.program && S.program.startDate && S.canWrite !== false) remoteSet(st + 'program', { startDate: S.program.startDate }, true);
      }
    });
    sub('progress', { where: who, orderBy: ['date', 'desc'], limit: 14 }, list => { T.progressList = list; onData(); });
    sub('sessions', { where: who, orderBy: ['ts', 'desc'], limit: mine() ? 300 : 150 }, list => { T.sessions = list; onData(); });
    sub('assessments', { where: who, orderBy: ['ts', 'desc'], limit: 60 }, list => { T.assess = list; onData(); });
    sub('checkins', { where: who, orderBy: ['date', 'desc'], limit: 120 }, list => { T.checkins = list; onData(); });
    if (!mine()) sub('presence/' + id, {}, d => { T.presence = d; if (S.screen === 'home') onData(); });
  });
}
/* 체험 모드: 목록이 없으면 '나'(아버지)와 예시 한 분(어머니)을 넣어 둬요. 예시 분의 오늘 진행·지난 기록도 함께. */
export const DEMO_T2 = 'demo2';
async function seedLocalTrainees() {
  const A = Store.adapter, today = todayS();
  if (!(await A.getDoc('state/trainees'))) await A.setDoc('state/trainees', { v: 1, ids: ['local', DEMO_T2], labels: { local: '아버지', [DEMO_T2]: '어머니' }, updatedBy: 'local', updatedTs: Date.now() });
  const mark = await A.getDoc('trainees/' + DEMO_T2 + '/state/demoSeed');
  if (mark && mark.date === today) return;
  const ops = [{ set: 'trainees/' + DEMO_T2 + '/state/demoSeed', data: { date: today } }], now = Date.now(), G = ['cards', 'odd', 'shop', 'today', 'flash'];
  for (let k = 1; k <= 6; k++) {
    if (k === 3) continue;
    const date = ymd(new Date(now - k * 864e5));
    ops.push({ set: 'progress/' + date + '-' + DEMO_T2, data: { userId: DEMO_T2, date, v: 1, kind: 'course', planned: G, idx: 5, results: G.map((g, i) => ({ g, acc: 0.7 + (i % 3) * 0.1, sec: 60 + i * 5, level: 2 })), status: 'done', startTs: now - k * 864e5, updatedTs: now - k * 864e5 + 6e5, doneTs: now - k * 864e5 + 6e5, sts: now - k * 864e5, example: true } });
    G.forEach((g, i) => ops.push({ set: 'sessions/demo2-' + date + '-' + g, data: { date, ts: now - k * 864e5 + i * 9e4, gameId: g, level: 2, correct: 4, total: 5, accuracy: 0.8, durationSec: 70, inCourse: true, userId: DEMO_T2, example: true } }));
  }
  ops.push({ set: 'progress/' + today + '-' + DEMO_T2, data: { userId: DEMO_T2, date: today, v: 1, kind: 'course', planned: G, idx: 2, current: G[2], currentTs: now - 2 * 6e4, results: G.slice(0, 2).map(g => ({ g, acc: 0.8, sec: 65, level: 2 })), status: 'started', startTs: now - 6e5, updatedTs: now - 2 * 6e4, sts: now - 2 * 6e4, example: true } });
  ops.push({ set: 'presence/' + DEMO_T2, data: { ts: now - 6e4, lastSeen: now - 6e4, screen: 'game', device: 'Android' } });
  await A.batch(ops);
}
/* ---- 가족 전용 자료 (설문·시계 그림·병원 검사·잠 기록·점검 과제 상세): 고른 훈련하는 분 것만 구독해요 ----
 * 규칙상 role 이 'family' 이고 훈련하는 분 목록에 없는 사람만 읽을 수 있어요. [컬렉션, S 의 이름, 정렬, 개수, 사람 필드] */
export const FAMILY_ONLY = [
  ['surveys', 'surveys', 'ts', 100, 'subjectId'], ['clocks', 'clocks', 'ts', 40, 'userId'], ['clinicalTests', 'clinical', 'ts', 100, 'subjectId'],
  ['sleeplogs', 'sleeplogs', 'date', 30, 'userId'], ['taskRuns', 'taskRuns', 'ts', 30, 'userId']
];
let famUnsubs = [];
/* 체험 모드는 한 기기에서 두 역할을 다 써 보는 곳이라 항상 읽어요. 가족방에서는 내 member 문서의 role 이 family 이고 목록에 없을 때만요. */
export function myMemberRole() { return Store.mode === 'firebase' ? ((FirebaseAdapter.members()[FirebaseAdapter.mid] || {}).role || null) : null; }
export function canReadFamilyOnly() { return Store.mode === 'local' || (myMemberRole() === 'family' && !myTrainee()); }
let famReadable = null, famFor = null;     // connectFamilyOnly 를 마지막으로 맞춘 때의 값 (바뀌면 다시 맞춰요)
export function connectFamilyOnly() {
  famUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  famReadable = canReadFamilyOnly(); famFor = focusId();
  FAMILY_ONLY.forEach(f => { S[f[1]] = []; });
  if (!famReadable || !famFor || !Store.adapter) return;
  FAMILY_ONLY.forEach(([coll, key, ord, lim, field]) => {
    try { famUnsubs.push(Store.subscribe(coll, { where: [[field, '==', famFor]], orderBy: [ord, 'desc'], limit: lim, onError: () => {} }, list => { S[key] = list; onData(); })); } catch (e) {}
  });
}
/* 가족을 나가거나 삭제한 뒤: 구독 해제 */
export function disconnectData() {
  famUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); famReadable = null; famFor = null; wasTrainee = null;
  dbUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  Object.keys(tSubs).forEach(dropTrainee);
  resetAdminSubs(); stopBank(); aiAcc = null;
  if (S.msgUnsub) { try { S.msgUnsub(); } catch (e) {} S.msgUnsub = null; }
  stopHeartbeat();
}
/* 훈련하는 분 기기: 앱이 보이는 동안 접속 기록을 보내요 */
function syncHeartbeat() { if (Store.adapter && myTrainee()) startHeartbeat(); else stopHeartbeat(); }
/* 역할이 바뀌었을 때(체험 모드의 미리보기 전환, 훈련하는 분 지정): 화면 설정·구독을 다시 맞춰요 */
export function refreshRole() { applyDisplay({ noRender: true }); syncTraineeSubs(); syncHeartbeat(); connectFamilyOnly(); }
/* 관리자가 목록이나 역할을 고치면(state/trainees, members.role) 이 기기도 다시 열지 않고 따라가요 */
let wasTrainee = null;
function roleChanged() { return (wasTrainee !== null && wasTrainee !== isTrainee()) || (famReadable !== null && famReadable !== canReadFamilyOnly()); }
let aiAcc = null;
function syncRole() {
  const tr = isTrainee(), acc = aiAccess();
  if (aiAcc !== null && aiAcc !== acc) resetAdminSubs();          // 관리자 ↔ 훈련하는 분: AI 리포트 구독을 새로
  aiAcc = acc;
  if (wasTrainee !== null && wasTrainee !== tr) applyDisplay({ noRender: true });
  wasTrainee = tr;
  syncTraineeSubs();
  if (famReadable !== null && (famReadable !== canReadFamilyOnly() || famFor !== focusId())) connectFamilyOnly();
}
/* 훈련하는 분 기기는 자기 AI 문제 묶음(trainees/{나}/aiPacks)을 한 번 구독해요 (기기에 저장해 오프라인에서도 써요) */
function syncBank() { const me = myTrainee(); if (Store.adapter && me) startBank(subscribe, me); }
function onData() {
  syncRole(); syncHeartbeat(); syncBank();
  alarmTick(true);
  if (['home', 'pick', 'family', 'assess', 'settings', 'members', 'surveys', 'clinical', 'clocks'].includes(S.screen) || String(S.screen).indexOf('ai') === 0) { const keep = document.activeElement; if (!(keep && /^(INPUT|TEXTAREA)$/.test(keep.tagName))) render(true); }
  else if (S.screen === 'chat') refreshChat();
  else renderChrome();
  checkNudgeDialog();
}
