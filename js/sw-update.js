/* 서비스 워커 업데이트: 새 버전은 바로 켜지고(sw.js 의 skipWaiting + clients.claim),
 * 앱은 "안전한 화면"(홈·처음 화면)에 있을 때만 한 번 새로고침해요. 게임·설문 도중이면 새로고침하지 않고,
 * 다음에 앱을 열 때 새 버전으로 열려요. 새로고침 반복을 막으려고 60초 안에는 다시 새로고침하지 않아요. */
export const SAFE_SCREENS = ['home', 'ob-start', 'setup', 'ob-error'];
export const RELOAD_GAP_MS = 60000;
const KEY = 'bw.swReloadAt';

/* 순수 판단 (시험에서도 써요). hadController: 이 페이지가 열릴 때 이미 서비스 워커의 제어를 받고 있었는지 (처음 설치면 새로고침 안 해요) */
export function shouldReload({ hadController, screen, lastReloadAt, now, alreadyReloaded }) {
  if (!hadController || alreadyReloaded) return false;
  if (!SAFE_SCREENS.includes(screen)) return false;
  if (lastReloadAt && now - lastReloadAt < RELOAD_GAP_MS) return false;
  return true;
}

export function watchServiceWorker({ getScreen, reload, now }) {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker; let hadController = !!sw.controller;   // 처음 설치로 제어권을 받는 첫 변화는 새로고침 대상이 아니에요
  const clock = now || Date.now, doReload = reload || (() => location.reload());
  let reloaded = false;
  const lastAt = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
  sw.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (!shouldReload({ hadController, screen: getScreen(), lastReloadAt: lastAt(), now: clock(), alreadyReloaded: reloaded })) return;
    reloaded = true;
    try { sessionStorage.setItem(KEY, String(clock())); } catch (e) {}
    doReload();
  });
}

/* 폰에서 앱이 백그라운드에 있다가 돌아올 때는 페이지를 새로 열지 않아서, 브라우저가 새 sw.js 를 찾지 않아요: 직접 물어봐요. */
export function checkForUpdates(reg) {
  const ask = () => { try { reg.update().catch(() => {}); } catch (e) {} };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ask(); });
  setInterval(() => { if (document.visibilityState === 'visible') ask(); }, 30 * 60000);
  ask();
}
