/* 서비스 워커 업데이트: 새 버전은 바로 켜지고(sw.js 의 skipWaiting + clients.claim),
 * 앱은 "안전한 화면"(홈·처음 화면)에 있을 때만 한 번 새로고침해요. 게임·설문 도중이면 새로고침하지 않고,
 * 다음에 앱을 열 때 새 버전으로 열려요. 새로고침 반복을 막으려고 60초 안에는 다시 새로고침하지 않아요. */
export const SAFE_SCREENS = ['home', 'ob-start', 'setup', 'ob-error'];
/* 진행 중인 흐름(게임·설문·점검 등) 화면. 여기서는 새로고침하지 않고, 흐름이 끝나 다른 화면으로 가면 그때 해요. */
export const BUSY_SCREENS = ['game', 'result', 'courseBreak', 'checkIntro', 'checkin', 'courseDone', 'assessStep', 'assessBreak', 'assessDone', 'surveyIntro', 'surveyQ', 'surveyDone', 'chat', 'ob-name', 'ob-join', 'ob-role', 'ob-transfer'];
export const RELOAD_GAP_MS = 60000;
const KEY = 'bw.swReloadAt';

/* 순수 판단 (시험에서도 써요). hadController: 이 페이지가 열릴 때 이미 서비스 워커의 제어를 받고 있었는지 (처음 설치면 새로고침 안 해요) */
export function shouldReload({ hadController, screen, lastReloadAt, now, alreadyReloaded }) {
  if (!hadController || alreadyReloaded) return false;
  if (BUSY_SCREENS.includes(screen) || (typeof document !== 'undefined' && document.querySelector && document.querySelector('.dialog, .sheet.open'))) return false;
  if (lastReloadAt && now - lastReloadAt < RELOAD_GAP_MS) return false;
  return true;
}

export function watchServiceWorker({ getScreen, reload, now }) {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker; let hadController = !!sw.controller;   // 처음 설치로 제어권을 받는 첫 변화는 새로고침 대상이 아니에요
  const clock = now || Date.now, doReload = reload || (() => location.reload());
  let reloaded = false;
  const lastAt = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
  let pending = false;
  const tryReload = () => {
    if (!pending || !shouldReload({ hadController, screen: getScreen(), lastReloadAt: lastAt(), now: clock(), alreadyReloaded: reloaded })) return;
    reloaded = true;
    try { sessionStorage.setItem(KEY, String(clock())); } catch (e) {}
    doReload();
  };
  sw.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    pending = true; tryReload();
  });
  // 흐름 도중에 새 버전이 켜졌으면, 흐름이 끝나 다른 화면으로 가거나 앱을 다시 볼 때 새로고침해요.
  if (typeof setInterval === 'function') setInterval(tryReload, 3000);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tryReload(); });
}

/* 폰에서 앱이 백그라운드에 있다가 돌아올 때는 페이지를 새로 열지 않아서, 브라우저가 새 sw.js 를 찾지 않아요: 직접 물어봐요. */
export function checkForUpdates(reg) {
  const ask = () => { try { reg.update().catch(() => {}); } catch (e) {} };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ask(); });
  setInterval(() => { if (document.visibilityState === 'visible') ask(); }, 30 * 60000);
  ask();
}
