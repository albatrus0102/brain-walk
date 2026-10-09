import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, collection, getDocs, deleteField } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-bw', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
let pass = 0, fail = 0;
async function t(name, p, ok = true) { try { await (ok ? assertSucceeds(p) : assertFails(p)); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, e.message.split('\n')[0]); } }
const db = u => env.authenticatedContext(u).firestore();
const anon = env.unauthenticatedContext().firestore();
const F = 'fam1', CODE = 'ABC234', in7d = () => Timestamp.fromMillis(Date.now() + 7 * 864e5);
// ---- founding (uid A = father)
{
  const d = db('uidA'), b = writeBatch(d);
  b.set(doc(d, 'families', F), { createdBy: 'uidA', createdTs: serverTimestamp(), ownerMemberId: 'mA', joinCode: CODE, name: '우리집', schemaVersion: 1 });
  b.set(doc(d, 'joinCodes', CODE), { familyId: F, createdBy: 'mA', createdTs: serverTimestamp(), expiresTs: in7d() });
  b.set(doc(d, `families/${F}/uids/uidA`), { memberId: 'mA', via: 'create', addedTs: serverTimestamp() });
  b.set(doc(d, `families/${F}/members/mA`), { name: '아버지', role: 'trainee', joinedTs: serverTimestamp() });
  b.set(doc(d, 'users/uidA'), { familyId: F, memberId: 'mA', updatedAt: serverTimestamp() });
  await t('found family', b.commit());
  await t('set trainee', setDoc(doc(d, `families/${F}/state/trainee`), { userId: 'mA', displayLabel: '아버지' }));
}
// ---- second founding attempt over existing family by attacker
{
  const d = db('evil'), b = writeBatch(d);
  b.set(doc(d, `families/${F}/uids/evil`), { memberId: 'mA', via: 'create', addedTs: serverTimestamp() });
  await t('hijack via create denied', b.commit(), false);
}
// ---- enumeration
await t('list joinCodes denied', getDocs(collection(db('x'), 'joinCodes')), false);
await t('get wrong code denied', getDoc(doc(db('x'), 'joinCodes', 'ZZZ999')), false);
await t('get valid code ok', getDoc(doc(db('x'), 'joinCodes', CODE)));
await t('anon (no auth) code denied', getDoc(doc(anon, 'joinCodes', CODE)), false);
await t('non-member read family denied', getDoc(doc(db('x'), 'families', F)), false);
await t('non-member read messages denied', getDocs(collection(db('x'), `families/${F}/messages`)), false);
await t('list families denied', getDocs(collection(db('uidA'), 'families')), false);
// ---- join (uid B = son)
{
  const d = db('uidB'), b = writeBatch(d);
  b.set(doc(d, `families/${F}/uids/uidB`), { memberId: 'mB', via: 'join', code: CODE, addedTs: serverTimestamp() });
  b.set(doc(d, `families/${F}/members/mB`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
  await t('join with code', b.commit());
}
{
  const d = db('uidC'), b = writeBatch(d);
  b.set(doc(d, `families/${F}/uids/uidC`), { memberId: 'mA', via: 'join', code: CODE, addedTs: serverTimestamp() });
  await t('join as existing member denied', b.commit(), false);
  const b2 = writeBatch(d);
  b2.set(doc(d, `families/${F}/uids/uidC`), { memberId: 'mC', via: 'join', code: 'ZZZ999', addedTs: serverTimestamp() });
  b2.set(doc(d, `families/${F}/members/mC`), { name: '딸', role: 'family', joinedTs: serverTimestamp() });
  await t('join with wrong code denied', b2.commit(), false);
  await t('member doc without link denied', setDoc(doc(d, `families/${F}/members/mC`), { name: '딸', role: 'family', joinedTs: serverTimestamp() }), false);
}
// expired code
{
  const d = db('uidB');
  await t('member creates expired code', setDoc(doc(d, 'joinCodes', 'EXP234'), { familyId: F, createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 1500) }));
  await new Promise(r => setTimeout(r, 2000));
  await t('get expired code denied', getDoc(doc(db('y'), 'joinCodes', 'EXP234')), false);
  await t('code for other family denied', setDoc(doc(db('uidB'), 'joinCodes', 'OTH234'), { familyId: 'famX', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: in7d() }), false);
  await t('rotate family joinCode', (async () => { const b = writeBatch(d); b.set(doc(d, 'joinCodes', 'NEW234'), { familyId: F, createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: in7d() }); b.update(doc(d, 'families', F), { joinCode: 'NEW234' }); await b.commit(); })());
}
// ---- messages
const dA = db('uidA'), dB = db('uidB');
const msg = (o = {}) => Object.assign({ authorId: 'mB', text: '안녕하세요', ts: Date.now(), sts: serverTimestamp(), kind: 'text', push: 'pending', reactions: {} }, o);
await t('send text', setDoc(doc(dB, `families/${F}/messages/m1`), msg()));
await t('impersonate author denied', setDoc(doc(dB, `families/${F}/messages/m2`), msg({ authorId: 'mA' })), false);
await t('text > 500 denied', setDoc(doc(dB, `families/${F}/messages/m3`), msg({ text: 'x'.repeat(501) })), false);
await t('push=sent by client denied', setDoc(doc(dB, `families/${F}/messages/m4`), msg({ push: 'sent' })), false);
await t('A reacts own key', updateDoc(doc(dA, `families/${F}/messages/m1`), { 'reactions.mA': ['👍'] }));
await t('A edits B reaction denied', updateDoc(doc(dA, `families/${F}/messages/m1`), { 'reactions.mB': ['👎'] }), false);
await t('A edits text denied', updateDoc(doc(dA, `families/${F}/messages/m1`), { text: 'hacked' }), false);
await t('A acks own', updateDoc(doc(dA, `families/${F}/messages/m1`), { 'acks.mA': Date.now() }));
await t('B removes own reaction-less key ok', updateDoc(doc(dB, `families/${F}/messages/m1`), { 'reactions.mB': ['❤️'] }));
await t('B edits own text', updateDoc(doc(dB, `families/${F}/messages/m1`), { text: '수정', editedTs: Date.now() }));
await t('B soft-deletes', updateDoc(doc(dB, `families/${F}/messages/m1`), { deleted: true, text: '' }));
await t('A deletes B msg (owner) ok', deleteDoc(doc(dA, `families/${F}/messages/m1`)));
await t('B change push denied', (async () => { await setDoc(doc(dB, `families/${F}/messages/m5`), msg()); await updateDoc(doc(dB, `families/${F}/messages/m5`), { push: 'sent' }); })(), false);
// ---- nudge
const nudge = d => { const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/n${Math.random().toString(36).slice(2, 8)}`), msg({ kind: 'nudge', toId: 'mA', text: '아버지, 산책 가요', acks: {} })); b.update(doc(d, `families/${F}/members/mB`), { lastNudgeAt: serverTimestamp() }); return b.commit(); };
await t('nudge without member stamp denied', setDoc(doc(dB, `families/${F}/messages/nx`), msg({ kind: 'nudge', toId: 'mA' })), false);
await t('nudge #1', nudge(dB));
await t('nudge #2 within 115m denied', nudge(dB), false);
await t('nudge to non-trainee denied', (async () => { const d = dA; const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/ny`), msg({ authorId: 'mA', kind: 'nudge', toId: 'mB' })); b.update(doc(d, `families/${F}/members/mA`), { lastNudgeAt: serverTimestamp() }); await b.commit(); })(), false);
await t('set lastNudgeAt to past denied', updateDoc(doc(dB, `families/${F}/members/mB`), { lastNudgeAt: Timestamp.fromMillis(0) }), false);
// ---- records
const today = new Date().toISOString().slice(0, 10);
await t('session by trainee', setDoc(doc(dA, `families/${F}/sessions/s1`), { date: today, ts: Date.now(), gameId: 'flash', gameName: '번쩍', domain: 'speed', level: 2, correct: 4, total: 5, accuracy: 0.8, durationSec: 60, inCourse: true, roundSec: null, userId: 'mA' }));
await t('session forged user denied', setDoc(doc(dB, `families/${F}/sessions/s2`), { date: today, ts: Date.now(), gameId: 'flash', userId: 'mA' }), false);
await t('B edits A session denied', updateDoc(doc(dB, `families/${F}/sessions/s1`), { accuracy: 1 }), false);
await t('assessment', setDoc(doc(dA, `families/${F}/assessments/1`), { date: today, ts: Date.now(), scores: { memory: 80 }, total: 80, userId: 'mA' }));
await t('checkin own id', setDoc(doc(dA, `families/${F}/checkins/${today}-mA`), { date: today, ts: Date.now(), mood: 4, sleepHours: 7, exercise: true, social: false, meals: true, userId: 'mA' }));
await t('checkin wrong id denied', setDoc(doc(dA, `families/${F}/checkins/${today}-mB`), { date: today, ts: Date.now(), userId: 'mA' }), false);
await t('alarm', setDoc(doc(dB, `families/${F}/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mB', updatedTs: Date.now() }));
await t('alarm bad day denied', setDoc(doc(dB, `families/${F}/state/alarm`), { time: '10:00', days: [7], updatedBy: 'mB', updatedTs: Date.now() }), false);
await t('levels', setDoc(doc(dA, `families/${F}/state/levels`), { levels: { flash: 2 }, updatedTs: Date.now() }));
await t('program', setDoc(doc(dA, `families/${F}/state/program`), { startDate: today }));
await t('unknown state doc denied', setDoc(doc(dA, `families/${F}/state/evil`), { x: 1 }), false);
await t('reads own', setDoc(doc(dB, `families/${F}/reads/mB`), { lastReadTs: Date.now() }));
await t('reads other denied', setDoc(doc(dB, `families/${F}/reads/mA`), { lastReadTs: Date.now() }), false);
await t('reminder own', setDoc(doc(dB, `families/${F}/reminders/mB`), { time: '19:00', enabled: true }));
await t('pushState write denied', setDoc(doc(dB, `families/${F}/pushState/mB`), { lastAlarmSentDate: today }), false);
// ---- devices
await t('own device', setDoc(doc(dB, `families/${F}/members/mB/devices/dev1`), { token: 'x'.repeat(100), uid: 'uidB', platform: 'android', standalone: true, updatedAt: serverTimestamp() }));
await t('device for other member denied', setDoc(doc(dB, `families/${F}/members/mA/devices/dev2`), { token: 'x'.repeat(100), uid: 'uidB', platform: 'android', standalone: true, updatedAt: serverTimestamp() }), false);
await t('A (owner) can list B devices', getDocs(collection(dA, `families/${F}/members/mB/devices`)));
// ---- 가족 전용 자료: surveys (mA 훈련하는 분·소유자, mB 가족)
{
  const sv = (who, extra = {}) => Object.assign({ kind: 'phq9', version: '1', answers: [0, 1, 0, 0, 1, 0, 0, 0, 0], score: 2, ts: Date.now(), date: today, mode: 'self', answeredBy: who, relation: '본인' }, extra);
  await t('trainee can create own survey', setDoc(doc(dA, `families/${F}/surveys/s1`), sv('mA')));
  await t('trainee cannot read survey (doc)', getDoc(doc(dA, `families/${F}/surveys/s1`)), false);
  await t('trainee cannot list surveys', getDocs(collection(dA, `families/${F}/surveys`)), false);
  await t('family reads survey (doc)', getDoc(doc(dB, `families/${F}/surveys/s1`)));
  await t('family lists surveys', getDocs(collection(dB, `families/${F}/surveys`)));
  await t('family creates informant survey', setDoc(doc(dB, `families/${F}/surveys/s2`), sv('mB', { kind: 'iqcode', mode: 'family', score: 3.2, answers: Array(16).fill(3), relation: '아들', subjectId: 'mA' })));
  await t('survey forged answeredBy denied', setDoc(doc(dB, `families/${F}/surveys/s3`), sv('mA')), false);
  await t('survey unknown kind denied', setDoc(doc(dB, `families/${F}/surveys/s4`), sv('mB', { kind: 'mmse' })), false);
  await t('survey extra field denied', setDoc(doc(dB, `families/${F}/surveys/s5`), sv('mB', { note: 'x' })), false);
  await t('survey too many answers denied', setDoc(doc(dB, `families/${F}/surveys/s6`), sv('mB', { answers: Array(31).fill(0) })), false);
  await t('survey update denied', updateDoc(doc(dB, `families/${F}/surveys/s2`), { score: 1 }), false);
  await t('non-member cannot read survey', getDoc(doc(db('stranger'), `families/${F}/surveys/s1`)), false);
  await t('trainee cannot delete survey', deleteDoc(doc(dA, `families/${F}/surveys/s2`)), false);
  await t('family deletes own survey', deleteDoc(doc(dB, `families/${F}/surveys/s2`)));
  await t('owner (trainee role) cannot delete either', deleteDoc(doc(dA, `families/${F}/surveys/s1`)), false);
}
// ---- transfer: B issues recovery code for A; new device uidA2 redeems
{
  const T = 'TRF234';
  await t('issue transfer code', setDoc(doc(dB, 'transferCodes', T), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }));
  await t('transfer code TTL > 30m denied', setDoc(doc(dB, 'transferCodes', 'TRF999'), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 60 * 60e3) }), false);
  const d = db('uidA2');
  await t('new device reads code', getDoc(doc(d, 'transferCodes', T)));
  const redeem = (dd, u) => { const b = writeBatch(dd); b.update(doc(dd, 'transferCodes', T), { usedBy: u, usedTs: serverTimestamp() }); b.set(doc(dd, `families/${F}/uids/${u}`), { memberId: 'mA', via: 'transfer', code: T, addedTs: serverTimestamp() }); return b.commit(); };
  await t('redeem transfer', redeem(d, 'uidA2'));
  await t('second redeem denied', redeem(db('uidA3'), 'uidA3'), false);
  await t('new device acts as mA', setDoc(doc(d, `families/${F}/reads/mA`), { lastReadTs: Date.now() }));
  await t('transfer without marking used denied', (async () => { const dd = db('uidA4'); await setDoc(doc(db('uidB'), 'transferCodes', 'TRF555'), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 10 * 60e3) }); await setDoc(doc(dd, `families/${F}/uids/uidA4`), { memberId: 'mA', via: 'transfer', code: 'TRF555', addedTs: serverTimestamp() }); })(), false);
  await t('revoke lost device (owner A2)', deleteDoc(doc(d, `families/${F}/uids/uidA`)));
  await t('revoked device locked out', getDoc(doc(db('uidA'), 'families', F)), false);
}
// ---- leave / remove
await t('B cannot remove A', updateDoc(doc(dB, `families/${F}/members/mA`), { leftTs: serverTimestamp() }), false);
await t('owner transfers ownership', updateDoc(doc(db('uidA2'), 'families', F), { ownerMemberId: 'mB' }));
await t('B (now owner) can delete family doc', deleteDoc(doc(dB, 'families', F)));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
