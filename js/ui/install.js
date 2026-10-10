import { Platform } from '../platform.js';
import { S } from '../state.js';
import { LS } from '../util.js';
import { h, toast } from './dom.js';
import { render } from './shell.js';

/* 홈 화면 설치 안내.
 *  - prompt : 안드로이드/PC 크롬 (beforeinstallprompt 를 받았을 때) → "설치하기" 버튼
 *  - inapp  : 카카오톡·네이버 등 앱 안 브라우저 → 설치가 안 되니 크롬/기본 브라우저로 열기
 *  - ios    : 아이폰 사파리 → 공유 → 홈 화면에 추가 (그림 안내)
 *  - menu   : 위가 아닌 브라우저 (설정 화면에서만 메뉴 안내)
 *  - done   : 이미 설치된 앱으로 열림
 * 카드는 [data-install] 자리에 그려요. 이벤트가 늦게 와도 자리만 다시 채워요 (입력 중인 화면을 지우지 않게). */
const DISMISS_KEY = 'bw.installDismiss', DAYS7 = 7 * 24 * 3600 * 1000;
const WEB_HOST = 'albatrus0102.github.io', WEB_BASE = '/brain-walk/';

/* [이름, 표시 이름] — userAgent 로 앱 안 브라우저를 알아봐요 */
const INAPP = [[/KAKAOTALK/i, '카카오톡'], [/NAVER\(inapp/i, '네이버'], [/Instagram/i, '인스타그램'], [/FBAN|FBAV/, '페이스북'], [/\bLine\//i, '라인'], [/Daum/i, '다음'], [/\bBAND\//i, '밴드'], [/Telegram/i, '텔레그램']];
export function inAppInfo(ua) {
  ua = ua == null ? navigator.userAgent : ua;
  for (const [re, name] of INAPP) if (re.test(ua)) return { name, kakao: /KAKAOTALK/i.test(ua) };
  return null;
}
export function chromeIntentUrl() {
  const path = location.pathname.indexOf(WEB_BASE) === 0 ? location.pathname.slice(WEB_BASE.length) : location.pathname.replace(/^\//, '');
  return 'intent://' + WEB_HOST + WEB_BASE + path + location.search + '#Intent;scheme=https;package=com.android.chrome;end';
}
export const kakaoExternalUrl = () => 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);

export function installState() {
  if (Platform.isStandalone() || S.installed) return 'done';
  if (inAppInfo()) return 'inapp';
  if (S.installEvt) return 'prompt';
  if (Platform.isIOS()) return 'ios';
  return 'menu';
}
const dismissed = () => Date.now() < (LS.get(DISMISS_KEY, 0) || 0);
/* where: 'start' | 'home' | 'join' (초대 링크 화면: 닫기 없음) | 'settings' (늘 보임) */
export function installVisible(where) {
  const st = installState();
  if (where === 'settings') return true;
  if (st === 'done' || st === 'menu') return false;
  return where === 'join' || !dismissed();
}

const svg = (inner, label) => { const w = document.createElement('span'); w.className = 'pict'; w.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; if (label) w.setAttribute('title', label); return w; };
const shareIcon = () => svg('<path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/><path d="M12 15V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/>', '공유 버튼');
const addIcon = () => svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>', '홈 화면에 추가');
const step = (icon, ...txt) => h('li', { class: 'inst-step' }, icon, h('span', {}, txt));

/* 아이폰 사파리: 그림 안내 (설정 화면의 알림 안내와 같은 목록을 써요) */
export function iosSteps(id) {
  return h('ol', { class: 't-body inst-steps', id: id || 'ios-steps' },
    step(shareIcon(), '사파리 아래의 ', h('b', { text: '공유 버튼' }), '(네모에 위쪽 화살표)을 눌러요'),
    step(addIcon(), h('b', { text: '"홈 화면에 추가"' }), '를 눌러요'),
    step(null, '오른쪽 위 ', h('b', { text: '"추가"' }), '를 눌러요'),
    step(null, '홈 화면에 생긴 ', h('b', { text: '"두뇌산책"' }), ' 아이콘으로 다시 열어요'));
}

async function doInstall(btn) {
  const ev = S.installEvt; if (!ev) return;
  btn.disabled = true;
  try {
    await ev.prompt();
    const c = await ev.userChoice;
    if (c && c.outcome === 'accepted') { S.installed = true; toast('설치했어요. 홈 화면의 \'두뇌산책\' 아이콘으로 열어 주세요'); }
  } catch (e) {}
  S.installEvt = null;   // 한 번 쓰면 다시 쓸 수 없어요
  refreshInstall();
}

function body(where, code) {
  const st = installState();
  if (st === 'done') return [h('p', { class: 't-body', id: 'install-done', text: '설치됨 ✓' })];
  if (st === 'prompt') return [
    h('p', { class: 't-body', text: '다음부터 아이콘만 누르면 열려요.' }),
    h('button', { class: 'btn filled', type: 'button', id: 'btn-install', onclick: e => doInstall(e.currentTarget) }, '설치하기')];
  if (st === 'ios') return [
    h('p', { class: 't-body', text: '다음부터 아이콘만 누르면 열려요. 공유 → 홈 화면에 추가 후 알림을 켤 수 있어요.' }),
    iosSteps(),
    h('p', { class: 't-small muted', text: '알림은 홈 화면 앱을 연 뒤 설정에서 켤 수 있어요 (iOS 16.4 이상).' }),
    code ? h('p', { class: 't-body', text: '홈 화면 앱을 연 뒤 이 코드를 입력해 주세요:' }) : null,
    code ? h('p', { class: 't-display center', id: 'ob-ios-code', text: code }) : null];
  if (st === 'inapp') {
    const info = inAppInfo(), android = Platform.platformName() === 'android';
    const out = [h('p', { class: 't-body', text: '카카오톡·네이버 같은 앱 안에서는 홈 화면에 설치할 수 없어요. 크롬이나 사파리에서 열어 주세요. 초대 코드는 그대로 유지돼요.' })];
    if (info.kakao) out.push(h('a', { class: 'btn filled', id: 'btn-open-external', href: kakaoExternalUrl(), rel: 'noopener' }, '기본 브라우저로 열기'));
    else if (android) out.push(h('a', { class: 'btn filled', id: 'btn-open-chrome', href: chromeIntentUrl(), rel: 'noopener' }, '크롬으로 열기'));
    else out.push(h('p', { class: 't-body', id: 'inapp-guide' }, '오른쪽 아래 ⋯ 또는 공유 버튼 → ', h('b', { text: "'Safari로 열기'" })));
    return out;
  }
  return [h('p', { class: 't-body', id: 'install-menu', text: '브라우저 오른쪽 위 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.' })];
}
const titleOf = () => { const st = installState(); return st === 'inapp' ? inAppInfo().name + ' 안에서는 앱 설치가 안 돼요' : st === 'done' ? '앱 설치' : '📲 홈 화면에 앱 설치'; };

function fill(slot) {
  const where = slot.dataset.install, code = slot.dataset.code || '';
  slot.textContent = '';
  if (!installVisible(where)) return;
  if (where === 'settings') { slot.append(...body(where, code).filter(Boolean)); slot.classList.add('stack'); return; }
  const kids = [h('h2', { class: 't-title', id: 'install-h', text: titleOf() }), ...body(where, code)];
  if (where !== 'join') kids.push(h('button', { class: 'btn text', type: 'button', id: 'install-dismiss', onclick: () => { LS.set(DISMISS_KEY, Date.now() + DAYS7); if (S.screen === 'home') render(true); else refreshInstall(); } }, '닫기'));
  slot.append(h('section', { class: 'card primary install-card stack', id: 'install-card', 'aria-labelledby': 'install-h' }, ...kids.filter(Boolean)));
}
/* 화면에 놓을 자리 */
export function installSlot(where, code) { const s = h('div', { 'data-install': where, 'data-code': code || null }); fill(s); return s; }
export function refreshInstall() { document.querySelectorAll('[data-install]').forEach(fill); }
/* 홈의 알림 카드가 같은 자리에서 중복되지 않게: 아이폰 안내 카드가 보이면 알림 안내 카드는 숨겨요 */
export const installCardShowing = where => installVisible(where) && installState() !== 'done' && installState() !== 'menu';

/* 부팅 때 한 번 */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.screen === 'home') render(true); else refreshInstall(); });
  window.addEventListener('appinstalled', () => { S.installed = true; S.installEvt = null; if (S.screen === 'home') render(true); else refreshInstall(); });
}
