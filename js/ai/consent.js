import { dbReady, isTrainee } from '../data.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { LS } from '../util.js';
import { CONSENT_KIND, CONSENT_VERSION, consentState, consentWrite, withdrawPatch } from './consent-doc.js';

/* ================= AI 리포트 안내 동의 (CLIENT-CONTRACT §5, DESIGN-AI §8.6) =================
 * 훈련하는 분 기기에서 처음 한 번 보여 주고 consents/{memberId} 에 기록해요. 서버는 이 기록이 있는 동안만 숫자를 모아요.
 * 문구를 바꾸면 version 을 올려요: 그러면 한 번 더 보여요. */
export { CONSENT_KIND, CONSENT_VERSION };
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
/* 이 기기에서 본 기록 (규칙이 없거나 읽을 수 없을 때, 그리고 설정 화면의 "멈추기/다시 시작" 줄에 써요) */
export const localConsent = () => { const l = LS.get(LSK, null); return l && l.version === CONSENT_VERSION ? (l.withdrawn ? 'withdrawn' : 'ok') : 'none'; };
/* 지금 안내를 보여야 하는지: 훈련하는 분 기기이고, 이 문구 버전으로 확인한 적이 없고, 관리자가 AI 리포트를 끄지 않았을 때.
 * 철회한 뒤에는 저절로 다시 묻지 않아요 (설정의 "다시 살펴봐도 돼요"로만 다시 열어요). 문구 버전이 바뀌면 한 번 더 보여요. */
export async function needConsent() {
  if (!isTrainee() || !Store.adapter || aiDemoOff()) return false;
  if (Store.mode === 'firebase' && !S.myId) return false;
  if (await aiSwitchOff()) return false;
  try {
    const st = consentState(await Store.getDoc('consents/' + myKey()));
    if (st === 'withdrawn') LS.set(LSK, { version: CONSENT_VERSION, withdrawn: true });
    return st === 'none' || st === 'old';
  } catch (e) {
    return localConsent() === 'none';                 // 읽을 수 없으면(오프라인·규칙이 아직 없는 등) 이 기기에서 본 적이 있는지만 봐요
  }
}
/* "알겠어요" / "가족과 함께 봤어요": 서버 시각으로 기록. 한 번만 (두 번 눌러도 쓰기는 한 번) */
let acking = null;
export function acknowledge(withFamily) {
  if (!acking) acking = ackOnce(withFamily).finally(() => { acking = null; });
  return acking;
}
async function ackOnce(withFamily) {
  await dbReady;
  if (!Store.adapter) return false;
  const id = 'consents/' + myKey();
  try {
    let cur = null; try { cur = await Store.getDoc(id); } catch (e) {}
    if (consentState(cur) === 'ok') { LS.set(LSK, { version: CONSENT_VERSION, ts: Date.now() }); return true; }
    const w = consentWrite(cur, withFamily);
    if (w.op === 'set') await Store.setDoc(id, w.data); else await Store.updateDoc(id, w.data);
    LS.set(LSK, { version: CONSENT_VERSION, ts: Date.now() });
    return true;
  } catch (e) { return false; }
}
/* 철회: 서버 시각만 더해요 (지우지 않아요) */
export async function withdraw() {
  await dbReady;
  try { await Store.updateDoc('consents/' + myKey(), withdrawPatch()); LS.set(LSK, { version: CONSENT_VERSION, withdrawn: true }); return true; } catch (e) { return false; }
}
