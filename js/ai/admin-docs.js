/* ================= 관리자가 쓰는 AI 문서 (CLIENT-CONTRACT §4) — 순수 함수 =================
 * 메모(aiNotes), 검토 결정(aiReview), 관심사 낱말(aiState/themes), AI 끄기(aiState/switch).
 * 화면(ai-admin.js)과 에뮬레이터 시험(tests/ai-client-contract.test.mjs)이 같은 함수를 써서, 앱이 만드는 모양이 규칙과 서버를 통과하는지 확인해요. */
export const NOTE_CODE_IDS = ['sleep', 'illness', 'med_change', 'hospital', 'event', 'travel', 'device', 'mood', 'other'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/* 메모 초안 → 문서. 잘못되면 { error } (화면이 안내 글로 보여 줘요). 자유 글은 Firestore 에만 남고 AI 에는 가지 않아요(서버는 날짜·분류만 써요). */
export function noteDoc(d, by, nowMs) {
  if (!YMD.test(d.from || '')) return { error: '시작 날짜를 골라 주세요.' };
  if (!d.ongoing && (!YMD.test(d.to || '') || d.to < d.from)) return { error: '끝나는 날짜가 시작 날짜보다 빠를 수 없어요.' };
  const codes = (d.codes || []).filter((c, i, a) => NOTE_CODE_IDS.includes(c) && a.indexOf(c) === i);
  if (!codes.length) return { error: '어떤 일인지 하나 이상 골라 주세요.' };
  const doc = { from: d.from, to: d.ongoing ? null : d.to, codes, by, ts: nowMs };
  const text = String(d.text || '').trim().slice(0, 200);
  if (text) doc.text = text;
  return { doc };
}
export const noteId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* 검토 결정: approve(내보내기) · retire(은퇴) · flag(이 문제 이상해요). 문서 id = 문항 id (bk_…) */
export const reviewDoc = (decision, by, nowMs) => ({ decision, by, ts: nowMs });
export const themesDoc = (words, by, nowMs) => ({ words: (words || []).slice(0, 8), updatedBy: by, updatedTs: nowMs });
export const switchDoc = (enabled, by, nowMs) => ({ enabled: !!enabled, updatedBy: by, updatedTs: nowMs });
