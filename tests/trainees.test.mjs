/* 순수 로직 시험: js/trainees.js (훈련하는 분 목록: 더하기·빼기·호칭 바꾸기·최대 4명·호칭·선택 규칙·문서 모양)
 * 실행: cd tests && npm run test:unit   (= node --test program.test.mjs trainees.test.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TRAINEES, LABEL_MAX, LABEL_CHOICES, normalizeTrainees, labelOf, inSet, canAdd, pickSel, pickOne,
  traineesDoc, withAdded, withRemoved, withLabel, joinLabels, fillWho
} from '../js/trainees.js';

const empty = () => normalizeTrainees(null);
const mk = (...pairs) => pairs.reduce((s, [id, l]) => withAdded(s, id, l), empty());

test('상수: 최대 4명, 호칭 12글자, 호칭 후보 4개', () => {
  assert.equal(MAX_TRAINEES, 4);
  assert.equal(LABEL_MAX, 12);
  assert.deepEqual(LABEL_CHOICES, ['아버지', '어머니', '할머니', '할아버지']);
});

test('normalizeTrainees: 없거나 깨진 문서는 빈 목록', () => {
  for (const d of [null, undefined, {}, 'x', 5, [], { ids: 'a' }, { ids: null, labels: 3 }]) assert.deepEqual(normalizeTrainees(d), { ids: [], labels: {} });
});
test('normalizeTrainees: 순서 유지, 호칭 복사, 호칭이 없으면 "훈련하는 분"', () => {
  const s = normalizeTrainees({ v: 1, ids: ['m2', 'm1'], labels: { m1: '어머니', m2: '아버지' } });
  assert.deepEqual(s.ids, ['m2', 'm1']);
  assert.deepEqual(s.labels, { m1: '어머니', m2: '아버지' });
  const t = normalizeTrainees({ ids: ['a', 'b'], labels: { a: '  ', b: 7 } });
  assert.deepEqual(t.labels, { a: '훈련하는 분', b: '7' });
});
test('normalizeTrainees: 잘못된 id·겹치는 id 버림, 5번째부터 버림', () => {
  const s = normalizeTrainees({ ids: ['a', 'a', '', 'bad id', 'x/y', 5, null, 'b', 'c', 'd', 'e', 'f'], labels: {} });
  assert.deepEqual(s.ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(Object.keys(s.labels), ['a', 'b', 'c', 'd']);
  assert.equal(normalizeTrainees({ ids: ['x'.repeat(64)] }).ids.length, 1);
  assert.equal(normalizeTrainees({ ids: ['x'.repeat(65)] }).ids.length, 0);
  assert.deepEqual(normalizeTrainees({ ids: ['A-b_9'] }).ids, ['A-b_9']);
});
test('normalizeTrainees: 목록에 없는 사람의 호칭은 버리고, 긴 호칭은 12글자로 자름', () => {
  const s = normalizeTrainees({ ids: ['a'], labels: { a: '가'.repeat(20), ghost: '유령' } });
  assert.equal(s.labels.a.length, LABEL_MAX);
  assert.ok(!('ghost' in s.labels));
});
test('normalizeTrainees: 입력을 바꾸지 않아요', () => {
  const d = { ids: ['a', 'b'], labels: { a: '아버지', b: '어머니' } }, copy = JSON.stringify(d);
  const s = normalizeTrainees(d); s.ids.push('z'); s.labels.a = 'x';
  assert.equal(JSON.stringify(d), copy);
});

test('withAdded: 끝에 더하고 원본은 그대로', () => {
  const a = mk(['m1', '아버지']);
  const b = withAdded(a, 'm2', '어머니');
  assert.deepEqual(b.ids, ['m1', 'm2']);
  assert.deepEqual(b.labels, { m1: '아버지', m2: '어머니' });
  assert.deepEqual(a.ids, ['m1']);
  assert.deepEqual(a.labels, { m1: '아버지' });
});
test('withRemoved: 목록과 호칭에서 함께 빼고, 순서는 유지, 없는 사람은 그대로', () => {
  const s = mk(['a', '아버지'], ['b', '어머니'], ['c', '할머니']);
  const r = withRemoved(s, 'b');
  assert.deepEqual(r.ids, ['a', 'c']);
  assert.deepEqual(r.labels, { a: '아버지', c: '할머니' });
  assert.deepEqual(s.ids, ['a', 'b', 'c']);
  assert.ok('b' in s.labels);
  assert.deepEqual(withRemoved(s, 'zzz'), { ids: ['a', 'b', 'c'], labels: s.labels });
  assert.deepEqual(withRemoved(withRemoved(mk(['a', 'x']), 'a'), 'a'), { ids: [], labels: {} });
});
test('withLabel: 호칭만 바꾸고 순서·다른 호칭은 그대로, 원본은 그대로', () => {
  const s = mk(['a', '아버지'], ['b', '어머니']);
  const r = withLabel(s, 'b', '할머니');
  assert.deepEqual(r.ids, ['a', 'b']);
  assert.deepEqual(r.labels, { a: '아버지', b: '할머니' });
  assert.equal(s.labels.b, '어머니');
  r.ids.push('q');
  assert.deepEqual(s.ids, ['a', 'b']);
});

test('최대 4명: canAdd 는 4명이 되면 거짓, 빼면 다시 참', () => {
  let s = empty();
  assert.equal(canAdd(s), true);
  ['a', 'b', 'c'].forEach(id => { s = withAdded(s, id, '아버지'); assert.equal(canAdd(s), true); });
  s = withAdded(s, 'd', '어머니');
  assert.equal(s.ids.length, MAX_TRAINEES);
  assert.equal(canAdd(s), false);
  assert.equal(canAdd(withRemoved(s, 'a')), true);
  assert.equal(canAdd(null), false);
  assert.equal(canAdd(undefined), false);
});
test('최대 4명: 5명짜리 문서는 normalize 가 4명으로, traineesDoc 도 4명으로 자름', () => {
  const five = { ids: ['a', 'b', 'c', 'd', 'e'], labels: { a: '1', b: '2', c: '3', d: '4', e: '5' } };
  assert.equal(normalizeTrainees(five).ids.length, 4);
  const doc = traineesDoc(five, 'me', 1);
  assert.deepEqual(doc.ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(Object.keys(doc.labels), ['a', 'b', 'c', 'd']);
});

test('inSet / labelOf / joinLabels', () => {
  const s = mk(['a', '아버지'], ['b', '어머니']);
  assert.equal(inSet(s, 'a'), true);
  assert.equal(inSet(s, 'z'), false);
  assert.equal(inSet(s, ''), false);
  assert.equal(inSet(s, null), false);
  assert.equal(inSet(null, 'a'), false);
  assert.equal(labelOf(s, 'b'), '어머니');
  assert.equal(labelOf(s, 'z'), '훈련하는 분');
  assert.equal(labelOf(null, 'a'), '훈련하는 분');
  assert.equal(joinLabels(s), '아버지·어머니');
  assert.equal(joinLabels(s, ['b', 'a']), '어머니·아버지');
  assert.equal(joinLabels(s, ['b', 'zz']), '어머니·훈련하는 분');
  assert.equal(joinLabels(empty()), '');
  assert.equal(joinLabels(null), '');
});

test('pickSel: 0명 null, 1명은 그 사람, 2명 이상은 기억한 값(all 또는 목록의 id) 아니면 all', () => {
  assert.equal(pickSel(empty(), 'all'), null);
  assert.equal(pickSel(null, 'a'), null);
  const one = mk(['a', '아버지']);
  assert.equal(pickSel(one, 'all'), 'a');
  assert.equal(pickSel(one, 'zzz'), 'a');
  const two = mk(['a', '아버지'], ['b', '어머니']);
  assert.equal(pickSel(two, 'all'), 'all');
  assert.equal(pickSel(two, 'b'), 'b');
  assert.equal(pickSel(two, 'removed'), 'all');
  assert.equal(pickSel(two, null), 'all');
  assert.equal(pickSel(two, undefined), 'all');
});
test('pickOne: 선택된 사람, 아니면 마지막으로 고른 사람, 아니면 첫 번째, 0명 null', () => {
  const s = mk(['a', '아버지'], ['b', '어머니'], ['c', '할머니']);
  assert.equal(pickOne(s, 'b', 'c'), 'b');
  assert.equal(pickOne(s, 'all', 'c'), 'c');
  assert.equal(pickOne(s, 'gone', 'gone2'), 'a');
  assert.equal(pickOne(s, null, null), 'a');
  assert.equal(pickOne(empty(), 'a', 'b'), null);
  assert.equal(pickOne(null, 'a', 'b'), null);
});

test('traineesDoc: 규칙의 validTrainees 와 같은 모양 (키 5개, v 1, labels 키 = ids)', () => {
  const s = mk(['a', '아버지'], ['b', '어머니']);
  const d = traineesDoc(s, 'me', 123);
  assert.deepEqual(Object.keys(d).sort(), ['ids', 'labels', 'updatedBy', 'updatedTs', 'v']);
  assert.equal(d.v, 1);
  assert.deepEqual(d.ids, ['a', 'b']);
  assert.deepEqual(Object.keys(d.labels).sort(), ['a', 'b']);
  assert.equal(d.updatedBy, 'me');
  assert.equal(d.updatedTs, 123);
});
test('traineesDoc: 빈 호칭은 "훈련하는 분", 긴 호칭은 12글자, 앞뒤 공백 제거, 목록 밖 호칭은 버림', () => {
  const d = traineesDoc({ ids: ['a', 'b', 'c'], labels: { a: '', b: '  어머니  ', c: '가'.repeat(30), ghost: 'x' } }, 'me', 1);
  assert.equal(d.labels.a, '훈련하는 분');
  assert.equal(d.labels.b, '어머니');
  assert.equal(d.labels.c.length, LABEL_MAX);
  assert.ok(!('ghost' in d.labels));
  assert.ok(Object.values(d.labels).every(l => l.length >= 1 && l.length <= LABEL_MAX));
});
test('traineesDoc → normalizeTrainees 로 되돌려도 같아요', () => {
  const s = mk(['a', '아버지'], ['b', '어머니'], ['c', '할머니']);
  assert.deepEqual(normalizeTrainees(traineesDoc(s, 'me', 1)), s);
});

test('흐름: 더하기 → 호칭 바꾸기 → 빼기 → 다시 더하기 (순서는 더한 순서)', () => {
  let s = empty();
  s = withAdded(s, 'a', '아버지');
  s = withAdded(s, 'b', '어머니');
  s = withLabel(s, 'a', '할아버지');
  assert.equal(joinLabels(s), '할아버지·어머니');
  s = withRemoved(s, 'a');
  assert.deepEqual(s.ids, ['b']);
  assert.equal(pickSel(s, 'all'), 'b');
  s = withAdded(s, 'a', '아버지');
  assert.deepEqual(s.ids, ['b', 'a']);
  assert.equal(joinLabels(s), '어머니·아버지');
});

test('fillWho: {{who}} 를 호칭으로 (공백 허용, 여러 번, 없으면 "훈련하는 분", 글이 아니면 글자로)', () => {
  assert.equal(fillWho('{{who}}의 반응이 느려졌어요. {{ who }}는 계속해요.', '아버지'), '아버지의 반응이 느려졌어요. 아버지는 계속해요.');
  assert.equal(fillWho('{{who}}', ''), '훈련하는 분');
  assert.equal(fillWho('{{who}}', null), '훈련하는 분');
  assert.equal(fillWho(null, '아버지'), '');
  assert.equal(fillWho(undefined, '아버지'), '');
  assert.equal(fillWho(12, '아버지'), '12');
  assert.equal(fillWho('{{n1}} 그대로', '아버지'), '{{n1}} 그대로');
  assert.equal(fillWho('{{who}}', '<b>x</b>'), '<b>x</b>');   // 화면에는 textContent 로만 넣어요: 여기서는 걸러내지 않고 그대로
});
