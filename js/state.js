import { LS } from './util.js';

/* ================= 상태 ================= */
export const S = {
  prefs: { size: LS.get('bw.size', 'normal'), sound: LS.get('bw.sound', true) !== false },
  levels: LS.get('bw.levels', {}) || {},
  local: Array.isArray(LS.get('bw.sessions', [])) ? LS.get('bw.sessions', []) : [],
  db: null, dbState: 'pending', dbSessions: null, canWrite: null, writeFailed: false, dbError: false,
  screen: 'home', sess: null, course: null, last: null, voice: null
};
if (!['normal', 'large', 'xlarge'].includes(S.prefs.size)) S.prefs.size = 'normal';

/* ================= 추가 상태 ================= */
S.prefs.contrast = LS.get('bw.contrast', false) === true;
Object.assign(S, {
  myId: null, me: null, profiles: {}, trainee: null,
  roleLocal: LS.get('bw.role', null), alarm: null, myReminder: LS.get('bw.reminder', null),
  program: LS.get('bw.program', null), assessLocal: LS.get('bw.assess', []), ciLocal: LS.get('bw.checkins', {}),
  dbAssess: null, dbCheckins: null, dbMsgs: [], pendingMsgs: {}, messages: [], msgsReady: false, msgLimit: 100, msgHasMore: false,
  reads: {}, ci: {}, notifyFamily: true, notifyPending: false, interacted: false, hist: LS.get('bw.hist', {}),
  reply: null, attach: null, alarmDue: false, remDue: false, nudgeShown: {}, icsText: ''
});
if (!Array.isArray(S.assessLocal)) S.assessLocal = [];
if (!S.ciLocal || typeof S.ciLocal !== 'object') S.ciLocal = {};
if (!S.hist || typeof S.hist !== 'object') S.hist = {};
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.interacted = true; }, { capture: true, passive: true }));
