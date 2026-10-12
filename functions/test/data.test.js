'use strict';
/* Data files: emoji ≤ Unicode 13.0, holiday table against KASI-verified dates, lexicon shape. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lexicon } = require('../ai/core/lexicon.js');
const kd = require('../ai/core/kdate.js');

const lx = lexicon();

test('every allowlisted emoji is a single code point with Emoji property in Unicode 13.0', () => {
  const { ranges } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/emoji13-ranges.json'), 'utf8'));
  const E = lx.raw.emoji;
  const all = new Set([...Object.values(E.groups).flat(), ...E.similar.flat(), ...Object.keys(E.places), ...E.fills, E.empty, ...E.cues]);
  for (const e of all) {
    const cps = [...e.replace(/️/g, '')].map((c) => c.codePointAt(0));
    assert.equal(cps.length, 1, `${e} must be one code point (no ZWJ, skin tone or gender)`);
    const r = ranges.find(([a, b]) => cps[0] >= a && cps[0] <= b);
    assert.ok(r && r[2] <= 13.0, `${e} U+${cps[0].toString(16)} not in Emoji 13.0`);
  }
  assert.ok(!lx.emojiAll.has('⛪'), 'religious place emoji excluded');
});

test('lunar holidays 2026–2030 (verified with KASI solar→lunar API)', () => {
  const H = kd.holidayIndex(lx.holidays);
  const want = {
    설날: ['2026-02-17', '2027-02-07', '2028-01-27', '2029-02-13', '2030-02-03'],
    추석: ['2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12'],
    부처님오신날: ['2026-05-24', '2027-05-13', '2028-05-02', '2029-05-20', '2030-05-09'],
    정월대보름: ['2026-03-03', '2027-02-21', '2028-02-10', '2029-02-27', '2030-02-17'],
    단오: ['2026-06-19', '2027-06-09', '2028-05-28', '2029-06-16', '2030-06-05'],
    칠석: ['2026-08-19', '2027-08-08', '2028-08-26', '2029-08-16', '2030-08-05'],
  };
  for (const [name, dates] of Object.entries(want)) dates.forEach((d) => assert.equal(H.byName.get(`${d.slice(0, 4)}|${name}`), d, `${name} ${d}`));
});
test('substitute holidays 2026–2028 match KASI exactly', () => {
  const subs = (y) => lx.holidays.years[y].holidays.filter((h) => h.kind === 'substitute').map((h) => h.date);
  assert.deepEqual(subs(2026), ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']);
  assert.deepEqual(subs(2027), ['2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']);
  assert.deepEqual(subs(2028), ['2028-10-05']);
});
test('solar terms 2026–2028 equal KASI; exactly one uncertain term (2030 우수) is flagged', () => {
  const t = (y, n) => lx.holidays.years[y].terms.find((x) => x.name === n);
  assert.deepEqual([t(2026, '입춘').date, t(2026, '입춘').time], ['2026-02-04', '05:02']);
  assert.deepEqual([t(2027, '상강').date, t(2027, '상강').time], ['2027-10-24', '00:33']);
  assert.deepEqual([t(2028, '대설').date, t(2028, '대설').time], ['2028-12-06', '23:25']);
  assert.equal(t(2029, '입춘').date, '2029-02-03');
  const unc = Object.values(lx.holidays.years).flatMap((v) => v.terms.filter((x) => x.uncertain).map((x) => x.name + x.date));
  assert.deepEqual(unc, ['우수2030-02-18']);
  for (const y of [2026, 2027, 2028, 2029, 2030]) assert.equal(lx.holidays.years[y].terms.length, 24);
});
test('date_q solver: weekday, date_of, holiday_of, days_until, season', () => {
  const T = lx.holidays;
  assert.equal(kd.solveDateQ({ type: 'weekday_of', ref: 'date', date: '2027-09-15' }, '2027-09-01', T).answer, '수요일');
  assert.equal(kd.solveDateQ({ type: 'date_of', name: '설날', year: 2028 }, '2028-01-01', T).answer, '1월 27일');
  assert.equal(kd.solveDateQ({ type: 'holiday_of', ref: 'date', date: '2026-09-24' }, '2026-09-01', T).answer, '추석');
  assert.equal(kd.solveDateQ({ type: 'days_until', name: '추석' }, '2026-09-20', T).answer, '5일');
  assert.equal(kd.solveDateQ({ type: 'season_of', ref: 'today' }, '2026-12-01', T).answer, '겨울');
  assert.equal(kd.solveDateQ({ type: 'date_of', name: '우수', year: 2030 }, '2030-01-01', T).error, 'date_uncertain');
  assert.equal(kd.solveDateQ({ type: 'holiday_of', ref: 'date', date: '2031-01-01' }, '2030-12-01', T).error, 'date_out_of_table');
});
test('Sunday-start week keys round-trip', () => {
  for (const d of ['2026-11-01', '2026-12-31', '2027-01-03', '2027-03-16', '2030-12-29']) {
    const k = kd.weekKey(d); const s = kd.weekStart(k);
    assert.equal(kd.weekday(s), 0); assert.ok(s <= d && d <= kd.addDays(s, 6), `${d} ${k} ${s}`);
  }
  assert.equal(kd.nextWeekKey(kd.weekKey('2026-12-27'), 1), kd.weekKey('2027-01-03'));
  assert.equal(kd.weeksBetween(kd.weekKey('2026-11-01'), kd.weekKey('2027-02-07')), 14);
});

test('lexicon: categories seeded from the app, ambiguous words flagged, extendable', () => {
  assert.ok(lx.raw.words.extendable && lx.raw.relations.extendable && lx.raw.items.extendable);
  for (const w of ['사과', '배추', '고등어', '냉장고', '장구']) assert.ok(lx.wordCats.get(w), w);
  for (const w of ['배', '눈', '다리', '밤']) assert.ok(lx.ambiguous.has(w), w);
  assert.ok(lx.known.size > 600, `known ${lx.known.size}`);
  for (const [, def] of Object.entries(lx.raw.words.categories)) for (const n of def.near) assert.ok(lx.catGroup.has(n), `near ${n}`);
  for (const [a, r, b] of lx.raw.relations.pairs) assert.ok(lx.relTypes.has(r) && a && b);
  for (const [k, v] of Object.entries(lx.items)) assert.ok(v.min % 100 === 0 && v.max % 100 === 0 && v.min < v.max, k);
});
test('do-not-copy holds hashes only (no plain words)', () => {
  const raw = JSON.stringify(lx.raw.donotcopy.wordSets);
  for (const w of ['나무', '자동차', '모자', '비행기', '연필', '소나무', '우산']) assert.ok(!raw.includes(w), w);
  assert.ok(lx.raw.donotcopy.wordSets.every((s) => s.h.every((h) => /^[0-9a-f]{16}$/.test(h))));
});
test('names list: 40 allowed character names', () => { assert.equal(lx.raw.names.allowed.length, 40); });
