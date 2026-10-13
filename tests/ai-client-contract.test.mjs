/**
 * App ↔ deployed AI backend contract, against the Functions + Firestore emulators (run by tests/ai-run-emu.mjs after
 * ai-emulator.test.mjs). Shape mismatches fail silently by design (the server sanitizes and drops), so this test writes
 * the EXACT objects the app builds — the same pure builders the app calls (js/ai/itemlog-doc.js, consent-doc.js,
 * admin-docs.js) — through the app's real FirebaseAdapter (which turns the '$TS'/'$DEL' marks into serverTimestamp()/
 * deleteField()), under the real firestore.rules, and then checks what the deployed functions did with them:
 *
 *  C1 itemLogs: rules accept every log the app builds (bank training/reference/anchor items, story #qN questions with
 *     DELAY_LOSS, code-made items, speed 'proc' items, abandoned games, the 🌼 prospective log, a 25-item game split in
 *     two docs); aiOnItemLog records the exposures (nothing dropped); the server's own sanitizeLog/weekStats keep every
 *     item, role and error code.
 *  C2 consents: create (server time) → eligibility ok → withdraw → no_consent → re-acknowledge (withdrawnTs removed) → ok.
 *  C3 aiNotes (admin only, null `to`, free text), C4 aiReview → aiOnReview result, C5 aiState/themes and switch.
 * Prints only check names (the runner scans all output for leaks).
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFn = createRequire(path.join(root, 'functions/package.json'));
process.env.GCLOUD_PROJECT = 'demo-bw';

// ---- server side (admin SDK, emulator) and the server's own pure code
const { initializeApp, getApps } = requireFn('firebase-admin/app');
const { getFirestore, Timestamp } = requireFn('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'demo-bw' });
const adb = getFirestore();
const SR = requireFn('./ai/core/series.js');
const { eligibility, validThemes } = requireFn('./ai/pipeline.js');

// ---- client side: the app's own modules (node stand-ins for the browser globals they touch)
const mem = new Map();
globalThis.self = globalThis;
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const F = await import('firebase/firestore');
const fs = await import('node:fs');
const { FirebaseAdapter } = await import('../js/store/firebase-adapter.js');
const { entryOf, logDocs, codeItemId, codeRole } = await import('../js/ai/itemlog-doc.js');
const { consentWrite, withdrawPatch, consentState, CONSENT_KIND, adminConsentWrite, adminWithdrawPatch } = await import('../js/ai/consent-doc.js');
const { noteDoc, noteId, reviewDoc, themesDoc, switchDoc } = await import('../js/ai/admin-docs.js');

const env = await initializeTestEnvironment({ projectId: 'demo-bw', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, String(e && (e.code || e.message)).slice(0, 160)); } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(250); } }
const denied = async (p) => { try { await p; return false; } catch (e) { return e && e.code === 'permission-denied'; } };

const FID = 'famCC';
const P = `families/${FID}`;
// one app adapter per person: the real FirebaseAdapter code over an authenticated emulator connection
const adapter = (uid, mid) => Object.assign(Object.create(FirebaseAdapter), { sdk: { F, db: env.authenticatedContext(uid).firestore() }, fid: FID, mid });
const T = adapter('uT', 't'), A = adapter('uA', 'a'), O = adapter('uO', 'o'), Fm = adapter('uF', 'f');

// ------------------------------------------------------------------ seed (server side)
const hex = (n) => n.toString(16).padStart(20, '0');
const BK = { train: 'bk_' + hex(1), ref: 'bk_' + hex(2), anchor: 'bk_' + hex(3), story: 'bk_' + hex(4), pend: 'bk_' + hex(5), cardT: 'bk_' + hex(6) };
{
  const b = adb.batch();
  b.set(adb.doc(`families/${FID}`), { createdBy: 'uO', ownerMemberId: 'o', admins: ['a'], joinCode: 'CCC234' });
  for (const [uid, mid, role] of [['uO', 'o', 'family'], ['uA', 'a', 'family'], ['uF', 'f', 'family'], ['uT', 't', 'trainee']]) {
    b.set(adb.doc(`${P}/uids/${uid}`), { memberId: mid, via: 'join' });
    b.set(adb.doc(`${P}/members/${mid}`), { name: 'm-' + mid, role });
  }
  b.set(adb.doc(`${P}/state/trainee`), { userId: 't', displayLabel: 'x' });
  const bank = (id, o) => b.set(adb.doc(`aiBank/${id}`), Object.assign({ id, json: '{}', exposures: [], nExp: 0, level: 3 }, o));
  bank(BK.train, { status: 'ready', role: 'training', cdomain: 'memory', format: 'word_recog' });
  bank(BK.ref, { status: 'reserved', role: 'reference', cdomain: 'executive', format: 'shop_calc', refWeek: '2099-W01' });
  bank(BK.anchor, { status: 'frozen', role: 'anchor_candidate', cdomain: 'attention', format: 'letter_search', anchorSet: 'A' });
  bank(BK.story, { status: 'reserved', role: 'reference', cdomain: 'memory', format: 'story_recall', refWeek: '2099-W01' });
  bank(BK.pend, { status: 'pending_review', role: 'training', cdomain: 'reminiscence', format: 'reminiscence', level: 2 });
  bank(BK.cardT, { status: 'ready', role: 'training', cdomain: 'memory', format: 'card_theme' });
  b.set(adb.doc('aiConfig/main'), { familyId: FID, pseudonym: '사용자 C', enabled: true, routineKeyHash: 'f'.repeat(64) });
  await b.commit();
  await sleep(1500);            // function config cache (AI_CONFIG_TTL_SEC=1)
}

// ===================================================================== C1. itemLogs
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const env0 = { uid: 't', speechOn: true, size: 'xlarge', device: 'android', now: new Date() };
const sess = (g, o = {}) => Object.assign({ g: { id: g }, date: today, level: 3, inCourse: true, hour: 10 }, o);
// entries exactly as js/ui/screens/game.js (logItem) and js/games/items.js build them
const bankE = (id, role, fmt, cd, o) => entryOf(Object.assign({ id, role, fmt, cd, lv: 3, rt: 4200, rtStart: 'speech_end', intr: false }, o));
const codeE = (g, cd, pos, o) => entryOf(Object.assign({ id: codeItemId(g, 3, pos), role: codeRole(g), fmt: g, cd, lv: 3, rt: 2500, rtStart: 'display', intr: false, pos }, o));
const LOGS = [
  // 단어 기억하기 한 판: 훈련 문항(오답: 고른 오답의 err + MISS), 둘째 자리에 끼운 기준 문항, 코드 문항
  { sid: 'cc-words-1', s: sess('words'), items: [
    bankE(BK.train, 'training', 'word_recog', 'memory', { score: 0.667, ok: false, err: ['INTR_SEM', 'MISS'], pick: [0, 2, 5], pos: 0 }),
    bankE(BK.ref, 'reference', 'shop_calc', 'executive', { score: 0, ok: false, err: ['CALC_NOQTY'], pick: [0], pos: 1 }),
    codeE('words', 'memory', 2, { score: 1, ok: true, err: [], pick: [1, 3, 4] })] },
  // 다른 그림 찾기(속도 과제): 앵커 문항 + proc
  { sid: 'cc-odd-1', s: sess('odd'), items: [
    codeE('odd', 'attention', 0, { score: 1, ok: true, pick: [7] }),
    bankE(BK.anchor, 'anchor', 'letter_search', 'attention', { score: 1, ok: true, err: [], pick: [2], pos: 1 })] },
  // 이야기: 바로 묻는 질문 두 개 (bk_…#q0, #q1)
  { sid: 'cc-story-1', s: sess('story'), items: [
    bankE(BK.story + '#q0', 'reference', 'story_recall', 'memory', { score: 1, ok: true, pick: [0], pos: 0 }),
    bankE(BK.story + '#q1', 'reference', 'story_recall', 'memory', { score: 1, ok: true, pick: [1], pos: 0 })] },
  // 코스 끝 늦게 묻는 질문: 바로는 맞히고 나중에 틀림 → DELAY_LOSS (finishSession: logGameId 'story')
  { sid: 'cc-del-d', s: sess('delayedq', { logGameId: 'story', logInCourse: true }), items: [
    bankE(BK.story + '#q2', 'reference', 'story_recall', 'memory', { score: 0, ok: false, err: ['INTR_SEM', 'DELAY_LOSS'], pick: [0], pos: 0 })] },
  // 중간에 그만둔 판 (flushItemLog abandoned): 마지막 문항에 ABANDON
  { sid: 'cc-shop-ab', abandoned: true, s: sess('shop'), items: [
    codeE('shop', 'executive', 0, { score: 1, ok: true, pick: [2] }), codeE('shop', 'executive', 1, { score: 0, ok: false, err: ['ABANDON'] })] },
  // 🌼 잊지 말고 누르기 (pm.js finalize): 코스당 문서 하나
  { sid: 'pm-cc-1', s: { g: { id: 'prospective' }, level: 2, inCourse: true, date: today }, items: [
    entryOf({ id: 'bk_' + hex(7), role: 'training', fmt: 'prospective', cd: 'memory', lv: 2, score: 0, ok: false, err: ['PM_MISS', 'PM_WRONG_CUE'], pick: [] })] },
  // 카드 짝 맞추기(card_theme 은행 그림) + 문항이 25개인 판은 문서 두 개로
  { sid: 'cc-trail-25', s: sess('trail'), items: Array.from({ length: 25 }, (_, i) => codeE('trail', 'attention', i, { score: 1, ok: true })) },
  { sid: 'cc-cards-1', s: sess('cards'), items: [bankE(BK.cardT, 'training', 'card_theme', 'memory', { score: 0.75, ok: false, pick: [], pos: 1 })] },
];
const built = LOGS.flatMap((L) => logDocs(Object.assign({}, env0, { s: L.s, items: L.items, abandoned: !!L.abandoned, sid: L.sid })));

await t('C1.0 app builds 25 items into two docs (sid, sid-1) of 20 + 5', async () => {
  const d = built.filter((x) => x.id.startsWith('cc-trail-25'));
  assert(d.length === 2 && d[0].id === 'cc-trail-25' && d[1].id === 'cc-trail-25-1' && d[0].data.items.length === 20 && d[1].data.items.length === 5);
});
await t('C1.0 code-made items: speed games proc, others training (contract role table)', async () => {
  assert(codeRole('trail') === 'proc' && codeRole('odd') === 'proc' && codeRole('flash') === 'proc' && codeRole('shop') === 'training' && codeRole('words') === 'training');
});
for (const d of built) {
  await t(`C1.1 rules accept the app-built item log ${d.id} (written by the trainee device through FirebaseAdapter)`, async () => { await T.setDoc('itemLogs/' + d.id, d.data); });
}
await t('C1.2 the same doc from a non-trainee device is denied (admin / family)', async () => {
  const d = built[0];
  assert(await denied(A.setDoc('itemLogs/cc-x1', Object.assign({}, d.data, { userId: 'a' }))) && await denied(Fm.setDoc('itemLogs/cc-x2', Object.assign({}, d.data, { userId: 'f' }))));
});
await t('C1.3 stored sts is a server timestamp', async () => { const s = await adb.doc(`${P}/itemLogs/cc-words-1`).get(); assert(s.get('sts') instanceof Timestamp); });

await t('C1.4 aiOnItemLog processed the logs: training exposure recorded with the picked options, status used', async () => {
  const d = await waitFor(async () => { const s = await adb.doc(`aiBank/${BK.train}`).get(); return s.get('nExp') >= 1 ? s.data() : null; });
  const e = d.exposures[0];
  assert(d.status === 'used' && e.role === 'training' && e.ok === false && JSON.stringify(e.pick) === '[0,2,5]' && e.rt === 4200 && e.date === today, JSON.stringify({ st: d.status, e }));
});
await t('C1.5 reference item exposure recorded (reserved → used)', async () => {
  const d = await waitFor(async () => { const s = await adb.doc(`aiBank/${BK.ref}`).get(); return s.get('nExp') >= 1 ? s.data() : null; });
  assert(d.status === 'used' && d.exposures[0].role === 'reference');
});
await t('C1.6 anchor item exposure recorded and the item stays frozen (reused in 12 weeks)', async () => {
  const d = await waitFor(async () => { const s = await adb.doc(`aiBank/${BK.anchor}`).get(); return s.get('nExp') >= 1 ? s.data() : null; });
  assert(d.status === 'frozen' && d.exposures[0].role === 'anchor' && d.exposures[0].ok === true);
});
await t('C1.7 story questions bk_…#qN map back to the bank item (immediate doc and delayed doc both counted)', async () => {
  const d = await waitFor(async () => { const s = await adb.doc(`aiBank/${BK.story}`).get(); return s.get('nExp') >= 2 ? s.data() : null; });
  assert(d.exposures.length === 2 && d.exposures.some((e) => e.ok === true) && d.exposures.some((e) => e.ok === false));
});
await t('C1.8 card_theme content item from the cards game recorded', async () => {
  await waitFor(async () => (await adb.doc(`aiBank/${BK.cardT}`).get()).get('nExp') >= 1);
});

await t('C1.9 server sanitizeLog keeps every doc and every item, role and error code (nothing dropped)', async () => {
  for (const d of built) {
    const s = await adb.doc(`${P}/itemLogs/${d.id}`).get();
    const L = SR.sanitizeLog(s.data(), s.id);
    assert(L, 'doc dropped ' + d.id);
    assert(L.items.length === d.data.items.length, 'items dropped in ' + d.id);
    L.items.forEach((x, i) => {
      const a = d.data.items[i];
      assert(x.role === a.role && x.id === a.id && x.fmt === a.fmt && x.cd === a.cd && x.lv === a.lv && x.score === a.score && x.ok === a.ok, 'field mismatch ' + d.id + '#' + i);
      assert(JSON.stringify(x.err) === JSON.stringify(a.err) && JSON.stringify(x.pick) === JSON.stringify(a.pick), 'err/pick mismatch ' + d.id + '#' + i);
      assert(a.rt == null || (x.rt === a.rt && x.rtStart === a.rtStart), 'rt mismatch ' + d.id + '#' + i);
    });
    assert(L.userId === 't' && L.date === today && L.gameId === d.data.gameId && L.inCourse === d.data.inCourse && L.abandoned === d.data.abandoned && L.size === 'xlarge' && L.device === 'android' && L.speechOn === true && L.hour === d.data.hour, 'top-level mismatch ' + d.id);
  }
});
await t('C1.10 server weekStats counts them: reference answered, anchor rows, DELAY_LOSS, PM, ABANDON excluded, proc speed rows', async () => {
  const s = await adb.collection(`${P}/itemLogs`).where('date', '==', today).get();
  const logs = s.docs.map((d) => SR.sanitizeLog(d.data(), d.id)).filter((x) => x && x.userId === 't');
  const ws = SR.weekStats('2099-W01', logs, {});
  assert(ws.offered === 4 && ws.ref.n === 4 && ws.ref.dom.memory.n === 3 && ws.ref.dom.executive.n === 1, 'ref ' + ws.offered + '/' + ws.ref.n);
  assert(ws.anchorRows.length === 1 && ws.anchorRows[0].ok === true && ws.anchorRows[0].rt === 4200, 'anchorRows');
  assert(ws.err.DELAY_LOSS === 1 && ws.err.PM_MISS === 1 && ws.err.ABANDON === 1 && ws.err.CALC_NOQTY === 1, 'err ' + JSON.stringify(ws.err));
  assert(ws.pm.n === 1 && ws.pm.ok === 0, 'pm');
  assert(ws.rows.filter((r) => r.role === 'proc').length === 26, 'proc rows ' + ws.rows.filter((r) => r.role === 'proc').length);
  assert(ws.train.n === 4 && ws.abandoned === 1 && ws.days[today].inCourse >= 8, 'train ' + ws.train.n);
});

// ===================================================================== C2. consents
await t('C2.1 trainee acknowledges: create with server ackTs (+ withFamily) is accepted', async () => {
  const w = consentWrite(null, true); assert(w.op === 'set');
  await T.setDoc('consents/t', w.data);
  const s = await adb.doc(`${P}/consents/t`).get();
  assert(s.get('kind') === CONSENT_KIND && s.get('ackTs') instanceof Timestamp && s.get('withFamily') === true && consentState(s.data()) === 'ok');
});
await t('C2.2 server eligibility: ok after the acknowledgement', async () => { const e = await eligibility(FID); assert(e.ok === true && e.traineeId === 't', JSON.stringify(e)); });
await t('C2.3 a second create attempt with a client time is denied; nobody else can write the trainee\'s consent', async () => {
  assert(await denied(T.setDoc('consents/t', { kind: CONSENT_KIND, version: 'x', ackTs: Date.now() })));
  assert(await denied(A.setDoc('consents/t', consentWrite(null, false).data)) && await denied(O.updateDoc('consents/t', withdrawPatch())));
});
await t('C2.4 withdraw (server time only) → server stops: no_consent', async () => {
  await T.updateDoc('consents/t', withdrawPatch());
  const s = await adb.doc(`${P}/consents/t`).get();
  assert(s.get('withdrawnTs') instanceof Timestamp && consentState(s.data()) === 'withdrawn');
  assert((await eligibility(FID)).why === 'no_consent');
});
await t('C2.5 re-acknowledge after withdrawal (update, withdrawnTs deleted) → eligible again', async () => {
  const cur = (await adb.doc(`${P}/consents/t`).get()).data();
  const w = consentWrite(cur, false); assert(w.op === 'update');
  await T.updateDoc('consents/t', w.data);
  const s = await adb.doc(`${P}/consents/t`).get();
  assert(!('withdrawnTs' in s.data()) && consentState(s.data()) === 'ok' && (await eligibility(FID)).ok === true);
});
await t('C2.6 a pending (not yet acknowledged by the server) ackTs reads as acknowledged, so the screen is not shown again', async () => {
  assert(consentState({ kind: CONSENT_KIND, version: '2026-11-v1', ackTs: null }) === 'ok' && consentState({ kind: CONSENT_KIND, version: '2026-11-v1', ackTs: null, withdrawnTs: null }) === 'withdrawn' && consentState(null) === 'none');
});
await t('C2.7 admins read the consent list (루틴 상태 row); a plain family member cannot read it', async () => {
  const l = await A.query('consents', { limit: 10 }); assert(l.some((c) => c.id === 't'));
  assert(await denied(Fm.getDoc('consents/t')));
});
await t('C2.8 admin-made consent (byAdmin): create → eligible; admin off → no_consent; admin on again → eligible; the extra key breaks nothing server side', async () => {
  await adb.doc(`${P}/consents/t`).delete();
  assert((await eligibility(FID)).why === 'no_consent');
  const w = adminConsentWrite(null, 'a'); assert(w.op === 'set');
  await A.setDoc('consents/t', w.data);
  let s = await adb.doc(`${P}/consents/t`).get();
  assert(s.get('byAdmin') === 'a' && s.get('ackTs') instanceof Timestamp && consentState(s.data()) === 'ok');
  const e = await eligibility(FID); assert(e.ok === true && e.traineeId === 't' && e.consentTs, JSON.stringify(e));
  await A.updateDoc('consents/t', adminWithdrawPatch('a'));
  s = await adb.doc(`${P}/consents/t`).get();
  assert(consentState(s.data()) === 'withdrawn' && (await eligibility(FID)).why === 'no_consent');
  const w2 = adminConsentWrite(s.data(), 'o'); assert(w2.op === 'update');
  await O.updateDoc('consents/t', w2.data);
  s = await adb.doc(`${P}/consents/t`).get();
  assert(!('withdrawnTs' in s.data()) && s.get('byAdmin') === 'o' && (await eligibility(FID)).ok === true);
  assert(await denied(Fm.setDoc('consents/t', adminConsentWrite(null, 'f').data)) && await denied(T.setDoc('consents/t', adminConsentWrite(null, 't').data)));
});

// ===================================================================== C3. aiNotes
await t('C3.1 admin note (dates, codes, free text) is accepted; the server reads only dates and codes', async () => {
  const r = noteDoc({ from: '2027-02-28', to: '2027-03-06', ongoing: false, codes: ['illness', 'sleep'], text: '  기침약 3일  ' }, 'a', Date.now());
  assert(!r.error && r.doc.text === '기침약 3일');
  const id = noteId(); await A.setDoc('aiNotes/' + id, r.doc);
  const s = await adb.doc(`${P}/aiNotes/${id}`).get(); assert(s.get('to') === '2027-03-06' && s.get('codes').length === 2);
});
await t('C3.2 ongoing note (to: null) and owner note are accepted', async () => {
  const r = noteDoc({ from: '2027-03-01', ongoing: true, codes: ['med_change'], text: '' }, 'o', Date.now());
  assert(r.doc.to === null && !('text' in r.doc));
  await O.setDoc('aiNotes/' + noteId(), r.doc);
});
await t('C3.3 the builder refuses bad input before writing (end before start, no code)', async () => {
  assert(noteDoc({ from: '2027-03-05', to: '2027-03-01', codes: ['sleep'] }, 'a', 1).error && noteDoc({ from: '2027-03-05', ongoing: true, codes: [] }, 'a', 1).error);
});
await t('C3.4 a non-admin family member and the trainee cannot write or read notes', async () => {
  const r = noteDoc({ from: '2027-03-01', ongoing: true, codes: ['sleep'] }, 'f', Date.now());
  assert(await denied(Fm.setDoc('aiNotes/' + noteId(), r.doc)) && await denied(T.setDoc('aiNotes/' + noteId(), Object.assign({}, r.doc, { by: 't' }))));
  assert(await denied(T.query('aiNotes', { limit: 5 })) && await denied(Fm.query('aiNotes', { limit: 5 })));
});

// ===================================================================== C4. aiReview
await t('C4.1 admin approves a 옛날 이야기 item → aiOnReview sets result/processedTs and the item becomes ready', async () => {
  await A.setDoc('aiReview/' + BK.pend, reviewDoc('approve', 'a', Date.now()));
  const s = await waitFor(async () => { const x = await adb.doc(`${P}/aiReview/${BK.pend}`).get(); return x.get('processedTs') ? x : null; });
  assert(s.get('result') === 'ready' && (await adb.doc(`aiBank/${BK.pend}`).get()).get('status') === 'ready');
});
await t('C4.2 admin flags an item ("이 문제 이상해요") → quarantine', async () => {
  await A.setDoc('aiReview/' + BK.train, reviewDoc('flag', 'a', Date.now()));
  const s = await waitFor(async () => { const x = await adb.doc(`${P}/aiReview/${BK.train}`).get(); return x.get('processedTs') ? x : null; });
  assert(s.get('result') === 'quarantine' && (await adb.doc(`aiBank/${BK.train}`).get()).get('quarantineWhy') === 'admin_flag');
});
await t('C4.3 a second decision on the same item is denied (create only), and non-admins cannot decide', async () => {
  assert(await denied(A.setDoc('aiReview/' + BK.train, reviewDoc('retire', 'a', Date.now()))));
  assert(await denied(Fm.setDoc('aiReview/' + BK.ref, reviewDoc('retire', 'f', Date.now()))));
});

// ===================================================================== C5. aiState/themes, aiState/switch
await t('C5.1 admin saves interest words; the server keeps the Hangul words', async () => {
  await A.setDoc('aiState/themes', themesDoc(['낚시', '등산', '트로트'], 'a', Date.now()));
  const w = (await adb.doc(`${P}/aiState/themes`).get()).get('words');
  assert(JSON.stringify(validThemes(w)) === JSON.stringify(['낚시', '등산', '트로트']));
});
await t('C5.2 a non-admin family member cannot change the words', async () => { assert(await denied(Fm.setDoc('aiState/themes', themesDoc(['바둑'], 'f', Date.now())))); });
await t('C5.3 AI off → server eligibility switched_off; on again → ok', async () => {
  await A.setDoc('aiState/switch', switchDoc(false, 'a', Date.now()));
  assert((await eligibility(FID)).why === 'switched_off');
  await O.setDoc('aiState/switch', switchDoc(true, 'o', Date.now()));
  assert((await eligibility(FID)).ok === true);
});
await t('C5.4 the trainee cannot switch AI off', async () => { assert(await denied(T.setDoc('aiState/switch', switchDoc(false, 't', Date.now())))); });

console.log(`\n${pass} passed, ${fail} failed`);
if (!fail) console.log('AI CLIENT CONTRACT: ALL PASSED');
await env.cleanup().catch(() => {});
process.exit(fail ? 1 : 0);
