import { Platform } from './platform.js';
import { S } from './state.js';
import { FirebaseAdapter } from './store/firebase-adapter.js';
import { loadSdk } from './store/firebase-sdk.js';
import { removeDevice, saveDevice } from './store/membership.js';
import { toast } from './ui/dom.js';
import { LS } from './util.js';

/* 푸시 알림 (ARCHITECTURE.md §4.3, §4.4)
 *  - 권한 요청은 반드시 사용자가 누른 직후, 첫 await 로 해야 해요 (iOS).
 *  - getToken 에는 vapidKey 와 직접 등록한 서비스 워커(registration)를 넘겨요.
 *  - 토큰은 members/{mid}/devices/{deviceId} 에 저장해요. */
const WEEK = 7 * 864e5;
export const deviceId = () => {
  let id = null; try { id = localStorage.getItem('bw.deviceId'); } catch (e) {}
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem('bw.deviceId', id); } catch (e) {} }
  return id;
};
let fgBound = false;

/* 부팅 때 미리 계산: 'unsupported' | 'ios-install-first' | 'default' | 'granted' | 'denied' */
export async function initPush() {
  try {
    S.pushState = await Platform.pushState();
    if (S.pushState === 'granted' && LS.get('bw.pushOn', false)) await syncToken(true);
    if (S.pushState === 'granted') await bindForeground();
  } catch (e) { S.pushState = S.pushState || 'unsupported'; }
  return S.pushState;
}

async function messagingParts() {
  const M = await loadSdk('messaging');
  const reg = await navigator.serviceWorker.ready;
  return { M, reg, messaging: M.getMessaging(FirebaseAdapter.sdk.app) };
}
async function bindForeground() {
  if (fgBound) return; fgBound = true;
  const { M, messaging } = await messagingParts();
  M.onMessage(messaging, p => { const n = p.notification || {}; toast((n.title ? n.title + ' · ' : '') + (n.body || '새 알림이 있어요')); });
}
/* 토큰을 받아 기기 문서에 저장. 토큰이 바뀌었거나 7일이 지났을 때만 다시 써요. */
async function syncToken(onlyIfStale) {
  const { M, reg, messaging } = await messagingParts();
  const token = await M.getToken(messaging, { vapidKey: self.BW_CONFIG.vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw { code: 'no-token' };
  const last = LS.get('bw.pushTok', null);
  if (!(onlyIfStale && last && last.token === token && Date.now() - last.ts < WEEK)) {
    await saveDevice(deviceId(), { token, platform: Platform.platformName(), standalone: Platform.isStandalone() });
    LS.set('bw.pushTok', { token, ts: Date.now() });
  }
  return token;
}

/* "알림 받기" 켜기. 결과: {ok:true} | {ok:false, reason} (reason: ios-install-first|unsupported|denied|dismissed|error) */
export async function enablePush() {
  const st = S.pushState || 'unsupported';
  if (st === 'ios-install-first' || st === 'unsupported') return { ok: false, reason: st };
  if (!self.BW_CONFIG || !self.BW_CONFIG.vapidKey || /REPLACE_ME/.test(self.BW_CONFIG.vapidKey)) return { ok: false, reason: 'error' };
  let perm;
  try { perm = await Notification.requestPermission(); } catch (e) { return { ok: false, reason: 'error' }; }   // 탭 직후 첫 await
  S.pushState = perm;
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  try { await syncToken(false); LS.set('bw.pushOn', true); await bindForeground(); return { ok: true }; }
  catch (e) { return { ok: false, reason: 'error' }; }
}
export async function disablePush() {
  LS.set('bw.pushOn', false);
  try { const { M, messaging } = await messagingParts(); await M.deleteToken(messaging); } catch (e) {}
  await removeDevice(deviceId());
  LS.set('bw.pushTok', null);
}
export const pushIsOn = () => S.pushState === 'granted' && !!LS.get('bw.pushOn', false);

/* 사유별 안내 문구 */
export function pushReasonText(reason) {
  if (reason === 'ios-install-first') return '아이폰에서는 공유 → 홈 화면에 추가 후 알림을 켤 수 있어요. 홈 화면의 앱 아이콘으로 다시 열어 주세요.';
  if (reason === 'unsupported') return '이 브라우저에서는 알림을 쓸 수 없어요. 다른 브라우저나 홈 화면에 추가한 앱으로 열어 보세요.';
  if (reason === 'denied') return '알림이 차단되어 있어요. 브라우저(또는 휴대폰) 설정에서 이 앱의 알림을 허용해 주세요.';
  if (reason === 'dismissed') return '알림 허용을 선택하지 않으셨어요. 필요하실 때 다시 눌러 주세요.';
  return '알림을 켜지 못했어요. 잠시 뒤 다시 해 보세요.';
}
