import { alarmTick } from './alarm.js';
import { SURVEYS } from './surveys/content.js';
import { clinicalInput, deleteClinical, openClinicalForm, saveClinical, shareClinical } from './ui/screens/clinical.js';
import { openClock } from './ui/screens/clock.js';
import { answerSurvey } from './ui/screens/surveys.js';
import { togglePush } from './ui/room-settings.js';
import { setMyRole } from './store/membership.js';
import { FirebaseAdapter } from './store/firebase-adapter.js';
import { NO_WRITE_MSG, connectFamilyOnly, writeErrMsg, allCheckins, allSessions, chatAvail, isTrainee, remoteSet, todayS, traineeId } from './data.js';
import { buildIcs } from './logic.js';
import { Platform } from './platform.js';
import { recordOfCheck, recordOfSession, shareSummary, talkAbout } from './records.js';
import { beginAssessStep, completeAssessment, resumeAssessment, saveAssessLater, finishSession, nextCourseStep, startAssessment, startCourse, startSession } from './session.js';
import { say, stopSpeech } from './sound.js';
import { S } from './state.js';
import { Store } from './store/store.js';
import { dialog, toast } from './ui/dom.js';
import { go, render } from './ui/shell.js';
import { $, LS } from './util.js';

/* ================= 이벤트 ================= */
export function applyPrefs() {
  const r = document.documentElement;
  r.setAttribute('data-size', S.prefs.size);
  if (S.prefs.contrast) r.setAttribute('data-contrast', 'high'); else r.removeAttribute('data-contrast');
}
function leaveGameConfirm(then) {
  dialog('훈련을 그만하실래요?', '지금까지의 이 훈련 기록은 저장되지 않아요.', [{ label: '계속하기', kind: 'filled' }, { label: '그만하기', kind: 'text', run: then }]);
}
function saveAlarm() {
  const d = S.alarmDraft; if (!d || !/^\d{2}:\d{2}$/.test(d.time || '')) { toast('시간을 먼저 골라 주세요.'); return; }
  const doc = { time: d.time, days: d.days.slice().sort((a, b) => a - b), updatedBy: S.myId || null, updatedTs: Date.now() };
  S.alarm = doc; LS.set('bw.alarm', doc); remoteSet('state/alarm', doc, true).then(ok => toast(ok || !Store.shared ? '알람을 저장했어요.' : NO_WRITE_MSG));
  alarmTick();
}
function saveIcs() {
  const d = S.alarmDraft, ics = buildIcs({ time: d.time, days: d.days }, Date.now(), '');
  if (!ics) { toast('시간과 요일을 하나 이상 골라 주세요.'); return; }
  Platform.saveFile('brainwalk-alarm.ics', new Blob([ics], { type: 'text/calendar' })).then(() => toast('저장했어요. 파일을 열면 휴대폰 캘린더에 매일 알림이 등록돼요.')).catch(() => {
    S.icsText = ics; render(true); toast('파일을 저장하지 못했어요. 아래 내용을 복사해 쓰세요.');
  });
}
function roleSwitch() {
  if (isTrainee()) {
    dialog('가족으로 바꿀까요?', chatAvail() && traineeId() === S.myId ? '훈련하는 분 등록이 해제되고 가족 화면으로 열려요.' : '가족 화면으로 열려요.', [{ label: '취소', kind: 'text' }, { label: '바꾸기', kind: 'filled', run: async () => {
      if (chatAvail() && traineeId() === S.myId) {
        try { await Store.deleteDoc('state/trainee'); S.trainee = null; }
        catch (e) { toast(e && e.code === 'permission-denied' ? '훈련하는 분 해제는 가족방을 만든 분만 할 수 있어요.' : writeErrMsg(e)); return; }
      }
      S.roleLocal = 'family'; LS.set('bw.role', 'family');
      if (Store.mode === 'firebase') { try { await setMyRole('family'); await FirebaseAdapter.refreshMembers(); } catch (e) {} connectFamilyOnly(); }
      render(true); } }]);
  } else {
    dialog('훈련하는 분으로 바꿀까요?', traineeId() && traineeId() !== S.myId ? '지금 등록된 훈련하는 분이 바뀌어요. 정말 바꿀까요?' : '이 기기에서 훈련하는 분으로 쓰게 돼요.', [{ label: '취소', kind: 'text' }, { label: '바꾸기', kind: 'filled', run: async () => {
      if (chatAvail()) { try { const doc = { userId: S.myId, displayLabel: (S.trainee && S.trainee.displayLabel) || '아버지' }; await Store.setDoc('state/trainee', doc); S.trainee = doc; } catch (e) { toast(writeErrMsg(e)); return; } }
      S.roleLocal = 'trainee'; LS.set('bw.role', 'trainee');
      if (Store.mode === 'firebase') { try { await setMyRole('trainee'); await FirebaseAdapter.refreshMembers(); } catch (e) {} connectFamilyOnly(); }
      render(true); } }]);
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'nav') { if (b.dataset.to === 'settings') { S.alarmDraft = null; S.remDraft = null; S.icsText = ''; } go(b.dataset.to); }
  else if (a === 'back' || a === 'home') { if (S.screen === 'game') leaveGameConfirm(() => go('home')); else go('home'); }
  else if (a === 'quit') leaveGameConfirm(() => go('home'));
  else if (a === 'sound') {
    S.prefs.sound = !S.prefs.sound; LS.set('bw.sound', S.prefs.sound); if (!S.prefs.sound) stopSpeech();
    b.setAttribute('aria-checked', String(S.prefs.sound));
    const stt = $('#sound-switch-state'); if (stt) stt.textContent = S.prefs.sound ? '켜져 있어요. 문제를 읽어 드려요.' : '꺼져 있어요.';
    toast(S.prefs.sound ? '소리 안내를 켰어요.' : '소리 안내를 껐어요.'); if (S.prefs.sound) say('소리 안내를 켰어요.');
  }
  else if (a === 'contrast') { S.prefs.contrast = !S.prefs.contrast; LS.set('bw.contrast', S.prefs.contrast); applyPrefs(); b.setAttribute('aria-checked', String(S.prefs.contrast)); const stt = $('#contrast-switch-state'); if (stt) stt.textContent = S.prefs.contrast ? '켜져 있어요. 글자와 테두리가 더 진해요.' : '꺼져 있어요.'; }
  else if (a === 'notify') { S.notifyFamily = !S.notifyFamily; b.setAttribute('aria-checked', String(S.notifyFamily)); const stt = $('#notify-switch-state'); if (stt) stt.textContent = S.notifyFamily ? '켜져 있어요. 나갈 때 가족 대화방에 알려요.' : '꺼져 있어요.'; }
  else if (a === 'size') { S.prefs.size = b.dataset.v; LS.set('bw.size', S.prefs.size); applyPrefs(); render(true); const nb = $('#size-' + S.prefs.size); if (nb) nb.focus(); }
  else if (a === 'push') togglePush(b);
  else if (a === 'clform') openClinicalForm(b.dataset.t || 'cist');
  else if (a === 'clsave') saveClinical();
  else if (a === 'clcancel') { S.cl = null; go('clinical'); }
  else if (a === 'clres') { S.cl.result = S.cl.result === b.dataset.v ? null : b.dataset.v; S.cl.open = true; render(true); const nb = $('#cl-more'); if (nb) nb.scrollIntoView({ block: 'nearest' }); }
  else if (a === 'clshare') shareClinical(b.dataset.id);
  else if (a === 'cldel') deleteClinical(b.dataset.id);
  else if (a === 'clockopen') openClock(Number(b.dataset.i));
  else if (a === 'svopen') { const sv = SURVEYS[b.dataset.k]; S.sv = { kind: sv.id, mode: isTrainee() ? 'self' : sv.modes[0], relation: LS.get('bw.relation', null), idx: 0, answers: [] }; go('surveyIntro'); }
  else if (a === 'svmode') { S.sv.mode = b.dataset.v; render(true); }
  else if (a === 'svrel') { S.sv.relation = b.dataset.v; render(true); const nb = $('#btn-sv-start'); if (nb) nb.focus(); }
  else if (a === 'svstart') { S.sv.idx = 0; S.sv.answers = []; go('surveyQ'); }
  else if (a === 'svans') answerSurvey(Number(b.dataset.v));
  else if (a === 'svprev') { S.sv.idx = Math.max(0, S.sv.idx - 1); render(); }
  else if (a === 'svcancel') go(isTrainee() ? 'home' : 'surveys');
  else if (a === 'course') startCourse();
  else if (a === 'game') startSession(b.dataset.id, { inCourse: false });
  else if (a === 'replay') { if (S.ctx) S.ctx.replay(); }
  else if (a === 'next') { const s = S.sess; if (!s) return; if (s.idx + 1 < s.rounds) { s.idx++; render(); } else finishSession(); }
  else if (a === 'after') { if (S.sess && S.sess.inCourse && S.course) nextCourseStep(); else go('pick'); }
  else if (a === 'again') startSession(S.last.rec.gameId, { inCourse: false });
  else if (a === 'assessstart') startAssessment();
  else if (a === 'assessbegin') beginAssessStep();
  else if (a === 'assesscontinue') go('assessStep');
  else if (a === 'assesslater') { saveAssessLater(); toast('여기까지 저장했어요. 내일 이어서 해 주세요.'); go('home'); }
  else if (a === 'assessend') completeAssessment();
  else if (a === 'assessresume') resumeAssessment();
  else if (a === 'ci') {
    const k = b.dataset.k, v = b.dataset.v; S.ci[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
    render(true); const nb = $('#ci-' + (k === 'mood' ? 'mood-' + v : k === 'sleepHours' ? 'sleep-' + v : k + '-' + (v === 'true' ? 'yes' : 'no'))); if (nb) nb.focus();
  }
  else if (a === 'cisave') {
    const c = S.ci, date = todayS(), doc = { date, ts: Date.now(), mood: c.mood, sleepHours: c.sleepHours, exercise: !!c.exercise, social: !!c.social, meals: !!c.meals, userId: S.myId || null };
    S.ciLocal[date] = doc; LS.set('bw.checkins', S.ciLocal); remoteSet('checkins/' + date + '-' + (S.myId || 'local'), doc, true);
    if (/^\d{2}:\d{2}$/.test(c.bed || '') && /^\d{2}:\d{2}$/.test(c.wake || '')) remoteSet('sleeplogs/' + date + '-' + (S.myId || 'local'), { date, ts: doc.ts, userId: S.myId || null, bed: c.bed, wake: c.wake, wakings: c.wakings == null ? 0 : c.wakings }, true);
    S.ci = {}; toast('저장했어요. 잘하셨어요!'); go('home');
  }
  else if (a === 'nudgego') { go('family'); setTimeout(() => { const n = $('#nudge-card'); if (n) n.scrollIntoView({ block: 'center' }); }, 60); }
  else if (a === 'sharesummary') shareSummary();
  else if (a === 'talk') { const s = allSessions().find(x => x.id === b.dataset.id); if (s) talkAbout(recordOfSession(s)); }
  else if (a === 'talkcheck') { const c = allCheckins()[todayS()]; if (c) talkAbout(recordOfCheck(c)); }
  else if (a === 'aday') { const d = Number(b.dataset.d), arr = S.alarmDraft.days, i = arr.indexOf(d); if (i >= 0) arr.splice(i, 1); else arr.push(d); render(true); const nb = $('#alarm-day-' + d); if (nb) nb.focus(); }
  else if (a === 'alarmsave') saveAlarm();
  else if (a === 'ics') saveIcs();
  else if (a === 'icscopy') { const t = $('#ics-text'); Platform.copy(S.icsText, t).then(ok => toast(ok ? '복사했어요.' : '글자를 길게 눌러 복사해 주세요.')); }
  else if (a === 'roleswitch') roleSwitch();
  else if (a === 'remsw') { S.remDraft.enabled = !S.remDraft.enabled; render(true); const nb = $('#rem-switch'); if (nb) nb.focus(); }
  else if (a === 'remsave') {
    const doc = { time: S.remDraft.time, enabled: !!S.remDraft.enabled }; S.myReminder = doc; LS.set('bw.reminder', doc);
    remoteSet('reminders/' + S.myId, doc, true).then(ok => toast(ok ? '저장했어요.' : NO_WRITE_MSG)); alarmTick();
  }
});
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'sl-details') S.ci._sl = e.target.open; else if (e.target && e.target.id === 'cl-more' && S.cl) S.cl.open = e.target.open; }, true);
document.addEventListener('input', e => {
  const t = e.target;
  if (S.cl && S.screen === 'clinicalForm' && clinicalInput(t)) return;
  if (t.id === 'sl-bed') S.ci.bed = t.value;
  else if (t.id === 'sl-wake') S.ci.wake = t.value;
  else if (t.id === 'alarm-time' && S.alarmDraft) S.alarmDraft.time = t.value;
  else if (t.id === 'rem-time' && S.remDraft) S.remDraft.time = t.value;
});
