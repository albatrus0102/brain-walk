import { S } from '../state.js';

/* 병원·센터 검사 기록: 가족이 결과지에서 옮겨 적는 "점수"만 저장해요. 검사 문항이나 내용은 앱에 없어요. */
export const CLINICAL_TESTS = [
  { id: 'cist', name: 'CIST (인지선별검사)', max: 30 },
  { id: 'mmse_ds', name: 'MMSE-DS', max: 30 },
  { id: 'k_mmse', name: 'K-MMSE', max: 30 },
  { id: 'moca', name: 'MoCA / K-MoCA', max: 30 },
  { id: 'snsb', name: 'SNSB', max: null },
  { id: 'cerad', name: 'CERAD-K', max: null },
  { id: 'cdr', name: 'CDR (임상치매척도)', max: 3 },
  { id: 'gds_global', name: 'GDS (전반 퇴화 척도)', max: null },
  { id: 'other', name: '기타', max: null }
];
export const CT = Object.fromEntries(CLINICAL_TESTS.map(t => [t.id, t]));
export const RESULTS = ['정상', '인지저하', '경도인지장애', '치매', '기타'];
export const testName = r => (r.test === 'other' ? (r.testLabel || '기타 검사') : (CT[r.test] ? CT[r.test].name : r.test));
export const shortName = r => (r.test === 'other' ? (r.testLabel || '기타 검사') : r.test === 'cist' ? 'CIST' : (CT[r.test] ? CT[r.test].name.split(' ')[0] : r.test));
export const scoreText = r => (r.score == null ? '점수 기록 없음' : r.score + (r.max ? ' / ' + r.max : '') + '점');

export const records = () => (S.clinical || []).filter(r => r && r.date && r.test).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts));
export const byTest = () => {
  const m = {}; records().forEach(r => { const k = r.test === 'other' ? 'other:' + (r.testLabel || '') : r.test; (m[k] ||= []).push(r); }); return m;
};

/* CIST 는 2년마다: 마지막 CIST 날짜 + 2년. 결과가 정상이 아니면 재검 알림 대신 상담 안내. */
export function cistReminder(today) {
  const l = records().find(r => r.test === 'cist'); if (!l) return { state: 'none' };
  if (l.result && l.result !== '정상') return { state: 'followup', last: l };
  const d = new Date(l.date + 'T00:00:00'); d.setFullYear(d.getFullYear() + 2);
  const due = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const days = Math.round((new Date(due + 'T00:00:00') - new Date((today || new Date().toISOString().slice(0, 10)) + 'T00:00:00')) / 864e5);
  return { state: days < 0 ? 'overdue' : days <= 60 ? 'soon' : 'later', due, days, last: l };
}
