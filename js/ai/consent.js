import { dbReady, focusId } from '../data.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { LS } from '../util.js';
import { CONSENT_KIND, CONSENT_VERSION, adminConsentWrite, adminWithdrawPatch, consentState } from './consent-doc.js';

/* ================= AI 기록 관찰 켜기 (CLIENT-CONTRACT §5) =================
 * 훈련하는 분 화면에는 안내 화면이 없어요. 관리자가 설정 > AI 리포트 설정 에서 "AI 기록 관찰 켜기"를 켜면
 * consents/{훈련하는 분 memberId} 를 관리자가 대신 기록해요 (같은 kind·version, 서버 시각, byAdmin = 관리자 memberId).
 * 서버는 이 기록이 있는 동안만 숫자를 모아요. */
export { CONSENT_KIND, CONSENT_VERSION };
export const aiDemoOff = () => Store.mode === 'local' && LS.get('bw.aiDemo', true) === false;   // 시험용: 체험 모드에서 AI 화면을 끔

/* 지금 훈련하는 분의 기록 상태: 'none' | 'old' | 'withdrawn' | 'ok' (켜져 있으면 ok) */
export function observationState(consents, tid = focusId()) {
  return consentState((consents || []).find(c => c.id === tid) || null);
}

/* 켜기/끄기. 관리자만 (규칙이 막아요). 성공하면 true */
export async function setObservation(on, tid = focusId()) {
  await dbReady;
  if (!Store.adapter || !tid) return false;
  const id = 'consents/' + tid, adminId = S.myId || 'local';
  try {
    let cur = null; try { cur = await Store.getDoc(id); } catch (e) {}
    if (on) {
      if (consentState(cur) === 'ok') return true;
      const w = adminConsentWrite(cur, adminId);
      if (w.op === 'set') await Store.setDoc(id, w.data); else await Store.updateDoc(id, w.data);
    } else {
      if (!cur) return true;
      await Store.updateDoc(id, adminWithdrawPatch(adminId));
    }
    return true;
  } catch (e) { return false; }
}
