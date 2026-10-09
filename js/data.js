import { alarmTick } from './alarm.js';
import { GAMES } from './games/registry.js';
import { checkNudgeDialog } from './nudge.js';
import { Platform } from './platform.js';
import { COURSE_N } from './session.js';
import { S } from './state.js';
import { FirebaseAdapter } from './store/firebase-adapter.js';
import { Store } from './store/store.js';
import { refreshChat } from './ui/chat.js';
import { toast } from './ui/dom.js';
import { render, renderChrome } from './ui/shell.js';
import { LS, clampLv, ymd } from './util.js';

/* ================= 데이터 접근 ================= */
export const getLevel = id => clampLv(S.levels[id] || 1);
export const todayS = () => ymd(new Date());
export const traineeId = () => (S.trainee && S.trainee.userId) || null;
const forTrainee = list => { const t = traineeId(); return t ? list.filter(x => !x.userId || x.userId === t) : list; };
export function role() {
  if (S.trainee && S.trainee.userId && S.myId) return S.trainee.userId === S.myId ? 'trainee' : 'family';
  return S.roleLocal === 'family' ? 'family' : 'trainee';
}
export const isTrainee = () => role() === 'trainee';
export const chatAvail = () => !!(Store.shared && S.myId);
export const traineeLabel = () => (S.trainee && S.trainee.displayLabel) || '아버지';
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
export function allSessions() {
  const map = new Map();
  S.local.forEach(s => { if (s && s.id && (!Store.shared || s.userId)) map.set(s.id, s); });
  if (S.dbSessions) S.dbSessions.forEach(s => { if (s && s.id) map.set(s.id, s); });
  return forTrainee(Array.from(map.values())).filter(s => s && typeof s.ts === 'number' && s.date).sort((a, b) => b.ts - a.ts);
}
export function allAssessments() {
  const map = new Map();
  S.assessLocal.forEach(a => { if (a && a.ts && (!Store.shared || a.userId)) map.set(String(a.ts), a); });
  (S.dbAssess || []).forEach(a => { if (a && a.ts) map.set(String(a.ts), a); });
  return forTrainee(Array.from(map.values())).filter(a => a.scores && a.total != null).sort((a, b) => b.ts - a.ts);
}
export function allCheckins() {
  const map = {};
  forTrainee(Object.keys(S.ciLocal).map(k => S.ciLocal[k]).filter(c => !Store.shared || (c && c.userId))).forEach(c => { if (c && c.date) map[c.date] = c; });
  forTrainee(S.dbCheckins || []).sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(c => { if (c && c.date) map[c.date] = c; });
  return map;
}
export function streakOf(list, today) {
  const ds = dateSet(list); let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!ds.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0; while (ds.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const dateSet = list => new Set(list.map(s => s.date));
export function courseStatus() {
  const t = todayS(), ss = allSessions().filter(s => s.date === t && s.inCourse);
  const ids = new Set(ss.map(s => s.gameId));
  return { done: ids.size >= COURSE_N, ts: ss.length ? Math.max.apply(null, ss.map(s => s.ts)) : 0, any: allSessions().some(s => s.date === t), count: Math.min(ids.size, COURSE_N) };
}
function syncNoteText() {
  if (S.dbState === 'pending') return '';
  if (S.dbState !== 'ready') return '기록은 이 기기에만 저장돼요.';
  if (S.dbError || S.writeFailed || S.canWrite === false) return '가족과 함께 저장하는 데 문제가 있어요. 인터넷 연결을 확인해 주세요. 기록은 이 기기에 먼저 저장돼요.';
  return '기록이 가족과 함께 저장되고 있어요.';
}
export function updateSyncNote() { document.querySelectorAll('.sync-note').forEach(el => { el.textContent = syncNoteText(); }); }
export const NO_WRITE_MSG = '지금은 저장하지 못했어요. 인터넷 연결을 확인하고 다시 해 보세요.';
/* 저장 실패 문구: 어댑터가 오류 종류를 보고 알맞은 말로 바꿔 줘요 */
export const writeErrMsg = e => (Store.mode === 'firebase' ? Store.explain(e) : NO_WRITE_MSG);

/* ================= 저장 ================= */
export function remoteSet(path, data, quiet) {
  return dbReady.then(async () => {
    if (!Store.adapter) return false;
    if (S.canWrite === false) { S.writeFailed = true; updateSyncNote(); return false; }
    try { await Store.setDoc(path, data); return true; }
    catch (e) { S.writeFailed = true; updateSyncNote(); if (!quiet) toast(Store.shared ? writeErrMsg(e) : '기록은 이 기기에만 저장돼요.'); return false; }
  });
}
export function saveSession(rec, newLevel) {
  S.local.push(rec); if (S.local.length > 400) S.local = S.local.slice(-400);
  LS.set('bw.sessions', S.local);
  S.levels[rec.gameId] = newLevel; LS.set('bw.levels', S.levels);
  const doc = Object.assign({}, rec); delete doc.id;
  remoteSet('sessions/' + rec.id, doc).then(ok => { if (ok) remoteSet('state/levels', { levels: S.levels, updatedTs: Date.now() }, true); });
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
    try {
      const d = await Store.getDoc('state/levels');
      if (d && d.levels && typeof d.levels === 'object') { Object.keys(GAMES).forEach(k => { if (d.levels[k] != null) S.levels[k] = clampLv(d.levels[k]); }); LS.set('bw.levels', S.levels); }
    } catch (e) {}
    try {
      const d = await Store.getDoc('state/program');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '')) { S.program = { startDate: d.startDate }; LS.set('bw.program', S.program); }
      else if (S.program && S.canWrite !== false) remoteSet('state/program', { startDate: S.program.startDate }, true);
    } catch (e) {}
    try { S.trainee = await Store.getDoc('state/trainee'); } catch (e) {}
    subscribe('state/trainee', {}, d => { S.trainee = d; onData(); });
    subscribe('state/alarm', {}, d => { S.alarm = d; alarmTick(); if (S.screen === 'settings') render(true); });
    subscribe('sessions', { orderBy: ['ts', 'desc'], limit: 300 }, list => { S.dbSessions = list; onData(); });
    subscribe('assessments', { orderBy: ['ts', 'desc'], limit: 60 }, list => { S.dbAssess = list; onData(); });
    subscribe('checkins', { orderBy: ['date', 'desc'], limit: 120 }, list => { S.dbCheckins = list; onData(); });
    if (Store.shared && S.myId) {
      subscribe('reads', {}, list => { S.reads = {}; list.forEach(d => { S.reads[d.id] = Number(d.lastReadTs) || 0; }); onData(); });
      subscribeMessages();
      try { const d = await Store.getDoc('reminders/' + S.myId); if (d) { S.myReminder = d; LS.set('bw.reminder', d); } } catch (e) {}
    }
    connectFamilyOnly();
    updateSyncNote(); onData();
  } catch (e) { S.dbState = 'none'; try { console.warn('저장소 초기화 실패', e); } catch (x) {} }
  resolveReady();
}
/* ---- 가족 전용 자료 (설문·일상생활 체크·시계 그림·병원 검사·잠 기록·점검 과제 상세): 규칙상 role 이 'family' 인 사람만 읽을 수 있어요 ---- */
export const FAMILY_ONLY = [
  ['surveys', 'surveys', 'ts', 100], ['clocks', 'clocks', 'ts', 40], ['clinicalTests', 'clinical', 'ts', 100],
  ['sleeplogs', 'sleeplogs', 'date', 30], ['taskRuns', 'taskRuns', 'ts', 30]
];
let famUnsubs = [];
/* 체험 모드는 한 기기에서 두 역할을 다 써 보는 곳이라 항상 읽어요. 가족방에서는 내 member 문서의 role 이 family 일 때만요. */
export function myMemberRole() { return Store.mode === 'firebase' ? ((FirebaseAdapter.members()[FirebaseAdapter.mid] || {}).role || null) : null; }
export function canReadFamilyOnly() { return Store.mode === 'local' || myMemberRole() === 'family'; }
export function connectFamilyOnly() {
  famUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  if (!canReadFamilyOnly()) { FAMILY_ONLY.forEach(f => { S[f[1]] = []; }); return; }
  FAMILY_ONLY.forEach(([coll, key, ord, lim]) => {
    try { famUnsubs.push(Store.subscribe(coll, { orderBy: [ord, 'desc'], limit: lim, onError: () => {} }, list => { S[key] = list; onData(); })); } catch (e) {}
  });
}
/* 가족을 나가거나 삭제한 뒤: 구독 해제 */
export function disconnectData() {
  famUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  dbUnsubs.splice(0).forEach(u => { try { u(); } catch (e) {} });
  if (S.msgUnsub) { try { S.msgUnsub(); } catch (e) {} S.msgUnsub = null; }
}
function onData() {
  alarmTick(true);
  if (['home', 'pick', 'family', 'assess', 'settings'].includes(S.screen)) { const keep = document.activeElement; if (!(keep && /^(INPUT|TEXTAREA)$/.test(keep.tagName))) render(true); }
  else if (S.screen === 'chat') refreshChat();
  else renderChrome();
  checkNudgeDialog();
}
