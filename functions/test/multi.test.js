'use strict';
/* Multi-trainee server pieces that need no database (DESIGN-MULTI §4–§5): trainee set, letters, {{who}}, digest
 * grouping, wake caps, bank demand scaling, report letter parsing. */
const test = require('node:test');
const assert = require('node:assert/strict');

test('state/trainees normalization: order kept, duplicates/bad ids dropped, max 4, labels per id', () => {
  const { normalizeTrainees } = require('../ai/family.js');
  assert.deepEqual(normalizeTrainees(null), { ids: [], labels: {} });
  const t = normalizeTrainees({ ids: ['m2', 'm1', 'm2', 'bad id', 7, 'm3', 'm4', 'm5'], labels: { m1: ' 어머니 ', m2: '아버지', m9: 'x' } });
  assert.deepEqual(t.ids, ['m2', 'm1', 'm3', 'm4']);
  assert.deepEqual(t.labels, { m2: '아버지', m1: '어머니', m3: '', m4: '' });
});

test('pseudonym letters: first eligible = A, stable, never reused, Z is the last', () => {
  const { assignLetters, midOfLetter, letterOf } = require('../ai/family.js');
  let r = assignLetters({}, ['m1']);
  assert.deepEqual(r.subjects, { m1: 'A' });
  r = assignLetters(r.subjects, ['m2', 'm1']);
  assert.deepEqual(r.subjects, { m1: 'A', m2: 'B' }); assert.deepEqual(r.added, { m2: 'B' });
  // m1 removed from T and m3 added: m3 gets C, A stays with m1 (no reuse); m1 re-added keeps A
  r = assignLetters(r.subjects, ['m3', 'm1']);
  assert.deepEqual(r.subjects, { m1: 'A', m2: 'B', m3: 'C' });
  assert.equal(midOfLetter({ subjects: r.subjects }, 'B'), 'm2');
  assert.equal(midOfLetter({ subjects: r.subjects }, 'D'), null);
  assert.equal(letterOf({ subjects: r.subjects }, 'm3'), 'C');
  const full = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L, i) => ['x' + i, L]));
  assert.deepEqual(assignLetters(full, ['new']).added, {});
});

test('theme union for bank needs is ≤ 16 and keeps order', () => {
  const { unionThemes } = require('../ai/family.js');
  assert.deepEqual(unionThemes([['낚시', '바둑'], ['바둑', '꽃']]), ['낚시', '바둑', '꽃']);
  const many = Array.from({ length: 4 }, (_, i) => Array.from({ length: 8 }, (_, j) => '가'.repeat(1) + String.fromCharCode(0xac00 + i * 8 + j)));
  assert.equal(unionThemes(many).length, 16);
});

test('report letter comes from basedOn; aggregate ids carry the letter', () => {
  const { letterOfAggId } = require('../ai/reports.js');
  assert.equal(letterOfAggId('a-B-20270316-0650'), 'B');
  assert.equal(letterOfAggId('a-A-20270316-1410-al'), 'A');
  assert.equal(letterOfAggId('a-20270316-0650'), null);
  assert.equal(letterOfAggId('a-b-20270316-0650'), null);
  assert.equal(letterOfAggId(undefined), null);
});

const AGG = {
  schema: 'bw.agg.v1', id: 'a-B-20270316-0650', asOf: '2027-03-16T06:50:00+09:00', mode: 'daily', subject: '사용자 B', phase: 'monitoring', thresholdsVer: 'v1',
  today: null, domains: [{ domain: 'composite', light: 'green', metrics: ['comp_ma4', 'comp_base'] }], signals: [], anchor: null, confounders: [],
  participation: { metrics: [] }, reference: [], confidence: 'weak', numbers: { comp_ma4: '74%', comp_base: '77%' }, glossaryKeys: ['baseline'],
};
const REP = () => ({
  schema: 'bw.report.v1', jobId: 'scheduled', basedOn: AGG.id, mode: 'daily',
  headline: '{{who}}께서 어제도 평소처럼 마치셨어요.',
  summary: ['{{who}}의 전체 흐름은 평소 범위 안이에요.', '몇 주의 흐름을 함께 지켜봐요.'],
  domains: [{ domain: 'composite', light: 'green', sentence: '전체는 {{comp_ma4}}로 평소 {{comp_base}}와 비슷해요.' }],
  notable: [], confounders: [],
  doctorPoints: [{ text: '지금은 급하게 상의할 일은 없어요. {{who}}께 그래프를 보여 드리면 충분해요.', evidence: [] }],
  glossary: [], confidence: 'weak',
});

test('{{who}} is accepted (not a number key), kept by fill; written-out kinship words are rejected', () => {
  const { checkReport, fillReport } = require('../ai/core/report.js');
  assert.deepEqual(checkReport(REP(), AGG).codes, []);
  const f = fillReport(REP(), AGG);
  assert.equal(f.headline, '{{who}}께서 어제도 평소처럼 마치셨어요.');
  assert.equal(f.domains[0].sentence, '전체는 74%로 평소 77%와 비슷해요.');
  for (const w of ['아버지께서', '어머니의', '할머니께']) {
    const r = REP(); r.headline = `${w} 어제도 평소처럼 마치셨어요.`;
    assert.ok(checkReport(r, AGG).codes.includes('who'), w);
  }
  const r2 = REP(); r2.summary[0] = '김영수 님의 전체 흐름은 평소 범위 안이에요.';
  assert.ok(checkReport(r2, AGG).codes.length > 0);
  // `who` must never be a number key
  assert.ok(checkReport(REP(), { ...AGG, numbers: { ...AGG.numbers, who: 'x' } }).codes.includes('placeholder'));
  // other unknown placeholders still fail
  const r3 = REP(); r3.summary[1] = '{{whom}} 몇 주의 흐름을 함께 지켜봐요.';
  assert.ok(checkReport(r3, AGG).codes.includes('placeholder'));
});

test('the template names the person only as {{who}} and passes its own check', () => {
  const { templateReport } = require('../ai/core/template.js');
  const { checkReport } = require('../ai/core/report.js');
  const rep = templateReport(AGG);
  assert.ok(JSON.stringify(rep).includes('{{who}}'));
  assert.deepEqual(checkReport(rep, AGG).codes, []);
  const orange = { ...AGG, signals: [{ key: 'S1:composite', rule: 'S1', domain: 'composite', level: 'orange', why: [], downgraded: false, evidence: ['comp_ma4'] }] };
  assert.deepEqual(checkReport(templateReport(orange), orange).codes, []);
});

test('Telegram digest: one line per kind, "· {n}명" for several trainees, orange counts summed, no names', () => {
  const { digestText, messageText } = require('../ai/telegram.js');
  const url = 'https://x.example/';
  assert.equal(messageText('morning', 0, url, 2), '🧠 오늘의 두뇌 산책\n아침 리포트가 올라왔어요 · 2명\nhttps://x.example/');
  assert.equal(digestText([{ kind: 'morning', n: 0, s: 'A' }, { kind: 'morning', n: 1, s: 'B' }], url),
    '🧠 오늘의 두뇌 산책\n아침 리포트가 올라왔어요 · 2명 · 주의 신호 1건\nhttps://x.example/');
  const d = digestText([
    { kind: 'morning', n: 1, s: 'A' }, { kind: 'morning', n: 2, s: 'A' }, { kind: 'morning', n: 1, s: 'B' }, { kind: 'morning', n: 0, s: 'C' },
    { kind: 'morning_template', n: 0, s: 'D' }, { kind: 'gen_stalled', n: 0 },
  ], url);
  assert.equal(d, '🧠 오늘의 두뇌 산책\n· 아침 리포트가 올라왔어요 · 3명 · 주의 신호 3건\n· 아침 리포트(간단판)가 올라왔어요 · AI 설명은 오늘 빠졌어요\n· 문제 만들기가 2일째 멈췄어요(앱은 정상이에요)\nhttps://x.example/');
  assert.ok(!/[A-D]\b/.test(d.replace(url, '').replace('AI', '')));
});

test('wake caps: 2 per trainee per day, 4 per family per day', () => {
  const { decideWake } = require('../ai/waker.js');
  const at = Date.parse('2027-04-08T14:10:00+09:00');
  const o = [{ key: 'S3:speed', rule: 'S3', why: ['x'] }];
  assert.equal(decideWake({ newOrange: o, nowMs: at, wakes: { days: { '2027-04-08': 1 } }, famWakes: { days: { '2027-04-08': 3 } } }).action, 'wake');
  assert.equal(decideWake({ newOrange: o, nowMs: at, wakes: { days: { '2027-04-08': 2 } }, famWakes: { days: { '2027-04-08': 2 } } }).action, 'cap');
  assert.equal(decideWake({ newOrange: o, nowMs: at, wakes: { days: { '2027-04-08': 0 } }, famWakes: { days: { '2027-04-08': 4 } } }).action, 'family_cap');
  assert.equal(decideWake({ newOrange: o, nowMs: at, wakes: {}, famWakes: { days: { '2027-04-07': 4 } } }).action, 'wake');
});

test('generator demand scales with the number of trainees', () => {
  const { maxItemsFor, WAKE } = require('../ai/config.js');
  assert.equal(maxItemsFor(1), 90); assert.equal(maxItemsFor(2), 120); assert.equal(maxItemsFor(3), 150); assert.equal(maxItemsFor(4), 150); assert.equal(maxItemsFor(0), 90);
  assert.equal(WAKE.perDay, 2); assert.equal(WAKE.perDayFamily, 4);
  const bank = require('../ai/bank.js');
  assert.equal(bank.refWeekKey('2027-W11', 'B'), '2027-W11:B');
  assert.equal(bank.anchorKey('A', 'B'), 'A_B');
});
