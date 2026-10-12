import { addDays, daysBetween, parseYmd, pad2 } from '../util.js';

/* 주 번호 (서버 functions/ai/core/kdate.js 의 weekKey / weekStart 와 같은 규칙).
 * 주는 일요일 0시 ~ 토요일 24시. 'YYYY-Www': 그 주의 수요일이 속한 해, 1주차 = 수요일이 1월 1~7일인 주. ISO 주(월요일 시작)가 아니에요. */
export const sundayOf = s => addDays(s, -parseYmd(s).getDay());
export function weekKey(s) {
  const wed = addDays(sundayOf(s), 3), y = Number(wed.slice(0, 4)), doy = daysBetween(y + '-01-01', wed) + 1;
  return y + '-W' + pad2(Math.floor((doy - 1) / 7) + 1);
}
export function weekStart(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key || ''); if (!m) return null;
  const y = Number(m[1]), n = Number(m[2]);
  let wed1 = y + '-01-01'; while (parseYmd(wed1).getDay() !== 3) wed1 = addDays(wed1, 1);
  return addDays(wed1, 7 * (n - 1) - 3);
}
export const weekEnd = key => addDays(weekStart(key), 6);
export const nextWeekKey = (key, n) => weekKey(addDays(weekStart(key), 7 * (n == null ? 1 : n)));
export const weeksBetween = (a, b) => Math.round(daysBetween(weekStart(a), weekStart(b)) / 7);
