'use strict';
/* Server pieces that need no database: logger hygiene, Telegram text, waker decisions, submit shape, key auth, vendored validator. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('logger drops item text, names, scores-as-strings, URLs and tokens; keeps counts and codes', () => {
  const log = require('../ai/log.js');
  const lines = [];
  log._setSink({ info: (...a) => lines.push(JSON.stringify(a)), warn: (...a) => lines.push(JSON.stringify(a)), error: (...a) => lines.push(JSON.stringify(a)) });
  log.info('items', { accepted: 3, codes: { 'banned:medical': 1 }, text: '토요일 아침, 영수 씨는 손녀와', name: '김영수', score: '74%', url: 'https://api.telegram.org/bot123:ABC/sendMessage', key: 'k'.repeat(48), nested: { prompt: '다섯 가지 낱말' } });
  const out = lines.join('\n');
  for (const bad of ['토요일', '영수', '김영수', '74%', 'telegram', 'kkkk', '다섯']) assert.ok(!out.includes(bad), bad);
  assert.ok(out.includes('"accepted":3') && out.includes('banned:medical'));
});

test('Telegram text: kind sentence, optional orange count, link — no health content', () => {
  const { messageText, KIND } = require('../ai/telegram.js');
  const t = messageText('morning', 1, 'https://example.github.io/brain-walk/');
  assert.equal(t, '🧠 오늘의 두뇌 산책\n아침 리포트가 올라왔어요 · 주의 신호 1건\nhttps://example.github.io/brain-walk/');
  for (const k of Object.keys(KIND)) {
    const m = messageText(k, 0, 'https://x.example/');
    assert.ok(!/%|점|정답|느림|기억|치매|진단/.test(m.replace('두뇌 산책', '')), k);
  }
});

test('waker decisions: quiet hours, cooldown, daily cap, bundle', () => {
  const { decideWake } = require('../ai/waker.js');
  const at = (hhmm) => Date.parse(`2027-04-08T${hhmm}:00+09:00`);
  const s = (key) => ({ key, rule: key.split(':')[0], why: ['x'] });
  assert.equal(decideWake({ newOrange: [], nowMs: at('14:10'), wakes: {} }).action, 'none');
  assert.equal(decideWake({ newOrange: [s('S3:speed')], nowMs: at('21:00'), wakes: {} }).action, 'quiet');
  assert.equal(decideWake({ newOrange: [s('S3:speed')], nowMs: at('07:59'), wakes: {} }).action, 'quiet');
  const w = decideWake({ newOrange: [s('S3:speed'), s('S1:composite')], nowMs: at('14:10'), wakes: {} });
  assert.equal(w.action, 'wake'); assert.equal(w.eligible.length, 2);
  assert.equal(decideWake({ newOrange: [s('S3:speed')], nowMs: at('14:10'), wakes: { lastWake: { 'S3:speed': at('14:10') - 6 * 864e5 } } }).action, 'cooldown');
  assert.equal(decideWake({ newOrange: [s('S3:speed')], nowMs: at('14:10'), wakes: { lastWake: { 'S3:speed': at('14:10') - 7 * 864e5 } } }).action, 'wake');
  assert.equal(decideWake({ newOrange: [s('S3:speed')], nowMs: at('14:10'), wakes: { days: { '2027-04-08': 2 } } }).action, 'cap');
  assert.match(require('../ai/waker.js').jobIdFor(at('14:10')), /^w-20270408-1410-[a-z0-9]{2}$/);
});

test('aiSubmit shape check', () => {
  const { shapeError } = require('../ai/endpoints.js');
  const items = { kind: 'items', runId: '20270316-0331', payload: { schema: 'bw.items.v1', runId: '20270316-0331', items: [{}] } };
  assert.equal(shapeError(items), null);
  assert.equal(shapeError({ ...items, extra: 1 }), 'keys');
  assert.equal(shapeError({ ...items, kind: 'other' }), 'kind');
  assert.equal(shapeError({ ...items, runId: 'today' }), 'runId');
  assert.equal(shapeError({ ...items, payload: { schema: 'bw.items.v1', items: new Array(201).fill({}) } }), 'payload');
  const rep = { kind: 'report', runId: '20270316-0731', jobId: 'scheduled', payload: { schema: 'bw.report.v1', jobId: 'scheduled' } };
  assert.equal(shapeError(rep), null);
  assert.equal(shapeError({ ...rep, jobId: 'w-1' }), 'jobId');
  assert.equal(shapeError({ ...rep, payload: { schema: 'bw.report.v1', jobId: 'w-20270408-1410-a1' } }), 'jobId');
});

test('routine key: constant-time hash compare, 401 / 503 rules', async () => {
  const config = require('../ai/config.js');
  const fb = require('../ai/fb.js');
  const { checkKey, hashKey } = require('../ai/auth.js');
  const key = 'A'.repeat(24) + 'b'.repeat(24);
  let cfg = { routineKeyHash: hashKey(key) };
  const orig = fb.db;
  require.cache[require.resolve('../ai/fb.js')].exports.db = () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => cfg }) }) }) });
  try {
    const req = (h) => ({ get: (n) => (n.toLowerCase() === 'authorization' ? h : ''), headers: {} });
    config._resetConfigCache(); assert.equal((await checkKey(req('Bearer ' + key))).status, 200);
    config._resetConfigCache(); assert.equal((await checkKey(req('Bearer ' + key + 'x'))).status, 401);
    config._resetConfigCache(); assert.equal((await checkKey(req('Bearer short'))).status, 401);
    config._resetConfigCache(); assert.equal((await checkKey(req(''))).status, 401);
    cfg = {}; config._resetConfigCache(); assert.equal((await checkKey(req('Bearer ' + key))).status, 503);
    cfg = { routineKeyHash: 'abc' }; config._resetConfigCache(); assert.equal((await checkKey(req('Bearer ' + key))).status, 503);
    cfg = { routineKeyHash: hashKey(key), enabled: false }; config._resetConfigCache(); assert.equal((await checkKey(req('Bearer ' + key))).status, 503);
  } finally { require.cache[require.resolve('../ai/fb.js')].exports.db = orig; config._resetConfigCache(); }
});

test('vendored validator bundle behaves like the server core and is reproducible', async () => {
  const { build } = await import(path.join(__dirname, '../ai/tools/vendor-validator.mjs'));
  const a = build(), b = build();
  assert.equal(a.sha, b.sha);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bwv-')), 'bw-validator.cjs');
  fs.writeFileSync(f, a.out);
  const v = require(f);
  const core = require('../ai/core/item.js');
  const { good } = require('./fixtures/items.js');
  for (const it of Object.values(good)) {
    const x = v.checkItem(it, { specVer: 'ref-v1', today: '2026-12-10' }), y = core.checkItem(it, { specVer: 'ref-v1', today: '2026-12-10' });
    assert.deepEqual([x.ok, x.codes, x.hash], [y.ok, y.codes, y.hash]);
  }
  assert.equal(v.SOURCE_SHA, a.sha); assert.equal(v.VERSION, require('../ai/core/index.js').VERSION);
  assert.match(fs.readFileSync(f, 'utf8').split('\n')[0], /^\/\/ bw-validator \d+\.\d+\.\d+ sha256:[0-9a-f]{64}$/);
});

test('Telegram hold window 02:00–08:00 KST and the combined digest', () => {
  const { inHold, digestText } = require('../ai/telegram.js');
  const at = (hhmm) => Date.parse(`2027-04-08T${hhmm}:00+09:00`);
  assert.equal(inHold(at('01:59')), false); assert.equal(inHold(at('02:00')), true); assert.equal(inHold(at('07:59')), true); assert.equal(inHold(at('08:00')), false);
  const url = 'https://x.example/';
  assert.equal(digestText([{ kind: 'morning', n: 0 }], url), '🧠 오늘의 두뇌 산책\n아침 리포트가 올라왔어요\nhttps://x.example/');
  const d = digestText([{ kind: 'key_offschedule', n: 0 }, { kind: 'morning', n: 1 }, { kind: 'key_offschedule', n: 0 }, { kind: 'morning', n: 2 }, { kind: 'bogus', n: 9 }], url);
  assert.equal(d, '🧠 오늘의 두뇌 산책\n· 아침 리포트가 올라왔어요 · 주의 신호 2건\n· 루틴 키가 예정에 없던 시각에 쓰였어요. 루틴 상태를 확인해 주세요\nhttps://x.example/');
});
