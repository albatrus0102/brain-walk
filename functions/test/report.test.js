'use strict';
/* Report check / fill (B.8) and the template "간단판". */
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkReport, fillReport } = require('../ai/core/report.js');
const { templateReport } = require('../ai/core/template.js');

const AGG = {
  schema: 'bw.agg.v1', id: 'a-20270316-0650', asOf: '2027-03-16T06:50:00+09:00', mode: 'daily', subject: '사용자 A', phase: 'monitoring', thresholdsVer: 'v1',
  today: { trained: true, metrics: ['today_games'] },
  domains: [
    { domain: 'composite', light: 'green', metrics: ['comp_ma4', 'comp_base', 'comp_band'] },
    { domain: 'memory', light: 'green', metrics: ['mem_ma4', 'mem_base', 'mem_mdc90'] },
    { domain: 'speed', light: 'yellow', metrics: ['spd_change', 'spd_slope', 'spd_since'] },
  ],
  signals: [{ key: 'S3:speed', rule: 'S3', domain: 'speed', level: 'yellow', why: ['speed_ewma_yellow'], downgraded: false, evidence: ['spd_change'] }],
  anchor: null, confounders: [{ code: 'illness', from: 'note1_from', to: 'note1_to' }], participation: { metrics: ['part_days14'] }, reference: [],
  confidence: 'weak',
  numbers: { date: '3월 16일 (화)', comp_ma4: '74%', comp_base: '77%', comp_band: '±9%p', mem_ma4: '66%', mem_base: '70%', mem_mdc90: '±21%p', spd_change: '9% 느림', spd_slope: '주당 +1.8%', spd_since: '3월 7일 주', note1_from: '2월 28일', note1_to: '3월 6일', part_days14: '14일', today_games: '5개' },
  glossaryKeys: ['baseline', 'band', 'ewma', 'rt'],
};
const GOOD = () => ({
  schema: 'bw.report.v1', jobId: 'scheduled', basedOn: AGG.id, mode: 'daily',
  headline: '어제도 평소처럼 마치셨어요. 반응 속도만 지켜보는 중이에요.',
  summary: ['전체 흐름은 평소 범위 안이에요.', '반응 속도는 {{spd_since}}부터 조금 느린 쪽이라 관찰 중이에요.'],
  domains: [
    { domain: 'composite', light: 'green', sentence: '전체는 {{comp_ma4}}로 평소 {{comp_base}}와 비슷해요.' },
    { domain: 'memory', light: 'green', sentence: '기억은 {{mem_ma4}}예요. 영역 하나는 흔들림이 커요.' },
    { domain: 'speed', light: 'yellow', sentence: '처음보다 {{spd_change}}, 같은 기간 감기 메모가 있어요.' },
  ],
  notable: [{ text: '반응 속도가 {{spd_slope}}로 조금씩 느려지는 흐름이에요.', evidence: ['spd_slope'] }],
  confounders: ['감기·몸살 {{note1_from}}~{{note1_to}}'],
  doctorPoints: [{ text: '다음 진료 때 반응 속도 그래프를 함께 보여 드려 볼 만해요.', evidence: ['spd_change'] }],
  glossary: [{ key: 'ewma', plain: '최근 주에 조금 더 무게를 둔 평균이에요.', analogy: '기온 대신 요즘 날씨를 보는 것' }],
  confidence: 'weak',
});
const codes = (rep, agg = AGG, o) => checkReport(rep, agg, o).codes;
const mut = (f) => { const r = GOOD(); f(r); return r; };

test('a well-formed routine report passes and is filled with server numbers', () => {
  assert.deepEqual(codes(GOOD()), []);
  const f = fillReport(GOOD(), AGG);
  assert.equal(f.domains[0].sentence, '전체는 74%로 평소 77%와 비슷해요.');
  assert.equal(f.confounders[0], '감기·몸살 2월 28일~3월 6일');
  assert.ok(!JSON.stringify(f).includes('{{'));
});
test('digits outside placeholders are rejected (even full-width)', () => {
  assert.ok(codes(mut((r) => { r.summary[0] = '전체는 74%예요. 관찰 중이에요.'; })).includes('digits'));
  assert.ok(codes(mut((r) => { r.headline = '반응 속도 ９% 느림'; })).includes('digits'));
});
test('unknown placeholder keys are rejected', () => { assert.ok(codes(mut((r) => { r.summary[0] = '전체 {{comp_slope}} 관찰 중이에요.'; })).includes('placeholder')); });
test('light, confidence and the domain list must match exactly', () => {
  assert.ok(codes(mut((r) => { r.domains[2].light = 'green'; })).includes('light'));
  assert.ok(codes(mut((r) => { r.domains.reverse(); })).includes('domains'));
  assert.ok(codes(mut((r) => { r.domains.pop(); })).includes('domains'));
  assert.ok(codes(mut((r) => { r.confidence = 'concordant'; })).includes('confidence'));
});
test('report_banned words are rejected; 치매안심센터 is allowed', () => {
  for (const w of ['치매', '진단', '악화', '알츠하이머', '확실히', '틀림없이', '비정상']) assert.ok(codes(mut((r) => { r.doctorPoints[0].text = `${w} 의사와 상담해 보세요.`; })).includes('banned'), w);
  assert.deepEqual(codes(mut((r) => { r.doctorPoints[0].text = '걱정되면 치매안심센터와 의사와 상담해 보세요.'; })), []);
});
test('a closing phrase from the approved list is required', () => {
  assert.ok(codes(mut((r) => { r.summary = ['전체 흐름은 평소 범위예요.', '속도는 조금 느려요.']; r.doctorPoints[0].text = '그래프를 함께 보여 드려요.'; })).includes('closing'));
});
test('lengths', () => {
  assert.ok(codes(mut((r) => { r.headline = '가'.repeat(61); })).includes('length'));
  assert.ok(codes(mut((r) => { r.summary = ['관찰 중이에요.']; })).includes('length'));
  assert.ok(codes(mut((r) => { r.domains[0].sentence = '가'.repeat(81); })).includes('length'));
});
test('job and basis must match', () => {
  assert.ok(codes(mut((r) => { r.basedOn = 'a-20270315-0650'; })).includes('based_on'));
  assert.ok(codes(GOOD(), AGG, { jobId: 'w-20270408-1410-a1' }).includes('job'));
  assert.ok(codes(mut((r) => { r.mode = 'weekly'; })).includes('mode'));
  assert.deepEqual(codes(mut((r) => { r.extra = 1; })), ['schema']);
});
test('evidence and glossary keys must come from the aggregate', () => {
  assert.ok(codes(mut((r) => { r.doctorPoints[0].evidence = ['made_up']; })).includes('evidence'));
  assert.ok(codes(mut((r) => { r.glossary[0].key = 'iiv'; })).includes('glossary'));
});
test('weekly mode needs a trend; anchor text only when the aggregate has an anchor', () => {
  const W = { ...AGG, mode: 'weekly' };
  assert.ok(codes(mut((r) => { r.mode = 'weekly'; }), W).includes('trend'));
  assert.deepEqual(codes(mut((r) => { r.mode = 'weekly'; r.trend = ['흐름은 평평해요.', '지켜봐요.']; }), W), []);
  assert.ok(codes(mut((r) => { r.mode = 'weekly'; r.trend = ['흐름은 평평해요.', '지켜봐요.']; r.anchor = ['같은 문제', '유지예요.']; }), W).includes('anchor'));
});
test('names / phone numbers in a report are rejected', () => {
  assert.ok(codes(mut((r) => { r.notable[0].text = '김태희 씨가 관찰 중이에요.'; })).includes('pii'));
});
test('template report passes the same check for every mode and light mix', () => {
  for (const mode of ['daily', 'weekly', 'alert']) {
    const agg = { ...AGG, mode, anchor: mode === 'weekly' ? { set: 'A', verdict: 'green', metrics: [] } : null, glossaryKeys: [...AGG.glossaryKeys, 'anchor'] };
    agg.signals = mode === 'alert' ? [{ ...AGG.signals[0], level: 'orange' }] : AGG.signals;
    const rep = templateReport(agg, mode === 'alert' ? 'w-20270408-1410-a1' : 'scheduled');
    assert.deepEqual(checkReport(rep, agg, { jobId: rep.jobId }).codes, [], mode);
  }
  const gray = { ...AGG, phase: 'baseline', confidence: 'insufficient', signals: [], domains: [{ domain: 'composite', light: 'gray', metrics: [] }], numbers: {}, confounders: [] };
  assert.deepEqual(checkReport(templateReport(gray), gray).codes, []);
});
