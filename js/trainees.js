/* ================= 훈련하는 분 목록 (DESIGN-MULTI §1.1, §1.4) =================
 * families/{fid}/state/trainees = { v: 1, ids: [memberId…] (최대 4명, 순서 = 보여 주는 순서), labels: { memberId: '아버지' }, updatedBy, updatedTs }
 * 순수 함수만 있어요 (화면·저장소를 모름). */
export const MAX_TRAINEES = 4;
export const LABEL_MAX = 12;
export const LABEL_CHOICES = ['아버지', '어머니', '할머니', '할아버지'];
const okId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/* 문서 → { ids, labels }. 없거나 깨진 문서 = 빈 목록 */
export function normalizeTrainees(doc) {
  const ids = [], labels = {};
  const src = doc && Array.isArray(doc.ids) ? doc.ids : [];
  const lab = doc && doc.labels && typeof doc.labels === 'object' ? doc.labels : {};
  src.forEach(id => { if (okId(id) && !ids.includes(id) && ids.length < MAX_TRAINEES) { ids.push(id); labels[id] = String(lab[id] || '').trim().slice(0, LABEL_MAX) || '훈련하는 분'; } });
  return { ids, labels };
}
export const labelOf = (set, mid) => (set && set.labels && set.labels[mid]) || '훈련하는 분';
export const inSet = (set, mid) => !!(set && mid && set.ids.includes(mid));
export const canAdd = set => !!set && set.ids.length < MAX_TRAINEES;
/* 가족 화면의 선택: 2명 이상이면 기억해 둔 값('all' 또는 목록에 있는 id), 아니면 'all'. 1명이면 그 사람. 0명이면 null */
export function pickSel(set, stored) {
  const ids = (set && set.ids) || [];
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  if (stored === 'all' || ids.includes(stored)) return stored;
  return 'all';
}
/* 한 사람을 가리켜야 하는 화면(기록·설정·AI): 선택된 사람, 아니면 마지막으로 고른 사람, 아니면 첫 번째 */
export function pickOne(set, sel, last) {
  const ids = (set && set.ids) || [];
  if (!ids.length) return null;
  if (ids.includes(sel)) return sel;
  if (ids.includes(last)) return last;
  return ids[0];
}
/* 목록 문서 만들기 (규칙의 validTrainees 와 같은 모양) */
export function traineesDoc(set, by, now) {
  const ids = set.ids.slice(0, MAX_TRAINEES), labels = {};
  ids.forEach(id => { labels[id] = String(set.labels[id] || '훈련하는 분').trim().slice(0, LABEL_MAX) || '훈련하는 분'; });
  return { v: 1, ids, labels, updatedBy: by, updatedTs: now };
}
export const withAdded = (set, mid, label) => ({ ids: set.ids.concat([mid]), labels: Object.assign({}, set.labels, { [mid]: label }) });
export const withRemoved = (set, mid) => { const labels = Object.assign({}, set.labels); delete labels[mid]; return { ids: set.ids.filter(x => x !== mid), labels }; };
export const withLabel = (set, mid, label) => ({ ids: set.ids.slice(), labels: Object.assign({}, set.labels, { [mid]: label }) });
/* "아버지·어머니" */
export const joinLabels = (set, ids) => (ids || (set && set.ids) || []).map(id => labelOf(set, id)).join('·');
/* 리포트 글의 {{who}} 를 호칭으로 (화면에는 textContent 로만 넣어요) */
export const fillWho = (text, label) => String(text == null ? '' : text).replace(/\{\{\s*who\s*\}\}/g, label || '훈련하는 분');
