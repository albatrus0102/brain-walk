/* sw.js — 하나의 서비스 워커: 앱 껍데기 캐시(오프라인) + FCM 백그라운드 알림.
 * 같은 범위(/brain-walk/)에는 서비스 워커가 하나만 있을 수 있어서 두 일을 한 파일에서 해요.
 * 앱이 직접 './sw.js' 를 등록하고, getToken 에도 그 등록을 넘겨요 (ARCHITECTURE.md §4.2, §4.3).
 * __BUILD__ 는 배포(pages.yml)할 때 커밋 번호로 바뀌어서, 배포마다 캐시가 새로 만들어져요. */
importScripts('./firebase-config.js');

const FB_VERSION = '11.10.0';
const cfg = self.BW_CONFIG;
const configured = !!(cfg && cfg.firebase && cfg.firebase.apiKey && !JSON.stringify(cfg.firebase).includes('REPLACE_ME'));

// 설정이 비어 있으면(체험/미설정) FCM 은 필요 없으니 불러오지 않아요.
if (configured) {
  importScripts('https://www.gstatic.com/firebasejs/' + FB_VERSION + '/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/firebase-messaging-compat.js');
  // FCM 은 최상위에서 바로 초기화해야 'push' 리스너가 등록돼요.
  firebase.initializeApp(cfg.firebase);
  const messaging = firebase.messaging();
  // 서버가 webpush.notification 을 보내므로 SDK 가 알림을 직접 보여 주고 클릭도 처리해요.
  // 여기서 showNotification 을 또 부르면 두 번 떠요. 배지만 갱신해요.
  messaging.onBackgroundMessage(() => { if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {}); });
}

const VERSION = '__BUILD__';
const DEV = VERSION === '__BUILD__';   // 배포 전(개발) 상태면 항상 네트워크 우선
const SHELL = 'bw-shell-' + VERSION, CDN = 'bw-cdn-' + FB_VERSION;
// 파일을 더하거나 지웠다면: node tools/shell-list.mjs --write
const SHELL_FILES = /*SHELL_START*/ [
  "./",
  "./firebase-config.js",
  "./icons/apple-touch-icon-180.png",
  "./icons/badge-72.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./index.html",
  "./js/alarm.js",
  "./js/app.js",
  "./js/boot.js",
  "./js/data.js",
  "./js/events.js",
  "./js/games/cards.js",
  "./js/games/flash.js",
  "./js/games/index.js",
  "./js/games/odd.js",
  "./js/games/order.js",
  "./js/games/proverb.js",
  "./js/games/registry.js",
  "./js/games/shop.js",
  "./js/games/today.js",
  "./js/games/trail.js",
  "./js/games/words.js",
  "./js/icons.js",
  "./js/logic.js",
  "./js/messages.js",
  "./js/nudge.js",
  "./js/platform.js",
  "./js/push.js",
  "./js/records.js",
  "./js/session.js",
  "./js/sound.js",
  "./js/state.js",
  "./js/store/firebase-adapter.js",
  "./js/store/firebase-sdk.js",
  "./js/store/local-adapter.js",
  "./js/store/membership.js",
  "./js/store/store.js",
  "./js/surveys/content.js",
  "./js/surveys/engine.js",
  "./js/ui/chat.js",
  "./js/ui/dom.js",
  "./js/ui/onboarding.js",
  "./js/ui/registry.js",
  "./js/ui/room-settings.js",
  "./js/ui/screens/assess.js",
  "./js/ui/screens/checkin.js",
  "./js/ui/screens/course-done.js",
  "./js/ui/screens/family.js",
  "./js/ui/screens/game.js",
  "./js/ui/screens/home.js",
  "./js/ui/screens/hub.js",
  "./js/ui/screens/index.js",
  "./js/ui/screens/pick.js",
  "./js/ui/screens/result.js",
  "./js/ui/screens/settings.js",
  "./js/ui/screens/surveys.js",
  "./js/ui/shell.js",
  "./js/ui/widgets.js",
  "./js/util.js",
  "./manifest.webmanifest",
  "./styles/app.css",
  "./styles/m3-tokens.css"
] /*SHELL_END*/;

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES))));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('bw-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });   // "새 버전이 있어요 · 업데이트"

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/' + FB_VERSION + '/')) {
    // 버전이 박힌 주소는 바뀌지 않으니 캐시 우선
    e.respondWith(caches.open(CDN).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;            // Firestore/Auth/FCM 통신은 가로채지 않아요
  if (req.mode === 'navigate') {                         // 네트워크 우선, 오프라인이면 껍데기로
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  if (DEV) { e.respondWith(fetch(req).catch(() => caches.match(req))); return; }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));   // 앱 파일: 캐시 우선 (SHELL 버전으로 갱신)
});
