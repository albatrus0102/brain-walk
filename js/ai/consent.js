import { dbReady, isTrainee } from '../data.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { DELETE_FIELD, LS, SERVER_TS } from '../util.js';

/* ================= AI 리포트 안내 동의 (CLIENT-CONTRACT §5, DESIGN-AI §8.6) =================
 * 훈련하는 분 기기에서 처음 한 번 보여 주고 consents/{memberId} 에 기록해요. 서버는 이 기록이 있는 동안만 숫자를 모아요.
 * 문구를 바꾸면 version 을 올려요: 그러면 한 번 더 보여요. */
export const CONSENT_KIND = 'ai-report-notice', CONSENT_VERSION = '2026-11-v1';
const LSK = 'bw.aiConsent';
const myKey = () => S.myId || 'local';
export const aiDemoOff = () => Store.mode === 'local' && LS.get('bw.aiDemo', true) === false;   // 시험용: 체험 모드에서 AI 화면·안내를 끔

/* 안내 문구 (DESIGN-AI §8.6 그대로, 호칭만 가족이 정한 이름으로) */
export function consentText(label) {
  const L = label || '아버지';
  return {
    title: '가족이 함께 살펴볼게요',
    paras: [
      L + (hasBatchim(L) ? '이' : '가') + ' 푸신 문제의 맞힌 개수와 걸린 시간을 가족이 살펴봐요.',
      '컴퓨터 프로그램(AI)이 숫자만 보고 가족에게 쉬운 설명을 써 줘요. ' + L + ' 이름이나 하신 말씀은 보내지 않아요. 이 프로그램은 외국 회사 서버에서 돌아가요.',
      '병을 판단하는 것이 아니에요. 싫으시면 언제든 가족에게 말씀해 주세요.'
    ]
  };
}
function hasBatchim(w) { const c = String(w).slice(-1).charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3 && ((c - 0xAC00) % 28) !== 0; }
export const consentSpeech = label => { const t = consentText(label); return t.title + '. ' + t.paras.join(' '); };

export async function aiSwitchOff() {
  try { const d = await Store.getDoc('aiState/switch'); return !!(d && d.enabled === false); } catch (e) { return false; }
}
/* 지금 안내를 보여야 하는지: 훈련하는 분 기기이고, 이 문구 버전의 동의가 없거나 철회했고, 관리자가 AI 리포트를 끄지 않았을 때 */
export async function needConsent() {
  if (!isTrainee() || !Store.adapter || aiDemoOff()) return false;
  if (Store.mode === 'firebase' && !S.myId) return false;
  if (await aiSwitchOff()) return false;
  try {
    const d = await Store.getDoc('consents/' + myKey());
    return !(d && d.kind === CONSENT_KIND && d.version === CONSENT_VERSION && d.ackTs && !d.withdrawnTs);
  } catch (e) {
    const l = LS.get(LSK, null);                        // 읽을 수 없으면(규칙이 아직 없는 등) 이 기기에서 본 적이 있는지만 봐요
    return !(l && l.version === CONSENT_VERSION);
  }
}
/* "알겠어요" / "가족과 함께 봤어요": 서버 시각으로 기록 */
export async function acknowledge(withFamily) {
  LS.set(LSK, { version: CONSENT_VERSION, ts: Date.now() });
  await dbReady;
  if (!Store.adapter) return false;
  const id = 'consents/' + myKey();
  try {
    let cur = null; try { cur = await Store.getDoc(id); } catch (e) {}
    if (!cur) {
      const d = { kind: CONSENT_KIND, version: CONSENT_VERSION, ackTs: SERVER_TS }; if (withFamily) d.withFamily = true;
      await Store.setDoc(id, d);
    } else {
      const d = { version: CONSENT_VERSION, ackTs: SERVER_TS, withdrawnTs: DELETE_FIELD }; if (withFamily) d.withFamily = true;
      await Store.updateDoc(id, d);
    }
    return true;
  } catch (e) { return false; }
}
/* 철회: 서버 시각만 더해요 (지우지 않아요) */
export async function withdraw() {
  await dbReady;
  try { await Store.updateDoc('consents/' + myKey(), { withdrawnTs: SERVER_TS }); LS.set(LSK, null); return true; } catch (e) { return false; }
}
