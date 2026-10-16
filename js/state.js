import { LS } from './util.js';

/* ================= 상태 ================= */
export const S = {
  prefs: { size: LS.get('bw.size', 'normal'), sound: LS.get('bw.sound', true) !== false, font: LS.get('bw.font', 'pretendard') },
  levels: LS.get('bw.levels', {}) || {},
  local: Array.isArray(LS.get('bw.sessions', [])) ? LS.get('bw.sessions', []) : [],
  db: null, dbState: 'pending', dbSessions: null, canWrite: null, writeFailed: false, dbError: false,
  screen: 'home', sess: null, course: null, last: null, voice: null
};
if (!['normal', 'large', 'xlarge', 'max'].includes(S.prefs.size)) S.prefs.size = 'normal';
if (!['pretendard', 'noto', 'system'].includes(S.prefs.font)) S.prefs.font = 'pretendard';

/* ================= 추가 상태 ================= */
S.prefs.contrast = LS.get('bw.contrast', false) === true;
Object.assign(S, {
  myId: null, me: null, profiles: {},
  /* 훈련하는 분 목록과 사람마다의 자료 (data.js) · 가족 화면에서 고른 사람 ('all' | memberId) */
  trainees: { ids: [], labels: {} }, T: {}, tsReady: false, selT: LS.get('bw.selT', null), lastT: LS.get('bw.selT1', null),
  roleLocal: LS.get('bw.role', null), myReminder: LS.get('bw.reminder', null),
  program: LS.get('bw.program', null), assessLocal: LS.get('bw.assess', []), ciLocal: LS.get('bw.checkins', {}),
  dbAssess: null, dbCheckins: null, dbMsgs: [], pendingMsgs: {}, messages: [], msgsReady: false, msgLimit: 100, msgHasMore: false,
  reads: {}, ci: {}, notifyFamily: true, notifyPending: false, interacted: false, hist: LS.get('bw.hist', {}),
  surveys: [], iadl: [], clinical: [], taskRuns: [], sleeplogs: [], sv: null, cl: null,
  reply: null, attach: null, alarmDue: false, remDue: false, nudgeShown: {}, icsText: '',
  /* 관리자·원격 설정·실시간 진행 (DESIGN.md §4.2) */
  eff: null, family: { ownerMemberId: null, admins: [] },
  ciFlow: false, planDraft: null, dispDraft: null, xpOpen: {}, _progLocal: null
});
if (!Array.isArray(S.assessLocal)) S.assessLocal = [];
if (!S.ciLocal || typeof S.ciLocal !== 'object') S.ciLocal = {};
if (!S.hist || typeof S.hist !== 'object') S.hist = {};
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.interacted = true; }, { capture: true, passive: true }));
