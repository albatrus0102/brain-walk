import { alarmTick } from './alarm.js';
import { allAssessments, connectData, ensureProgram, getPlan, myTrainee, setPlanRaw } from './data.js';
import { checkNudgeDialog } from './nudge.js';
import { startAssessment } from './session.js';
import { S } from './state.js';
import { Store } from './store/store.js';
import { initInstall } from './ui/install.js';
import { afterInit } from './ui/onboarding.js';
import { applyDisplay } from './display.js';
import { checkForUpdates, watchServiceWorker } from './sw-update.js';
import { dialog } from './ui/dom.js';
import { SCREENS } from './ui/registry.js';
import { go, render } from './ui/shell.js';
import { initPush } from './push.js';
import { LS } from './util.js';

/* 시작 순서: 화면 설정 → Store.init() → (설정 안내 | 가입 | 연결 오류 | 앱) */
SCREENS['ob-loading'] = {
  html() { return '<div class="stack"><h1 class="t-headline" id="load-h">불러오는 중이에요…</h1></div>'; }
};

function askDialog(title, text, actions) { return new Promise(res => dialog(title, text, actions, res)); }

export async function startFlow() {
  S.firstRunBusy = true;
  try {
    if (myTrainee() && getPlan().checkEveryWeeks && !allAssessments().length && !LS.get('bw.offered', false)) {
      LS.set('bw.offered', true);
      await askDialog('두뇌 건강 점검을 먼저 해 볼까요?', '약 15분', [
        { label: '점검 시작하기', kind: 'filled', run: () => { S.firstRunBusy = false; startAssessment(); } }, { label: '나중에 할게요', kind: 'text' }]);
    }
  } catch (e) {}
  S.firstRunBusy = false;
  checkNudgeDialog();
}

let ticking = false;
/* 저장소가 준비된 뒤(가입 완료 포함) 앱 화면으로 */
export async function enterApp(opts) {
  opts = opts || {};
  ensureProgram();
  await connectData();
  try { if (location.search) history.replaceState(history.state, '', location.pathname); } catch (e) {}
  if (!ticking) { ticking = true; setInterval(alarmTick, 60000); }
  alarmTick(true);
  if (Store.mode === 'firebase') initPush();
  if (opts.stayOn) { go(opts.stayOn); return; }
  const open = S.openParam;
  go(['chat', 'family', 'pick', 'assess'].includes(open) ? open : 'home');
  if (open === 'course') { const { startCourse } = await import('./session.js'); startCourse(); return; }
  startFlow();
}

export async function startLocalDemo(remember) {
  await Store.useLocal(remember);
  await enterApp();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  watchServiceWorker({ getScreen: () => S.screen });   // 새 버전이 켜지면: 안전한 화면에서만 한 번 새로고침 (js/sw-update.js)
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(checkForUpdates).catch(() => {});
}

export async function boot() {
  const q = new URLSearchParams(location.search);
  S.openParam = q.get('open');
  initInstall();
  setPlanRaw(null);
  applyDisplay({ noRender: true });
  S.screen = 'ob-loading'; render();
  registerServiceWorker();
  if (window.__DEBUG) { window.__S = S; window.__go = go; window.__render = render; window.__Store = Store; }
  const r = await Store.init();
  await afterInit(r);
}
