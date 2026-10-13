import { alarmTick } from '../../alarm.js';
import { allAssessments, allSessions, chatAvail, ensureProfiles, getPlan, isTrainee, nameOf, todayS, traineeLabel } from '../../data.js';
import { ic } from '../../icons.js';
import { unreadCount } from '../../messages.js';
import { checkDue, isTrainingDay, nextTrainingDate } from '../../program.js';
import { assessDraft, courseInfo, resumeAssessment, startAssessment, startCourse } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { ACTS } from '../acts.js';
import { btnEl, dialog, h, svgIcon, toast } from '../dom.js';
import { dashboardHtml, startDashboardTicker } from '../dashboard.js';
import { installSlot } from '../install.js';
import { pushPromptCard } from '../room-settings.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { progressBar } from '../widgets.js';
import { $, LS, WD, esc, iga, parseYmd, ymd } from '../../util.js';

/* 훈련하는 분의 홈 (DESIGN.md §5 L1): 오늘 할 일 하나(큰 버튼)와 가족 한마디뿐이에요. 하단 메뉴 없음.
 * 큰 버튼의 상태(첫 번째로 맞는 것): 점검 이어하기 · 점검 하는 날 · 오늘 완료 · 이어서 하기 · 오늘 훈련 시작 · 쉬는 날 */
export function mainState() {
  const now = new Date(), today = ymd(now), plan = getPlan(), ci = courseInfo(), trainingDay = isTrainingDay(plan, now);
  const lastA = allAssessments()[0], dr = assessDraft();
  const due = checkDue(plan, lastA && lastA.date, today, allSessions().length > 0);
  const anyToday = ci.done || ci.started || allSessions().some(s => s.date === today);
  if (dr) return { k: 'resumeCheck', label: '점검 이어서 하기', sub: '어제 하던 두뇌 점검을 마저 해요 · 약 7분', ci };
  if (due.state === 'due' && trainingDay && LS.get('bw.checkSkip', '') !== today && !anyToday) return { k: 'check', label: '오늘 점검 시작', sub: '한 달에 한 번 하는 두뇌 점검이에요 · 약 15분', ci };
  if (ci.done) return { k: 'done', label: '오늘 완료 ✓', sub: '내일 또 만나요', ci };
  if (ci.started) return { k: 'course', label: '이어서 하기', sub: ci.N + '개 중 ' + ci.n + '개 했어요', ci, progress: true };
  if (trainingDay) return { k: 'course', label: '오늘 훈련 시작', sub: '게임 ' + ci.N + '개 · 약 ' + ci.minutes + '분', ci };
  const nx = nextTrainingDate(plan, now);
  return { k: 'rest', label: '가볍게 해 보기', sub: '오늘은 쉬는 날이에요.' + (nx ? ' 다음 훈련은 ' + WD[parseYmd(nx).getDay()] + '요일이에요.' : ''), ci };
}
function traineeHtml() {
  const now = new Date(), hr = now.getHours(), st = mainState(), due = !!S.alarmDue && st.k !== 'done';
  const greet = hr < 12 ? '좋은 아침이에요' : hr < 18 ? '편안한 오후예요' : '편안한 저녁이에요';
  const cls = st.k === 'done' ? ' done' : st.k === 'rest' ? ' soft' : '';
  const card = '<section class="card ' + (due ? 'today due' : 'elevated today') + '" id="today-card" aria-labelledby="today-h"' + (due ? ' role="alert"' : '') + '>' +
    (due ? '<h2 class="due-title" id="today-h">' + ic('alarm') + '훈련할 시간이에요!</h2>' : '<h2 class="sr" id="today-h">오늘의 훈련</h2>') +
    '<button class="main-btn' + cls + '" id="btn-main" type="button" data-act="main" data-k="' + st.k + '">' + (st.k === 'done' ? '' : ic(st.k === 'rest' ? 'leaf' : 'play')) + '<span>' + st.label + '</span></button>' +
    '' +
    (st.progress ? '<div>' + progressBar(st.ci.n / st.ci.N * 100, '오늘의 훈련 진행') + '</div>' : '') +
    (due ? '<button class="btn text snooze" id="banner-snooze" type="button">30분 뒤에 다시 알려 주세요</button>' : '') + '</section>';
  return '<div class="stack"><header class="hero" aria-labelledby="hello"><p class="greet">' + greet + '</p><h1 class="date" id="hello">' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' + WD[now.getDay()] + '요일</h1></header>' + card + '<div id="cheer-slot"></div></div>';
}
function bindTrainee(el) {
  const sn = $('#banner-snooze', el);
  if (sn) sn.onclick = () => { LS.set('bw.snooze', Date.now() + 30 * 60000); alarmTick(); render(true); };
  const slot = $('#cheer-slot', el); if (!slot) return;
  if (!chatAvail()) {
    slot.append(h('section', { class: 'card primary cheer', id: 'cheer-card', 'aria-label': '가족' },
      h('button', { class: 'btn tonal big', id: 'btn-family-chat', type: 'button', onclick: () => go('chat') }, '가족 대화')));
    return;
  }
  const m = S.messages.filter(x => x.authorId !== S.myId && !x.deleted && x.kind === 'text' && x.text).slice(-1)[0];
  if (m) ensureProfiles([m.authorId]);
  const un = unreadCount();
  const line = m
    ? h('button', { class: 'cheer-line', id: 'cheer-line', type: 'button', 'aria-label': '응원 메시지 듣기', onclick: () => say(nameOf(m.authorId) + '님이 말씀하셨어요. ' + m.text, true) }, h('b', { text: nameOf(m.authorId) + ': ' }), h('span', { text: m.text }))
    : null;
  slot.append(h('section', { class: 'card primary cheer', id: 'cheer-card', 'aria-label': '가족' }, line,
    h('button', { class: 'btn tonal big', id: 'btn-family-chat', type: 'button', onclick: () => go('chat') }, '가족 대화', un > 0 ? h('span', { class: 'new-badge', text: '새 글 ' + (un > 99 ? '99+' : un) }) : null)));
}
/* 가족 홈 = 대시보드 (ui/dashboard.js): 요약 타일 · 오늘의 훈련 · 최근 7일 · 대화 · 빠른 동작 칩 */
function familyHtml() {
  const now = new Date(), hr = now.getHours();
  const hero = '<header class="hero" aria-labelledby="hello"><h1 class="date" id="hello">' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' + WD[now.getDay()] + '요일</h1><p class="greet muted">' + (hr < 12 ? '좋은 아침이에요' : hr < 18 ? '편안한 오후예요' : '편안한 저녁이에요') + '</p></header>';
  return '<div class="stack"><div id="home-banner"></div>' + hero + dashboardHtml() + '</div>';
}
SCREENS.home = {
  html() { return isTrainee() ? traineeHtml() : familyHtml(); },
  bind(el) {
    if (isTrainee()) return bindTrainee(el);
    const bn = $('#home-banner', el);
    bn.append(installSlot('home'));
    const pc = pushPromptCard(); if (pc) bn.append(pc);
    if (S.remDue) {
      bn.append(h('div', { class: 'banner', role: 'status', id: 'reminder-banner' }, h('div', { class: 't-title' }, svgIcon('alarm'), traineeLabel() + iga(traineeLabel()) + ' 아직 훈련 전이에요'),
        h('div', { class: 'row' }, btnEl('알림 보내기', 'filled fit', () => { go('family'); setTimeout(() => { const n = $('#nudge-slot'); if (n) n.scrollIntoView({ block: 'center' }); }, 50); }, 'rem-send'), btnEl('닫기', 'text', () => { LS.set('bw.remDismiss', todayS()); alarmTick(); render(true); }, 'rem-close'))));
    }
    startDashboardTicker(render);
  }
};
export const QUICK_REPLIES = ['고마워요 ❤️', '오늘도 했어요!', '보고 싶어요'];

/* ---- 훈련하는 분 홈의 동작 ---- */
ACTS.main = b => {
  const k = b.dataset.k;
  if (k === 'resumeCheck') resumeAssessment();
  else if (k === 'check') go('checkIntro');
  else if (k === 'done') dialog('오늘 훈련을 다 하셨어요', '한 번 더 해 보시겠어요? 오늘 기록은 그대로 남아요.', [{ label: '아니요, 쉴게요', kind: 'filled' }, { label: '한 번 더', kind: 'text', run: () => startCourse({ replay: true }) }]);
  else startCourse();
};
ACTS['check-start'] = () => startAssessment();
ACTS.checkskip = () => { LS.set('bw.checkSkip', todayS()); startCourse(); };
ACTS.cistskip = () => { S.ci = {}; S.ciFlow = false; go('courseDone'); };
/* 훈련하는 분이 실수로 설정을 열지 않도록: 한 번 더 물어봐요 */
ACTS.gear = () => dialog('설정을 열까요?', '가족이 도와줄 때만 열어 주세요.', [{ label: '닫기', kind: 'filled' }, { label: '설정 열기', kind: 'text', run: () => go('settings') }]);
