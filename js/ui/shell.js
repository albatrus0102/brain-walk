import { pmButtons, pmOnNav, pmVisible } from '../ai/pm.js';
import { chatAvail, isAdmin, isTrainee, traineeLabel, updateSyncNote } from '../data.js';
import { isCompact, syncDensity } from '../display.js';
import { memberIds, unreadCount } from '../messages.js';
import { ASSESS_STEPS, courseLen } from '../session.js';
import { stopSpeech } from '../sound.js';
import { S } from '../state.js';
import { closeSheet, dialog, h, svgIcon } from './dom.js';
import { exitApp, initNav, navTo, rearm } from './nav.js';
import { SCREENS } from './registry.js';
import { $ } from '../util.js';

/* ================= 화면 ================= */
/* 하단 메뉴는 가족만 있어요 (홈·기록·대화·설정, M3 navigation bar). 점검은 기록 화면의 탭이에요. 훈련하는 분은 하단 메뉴 없이 홈의 큰 버튼 하나로 모든 것이 이어져요. */
const NAV_TRAINEE = [];
const NAV_FAMILY = [['home', '홈', 'home'], ['family', '기록', 'chart'], ['chat', '대화', 'chat'], ['settings', '설정', 'gear']];
const navItems = () => (isTrainee() ? NAV_TRAINEE : NAV_FAMILY);
/* 하단 메뉴의 어느 칸에 속한 화면인지 (점검 허브는 '기록' 칸) */
const NAV_OF = { assess: 'family' };
const navKey = s => NAV_OF[s] || s;
/* 설정·점검 허브에서 여는 화면들: 뒤로 가기가 돌아갈 곳 (AI 화면은 ai-admin.js 의 AI_BACK) */
/* 하단 메뉴의 꼭지 화면. 그 밖의 화면을 꼭지에서 열었으면 어디서 왔는지 기억해 뒀다가, 뒤로 가기가 그곳으로 돌아가요 (같은 화면을 홈·설정·점검 어디서든 열 수 있어서) */
const TABS = ['home', 'family', 'assess', 'chat', 'settings'];
export const backTarget = (name, dflt) => { const o = S.origin && S.origin[name]; return o && o !== name ? o : dflt; };
export const BACK_TO = { setMine: 'settings', setNotify: 'settings', surveys: 'assess', clinical: 'assess', clocks: 'assess', assessView: 'assess', clinicalForm: 'clinical', surveyIntro: 'surveys', surveyDone: 'surveys' };
/* 훈련하는 분이 열 수 있는 화면: 흐름(훈련·쉬는 화면·점검·생활 체크·축하), 가족 대화, 가족이 도와줄 때 여는 설정. 나머지는 눌러도 홈으로. */
const TRAINEE_SCREENS = ['home', 'game', 'result', 'courseBreak', 'checkIntro', 'checkin', 'courseDone', 'chat', 'settings', 'assess', 'assessStep', 'assessBreak', 'assessDone', 'surveyIntro', 'surveyQ', 'surveyDone', 'clock', 'clockDone'];
/* 방 주인(관리자)이 훈련하는 분일 때, 설정 안의 '가족방 관리'에서 여는 관리 화면 */
const ADMIN_SCREENS = ['adminDisplay', 'adminPlan', 'members'];
export const ADMIN_SUBSCREENS = ADMIN_SCREENS;
const TITLES = { setMine: '내 화면', setNotify: '알림', clinical: '병원 검사 기록', clinicalForm: '검사 결과 기록', clock: '시계 그리기', clockDone: '시계 그리기', clocks: '시계 그림', assessBreak: '두뇌 건강 점검', surveys: '설문', surveyIntro: '설문', surveyQ: '설문', surveyDone: '설문', assessView: '두뇌 건강 점검 결과', home: '오늘의 두뇌 산책', pick: '골라서 하기', assess: '두뇌 건강 점검', assessStep: '두뇌 건강 점검', assessDone: '점검 결과', game: '', result: '훈련 결과', courseDone: '오늘의 훈련', courseBreak: '오늘의 훈련', checkIntro: '두뇌 점검', family: '가족이 보는 기록', checkin: '오늘의 생활 체크', settings: '설정', chat: '우리 가족 대화방', adminPlan: '훈련 계획', members: '가족 구성원', aiReports: 'AI 리포트', aiReport: 'AI 리포트', aiTrend: '흐름 그래프', aiAnchor: '같은 문제 다시 풀기', aiNotes: '메모', aiBank: '문제 은행', aiOps: '루틴 상태', aiSettings: 'AI 리포트 설정' };
const BARE = n => n === 'setup' || n.indexOf('ob-') === 0;   // 설정 안내·가입 화면: 뒤로가기/설정 버튼 없음

const guard = name => (isTrainee() && !BARE(name) && !TRAINEE_SCREENS.includes(name) && !(ADMIN_SCREENS.includes(name) && isAdmin())) ? 'home' : name;
export function go(name) {
  name = guard(name);
  if (TABS.includes(name)) S.origin = {}; else if (TABS.includes(S.screen) && S.screen !== name) (S.origin || (S.origin = {}))[name] = S.screen;
  pmOnNav(name);
  stopSpeech(); closeSheet(); navTo(name); S.screen = name; render();
}

/* ================= 뒤로 가기 (History API, nav.js) ================= */
/* 하던 일이 있는 화면: 게임, 설문 문항, 시계 그리기, 생활 체크. 여기서 Back 은 바로 나가지 않고 물어요. */
const TASK_SCREENS = ['game', 'surveyQ', 'clock', 'checkin'];
const QUIT_TEXT = '지금 하던 게임은 처음부터 다시 해요. 앞에서 마친 게임은 저장돼 있어요. 홈에서 ‘이어서 하기’를 누르면 돼요.';
/* 하던 일을 그만둘지 묻기: 계속하기(기본)·그만두기. 그만두기는 화면마다 원래의 그만두기 길을 따라가요. */
export function confirmQuit(then) {
  const sc = S.screen;
  let title = '게임을 그만둘까요?', text = QUIT_TEXT;
  if (!then) {
    if (sc === 'surveyQ') { title = '설문을 그만둘까요?'; text = '지금까지 답한 것은 저장되지 않아요.'; then = () => go(isTrainee() ? 'home' : 'surveys'); }
    else if (sc === 'clock') { title = '그림 그리기를 그만둘까요?'; text = '지금 그린 그림은 저장되지 않아요.'; then = () => go('pick'); }
    else if (sc === 'checkin') { title = '생활 체크를 그만둘까요?'; text = '체크한 것은 저장되지 않아요.'; then = () => { S.ciFlow = false; go('home'); }; }
    else then = () => go('home');
  }
  dialog(title, text, [{ label: '계속하기', kind: 'filled' }, { label: '그만두기', kind: 'text', run: then }]);
}
function confirmExit() {
  dialog('앱을 닫을까요?', '‘계속하기’를 누르면 앱에 그대로 있어요.', [{ label: '계속하기', kind: 'filled' }, { label: '닫기', kind: 'text', run: exitApp }], () => rearm(), null, { nopush: true });
}
function showFromHistory(name) { name = guard(name); stopSpeech(); closeSheet(); S.screen = name; render(); }
initNav({
  isTask: n => TASK_SCREENS.includes(n),
  isBare: n => BARE(n),
  isActive: () => S.screen === 'game',
  confirmQuit: () => confirmQuit(),
  confirmExit,
  show: showFromHistory
});

export function renderChrome() {
  syncDensity();
  const compact = isCompact();
  const showNav = navItems().some(n => n[0] === navKey(S.screen)) && S.screen !== 'chat';
  let title = BARE(S.screen) ? '오늘의 두뇌 산책' : TITLES[S.screen];
  if (compact && S.screen === 'home') title = '오늘의 두뇌 산책';
  if (compact && S.screen === 'family') title = '기록';
  if (compact && S.screen === 'assess') title = '기록';
  if (S.screen === 'adminDisplay') title = traineeLabel() + ' 화면';
  if (S.screen === 'game' && S.sess) title = S.sess.assess ? '점검 ' + (S.assess.idx + 1) + '/' + ASSESS_STEPS.length : S.sess.flow && S.course ? '오늘의 훈련 ' + Math.min(S.course.results.length + 1, courseLen()) + '/' + courseLen() : S.sess.g.name;
  if (S.screen === 'surveyQ' && S.sv) title = '설문 ' + (S.sv.idx + 1);
  if (S.screen === 'assessStep') title = '점검 ' + (S.assess.idx + 1) + '/' + ASSESS_STEPS.length;
  if (S.screen === 'chat') title = '우리 가족 대화방' + (chatAvail() ? ' · ' + memberIds().length + '명' : '');
  const bar = $('#appbar-in'); bar.textContent = '';
  const tr = isTrainee();
  // 촘촘한 모드: 하단 메뉴의 꼭지(홈·기록·대화·설정)는 뒤로 가기 없이, 그 안의 화면만 뒤로 가기 아이콘
  const top = compact && showNav;
  if (S.screen !== 'home' && !BARE(S.screen) && !top) bar.append(h('button', { class: 'icon-btn labeled', id: 'btn-back', type: 'button', 'data-act': 'back', 'aria-label': ADMIN_SCREENS.includes(S.screen) ? '뒤로 가기, 설정으로' : S.screen.indexOf('ai') === 0 || compact ? '뒤로 가기' : '뒤로 가기, 처음 화면으로' }, svgIcon('back'), h('span', { text: tr && !ADMIN_SCREENS.includes(S.screen) ? '처음으로' : '뒤로' })));
  else bar.append(svgIcon('leaf'));
  bar.append(h('div', { class: 'appbar-title', id: 'appbar-title', text: title }));
  // 훈련하는 분: 글자 없는 작은 톱니바퀴 (누르면 가족용이라는 확인창). 가족: 오른쪽 위 설정(아바타) 단추
  if (S.screen === 'home') bar.append(tr ? h('button', { class: 'icon-btn gear', id: 'btn-gear', type: 'button', 'data-act': 'gear', 'aria-label': '설정 (가족용)' }, svgIcon('gear'))
    : h('button', { class: 'icon-btn labeled', id: 'btn-settings', type: 'button', 'data-act': 'nav', 'data-to': 'settings', 'aria-label': '설정' }, compact ? h('span', { class: 'avatar', 'aria-hidden': 'true', text: Array.from((S.me && S.me.name) || '가')[0] }) : svgIcon('gear'), h('span', { text: '설정' })));
  const pmb = pmVisible() ? pmButtons() : null; if (pmb) bar.append(pmb);
  $('#appbar').classList.toggle('has-pm', !!pmb);
  $('#navbar').hidden = !showNav;
  document.body.classList.toggle('has-nav', showNav);
  document.body.classList.toggle('in-chat', S.screen === 'chat');
  const nav = $('#navbar-in'); nav.textContent = '';
  const un = unreadCount();
  navItems().forEach(n => {
    const pill = h('span', { class: 'nav-pill' }, svgIcon(n[2]));
    if (n[0] === 'chat' && un > 0) pill.append(h('span', { class: 'nav-badge', 'aria-label': '안 읽은 메시지 ' + un + '개', text: un > 99 ? '99+' : String(un) }));
    nav.append(h('button', { type: 'button', class: 'nav-item', id: 'nav-' + n[0], 'data-act': 'nav', 'data-to': n[0], 'aria-current': navKey(S.screen) === n[0] ? 'page' : null }, pill, n[1]));
  });
  // 채팅 화면에서는 하단 메뉴 대신 입력창이 있으므로 숨김 (위 showNav=false)
  // 하단 메뉴 높이(글자 크기에 따라 달라요): 맨 아래 안내 글과 고정 버튼(.cta)이 메뉴에 가려지지 않게 써요
  document.documentElement.style.setProperty('--nav-h', showNav ? $('#navbar').offsetHeight + 'px' : '0px');
}

export function render(soft) {
  S.nudgeUpdaters = [];
  if (S.onLeave) { const f = S.onLeave; S.onLeave = null; try { f(); } catch (e) {} }   // 이전 화면의 타이머 정리
  renderChrome();
  const el = $('#screen'), fn = SCREENS[S.screen];
  el.textContent = ''; el.insertAdjacentHTML('beforeend', fn.html());
  if (fn.bind) fn.bind(el);
  // 촘촘한 모드: 화면 제목이 위 앱 바의 제목과 같으면 두 번 보이지 않게 숨겨요 (읽어 주는 기기에는 남아요)
  if (isCompact()) { const hh = el.querySelector('h1'); const tt = $('#appbar-title'); if (hh && tt && hh.textContent.trim() === tt.textContent.trim()) hh.classList.add('dup'); }
  updateSyncNote();
  if (!soft) { window.scrollTo(0, 0); const hh = el.querySelector('h1'); if (hh) { hh.setAttribute('tabindex', '-1'); try { hh.focus({ preventScroll: true }); } catch (e) {} } }
}
