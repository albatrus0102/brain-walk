'use strict';
/**
 * Korea time (UTC+9, no DST), Sunday-start weeks, holiday table and the date_q solver.
 *
 * Week = Sunday 00:00 .. Saturday 24:00 KST (DESIGN-AI §4.5).
 * Week key "YYYY-Www": like ISO-8601 but Sunday-based — the week belongs to the year of its
 * Wednesday, and week 1 is the week whose Wednesday falls on Jan 1–7.
 */
const KST_MS = 9 * 3600e3;
const p2 = (n) => String(n).padStart(2, '0');

function kst(ms = Date.now()) {
  const d = new Date(ms + KST_MS);
  return {
    ms,
    date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
    hhmm: `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`,
  };
}
const parse = (ymd) => new Date(ymd + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const okYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
function addDays(ymd, n) { const d = parse(ymd); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
const weekday = (ymd) => parse(ymd).getUTCDay();
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const sundayOf = (ymd) => addDays(ymd, -weekday(ymd));
/** KST midnight of a date as epoch ms. */
const startMs = (ymd) => parse(ymd).getTime() - KST_MS;

function weekKey(ymd) {
  const wed = addDays(sundayOf(ymd), 3);
  const y = Number(wed.slice(0, 4));
  const doy = daysBetween(`${y}-01-01`, wed) + 1;
  return `${y}-W${p2(Math.floor((doy - 1) / 7) + 1)}`;
}
function weekStart(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key || '');
  if (!m) return null;
  const y = Number(m[1]), n = Number(m[2]);
  let wed1 = `${y}-01-01`;
  while (weekday(wed1) !== 3) wed1 = addDays(wed1, 1);
  return addDays(wed1, 7 * (n - 1) - 3);
}
const weekEnd = (key) => addDays(weekStart(key), 6);
const nextWeekKey = (key, n = 1) => weekKey(addDays(weekStart(key), 7 * n));
const weeksBetween = (a, b) => Math.round(daysBetween(weekStart(a), weekStart(b)) / 7);

const WD = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const WD1 = ['일', '월', '화', '수', '목', '금', '토'];
/** "3월 16일 (화)" */
const koDate = (ymd, withWd = true) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일${withWd ? ` (${WD1[weekday(ymd)]})` : ''}`;
const seasonOf = (ymd) => { const m = Number(ymd.slice(5, 7)); return m >= 3 && m <= 5 ? '봄' : m <= 8 && m >= 6 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울'; };

// ------------------------------------------------------------- holidays
let HOL = null;
function holidayIndex(table) {
  if (HOL && HOL.table === table) return HOL;
  const byDate = new Map(); const byName = new Map(); const terms = new Map(); const uncertain = new Set();
  for (const [y, v] of Object.entries(table.years)) {
    const add = (date, name, kind) => {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({ name, kind });
      const k = `${y}|${name}`; if (!byName.has(k)) byName.set(k, date);
    };
    v.holidays.forEach((h) => add(h.date, h.name, h.kind));
    v.festivals.forEach((h) => add(h.date, h.name, 'festival'));
    v.terms.forEach((t) => { add(t.date, t.name, 'term'); terms.set(`${y}|${t.name}`, t); if (t.uncertain) uncertain.add(`${y}|${t.name}`); });
  }
  HOL = { table, byDate, byName, terms, uncertain, years: Object.keys(table.years).map(Number) };
  return HOL;
}

/**
 * Solve a date_q query for a given "today". Returns { answer, kind, unit } or { error }.
 * query.type:
 *   weekday_of  {ref:'today'|'tomorrow'|'yesterday'|'date', date?}           -> "화요일"
 *   date_of     {name:'추석'|..., year?}  (holiday, festival or solar term)   -> "9월 25일"
 *   holiday_of  {ref:'this_week'|'next_week', weekday:0..6} | {ref:'date', date} -> name of the special day
 *   season_of   {ref:'today'}                                                -> "가을"
 *   days_until  {name}                                                       -> "12일"
 */
function solveDateQ(query, today, table) {
  const H = holidayIndex(table);
  const q = query || {};
  const yearOf = (d) => Number(d.slice(0, 4));
  const findNamed = (name, fromDate) => {
    for (const y of [yearOf(fromDate), yearOf(fromDate) + 1]) {
      const k = `${y}|${name}`;
      if (H.uncertain.has(k)) return { error: 'date_uncertain' };
      const d = H.byName.get(k);
      if (d && d >= fromDate) return { date: d };
    }
    return { error: 'date_out_of_table' };
  };
  const refDay = (ref, date) => ref === 'today' ? today : ref === 'tomorrow' ? addDays(today, 1) : ref === 'yesterday' ? addDays(today, -1) : ref === 'date' && okYmd(date) ? date : null;
  switch (q.type) {
    case 'weekday_of': {
      const d = refDay(q.ref, q.date); if (!d) return { error: 'date_query' };
      return { answer: WD[weekday(d)], kind: 'weekday' };
    }
    case 'date_of': {
      if (typeof q.name !== 'string') return { error: 'date_query' };
      const y = Number(q.year) || yearOf(today);
      const k = `${y}|${q.name}`;
      if (H.uncertain.has(k)) return { error: 'date_uncertain' };
      const d = H.byName.get(k); if (!d) return { error: 'date_out_of_table' };
      return { answer: koDate(d, false), kind: 'date', date: d };
    }
    case 'holiday_of': {
      let d = null;
      if (q.ref === 'date') d = okYmd(q.date) ? q.date : null;
      else if ((q.ref === 'this_week' || q.ref === 'next_week') && Number.isInteger(q.weekday) && q.weekday >= 0 && q.weekday <= 6) {
        d = addDays(sundayOf(today), (q.ref === 'next_week' ? 7 : 0) + q.weekday);
      }
      if (!d) return { error: 'date_query' };
      if (!H.years.includes(yearOf(d))) return { error: 'date_out_of_table' };
      const list = (H.byDate.get(d) || []).filter((h) => h.kind !== 'substitute');
      if (list.some((h) => H.uncertain.has(`${yearOf(d)}|${h.name}`))) return { error: 'date_uncertain' };
      const names = [...new Set(list.map((h) => h.name.replace(/ 연휴$/, '')))];
      if (names.length !== 1) return { error: names.length ? 'date_ambiguous' : 'date_no_holiday' };
      return { answer: names[0], kind: 'name', date: d };
    }
    case 'season_of':
      return { answer: seasonOf(today), kind: 'season' };
    case 'days_until': {
      if (typeof q.name !== 'string') return { error: 'date_query' };
      const r = findNamed(q.name, today); if (r.error) return r;
      return { answer: `${daysBetween(today, r.date)}일`, kind: 'days', n: daysBetween(today, r.date) };
    }
    default: return { error: 'date_query' };
  }
}

module.exports = {
  KST_MS, kst, parse, fmt, okYmd, addDays, weekday, daysBetween, sundayOf, startMs,
  weekKey, weekStart, weekEnd, nextWeekKey, weeksBetween, koDate, seasonOf, WD, WD1,
  holidayIndex, solveDateQ,
};
