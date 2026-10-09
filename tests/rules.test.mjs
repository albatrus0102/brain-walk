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
await t('A soft-deletes B msg denied (not author)', updateDoc(doc(dA, `families/${F}/messages/m5`), { deleted: true, text: '' }), false);
await t('B changes own msg kind denied', updateDoc(doc(dB, `families/${F}/messages/m5`), { kind: 'system' }), false);
await t('B changes own msg authorId denied', updateDoc(doc(dB, `families/${F}/messages/m5`), { authorId: 'mA' }), false);
await t('B adds record to own msg denied', updateDoc(doc(dB, `families/${F}/messages/m5`), { record: { title: 'x' } }), false);
await t('B forges ack for A denied', updateDoc(doc(dB, `families/${F}/messages/m5`), { 'acks.mA': Date.now() }), false);
await t('B reaction list > 6 denied', updateDoc(doc(dB, `families/${F}/messages/m5`), { 'reactions.mB': ['1', '2', '3', '4', '5', '6', '7'] }), false);
await t('new message with pre-filled reactions denied', setDoc(doc(dB, `families/${F}/messages/m6`), msg({ reactions: { mA: ['👍'] } })), false);
await t('B deletes A msg (not owner) denied', (async () => { await setDoc(doc(dA, `families/${F}/messages/m7`), msg({ authorId: 'mA' })); await deleteDoc(doc(dB, `families/${F}/messages/m7`)); })(), false);
// ---- nudge
const nudge = d => { const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/n${Math.random().toString(36).slice(2, 8)}`), msg({ kind: 'nudge', toId: 'mA', text: '아버지, 산책 가요', acks: {} })); b.update(doc(d, `families/${F}/members/mB`), { lastNudgeAt: serverTimestamp() }); return b.commit(); };
await t('nudge without member stamp denied', setDoc(doc(dB, `families/${F}/messages/nx`), msg({ kind: 'nudge', toId: 'mA' })), false);
await t('nudge #1', nudge(dB));
await t('nudge #2 within 115m denied', nudge(dB), false);
await t('nudge to non-trainee denied', (async () => { const d = dA; const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/ny`), msg({ authorId: 'mA', kind: 'nudge', toId: 'mB' })); b.update(doc(d, `families/${F}/members/mA`), { lastNudgeAt: serverTimestamp() }); await b.commit(); })(), false);
await t('set lastNudgeAt to past denied', updateDoc(doc(dB, `families/${F}/members/mB`), { lastNudgeAt: Timestamp.fromMillis(0) }), false);
await t('remove lastNudgeAt (reset limit) denied', updateDoc(doc(dB, `families/${F}/members/mB`), { lastNudgeAt: deleteField() }), false);
await t('text message carrying toId denied', setDoc(doc(dB, `families/${F}/messages/nz`), msg({ toId: 'mA' })), false);
await t('B renames A denied', updateDoc(doc(dB, `families/${F}/members/mA`), { name: '가짜' }), false);
await t('B changes A role denied', updateDoc(doc(dB, `families/${F}/members/mA`), { role: 'family' }), false);
await t('B makes self owner denied', updateDoc(doc(dB, 'families', F), { ownerMemberId: 'mB' }), false);
await t('B reads A users pointer denied', getDoc(doc(dB, 'users', 'uidA')), false);
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
await t('B (not owner) cannot list A devices', getDocs(collection(dB, `families/${F}/members/mA/devices`)), false);
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
// ---- taskRuns (점검 과제 상세): 가족 모두 읽기, 본인 userId 로만 쓰기
{
  const tr = (who, extra = {}) => Object.assign({ date: today, ts: Date.now(), userId: who, v: 1, tasks: { t_digits: { domain: 'attention', score: 60, m: { fwd: 5, bwd: 3 } } } }, extra);
  await t('trainee writes taskRun', setDoc(doc(dA, `families/${F}/taskRuns/r1`), tr('mA')));
  await t('family reads taskRun', getDoc(doc(dB, `families/${F}/taskRuns/r1`)));
  await t('taskRun forged userId denied', setDoc(doc(dB, `families/${F}/taskRuns/r2`), tr('mA')), false);
  await t('taskRun extra field denied', setDoc(doc(dA, `families/${F}/taskRuns/r3`), tr('mA', { note: 1 })), false);
  await t('taskRun update denied', updateDoc(doc(dA, `families/${F}/taskRuns/r1`), { v: 2 }), false);
  await t('non-member taskRun read denied', getDoc(doc(db('stranger'), `families/${F}/taskRuns/r1`)), false);
  await t('trainee cannot read taskRun (family-only)', getDoc(doc(dA, `families/${F}/taskRuns/r1`)), false);
  await t('trainee cannot list taskRuns', getDocs(collection(dA, `families/${F}/taskRuns`)), false);
}
// ---- clocks (시계 그림, 가족 전용) / sleeplogs / iadl 설문
{
  const png = 'data:image/png;base64,' + 'A'.repeat(1000);
  const ck = (who, extra = {}) => Object.assign({ date: today, ts: Date.now(), userId: who, img: png, w: 320, h: 320 }, extra);
  await t('trainee saves clock drawing', setDoc(doc(dA, `families/${F}/clocks/c1`), ck('mA')));
  await t('trainee cannot read clock', getDoc(doc(dA, `families/${F}/clocks/c1`)), false);
  await t('trainee cannot list clocks', getDocs(collection(dA, `families/${F}/clocks`)), false);
  await t('family reads clock', getDoc(doc(dB, `families/${F}/clocks/c1`)));
  await t('clock forged userId denied', setDoc(doc(dB, `families/${F}/clocks/c2`), ck('mA')), false);
  await t('clock not an image denied', setDoc(doc(dA, `families/${F}/clocks/c3`), ck('mA', { img: 'http://evil/x.png' })), false);
  await t('clock > 200KB denied', setDoc(doc(dA, `families/${F}/clocks/c4`), ck('mA', { img: 'data:image/png;base64,' + 'A'.repeat(200001) })), false);
  await t('clock 190KB ok', setDoc(doc(dA, `families/${F}/clocks/c5`), ck('mA', { img: 'data:image/png;base64,' + 'A'.repeat(190000) })));
  await t('clock img with quote (XSS) denied', setDoc(doc(dA, `families/${F}/clocks/c6`), ck('mA', { img: 'data:image/png;base64,AAAA" onerror="alert(1)' })), false);
  await t('clock img svg denied', setDoc(doc(dA, `families/${F}/clocks/c7`), ck('mA', { img: 'data:image/svg+xml;base64,AAAA' })), false);
  await t('clock update denied', updateDoc(doc(dA, `families/${F}/clocks/c1`), { w: 1 }), false);
  await t('trainee cannot delete clock', deleteDoc(doc(dA, `families/${F}/clocks/c1`)), false);
  await t('family deletes clock', deleteDoc(doc(dB, `families/${F}/clocks/c5`)));
  const sl = (who, extra = {}) => Object.assign({ date: today, ts: Date.now(), userId: who, bed: '22:30', wake: '06:40', wakings: 2, quality: 3 }, extra);
  await t('sleep log own id', setDoc(doc(dA, `families/${F}/sleeplogs/${today}-mA`), sl('mA')));
  await t('sleep log readable by family', getDoc(doc(dB, `families/${F}/sleeplogs/${today}-mA`)));
  await t('trainee cannot read sleep log (family-only)', getDoc(doc(dA, `families/${F}/sleeplogs/${today}-mA`)), false);
  await t('trainee cannot list sleep logs', getDocs(collection(dA, `families/${F}/sleeplogs`)), false);
  await t('trainee can still update own sleep log', setDoc(doc(dA, `families/${F}/sleeplogs/${today}-mA`), sl('mA', { wakings: 1 }), { merge: true }));
  await t('sleep log wrong id denied', setDoc(doc(dA, `families/${F}/sleeplogs/x1`), sl('mA')), false);
  await t('sleep log for another member denied', setDoc(doc(dB, `families/${F}/sleeplogs/${today}-mA`), sl('mA')), false);
  await t('sleep log bad time denied', setDoc(doc(dA, `families/${F}/sleeplogs/${today}-mA`), sl('mA', { bed: '25:99' })), false);
  await t('sleep log wakings too high denied', setDoc(doc(dA, `families/${F}/sleeplogs/${today}-mA`), sl('mA', { wakings: 99 })), false);
  await t('iadl survey kind allowed (family)', setDoc(doc(dB, `families/${F}/surveys/i1`), { kind: 'iadl', version: '1', answers: [0, 1, 0, 2, 0, 0, 1, 0], score: 4, ts: Date.now(), date: today, mode: 'family', answeredBy: 'mB', relation: '아들' }));
  await t('trainee cannot read iadl survey', getDoc(doc(dA, `families/${F}/surveys/i1`)), false);
}
// ---- clinicalTests (병원·센터 검사 기록): 가족만 읽기·쓰기
{
  const ct = (who, extra = {}) => Object.assign({ test: 'cist', date: today, score: 25, max: 30, place: '서울 ○○치매안심센터', result: '정상', memo: '2년 뒤 재검', recordedBy: who, ts: Date.now() }, extra);
  await t('family records clinical test', setDoc(doc(dB, `families/${F}/clinicalTests/k1`), ct('mB')));
  await t('family reads clinical test', getDoc(doc(dB, `families/${F}/clinicalTests/k1`)));
  await t('trainee cannot read clinical test', getDoc(doc(dA, `families/${F}/clinicalTests/k1`)), false);
  await t('trainee cannot list clinical tests', getDocs(collection(dA, `families/${F}/clinicalTests`)), false);
  await t('trainee cannot write clinical test', setDoc(doc(dA, `families/${F}/clinicalTests/k2`), ct('mA')), false);
  await t('date-only record (no score) ok', setDoc(doc(dB, `families/${F}/clinicalTests/k3`), { test: 'cist', date: today, recordedBy: 'mB', ts: Date.now() }));
  await t('other test with label ok', setDoc(doc(dB, `families/${F}/clinicalTests/k4`), ct('mB', { test: 'other', testLabel: '신경심리검사', max: null })));
  await t('forged recordedBy denied', setDoc(doc(dB, `families/${F}/clinicalTests/k5`), ct('mA')), false);
  await t('unknown test denied', setDoc(doc(dB, `families/${F}/clinicalTests/k6`), ct('mB', { test: 'mystery' })), false);
  await t('score above max denied', setDoc(doc(dB, `families/${F}/clinicalTests/k7`), ct('mB', { score: 31 })), false);
  await t('negative score denied', setDoc(doc(dB, `families/${F}/clinicalTests/k8`), ct('mB', { score: -1 })), false);
  await t('bad result value denied', setDoc(doc(dB, `families/${F}/clinicalTests/k9`), ct('mB', { result: '위험' })), false);
  await t('memo over 500 chars denied', setDoc(doc(dB, `families/${F}/clinicalTests/k10`), ct('mB', { memo: 'x'.repeat(501) })), false);
  await t('extra field (items) denied', setDoc(doc(dB, `families/${F}/clinicalTests/k11`), ct('mB', { items: [1, 2, 3] })), false);
  await t('author updates own record', updateDoc(doc(dB, `families/${F}/clinicalTests/k1`), { score: 26 }));
  await t('family deletes own record', deleteDoc(doc(dB, `families/${F}/clinicalTests/k3`)));
  await t('non-member cannot read clinical test', getDoc(doc(db('stranger'), `families/${F}/clinicalTests/k1`)), false);
}
// ---- transfer: B issues recovery code for A; new device uidA2 redeems
{
  const T = 'TRF234';
  // 방금 가족 코드로 들어온 사람(mC)은 다른 사람(아버지·방 주인 mA)의 복구 코드를 만들 수 없어요.
  {
    const dC = db('uidC2'), bj = writeBatch(dC);
    bj.set(doc(dC, `families/${F}/uids/uidC2`), { memberId: 'mC2', via: 'join', code: 'NEW234', addedTs: serverTimestamp() });
    bj.set(doc(dC, `families/${F}/members/mC2`), { name: '새 사람', role: 'family', joinedTs: serverTimestamp() });
    await t('newcomer joins with code', bj.commit());
    await t('newcomer cannot issue recovery code for owner', setDoc(doc(dC, 'transferCodes', 'TRF777'), { familyId: F, memberId: 'mA', createdBy: 'mC2', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }), false);
    await t('newcomer can issue own transfer code', setDoc(doc(dC, 'transferCodes', 'TRF778'), { familyId: F, memberId: 'mC2', createdBy: 'mC2', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }));
    await t('list transferCodes denied', getDocs(collection(dC, 'transferCodes')), false);
    await t('get unknown transfer code denied', getDoc(doc(db('x2'), 'transferCodes', 'ZZZ999')), false);
  }
  // 하루 전에 들어온 가족(mB)은 아버지의 복구 코드를 만들 수 있어요 (joinedTs 를 하루 전으로).
  await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), `families/${F}/members/mB`), { joinedTs: Timestamp.fromMillis(Date.now() - 2 * 864e5) }); });
  await t('issue transfer code', setDoc(doc(dB, 'transferCodes', T), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }));
  await t('transfer code TTL > 30m denied', setDoc(doc(dB, 'transferCodes', 'TRF999'), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 60 * 60e3) }), false);
  const d = db('uidA2');
  await t('new device reads code', getDoc(doc(d, 'transferCodes', T)));
  const redeem = (dd, u) => { const b = writeBatch(dd); b.update(doc(dd, 'transferCodes', T), { usedBy: u, usedTs: serverTimestamp() }); b.set(doc(dd, `families/${F}/uids/${u}`), { memberId: 'mA', via: 'transfer', code: T, addedTs: serverTimestamp() }); return b.commit(); };
  await t('redeem transfer', redeem(d, 'uidA2'));
  await t('second redeem denied', redeem(db('uidA3'), 'uidA3'), false);
  await t('get used transfer code denied', getDoc(doc(db('uidA5'), 'transferCodes', T)), false);
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
