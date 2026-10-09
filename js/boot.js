import { alarmTick } from './alarm.js';
import { allAssessments, connectData, ensureProgram, isTrainee } from './data.js';
import { checkNudgeDialog } from './nudge.js';
import { startAssessment } from './session.js';
import { S } from './state.js';
import { Store } from './store/store.js';
import { afterInit } from './ui/onboarding.js';
import { applyPrefs } from './events.js';
import { dialog } from './ui/dom.js';
import { SCREENS } from './ui/registry.js';
import { go, render } from './ui/shell.js';
import { initPush } from './push.js';
import { LS } from './util.js';

/* 시작 순서: 화면 설정 → Store.init() → (설정 안내 | 가입 | 연결 오류 | 앱) */
SCREENS['ob-loading'] = {
  html() { return '<div class="stack"><h1 class="t-headline" id="load-h">불러오는 중이에요…</h1></div>'; }
};

const DISCLAIMER_LONG = '이 앱은 두뇌 활동을 돕는 훈련용이며 의료기기나 진단 도구가 아니에요. 점수가 계속 낮아지면 가까운 치매안심센터(국번 없이 1899-9988)나 병원에서 상담받으세요.';
function askDialog(title, text, actions) { return new Promise(res => dialog(title, text, actions, res)); }

export async function startFlow() {
  S.firstRunBusy = true;
  try {
    if (!LS.get('bw.seenDisc', false)) await askDialog('처음 오셨네요', DISCLAIMER_LONG, [{ label: '확인', kind: 'filled', run: () => LS.set('bw.seenDisc', true) }]);
    if (isTrainee() && !allAssessments().length && !LS.get('bw.offered', false)) {
      LS.set('bw.offered', true);
      await askDialog('두뇌 건강 점검을 먼저 해 볼까요?', '지금 상태를 한 번 기록해 두면 나중에 변화를 비교할 수 있어요. 약 15분 걸려요 (두 번에 나눠 해도 돼요). 건너뛰어도 괜찮아요.', [
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
  try { if (location.search) history.replaceState(null, '', location.pathname); } catch (e) {}
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
  const hadController = !!navigator.serviceWorker.controller;   // 처음 설치할 때는 새로고침하지 않아요 (업데이트일 때만)
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller && S.screen === 'home') {
          dialog('새 버전이 있어요', '업데이트하면 최신 화면으로 바뀌어요.', [{ label: '업데이트', kind: 'filled', run: () => w.postMessage('SKIP_WAITING') }, { label: '나중에', kind: 'text' }]);
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloaded || !navigator.serviceWorker.controller) return; reloaded = true; if (S.screen === 'home') location.reload(); });
}

export async function boot() {
  const q = new URLSearchParams(location.search);
  S.openParam = q.get('open');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  applyPrefs();
  S.screen = 'ob-loading'; render();
  registerServiceWorker();
  if (window.__DEBUG) { window.__S = S; window.__go = go; window.__render = render; }
  const r = await Store.init();
  await afterInit(r);
}
