/**
 * AI backend against the Functions + Firestore emulators (run through tests/ai-run-emu.mjs).
 *
 *  A. endpoints: 503 while no key hash is configured, 401 wrong key, 200 right key, 400 shape, 405 method,
 *     413 size, 429 per-hour submit cap, key never in any response; config change cuts access without redeploy
 *  B. pipeline: items via aiSubmit → aiOnInbox validator → aiBank / aiRejects / aiPacks
 *     → fake item logs (12 weeks, a clear decline) → aggregate → signals → wake (mock fire API)
 *     → reporter reads the job via aiRead → report via aiSubmit → validated report stored → Telegram (mock)
 *     → scheduled report → wake failure → template report + rule-only Telegram
 * Prints only check names and counts (the runner scans all output for leaks).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'functions/package.json'));
process.env.GCLOUD_PROJECT = 'demo-bw';
process.env.FUNCTIONS_EMULATOR = 'true';               // in-process parts use the same mock endpoints
const SECRETS = JSON.parse(process.env.AI_TEST_SECRETS);
Object.assign(process.env, SECRETS, { APP_URL: 'https://example.test/brain-walk/', TELEGRAM_API_BASE: `http://127.0.0.1:${process.env.AI_TEST_PORT}/tg` });
const KEY = process.env.AI_TEST_KEY;
const KEY_HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const PORT = Number(process.env.AI_TEST_PORT);
const FN = 'http://127.0.0.1:5001/demo-bw/asia-northeast3';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
initializeApp({ projectId: 'demo-bw' });
const db = getFirestore();
const kd = require('./ai/core/kdate.js');
const { good, clone } = require('./test/fixtures/items.js');
const { templateReport } = require('./ai/core/template.js');
const { checkReport } = require('./ai/core/report.js');

let pass = 0, fail = 0;
const bodies = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, String(e && e.message).slice(0, 200)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(250); } }

// ------------------------------------------------------------ mock server
const fires = [], tgs = []; let fireStatus = 200;
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
    if (req.url === '/fire') { fires.push({ headers: req.headers, body: JSON.parse(b) }); res.writeHead(fireStatus, { 'Content-Type': 'application/json' }); res.end(fireStatus === 200 ? '{"type":"routine_fire","claude_code_session_url":"https://claude.ai/code/x"}' : '{"error":"x"}'); return; }
    if (req.url.startsWith('/tg/bot')) { tgs.push({ tokenOk: req.url === `/tg/bot${SECRETS.TELEGRAM_BOT_TOKEN}/sendMessage`, body: JSON.parse(b) }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

async function call(fnName, { method = 'GET', query = '', key = KEY, body, rawBody, headers = {} } = {}) {
  const h = { ...headers };
  if (key != null) h.Authorization = `Bearer ${key}`;
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${FN}/${fnName}${query}`, { method, headers: h, body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); bodies.push(text);
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const setConfig = async (cfg) => { await db.doc('aiConfig/main').set(cfg); await sleep(1300); };   // emulator cache TTL is 1 s
const FID = 'famAI';

// =============================================================== A. endpoints
await t('A1 aiRead answers 503 while no key hash is configured', async () => { const r = await call('aiRead', { query: '?doc=current' }); assert(r.status === 503, r.status); });
await t('A2 aiSubmit answers 503 while no key hash is configured', async () => { const r = await call('aiSubmit', { method: 'POST', body: {} }); assert(r.status === 503, r.status); });
await setConfig({ familyId: FID, pseudonym: '사용자 A', enabled: true, routineKeyHash: 'abc' });
await t('A3 a hash shorter than 16 chars is treated as not configured (503)', async () => { assert((await call('aiRead', { query: '?doc=current' })).status === 503); });
await setConfig({ familyId: FID, pseudonym: '사용자 A', enabled: true, routineKeyHash: KEY_HASH });
await db.doc('aiAggregates/current').set({ schema: 'bw.agg.v1', id: 'a-seed', mode: 'daily', numbers: {}, expireAt: Timestamp.fromMillis(Date.now() + 864e5) });
await t('A4 wrong key → 401', async () => { const r = await call('aiRead', { query: '?doc=current', key: KEY.slice(0, -1) + (KEY.endsWith('A') ? 'B' : 'A') }); assert(r.status === 401, r.status); });
await t('A5 missing Authorization → 401', async () => { assert((await call('aiRead', { query: '?doc=current', key: null })).status === 401); });
await t('A6 right key → 200 with the aggregate (no expireAt)', async () => { const r = await call('aiRead', { query: '?doc=current' }); assert(r.status === 200 && r.json.doc.id === 'a-seed' && !('expireAt' in r.json.doc), r.status); });
await t('A7 X-Routine-Key header also works', async () => { assert((await call('aiRead', { query: '?doc=current', key: null, headers: { 'X-Routine-Key': KEY } })).status === 200); });
await t('A8 unknown doc → 400', async () => { assert((await call('aiRead', { query: '?doc=aiConfig' })).status === 400); });
await t('A9 extra query parameter → 400', async () => { assert((await call('aiRead', { query: '?doc=current&x=1' })).status === 400); });
await t('A10 malformed job id → 400', async () => { assert((await call('aiRead', { query: '?doc=job&job=../aiConfig/main' })).status === 400); });
await t('A11 missing job → 404', async () => { assert((await call('aiRead', { query: '?doc=job&job=w-20270101-0101-zz' })).status === 404); });
await t('A12 bankNeeds not built yet → 404', async () => { assert((await call('aiRead', { query: '?doc=bankNeeds' })).status === 404); });
await t('A13 POST to aiRead → 405, GET to aiSubmit → 405', async () => { assert((await call('aiRead', { method: 'POST', body: {} })).status === 405); assert((await call('aiSubmit')).status === 405); });
await t('A14 body over 512 KB → 413', async () => {
  const big = JSON.stringify({ kind: 'items', runId: '20270101-0330', payload: { schema: 'bw.items.v1', runId: '20270101-0330', items: [{ pad: 'x'.repeat(600 * 1024) }] } });
  assert((await call('aiSubmit', { method: 'POST', rawBody: big })).status === 413);
});
await t('A15 shape errors → 400 (kind, runId, extra keys, report without jobId, invalid JSON)', async () => {
  for (const b of [{ kind: 'x', runId: '20270101-0330', payload: {} }, { kind: 'items', runId: 'now', payload: { schema: 'bw.items.v1', items: [{}] } }, { kind: 'items', runId: '20270101-0330', payload: { schema: 'bw.items.v1', items: [{}] }, evil: 1 }, { kind: 'report', runId: '20270101-0730', payload: { schema: 'bw.report.v1' } }]) assert((await call('aiSubmit', { method: 'POST', body: b })).status === 400, JSON.stringify(Object.keys(b)));
  assert((await call('aiSubmit', { method: 'POST', rawBody: '{"kind":' })).status === 400);
});
await t('A16 disabling AI in aiConfig closes the endpoints (503) without a redeploy', async () => {
  await setConfig({ familyId: FID, pseudonym: '사용자 A', enabled: false, routineKeyHash: KEY_HASH });
  assert((await call('aiRead', { query: '?doc=current' })).status === 503);
  await setConfig({ familyId: FID, pseudonym: '사용자 A', enabled: true, routineKeyHash: KEY_HASH });
  assert((await call('aiRead', { query: '?doc=current' })).status === 200);
});

// ======================================================= B. pipeline (family)
const today = kd.kst().date;
const ackMs = Date.now() - 86 * 864e5;
{
  const f = db.doc(`families/${FID}`);
  await f.set({ createdBy: 'uO', createdTs: Timestamp.now(), ownerMemberId: 'o', joinCode: 'AIA234', name: '시험가족' });
  await f.collection('members').doc('o').set({ name: '시험아들', role: 'family', joinedTs: Timestamp.now() });
  await f.collection('members').doc('t').set({ name: '시험아버지', role: 'trainee', joinedTs: Timestamp.now() });
  await f.collection('state').doc('trainee').set({ userId: 't', displayLabel: '아버지' });
  await f.collection('consents').doc('t').set({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: Timestamp.fromMillis(ackMs) });
  await f.collection('aiState').doc('themes').set({ words: ['낚시', '등산'], updatedBy: 'o', updatedTs: Date.now() });
}

await t('B1 items via aiSubmit are validated by the aiInbox trigger (accepted → bank, bad → rejects)', async () => {
  const bad = clone(good.shop_calc); bad.tempId = 'g-20270101-0330-0999'; bad.choices[0].t = '9,300원'; bad.qa.solve1 = bad.qa.solve2 = '9,300원';
  const items = Object.values(good).map(clone); items.push(bad);
  const ref = await call('aiSubmit', { method: 'POST', body: { kind: 'items', runId: '20270101-0330', payload: { schema: 'bw.items.v1', runId: '20270101-0330', items } } });
  assert(ref.status === 200 && ref.json.id, ref.status);
  const done = await waitFor(async () => { const s = await db.doc(`aiInbox/${ref.json.id}`).get(); return s.get('status') === 'done' ? s.data() : null; }, 60000);
  assert(done.result.accepted === Object.keys(good).length, `accepted ${done.result.accepted}`);
  assert(done.result.rejected === 1 && done.result.codes.recompute === 1, JSON.stringify(done.result.codes));
  const bank = await db.collection('aiBank').get(); assert(bank.size === Object.keys(good).length);
  assert(bank.docs.some((d) => d.get('status') === 'pending_review'), 'reminiscence waits for review');
  const rej = await db.collection('aiRejects').get(); assert(rej.size === 1 && rej.docs[0].get('codes').includes('recompute'));
  const packs = await db.collection(`families/${FID}/aiPacks`).get(); assert(packs.size >= 25, `packs ${packs.size}`);
  const mem = JSON.parse((await db.doc(`families/${FID}/aiPacks/memory-L2`).get()).get('itemsJson'));
  assert(mem.some((x) => x.format === 'card_theme'), 'card_theme in memory-L2');
  assert(mem.every((x) => !('qa' in x) && !('hash' in x) && !('sketch' in x) && !('json' in x)), 'pack items carry no qa/hash');
  const vis = JSON.parse((await db.doc(`families/${FID}/aiPacks/visuospatial-L3`).get()).get('itemsJson'));
  assert(vis.length === 0, 'reference items are not in training packs');
  const g = (await db.collection('aiBank').where('format', '==', 'grid_rotate').get()).docs[0];
  assert(JSON.parse(g.get('json')).options.every((o) => Array.isArray(o.grid)), 'server-built grids stored');
  const needs = await call('aiRead', { query: '?doc=bankNeeds' }); assert(needs.status === 200 && needs.json.doc.schema === 'bw.needs.v1' && needs.json.doc.themes.join() === '낚시,등산');
  assert(!JSON.stringify(needs.json.doc).includes('famAI'), 'no family id in bankNeeds');
});
await t('B2 per-hour submit cap: the 21st inbox write in an hour → 429', async () => {
  const hour = Math.floor(Date.now() / 3600e3);
  await db.doc(`aiRate/submit-h${hour}`).set({ n: 19 }, { merge: true });
  const p = { kind: 'items', runId: '20270101-0331', payload: { schema: 'bw.items.v1', runId: '20270101-0331', items: [{ schema: 'x' }] } };
  assert((await call('aiSubmit', { method: 'POST', body: p })).status === 200, '20th ok');
  assert((await call('aiSubmit', { method: 'POST', body: p })).status === 429, '21st limited');
  await db.doc(`aiRate/submit-h${hour}`).set({ n: 0 }, { merge: true });
});

// fake item logs: 12+ weeks since the program start, a clear decline in the last weeks
const ackDate = kd.kst(ackMs).date;
const startDate = kd.weekday(ackDate) === 0 ? ackDate : kd.addDays(kd.sundayOf(ackDate), 7);
const curWk = kd.weekKey(today);
const nWeeks = kd.weeksBetween(kd.weekKey(startDate), curWk);
const DOMS = ['memory', 'attention', 'executive', 'language', 'visuospatial'];
let logs = 0;
for (let w = 0; w < nWeeks; w++) {
  const p = w >= nWeeks - 4 ? 0.45 : 0.8;
  for (let d = 0; d < 6; d++) {
    const date = kd.addDays(startDate, 7 * w + d);
    const items = [];
    for (let i = 0; i < 5; i++) {
      const k = d * 5 + i, ok = (k * 7919 % 100) / 100 < p;
      items.push({ id: `ref-${w}-${k}`, role: 'reference', fmt: ['word_recog', 'letter_search', 'shop_calc', 'lang_category', 'grid_rotate'][i], cd: DOMS[i], lv: 3, score: ok ? 1 : 0, ok, rt: Math.round(5000 * (w >= nWeeks - 4 ? 1.25 : 1) * (0.85 + ((k * 31) % 30) / 100)), err: ok ? [] : ['MISS'], pick: [0], intr: false, pos: i });
    }
    items.push({ id: `tr-${w}-${d}`, role: 'training', fmt: 'word_find', cd: 'language', lv: 3, score: 1, ok: true, rt: 4000, err: [], pick: [0], intr: false, pos: 6 });
    await db.collection(`families/${FID}/itemLogs`).doc(`s-${w}-${d}`).set({ v: 1, userId: 't', date, ts: Date.parse(date + 'T10:00:00+09:00'), sts: Timestamp.now(), gameId: 'words', inCourse: true, level: 3, speechOn: true, size: 'xlarge', device: 'android', hour: 10, abandoned: false, items });
    logs++;
  }
}
console.log(`seeded ${logs} item logs over ${nWeeks} weeks`);

const nowMs = Date.parse(`${today}T14:10:00+09:00`);
const { afterCourse } = require('./ai/course.js');
let course = null;
await t('B3 course done → aggregate + signals → new orange → one wake of the reporter routine', async () => {
  course = await afterCourse(FID, nowMs);
  assert(course.ran, 'pipeline ran');
  assert(course.newOrange.length >= 1, `new orange ${course.newOrange.length}`);
  assert(course.wake && course.wake.action === 'wake' && course.wake.ok, JSON.stringify(course.wake && course.wake.action));
  assert(fires.length === 1, `fires ${fires.length}`);
  const f = fires[0];
  assert(f.headers.authorization === `Bearer ${SECRETS.ROUTINE_REPORTER_TOKEN}` && f.headers['anthropic-version'] === '2023-06-01', 'fire headers');
  const text = JSON.parse(f.body.text);
  assert(text.v === 1 && /^w-\d{8}-\d{4}-[a-z0-9]{2}$/.test(text.job) && text.rules.length && Object.keys(text).join() === 'v,job,rules,why', 'fire text = codes only');
  const sig = await db.collection(`families/${FID}/aiSignals`).where('on', '==', true).get();
  assert(sig.docs.some((d) => d.get('level') === 'orange'));
  const cur = await call('aiRead', { query: '?doc=current' });
  assert(cur.json.doc.schema === 'bw.agg.v1' && cur.json.doc.subject === '사용자 A' && cur.json.doc.phase === 'monitoring');
  const s = JSON.stringify(cur.json.doc);
  for (const bad of ['famAI', '시험아버지', '시험아들', '시험가족', 'ref-']) assert(!s.includes(bad), 'aggregate leaks ' + bad);
});
await t('B4 same signal again the same day → no second wake (still on / cooldown)', async () => {
  await db.doc(`families/${FID}/aiOps/health`).set({ lastProgressRunMs: 0 }, { merge: true });
  const r = await afterCourse(FID, nowMs + 20 * 60e3);
  assert(r.ran && r.newOrange.length === 0 && fires.length === 1, `fires ${fires.length}`);
});
let job = null;
await t('B5 reporter reads the job + its alert aggregate through aiRead', async () => {
  const id = JSON.parse(fires[0].body.text).job;
  const r = await call('aiRead', { query: `?doc=job&job=${id}` });
  assert(r.status === 200 && r.json.doc.job.job === id && r.json.doc.aggregate.mode === 'alert', r.status);
  job = r.json.doc;
});
await t('B6 report via aiSubmit → validated, filled and stored for admins → Telegram (mock) without health data', async () => {
  const agg = job.aggregate;
  const rep = templateReport(agg, job.job.job);
  rep.headline = '반응과 정답에 살펴볼 변화가 있어요. 아래 설명을 확인해 주세요.';
  assert(checkReport(rep, agg, { jobId: job.job.job }).ok, 'local check (bw-io check) passes');
  const tg0 = tgs.length;
  const r = await call('aiSubmit', { method: 'POST', body: { kind: 'report', runId: `${today.replace(/-/g, '')}-1415`, jobId: job.job.job, payload: rep } });
  assert(r.status === 200, `submit ${r.status}`);
  const stored = await waitFor(async () => { const s = await db.doc(`families/${FID}/aiReports/r-${agg.id}`).get(); return s.exists ? s.data() : null; }, 60000);
  assert(stored.generatedBy === 'routine' && stored.kind === 'alert' && stored.report.headline === rep.headline, stored.generatedBy);
  assert(!JSON.stringify(stored.report).includes('{{'), 'placeholders filled');
  assert(stored.lights.composite === agg.domains.find((d) => d.domain === 'composite').light, 'lights copied from the server');
  await waitFor(async () => (await db.doc(`aiJobs/${job.job.job}`).get()).get('status') === 'reported', 20000);
  const h = kd.kst().hour;
  if (h >= 2 && h < 8) {   // the real clock is in the 02:00–08:00 hold window: the function queued it instead
    const q = await waitFor(async () => { const s = await db.collection('tgOutbox').where('kind', '==', 'alert').get(); return s.empty ? null : s.docs[0]; }, 20000);
    assert(q.get('n') >= 1 && tgs.length === tg0, 'queued, not sent');
    await require('./ai/telegram.js').flushOutbox(Date.parse(`${today}T08:00:00+09:00`));
  }
  await waitFor(() => tgs.length > tg0, 20000);
  const m = tgs[tgs.length - 1];
  assert(m.tokenOk && m.body.chat_id === '4242', 'bot token + chat id from secrets');
  assert(/^🧠 오늘의 두뇌 산책\n살펴볼 변화 설명이 올라왔어요 · 주의 신호 \d+건\nhttps:\/\/example\.test\/brain-walk\/$/.test(m.body.text), 'fixed text only');
});
await t('B7 a report with a digit outside placeholders is rejected and replaced by the template', async () => {
  const cur = (await call('aiRead', { query: '?doc=current' })).json.doc;
  const rep = templateReport(cur, 'scheduled'); rep.summary[0] = '정답률이 45%로 관찰 중이에요.';
  const r = await call('aiSubmit', { method: 'POST', body: { kind: 'report', runId: `${today.replace(/-/g, '')}-0731`, jobId: 'scheduled', payload: rep } });
  const inbox = await waitFor(async () => { const s = await db.doc(`aiInbox/${r.json.id}`).get(); return s.get('status') === 'done' ? s.data() : null; }, 60000);
  assert(inbox.result.ok === false && inbox.result.codes.includes('digits'), JSON.stringify(inbox.result));
  const stored = await db.doc(`families/${FID}/aiReports/r-${cur.id}`).get();
  assert(stored.get('generatedBy') === 'template' && stored.get('rejectCodes').includes('digits'));
});
await t('B8 wake failure → no retry, template alert report + rule-only Telegram', async () => {
  fireStatus = 500;
  const { maybeWake } = require('./ai/waker.js');
  const { storeTemplate, announce } = require('./ai/reports.js');
  const alertId = course.agg.id + '-al';
  const alertAgg = (await db.doc(`aiAggregates/${alertId}`).get()).data();
  const before = fires.length, tg0 = tgs.length;
  const w = await maybeWake(FID, {
    newOrange: [{ key: 'S5:anchor', rule: 'S5', why: ['anchor_rci_orange'] }], aggregateId: alertId, nowMs: nowMs + 3600e3,
    onFailure: async (jobId) => { await storeTemplate(FID, { ...alertAgg, id: alertId + '-f' }, { jobId, rejectCodes: ['wake_failed'] }); await announce(FID, 'rule_only', alertAgg, nowMs + 3600e3); },
  });
  assert(w.action === 'wake' && w.ok === false && fires.length === before + 1, `exactly one attempt (${w.action})`);
  const j = await db.doc(`aiJobs/${w.job}`).get(); assert(j.get('status') === 'failed');
  const rep = await db.doc(`families/${FID}/aiReports/r-${alertId}-f`).get(); assert(rep.get('generatedBy') === 'template');
  assert(tgs.length === tg0 + 1 && tgs[tgs.length - 1].body.text.includes('주의 신호가 있어요'), 'rule-only Telegram');
  fireStatus = 200;
});
await t('B9 third wake on the same day is capped (left for the morning report)', async () => {
  const { maybeWake } = require('./ai/waker.js');
  const r = await maybeWake(FID, { newOrange: [{ key: 'S2:memory', rule: 'S2', why: ['x'] }], aggregateId: 'a-x', nowMs: nowMs + 2 * 3600e3 });
  assert(r.action === 'cap', r.action);
  const q = await maybeWake(FID, { newOrange: [{ key: 'S2:language', rule: 'S2', why: ['x'] }], aggregateId: 'a-x', nowMs: Date.parse(`${today}T21:30:00+09:00`) });
  assert(q.action === 'quiet', q.action);
});
await t('B10 measure packs, bank status and admin-only ops docs exist; no key anywhere in Firestore ops', async () => {
  const { runFamily } = require('./ai/pipeline.js');
  await runFamily(FID, { mode: 'daily', reason: 'test', nowMs, daily: true });
  const m = await db.collection(`families/${FID}/aiPacks`).where('week', '==', curWk).get();
  assert(m.size === 1, 'measure pack for this week');
  const bank = await db.doc(`families/${FID}/aiOps/bank`).get(); assert(bank.exists && bank.get('total') > 0);
  const ops = JSON.stringify((await db.collection(`families/${FID}/aiOps`).get()).docs.map((d) => d.data()));
  assert(!ops.includes(KEY) && !ops.includes(KEY_HASH));
});
await t('B11 retention purge keeps fresh data and removes expired inbox docs', async () => {
  await db.collection('aiInbox').doc('old').set({ status: 'done', expireAt: Timestamp.fromMillis(Date.now() - 1000) });
  const { purge } = require('./ai/purge.js');
  const r = await purge();
  assert(r.aiInbox >= 1 && !(await db.doc('aiInbox/old').get()).exists);
  assert((await db.collection(`families/${FID}/itemLogs`).limit(1).get()).size === 1);
});
await t('B12 Telegram gate: nothing sent 02:00–08:00 KST; queued messages go out as ONE de-duplicated digest at 08:00', async () => {
  const { sendTelegram, flushOutbox } = require('./ai/telegram.js');
  const { announce } = require('./ai/reports.js');
  const at = (hhmm) => Date.parse(`${today}T${hhmm}:00+09:00`);
  for (const d of (await db.collection('tgOutbox').get()).docs) await d.ref.delete();
  const tg0 = tgs.length;
  assert(await sendTelegram('key_offschedule', 0, at('03:10')) === 'queued');
  assert(await sendTelegram('key_offschedule', 0, at('04:00')) === 'queued');
  assert(await sendTelegram('rule_only', 1, at('05:00')) === 'queued', 'even alerts wait');
  const cur = (await db.doc('aiAggregates/current').get()).data();
  assert(await announce(FID, 'morning', cur, at('07:41')) === 'queued', 'morning report notice waits for 08:00');
  assert(tgs.length === tg0, 'nothing sent in the hold window');
  assert((await flushOutbox(at('07:59'))).held, 'flush does nothing before 08:00');
  const f = await flushOutbox(at('08:00'));
  assert(f.sent === 1 && f.merged === 4 && tgs.length === tg0 + 1, JSON.stringify(f));
  const text = tgs[tgs.length - 1].body.text;
  assert(text.split('루틴 키가').length === 2 && text.includes('· 아침 리포트가 올라왔어요') && text.includes('· 주의 신호가 있어요'), 'one line per kind');
  assert((await db.collection('tgOutbox').get()).empty, 'outbox emptied');
  assert(await sendTelegram('rule_only', 1, at('08:30')) === 'sent', 'after 08:00 alerts go straight out');
});
await t('B12a 08:00: aiTgFlush and aiTick flushing at the same moment send ONE digest; a failing digest is dropped after 3 tries', async () => {
  const { sendTelegram, flushOutbox } = require('./ai/telegram.js');
  const at = (hhmm) => Date.parse(`${today}T${hhmm}:00+09:00`);
  for (const d of (await db.collection('tgOutbox').get()).docs) await d.ref.delete();
  await sendTelegram('key_offschedule', 0, at('03:10'));
  const tg0 = tgs.length;
  const rs = await Promise.all([flushOutbox(at('08:00')), flushOutbox(at('08:00')), flushOutbox(at('08:00'))]);
  assert(tgs.length === tg0 + 1, `digests sent: ${tgs.length - tg0}`);
  assert(rs.filter((r) => r.sent === 1).length === 1, JSON.stringify(rs));
  // a queued entry that already failed 3 times is dropped without sending
  await db.collection('tgOutbox').add({ kind: 'test', n: 0, status: 'queued', tries: 3, expireAt: Timestamp.fromMillis(Date.now() + 864e5) });
  const r = await flushOutbox(at('08:10'));
  assert(r.sent === 0 && r.dropped === 1 && tgs.length === tg0 + 1 && (await db.collection('tgOutbox').get()).empty, JSON.stringify(r));
});
await t('B12b tick: no report by 08:30 → template + "간단판" Telegram; tick also flushes a leftover outbox', async () => {
  const { tick } = require('./ai/tick.js');
  await db.doc(`families/${FID}/aiOps/health`).set({ morningDone: null }, { merge: true });
  const cur = (await db.doc('aiAggregates/current').get()).data();
  await db.doc(`families/${FID}/aiReports/r-${cur.id}`).delete();
  const tg0 = tgs.length;
  await tick(Date.parse(`${today}T08:40:00+09:00`));
  const rep = await db.doc(`families/${FID}/aiReports/r-${cur.id}`).get();
  assert(rep.exists && rep.get('generatedBy') === 'template', 'template report');
  assert(tgs.slice(tg0).some((m) => m.body.text.includes('간단판')), 'template Telegram');
});
await t('B13 deleting the family: the purge removes every leftover AI doc under it and its aggregates', async () => {
  await db.doc(`families/${FID}`).delete();
  const { purge } = require('./ai/purge.js');
  const r = await purge();
  assert(r.orphanFamily === 1);
  for (const c of ['aiReports', 'aiStats', 'aiSignals', 'aiOps', 'aiPacks', 'itemLogs', 'aiState']) assert((await db.collection(`families/${FID}/${c}`).limit(1).get()).empty, c);
  assert((await db.collection('aiAggregates').limit(1).get()).empty && (await db.collection('aiJobs').limit(1).get()).empty);
});
await t('C1 no response body ever contained the routine key or its hash', async () => {
  assert(bodies.length > 20); assert(!bodies.some((b) => b.includes(KEY) || b.includes(KEY_HASH)));
});
await t('C2 after 10 wrong keys from one IP in an hour, requests get 429 (cheap per-IP limit)', async () => {
  let saw429 = false;
  for (let i = 0; i < 12; i++) { const r = await call('aiRead', { query: '?doc=current', key: 'x'.repeat(48) }); if (r.status === 429) { saw429 = true; break; } }
  assert(saw429);
});

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (!fail) console.log('AI EMULATOR: ALL PASSED');
process.exit(fail ? 1 : 0);
