import { buildCourse, estimateMinutes } from '../program.js';
import { catalog } from '../games/registry.js';
import { todayS } from '../data.js';

/* 훈련 계획을 사람이 읽는 말로 (설정 요약, 계획 화면 요약이 함께 써요) */
const NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
export function daysText(wd) {
  const set = new Set(wd);
  if (set.size === 7) return '매일';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return '평일';
  if (set.size === 2 && set.has(0) && set.has(6)) return '주말';
  return MON_FIRST.filter(d => set.has(d)).map(d => NAMES[d]).join('·');
}
export const levelText = plan => { const k = Object.keys(plan.games).filter(id => plan.games[id].mode === 'fixed').length; return k ? k + '개 고정' : '모두 자동'; };
export const checkText = plan => plan.checkEveryWeeks ? plan.checkEveryWeeks + '주마다' : '끔';
export const autoNextText = sec => sec ? sec + '초' : '끔';
/* "하루 N개 · 약 M분 · 요일 · 난이도 · 점검" */
export function planSummary(plan) {
  const d = todayS(), n = buildCourse(plan, d, catalog()).length, m = estimateMinutes(plan, d, catalog());
  return '하루 ' + n + '개 · 약 ' + m + '분 · ' + daysText(plan.weekdays) + ' · 난이도 ' + (levelText(plan) === '모두 자동' ? '자동' : '일부 고정') + ' · 점검 ' + checkText(plan);
}
