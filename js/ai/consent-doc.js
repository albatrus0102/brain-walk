import { DELETE_FIELD, SERVER_TS } from '../util.js';

/* ================= AI 리포트 안내 동의 문서 (CLIENT-CONTRACT §5) — 순수 함수 =================
 * 앱(consent.js)과 에뮬레이터 시험이 같은 함수를 써요. SERVER_TS / DELETE_FIELD 표시는 저장소가 serverTimestamp() / deleteField() 로 바꿔요. */
export const CONSENT_KIND = 'ai-report-notice', CONSENT_VERSION = '2026-11-v1';

/* "알겠어요": 문서가 없으면 만들고(create), 있으면(문구 버전이 바뀌었거나 철회한 뒤) 다시 확인(update) */
export function consentWrite(cur, withFamily) {
  if (!cur) { const data = { kind: CONSENT_KIND, version: CONSENT_VERSION, ackTs: SERVER_TS }; if (withFamily) data.withFamily = true; return { op: 'set', data }; }
  const data = { version: CONSENT_VERSION, ackTs: SERVER_TS, withdrawnTs: DELETE_FIELD }; if (withFamily) data.withFamily = true;
  return { op: 'update', data };
}
/* 철회: 서버 시각만 더해요 (지우지 않아요) */
export const withdrawPatch = () => ({ withdrawnTs: SERVER_TS });

/* 문서 상태. 서버 시각은 기기에서 쓴 직후(아직 서버에 닿기 전, 오프라인 등)에는 null 로 읽혀요.
 * 그래서 값이 아니라 칸이 있는지로 봐요: ackTs 칸이 있으면 확인한 것, withdrawnTs 칸이 있으면 철회한 것. */
export function consentState(d) {
  if (!d || d.kind !== CONSENT_KIND || !('ackTs' in d)) return 'none';
  if ('withdrawnTs' in d) return 'withdrawn';
  return d.version === CONSENT_VERSION ? 'ok' : 'old';
}

/* 관리자가 훈련하는 분을 대신해 켜기 (설정 > AI 리포트 설정 > "AI 기록 관찰 켜기"): 같은 kind·version, 서버 시각, byAdmin = 관리자 memberId.
 * 문서가 없으면 만들고(create), 있으면(철회했거나 문구 버전이 바뀐 경우) 다시 켜요(update, 철회 표시는 지워요). */
export function adminConsentWrite(cur, adminId) {
  if (!cur) return { op: 'set', data: { kind: CONSENT_KIND, version: CONSENT_VERSION, ackTs: SERVER_TS, byAdmin: adminId } };
  return { op: 'update', data: { version: CONSENT_VERSION, ackTs: SERVER_TS, withdrawnTs: DELETE_FIELD, byAdmin: adminId } };
}
/* 관리자가 끄기: 서버 시각만 더해요 (지우지 않아요) */
export const adminWithdrawPatch = adminId => ({ withdrawnTs: SERVER_TS, byAdmin: adminId });
