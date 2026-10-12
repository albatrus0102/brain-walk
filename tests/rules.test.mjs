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
  // 코드 만들기·바꾸기는 관리자만 (DESIGN.md §3). 예전에는 아무 구성원(B)이나 했어요: 이제 방 주인 A 가 하고, B 는 거부돼요.
  const d = db('uidA');
  await t('non-admin creates join code denied', setDoc(doc(db('uidB'), 'joinCodes', 'BBB234'), { familyId: F, createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: in7d() }), false);
  await t('non-admin rotates joinCode denied', (async () => { const dd = db('uidB'), b = writeBatch(dd); b.set(doc(dd, 'joinCodes', 'BBC234'), { familyId: F, createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: in7d() }); b.update(doc(dd, 'families', F), { joinCode: 'BBC234' }); await b.commit(); })(), false);
  await t('non-admin deletes join code denied', deleteDoc(doc(db('uidB'), 'joinCodes', CODE)), false);
  await t('non-admin renames family denied', updateDoc(doc(db('uidB'), 'families', F), { name: '해킹' }), false);
  await t('admin (owner) renames family', updateDoc(doc(d, 'families', F), { name: '우리 집' }));
  await t('member creates expired code', setDoc(doc(d, 'joinCodes', 'EXP234'), { familyId: F, createdBy: 'mA', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 1500) }));
  await new Promise(r => setTimeout(r, 2000));
  await t('get expired code denied', getDoc(doc(db('y'), 'joinCodes', 'EXP234')), false);
  await t('code for other family denied', setDoc(doc(db('uidB'), 'joinCodes', 'OTH234'), { familyId: 'famX', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: in7d() }), false);
  await t('rotate family joinCode', (async () => { const b = writeBatch(d); b.set(doc(d, 'joinCodes', 'NEW234'), { familyId: F, createdBy: 'mA', createdTs: serverTimestamp(), expiresTs: in7d() }); b.update(doc(d, 'families', F), { joinCode: 'NEW234' }); await b.commit(); })());
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
// 알람은 관리자만 (예전에는 가족 누구나). A = 방 주인 = 관리자, B = 관리자 아님.
await t('alarm by non-admin denied', setDoc(doc(dB, `families/${F}/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mB', updatedTs: Date.now() }), false);
await t('alarm', setDoc(doc(dA, `families/${F}/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mA', updatedTs: Date.now() }));
await t('alarm bad day denied', setDoc(doc(dA, `families/${F}/state/alarm`), { time: '10:00', days: [7], updatedBy: 'mA', updatedTs: Date.now() }), false);
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
  // 다른 사람의 복구 코드는 이제 관리자만: 하루 지난 가족이라도 관리자가 아니면 거부, 방 주인이 관리자로 지정하면 허용.
  await t('non-admin family (24h+) cannot issue recovery code for other', setDoc(doc(dB, 'transferCodes', 'TRF666'), { familyId: F, memberId: 'mA', createdBy: 'mB', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }), false);
  await t('owner grants admin to B', updateDoc(doc(dA, 'families', F), { admins: ['mB'] }));
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
// ---- 방 주인이었던 훈련하는 분은 관리자라서, '모두 삭제' 중에 자기 role 을 잠깐 family 로 바꿀 수 있어요 (membership.deleteFamily)
await t('trainee-owner (admin) may flip own role for delete-all', updateDoc(doc(db('uidA2'), `families/${F}/members/mA`), { role: 'family' }));
await t('admin (non-owner) cannot transfer ownership', updateDoc(doc(dB, 'families', F), { ownerMemberId: 'mB' }), false);
await t('owner transfers ownership', updateDoc(doc(db('uidA2'), 'families', F), { ownerMemberId: 'mB' }));
await t('B (now owner) can delete family doc', deleteDoc(doc(dB, 'families', F)));

// =============================================================================
// 관리자·역할·훈련 계획·화면 설정·진행 상황·하트비트 (DESIGN.md §1–§3)
// 새 가족 F2: m1 아들(방 주인, 가족 역할) / m2 아버지(훈련하는 분) / m3 딸(가족) / m4 사위(훈련하는 분으로 들어왔다가 가족으로) / m5 손자(가족)
// =============================================================================
{
  const { planDoc, displayDoc, progressStart, progressFinish } = await import('../js/program.js');
  const CAT = [['cards', 'memory', 2], ['words', 'memory', 3], ['odd', 'attention', 5], ['trail', 'attention', 3], ['shop', 'executive', 5], ['order', 'executive', 3], ['today', 'orientation', 5], ['proverb', 'orientation', 5], ['flash', 'speed', 5]].map(([id, domain, rounds]) => ({ id, domain, rounds }));
  const F2 = 'fam2', C2 = 'FAM234', P = `families/${F2}`;
  const d1 = db('u1'), d2 = db('u2'), d3 = db('u3'), d4 = db('u4'), d5 = db('u5');
  const join = (dd, u, m, role, name) => { const b = writeBatch(dd); b.set(doc(dd, `${P}/uids/${u}`), { memberId: m, via: 'join', code: C2, addedTs: serverTimestamp() }); b.set(doc(dd, `${P}/members/${m}`), { name, role, joinedTs: serverTimestamp() }); return b.commit(); };
  const ageMember = (m, ms) => env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), `${P}/members/${m}`), { joinedTs: Timestamp.fromMillis(Date.now() - ms) }); });
  {
    const b = writeBatch(d1);
    b.set(doc(d1, 'families', F2), { createdBy: 'u1', createdTs: serverTimestamp(), ownerMemberId: 'm1', joinCode: C2, name: '둘째네', schemaVersion: 1 });
    b.set(doc(d1, 'joinCodes', C2), { familyId: F2, createdBy: 'm1', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d1, `${P}/uids/u1`), { memberId: 'm1', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d1, `${P}/members/m1`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F2: helper founds family as family role (no admins field = legacy shape)', b.commit());
  }
  await t('F2: father joins as trainee', join(d2, 'u2', 'm2', 'trainee', '아버지'));
  await t('F2: new trainee claims the empty trainee slot (initial join)', setDoc(doc(d2, `${P}/state/trainee`), { userId: 'm2', displayLabel: '아버지' }));
  await t('F2: daughter joins as family', join(d3, 'u3', 'm3', 'family', '딸'));
  await t('F2: son-in-law joins as trainee', join(d4, 'u4', 'm4', 'trainee', '사위'));
  await t('F2: second trainee joiner cannot take over the trainee slot', setDoc(doc(d4, `${P}/state/trainee`), { userId: 'm4', displayLabel: '사위' }), false);
  await t('F2: joiner switches own role trainee→family within 30 min (onboarding "가족으로 쓸게요")', updateDoc(doc(d4, `${P}/members/m4`), { role: 'family' }));
  await t('F2: grandson joins as family', join(d5, 'u5', 'm5', 'family', '손자'));

  // ---- migration: no admins field → owner is the only admin
  const plan = (by, o = {}) => Object.assign(planDoc({ gamesPerDay: 3, weekdays: [1, 3, 5], games: { odd: { mode: 'fixed', level: 3 } } }, CAT, by, Date.now()), o);
  const disp = (by, o = {}) => Object.assign(displayDoc({ font: 'noto', size: 'max', contrast: true, voice: true, rate: 0.75 }, by, Date.now()), o);
  await t('F2: owner (legacy family, no admins) writes plan', setDoc(doc(d1, `${P}/state/plan`), plan('m1')));
  await t('F2: owner writes learner display', setDoc(doc(d1, `${P}/state/display`), disp('m1')));
  await t('F2: owner writes alarm', setDoc(doc(d1, `${P}/state/alarm`), { time: '09:30', days: [1, 3, 5], updatedBy: 'm1', updatedTs: Date.now() }));
  await t('F2: non-admin family cannot write plan', setDoc(doc(d3, `${P}/state/plan`), plan('m3')), false);
  await t('F2: non-admin family cannot write display', setDoc(doc(d3, `${P}/state/display`), disp('m3')), false);
  await t('F2: non-admin family cannot write alarm', setDoc(doc(d3, `${P}/state/alarm`), { time: '09:30', days: [1], updatedBy: 'm3', updatedTs: Date.now() }), false);
  await t('F2: trainee cannot write plan', setDoc(doc(d2, `${P}/state/plan`), plan('m2')), false);
  await t('F2: trainee cannot write display', setDoc(doc(d2, `${P}/state/display`), disp('m2', { size: 'normal' })), false);
  await t('F2: everyone reads plan and display', Promise.all([getDoc(doc(d2, `${P}/state/plan`)), getDoc(doc(d3, `${P}/state/display`))]));
  await t('F2: non-member cannot read plan', getDoc(doc(db('stranger'), `${P}/state/plan`)), false);
  await t('F2: non-admin cannot delete state docs', deleteDoc(doc(d3, `${P}/state/plan`)), false);

  // ---- plan / display validation (admin m1)
  const badPlan = [['gamesPerDay 10', { gamesPerDay: 10 }], ['gamesPerDay 0', { gamesPerDay: 0 }], ['gamesPerDay 2.5', { gamesPerDay: 2.5 }], ['roundsPerGame 2', { roundsPerGame: 2 }], ['roundsPerGame 11', { roundsPerGame: 11 }],
    ['targetMin 61', { targetMin: 61 }], ['weekdays empty', { weekdays: [] }], ['weekday 7', { weekdays: [7] }], ['checkEveryWeeks 3', { checkEveryWeeks: 3 }], ['order bad', { order: 'random' }],
    ['showScore string', { showScore: 'yes' }], ['games list', { games: [] }], ['forged updatedBy', { updatedBy: 'm3' }], ['future updatedTs', { updatedTs: Date.now() + 3600e3 }], ['extra key', { secret: 1 }], ['v 2', { v: 2 }],
    ['autoNextSec 7', { autoNextSec: 7 }], ['autoNextSec string', { autoNextSec: '10' }], ['autoNextSec 20', { autoNextSec: 20 }]];
  for (const [name, o] of badPlan) await t('F2: plan ' + name + ' denied', setDoc(doc(d1, `${P}/state/plan`), plan('m1', o)), false);
  await t('F2: plan missing key denied', (async () => { const x = plan('m1'); delete x.checkin; await setDoc(doc(d1, `${P}/state/plan`), x); })(), false);
  for (const v of [0, 5, 10, 15]) await t('F2: plan autoNextSec ' + v + ' ok', setDoc(doc(d1, `${P}/state/plan`), plan('m1', { autoNextSec: v })));
  await t('F2: plan without autoNextSec (older writer) ok', (async () => { const x = plan('m1'); delete x.autoNextSec; await setDoc(doc(d1, `${P}/state/plan`), x); })());
  await t('F2: plan roundsPerGame null ok', setDoc(doc(d1, `${P}/state/plan`), plan('m1', { roundsPerGame: null })));
  await t('F2: plan roundsPerGame 10 + 9 games + off check ok', setDoc(doc(d1, `${P}/state/plan`), plan('m1', { roundsPerGame: 10, gamesPerDay: 9, checkEveryWeeks: 0, order: 'fixed' })));
  const badDisp = [['font', { font: 'comic' }], ['size', { size: 'huge' }], ['rate high', { rate: 3 }], ['rate low', { rate: 0.1 }], ['contrast str', { contrast: 'on' }], ['forged by', { updatedBy: 'm3' }], ['extra', { theme: 'dark' }]];
  for (const [name, o] of badDisp) await t('F2: display ' + name + ' denied', setDoc(doc(d1, `${P}/state/display`), disp('m1', o)), false);
  await t('F2: display missing voice denied', (async () => { const x = disp('m1'); delete x.voice; await setDoc(doc(d1, `${P}/state/display`), x); })(), false);

  // ---- admins list: owner only, one grant at a time, family role only
  await t('F2: non-owner cannot grant admin', updateDoc(doc(d3, 'families', F2), { admins: ['m3'] }), false);
  await t('F2: cannot grant admin to the trainee-role member', updateDoc(doc(d1, 'families', F2), { admins: ['m2'] }), false);
  await t('F2: cannot grant admin to a non-member', updateDoc(doc(d1, 'families', F2), { admins: ['ghost'] }), false);
  await t('F2: cannot grant two at once', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }), false);
  await t('F2: owner grants admin to daughter', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));
  await t('F2: duplicate grant denied', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm3'] }), false);
  await t('F2: grant must append, not reorder', updateDoc(doc(d1, 'families', F2), { admins: ['m5', 'm3'] }), false);
  await t('F2: granted admin writes plan', setDoc(doc(d3, `${P}/state/plan`), plan('m3')));
  await t('F2: granted admin writes display', setDoc(doc(d3, `${P}/state/display`), disp('m3', { size: 'xlarge' })));
  await t('F2: granted admin cannot change the admins list', updateDoc(doc(d3, 'families', F2), { admins: ['m3', 'm5'] }), false);
  await t('F2: granted admin cannot take ownership', updateDoc(doc(d3, 'families', F2), { ownerMemberId: 'm3' }), false);
  await t('F2: owner grants a second admin (append)', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }));
  await t('F2: owner revokes one admin', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));
  await t('F2: revoked admin cannot write plan', setDoc(doc(d5, `${P}/state/plan`), plan('m5')), false);

  // ---- role changes: admin-only after the initial join (closes "trainee switches to 가족 to read family-only data")
  await t('F2: assigned trainee cannot switch own role to family (even right after joining)', updateDoc(doc(d2, `${P}/members/m2`), { role: 'family' }), false);
  await t('F2: so the trainee still cannot read surveys', getDocs(collection(d2, `${P}/surveys`)), false);
  await t('F2: name + role in one self-update denied', updateDoc(doc(d5, `${P}/members/m5`), { name: '손자2', role: 'trainee' }), false);
  await t('F2: self rename still ok', updateDoc(doc(d5, `${P}/members/m5`), { name: '손주' }));
  await ageMember('m5', 2 * 3600e3);
  await t('F2: family member cannot change own role after the join window', updateDoc(doc(d5, `${P}/members/m5`), { role: 'trainee' }), false);
  await t('F2: non-admin cannot change someone else\'s role', updateDoc(doc(d5, `${P}/members/m2`), { role: 'family' }), false);
  await t('F2: admin changes trainee role to family', updateDoc(doc(d3, `${P}/members/m2`), { role: 'family' }));
  await t('F2: admin changes it back', updateDoc(doc(d3, `${P}/members/m2`), { role: 'trainee' }));
  await t('F2: admin role value must be valid', updateDoc(doc(d3, `${P}/members/m5`), { role: 'admin' }), false);
  // 관리자로 지정된 사람이 훈련하는 분 역할이 되면 관리자 권한이 꺼져요
  await t('F2: owner grants grandson admin again', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }));
  await t('F2: admin makes grandson a trainee-role member', updateDoc(doc(d1, `${P}/members/m5`), { role: 'trainee' }));
  await t('F2: listed admin with trainee role is not an admin', setDoc(doc(d5, `${P}/state/plan`), plan('m5')), false);
  await t('F2: ...and cannot give themselves family role back', updateDoc(doc(d5, `${P}/members/m5`), { role: 'family' }), false);
  await t('F2: admin restores grandson to family', updateDoc(doc(d1, `${P}/members/m5`), { role: 'family' }));
  await t('F2: owner revokes grandson admin', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));

  // ---- trainee assignment: admin-only (closes "any member can reassign the trainee")
  await t('F2: non-admin cannot reassign trainee to self', setDoc(doc(d5, `${P}/state/trainee`), { userId: 'm5', displayLabel: '손자' }), false);
  await t('F2: non-admin cannot delete trainee', deleteDoc(doc(d5, `${P}/state/trainee`)), false);
  await t('F2: trainee cannot reassign trainee', setDoc(doc(d2, `${P}/state/trainee`), { userId: 'm4', displayLabel: '사위' }), false);
  await t('F2: admin reassigns trainee', setDoc(doc(d3, `${P}/state/trainee`), { userId: 'm4', displayLabel: '사위' }));
  await t('F2: admin reassigns trainee back', setDoc(doc(d3, `${P}/state/trainee`), { userId: 'm2', displayLabel: '아버지' }));
  await t('F2: admin cannot assign a non-member', setDoc(doc(d3, `${P}/state/trainee`), { userId: 'ghost', displayLabel: '유령' }), false);
  await t('F2: admin clears the trainee slot', deleteDoc(doc(d3, `${P}/state/trainee`)));
  await t('F2: family-role newcomer cannot claim an empty slot', setDoc(doc(d4, `${P}/state/trainee`), { userId: 'm4', displayLabel: '사위' }), false);
  await ageMember('m2', 2 * 3600e3);
  await t('F2: trainee-role member who joined >1h ago cannot claim an empty slot', setDoc(doc(d2, `${P}/state/trainee`), { userId: 'm2', displayLabel: '아버지' }), false);
  await t('F2: admin assigns trainee again', setDoc(doc(d1, `${P}/state/trainee`), { userId: 'm2', displayLabel: '아버지' }));

  // ---- levels / program
  await t('F2: assigned trainee writes levels', setDoc(doc(d2, `${P}/state/levels`), { levels: { odd: 2 }, updatedTs: Date.now() }));
  await t('F2: family member playing cannot overwrite levels', setDoc(doc(d5, `${P}/state/levels`), { levels: { odd: 5 }, updatedTs: Date.now() }), false);
  await t('F2: admin may reset levels', setDoc(doc(d3, `${P}/state/levels`), { levels: { odd: 1 }, updatedTs: Date.now() }));
  await t('F2: any member creates program start date once', setDoc(doc(d5, `${P}/state/program`), { startDate: today }));
  await t('F2: non-admin cannot change program start date', setDoc(doc(d5, `${P}/state/program`), { startDate: '2020-01-01' }), false);

  // ---- progress (live dashboard)
  const pid = `${today}-m2`, planned = ['odd', 'shop', 'flash'];
  let pr = progressStart(null, { userId: 'm2', date: today, planned, gameId: 'odd', now: Date.now() });
  const withSts = (x, o = {}) => Object.assign({}, x, { sts: serverTimestamp() }, o);
  await t('F2: trainee writes progress at game start', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr)));
  pr = progressFinish(pr, { gameId: 'odd', result: { acc: 0.8, correct: 4, total: 5, sec: 55, level: 2 }, now: Date.now() });
  await t('F2: trainee updates progress at game end', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr)));
  await t('F2: family reads progress', getDoc(doc(d5, `${P}/progress/${pid}`)));
  await t('F2: family lists progress', getDocs(collection(d3, `${P}/progress`)));
  await t('F2: non-member cannot read progress', getDoc(doc(db('stranger'), `${P}/progress/${pid}`)), false);
  await t('F2: progress wrong doc id denied', setDoc(doc(d2, `${P}/progress/2020-01-01-m2`), withSts(pr)), false);
  await t('F2: progress for someone else denied', setDoc(doc(d5, `${P}/progress/${pid}`), withSts(pr)), false);
  await t('F2: non-trainee cannot write own progress', setDoc(doc(d5, `${P}/progress/${today}-m5`), withSts(Object.assign({}, pr, { userId: 'm5' }))), false);
  await t('F2: progress client sts denied', setDoc(doc(d2, `${P}/progress/${pid}`), Object.assign({}, pr, { sts: Timestamp.fromMillis(Date.now()) })), false);
  await t('F2: progress too many results denied', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr, { results: Array(14).fill({ g: 'x' }) })), false);
  await t('F2: progress bad status denied', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr, { status: 'cheated' })), false);
  await t('F2: progress extra key denied', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr, { note: 'x' })), false);
  await t('F2: progress idx not int denied', setDoc(doc(d2, `${P}/progress/${pid}`), withSts(pr, { idx: 1.5 })), false);
  await t('F2: non-admin cannot delete progress', deleteDoc(doc(d5, `${P}/progress/${pid}`)), false);

  // ---- presence (heartbeat)
  const beat = (x = {}) => Object.assign({ lastSeen: serverTimestamp(), ts: Date.now(), screen: 'home', device: 'Android' }, x);
  await t('F2: trainee writes heartbeat', setDoc(doc(d2, `${P}/presence/m2`), beat()));
  await t('F2: heartbeat faster than 20 s denied', setDoc(doc(d2, `${P}/presence/m2`), beat()), false);
  await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), `${P}/presence/m2`), { lastSeen: Timestamp.fromMillis(Date.now() - 61e3) }); });
  await t('F2: heartbeat after 60 s ok', setDoc(doc(d2, `${P}/presence/m2`), beat()));
  await t('F2: heartbeat for someone else denied', setDoc(doc(d5, `${P}/presence/m2`), beat()), false);
  await t('F2: heartbeat client lastSeen denied', setDoc(doc(d5, `${P}/presence/m5`), beat({ lastSeen: Timestamp.fromMillis(Date.now()) })), false);
  await t('F2: heartbeat extra key denied', setDoc(doc(d5, `${P}/presence/m5`), beat({ battery: 50 })), false);
  await t('F2: family reads trainee presence', getDoc(doc(d3, `${P}/presence/m2`)));

  // ---- recovery codes, removal, deletions
  const tc = (by, m, x = {}) => Object.assign({ familyId: F2, memberId: m, createdBy: by, createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 15 * 60e3) }, x);
  await ageMember('m4', 3 * 864e5);
  await t('F2: non-admin (joined days ago) cannot issue recovery code for the trainee', setDoc(doc(d4, 'transferCodes', 'RCA234'), tc('m4', 'm2')), false);
  await t('F2: trainee cannot issue recovery code for others', setDoc(doc(d2, 'transferCodes', 'RCB234'), tc('m2', 'm1')), false);
  await t('F2: anyone issues own transfer code', setDoc(doc(d4, 'transferCodes', 'RCC234'), tc('m4', 'm4')));
  await t('F2: admin issues recovery code for the trainee', setDoc(doc(d3, 'transferCodes', 'RCD234'), tc('m3', 'm2')));
  await t('F2: non-admin cannot delete someone else\'s code', deleteDoc(doc(d4, 'transferCodes', 'RCD234')), false);
  await t('F2: creator deletes own code', deleteDoc(doc(d4, 'transferCodes', 'RCC234')));
  await t('F2: admin rotates join code', (async () => { const b = writeBatch(d3); b.set(doc(d3, 'joinCodes', 'FAN234'), { familyId: F2, createdBy: 'm3', createdTs: serverTimestamp(), expiresTs: in7d() }); b.update(doc(d3, 'families', F2), { joinCode: 'FAN234' }); await b.commit(); })());
  await t('F2: admin deletes the old join code', deleteDoc(doc(d3, 'joinCodes', C2)));
  await t('F2: non-admin cannot remove a member', deleteDoc(doc(d5, `${P}/uids/u4`)), false);
  await t('F2: admin cannot remove the owner (uid link)', deleteDoc(doc(d3, `${P}/uids/u1`)), false);
  await t('F2: admin cannot mark the owner as left', updateDoc(doc(d3, `${P}/members/m1`), { leftTs: serverTimestamp() }), false);
  await t('F2: admin removes a member (uid link)', deleteDoc(doc(d3, `${P}/uids/u4`)));
  await t('F2: admin marks the removed member as left', updateDoc(doc(d3, `${P}/members/m4`), { leftTs: serverTimestamp() }));
  await t('F2: removed member is locked out', getDoc(doc(d4, `${P}/state/plan`)), false);
  await t('F2: trainee session', setDoc(doc(d2, `${P}/sessions/s1`), { date: today, ts: Date.now(), gameId: 'odd', userId: 'm2', inCourse: true }));
  await t('F2: non-admin cannot delete trainee session', deleteDoc(doc(d5, `${P}/sessions/s1`)), false);
  await t('F2: admin deletes trainee session', deleteDoc(doc(d3, `${P}/sessions/s1`)));
  await t('F2: trainee message', setDoc(doc(d2, `${P}/messages/x1`), { authorId: 'm2', text: '고마워', ts: Date.now(), sts: serverTimestamp(), kind: 'text', push: 'pending' }));
  await t('F2: non-admin cannot delete others\' message', deleteDoc(doc(d5, `${P}/messages/x1`)), false);
  await t('F2: admin deletes a message (moderation)', deleteDoc(doc(d3, `${P}/messages/x1`)));
  await t('F2: admin deletes progress', deleteDoc(doc(d3, `${P}/progress/${pid}`)));
  await t('F2: non-owner admin cannot delete the whole family', deleteDoc(doc(d3, 'families', F2)), false);
  await t('F2: chat still works for a plain family member', setDoc(doc(d5, `${P}/messages/x2`), { authorId: 'm5', text: '할아버지 화이팅', ts: Date.now(), sts: serverTimestamp(), kind: 'text', push: 'pending' }));
  // 방 주인 넘기기 + 나를 관리자로 남기기를 한 번에
  await t('F2: owner hands over ownership and stays admin in one write', updateDoc(doc(d1, 'families', F2), { ownerMemberId: 'm3', admins: ['m3', 'm1'] }));
  await t('F2: previous owner is still admin', setDoc(doc(d1, `${P}/state/display`), disp('m1')));
  await t('F2: new owner can revoke the previous owner', updateDoc(doc(d3, 'families', F2), { admins: ['m3'] }));
  await t('F2: previous owner is no longer admin', setDoc(doc(d1, `${P}/state/display`), disp('m1')), false);
}
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
