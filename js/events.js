import { alarmTick } from './alarm.js';
import { SURVEYS } from './surveys/content.js';
import { clinicalInput, deleteClinical, openClinicalForm, saveClinical, shareClinical } from './ui/screens/clinical.js';
import { openClock } from './ui/screens/clock.js';
import { answerSurvey } from './ui/screens/surveys.js';
import { togglePush } from './ui/room-settings.js';
import { NO_WRITE_MSG, allCheckins, allSessions, isTrainee, remoteSet, todayS } from './data.js';
import { applyDisplay } from './display.js';
import { recordOfCheck, recordOfSession, shareSummary, talkAbout } from './records.js';
import { beginAssessStep, completeAssessment, resumeAssessment, saveAssessLater, finishSession, nextCourseStep, startAssessment, startCourse, startSession } from './session.js';
import { say, stopSpeech } from './sound.js';
import { S } from './state.js';
import { ACTS } from './ui/acts.js';
import { toast } from './ui/dom.js';
import { AI_BACK } from './ui/screens/ai-admin.js';
import { ADMIN_SUBSCREENS, confirmQuit, go, render } from './ui/shell.js';
import { $, LS } from './util.js';

/* ================= 이벤트 ================= */
const leaveGameConfirm = then => confirmQuit(then);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (ACTS[a]) { ACTS[a](b, e); return; }          // 새 화면(관리자·쉬는 화면 등)이 등록한 동작
  if (a === 'nav') { if (b.dataset.to === 'settings') { S.remDraft = null; } go(b.dataset.to); }
  else if (a === 'back' || a === 'home') {
    if (S.screen === 'game') leaveGameConfirm(() => go('home'));
    else if (a === 'back' && ADMIN_SUBSCREENS.includes(S.screen)) ACTS.adminback();
    else if (a === 'back' && AI_BACK[S.screen]) go(AI_BACK[S.screen]);
    else { S.ciFlow = false; go('home'); }
  }
  else if (a === 'quit') leaveGameConfirm(() => go('home'));
  else if (a === 'sound') {
    S.prefs.sound = !S.prefs.sound; LS.set('bw.sound', S.prefs.sound); applyDisplay({ noRender: true }); if (!S.prefs.sound) stopSpeech();
    b.setAttribute('aria-checked', String(S.prefs.sound));
    const stt = $('#sound-switch-state'); if (stt) stt.textContent = S.prefs.sound ? '켜져 있어요. 문제를 읽어 드려요.' : '꺼져 있어요.';
    if (S.prefs.sound) say('소리 안내를 켰어요.');
  }
  else if (a === 'contrast') { S.prefs.contrast = !S.prefs.contrast; LS.set('bw.contrast', S.prefs.contrast); applyDisplay({ noRender: true }); b.setAttribute('aria-checked', String(S.prefs.contrast)); const stt = $('#contrast-switch-state'); if (stt) stt.textContent = S.prefs.contrast ? '켜져 있어요. 글자와 테두리가 더 진해요.' : '꺼져 있어요.'; }
  else if (a === 'notify') { S.notifyFamily = !S.notifyFamily; b.setAttribute('aria-checked', String(S.notifyFamily)); const stt = $('#notify-switch-state'); if (stt) stt.textContent = S.notifyFamily ? '켜져 있어요. 나갈 때 가족 대화방에 알려요.' : '꺼져 있어요.'; }
  else if (a === 'size') { S.prefs.size = b.dataset.v; LS.set('bw.size', S.prefs.size); applyDisplay(); render(true); const nb = $('#size-' + S.prefs.size); if (nb) nb.focus(); }
  else if (a === 'font') { S.prefs.font = b.dataset.v; LS.set('bw.font', S.prefs.font); applyDisplay(); render(true); const nb = $('#font-' + S.prefs.font); if (nb) nb.focus(); }
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
  else if (a === 'after') { if (S.sess && S.sess.flow && S.course) nextCourseStep(); else go('pick'); }
  else if (a === 'again') startSession(S.last.rec.gameId, { inCourse: false });
  else if (a === 'assessstart') startAssessment();
  else if (a === 'assessbegin') beginAssessStep();
  else if (a === 'assesscontinue') go('assessStep');
  else if (a === 'assesslater') { saveAssessLater(); go('home'); }
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
    S.ci = {};
    if (S.ciFlow) { S.ciFlow = false; go('courseDone'); } else go('home');
  }
  else if (a === 'nudgego') { go('family'); setTimeout(() => { const n = $('#nudge-card'); if (n) n.scrollIntoView({ block: 'center' }); }, 60); }
  else if (a === 'sharesummary') shareSummary();
  else if (a === 'talk') { const s = allSessions().find(x => x.id === b.dataset.id); if (s) talkAbout(recordOfSession(s)); }
  else if (a === 'talkcheck') { const c = allCheckins()[todayS()]; if (c) talkAbout(recordOfCheck(c)); }
  else if (a === 'remsw') { S.remDraft.enabled = !S.remDraft.enabled; render(true); const nb = $('#rem-switch'); if (nb) nb.focus(); }
  else if (a === 'remsave') {
    const doc = { time: S.remDraft.time, enabled: !!S.remDraft.enabled }; S.myReminder = doc; LS.set('bw.reminder', doc);
    remoteSet('reminders/' + S.myId, doc, true).then(ok => { if (!ok) toast(NO_WRITE_MSG); }); alarmTick();
  }
});
document.addEventListener('toggle', e => { if (e.target && e.target.dataset && e.target.dataset.xp) S.xpOpen[e.target.dataset.xp] = e.target.open; else if (e.target && e.target.id === 'sl-details') S.ci._sl = e.target.open; else if (e.target && e.target.id === 'cl-more' && S.cl) S.cl.open = e.target.open; }, true);
document.addEventListener('input', e => {
  const t = e.target;
  if (S.cl && S.screen === 'clinicalForm' && clinicalInput(t)) return;
  if (t.id === 'sl-bed') S.ci.bed = t.value;
  else if (t.id === 'sl-wake') S.ci.wake = t.value;
  else if (t.id === 'rem-time' && S.remDraft) S.remDraft.time = t.value;
});
