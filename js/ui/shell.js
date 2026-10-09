import { chatAvail, isTrainee, updateSyncNote } from '../data.js';
import { memberIds, unreadCount } from '../messages.js';
import { ASSESS_STEPS, COURSE_N, maybeNotify } from '../session.js';
import { stopSpeech } from '../sound.js';
import { S } from '../state.js';
import { closeSheet, h, svgIcon } from './dom.js';
import { SCREENS } from './registry.js';
import { $ } from '../util.js';

/* ================= 화면 ================= */
/* 하단 메뉴는 역할마다 달라요. 훈련하는 분: 홈·훈련·대화 (설문·기록·검사는 가족 전용이라 숨김). 가족: 홈·기록·점검·대화. */
const NAV_TRAINEE = [['home', '홈', 'home'], ['pick', '훈련', 'grid'], ['chat', '대화', 'chat']];
const NAV_FAMILY = [['home', '홈', 'home'], ['family', '기록', 'chart'], ['assess', '점검', 'clip'], ['chat', '대화', 'chat']];
const navItems = () => (isTrainee() ? NAV_TRAINEE : NAV_FAMILY);
/* 훈련하는 분이 열 수 없는 가족 전용 화면 (눌러도 홈으로) */
const FAMILY_ONLY_SCREENS = ['family', 'clocks', 'clinical', 'clinicalForm', 'assessView'];
const TITLES = { clinical: '병원·센터 검사', clinicalForm: '검사 결과 기록', clock: '시계 그리기', clockDone: '시계 그리기', clocks: '시계 그림', assessBreak: '두뇌 건강 점검', surveys: '설문', surveyIntro: '설문', surveyQ: '설문', surveyDone: '설문', assessView: '두뇌 건강 점검 결과', home: '오늘의 두뇌 산책', pick: '골라서 하기', assess: '두뇌 건강 점검', assessStep: '두뇌 건강 점검', assessDone: '점검 결과', game: '', result: '훈련 결과', courseDone: '오늘의 훈련', family: '가족이 보는 기록', checkin: '오늘의 생활 체크', settings: '설정', chat: '우리 가족 대화방' };
const BARE = n => n === 'setup' || n.indexOf('ob-') === 0;   // 설정 안내·가입 화면: 뒤로가기/설정 버튼 없음

export function go(name) { if (isTrainee() && FAMILY_ONLY_SCREENS.includes(name)) name = 'home'; stopSpeech(); if (S.screen === 'courseDone' && name !== 'courseDone') maybeNotify(); closeSheet(); S.screen = name; render(); }

export function renderChrome() {
  const showNav = navItems().some(n => n[0] === S.screen) && S.screen !== 'chat';
  let title = BARE(S.screen) ? '오늘의 두뇌 산책' : TITLES[S.screen];
  if (S.screen === 'game' && S.sess) title = S.sess.assess ? '점검 ' + (S.assess.idx + 1) + '/' + ASSESS_STEPS.length : S.sess.inCourse ? '오늘의 훈련 ' + (S.course.results.length + 1) + '/' + COURSE_N : S.sess.g.name;
  if (S.screen === 'surveyQ' && S.sv) title = '설문 ' + (S.sv.idx + 1);
  if (S.screen === 'assessStep') title = '점검 ' + (S.assess.idx + 1) + '/' + ASSESS_STEPS.length;
  if (S.screen === 'chat') title = '우리 가족 대화방' + (chatAvail() ? ' · ' + memberIds().length + '명' : '');
  const bar = $('#appbar-in'); bar.textContent = '';
  if (S.screen !== 'home' && !BARE(S.screen)) bar.append(h('button', { class: 'icon-btn labeled', id: 'btn-back', type: 'button', 'data-act': 'back', 'aria-label': '뒤로 가기, 처음 화면으로' }, svgIcon('back'), h('span', { text: '뒤로' })));
  else bar.append(svgIcon('leaf'));
  bar.append(h('div', { class: 'appbar-title', id: 'appbar-title', text: title }));
  if (S.screen === 'home') bar.append(h('button', { class: 'icon-btn labeled', id: 'btn-settings', type: 'button', 'data-act': 'nav', 'data-to': 'settings', 'aria-label': '설정' }, svgIcon('gear'), h('span', { text: '설정' })));
  $('#navbar').hidden = !showNav;
  document.body.classList.toggle('has-nav', showNav);
  document.body.classList.toggle('in-chat', S.screen === 'chat');
  const nav = $('#navbar-in'); nav.textContent = '';
  const un = unreadCount();
  navItems().forEach(n => {
    const pill = h('span', { class: 'nav-pill' }, svgIcon(n[2]));
    if (n[0] === 'chat' && un > 0) pill.append(h('span', { class: 'nav-badge', 'aria-label': '안 읽은 메시지 ' + un + '개', text: un > 99 ? '99+' : String(un) }));
    nav.append(h('button', { type: 'button', class: 'nav-item', id: 'nav-' + n[0], 'data-act': 'nav', 'data-to': n[0], 'aria-current': S.screen === n[0] ? 'page' : null }, pill, n[1]));
  });
  // 채팅 화면에서는 하단 메뉴 대신 입력창이 있으므로 숨김 (위 showNav=false)
}

export function render(soft) {
  S.nudgeUpdaters = [];
  renderChrome();
  const el = $('#screen'), fn = SCREENS[S.screen];
  el.textContent = ''; el.insertAdjacentHTML('beforeend', fn.html());
  if (fn.bind) fn.bind(el);
  updateSyncNote();
  if (!soft) { window.scrollTo(0, 0); const hh = el.querySelector('h1'); if (hh) { hh.setAttribute('tabindex', '-1'); try { hh.focus({ preventScroll: true }); } catch (e) {} } }
}
