import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch as writeBatchRaw, serverTimestamp, Timestamp, collection, getDocs, deleteField } from 'firebase/firestore';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const env = await initializeTestEnvironment({ projectId: 'demo-bw', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
let pass = 0, fail = 0;
async function t(name, p, ok = true) { try { await (ok ? assertSucceeds(p) : assertFails(p)); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, process.env.RULES_DEBUG ? e.message.replace(/\s+/g, ' ').slice(0, 500) : e.message.split('\n')[0]); } }
const db = u => env.authenticatedContext(u).firestore();
// ---- 가족방 만들기 코드: 시험 환경에 코드(해시만)를 심어 두고, 가족방을 만드는 배치에는 코드를 입력한 증거(createProofs)를 자동으로 함께 넣어요.
const sha = x => createHash('sha256').update(x).digest('hex');
const CREATE_CODE = 'test-create-code-1';
await env.withSecurityRulesDisabled(async c => { const x = c.firestore(); await setDoc(doc(x, 'appConfig/creation'), { codeHash: sha(sha(CREATE_CODE)), setBy: 'seed', updatedTs: Timestamp.now() }); });
const writeBatch = d => {
  const b = writeBatchRaw(d), set = b.set.bind(b);
  b.set = (ref, data, ...r) => { if (ref.parent.id === 'families' && ref.parent.parent === null && data && data.createdBy) set(doc(d, 'createProofs', data.createdBy), { proof: sha(CREATE_CODE), ts: serverTimestamp() }); return set(ref, data, ...r); };
  return b;
};
const anon = env.unauthenticatedContext().firestore();
const F = 'fam1', CODE = 'ABC234', in7d = () => Timestamp.fromMillis(Date.now() + 7 * 864e5);
// 훈련하는 분 목록 문서 (state/trainees): ids 와 호칭
const tsDoc = (by, ids, labels) => ({ v: 1, ids, labels: labels || Object.fromEntries(ids.map(i => [i, '호칭' + i.slice(0, 4)])), updatedBy: by, updatedTs: Date.now() });
// ---- founding (uid A = father)
{
  const d = db('uidA'), b = writeBatch(d);
  b.set(doc(d, 'families', F), { createdBy: 'uidA', createdTs: serverTimestamp(), ownerMemberId: 'mA', joinCode: CODE, name: '우리집', schemaVersion: 1 });
  b.set(doc(d, 'joinCodes', CODE), { familyId: F, createdBy: 'mA', createdTs: serverTimestamp(), expiresTs: in7d() });
  b.set(doc(d, `families/${F}/uids/uidA`), { memberId: 'mA', via: 'create', addedTs: serverTimestamp() });
  b.set(doc(d, `families/${F}/members/mA`), { name: '아버지', role: 'trainee', joinedTs: serverTimestamp() });
  b.set(doc(d, 'users/uidA'), { familyId: F, memberId: 'mA', updatedAt: serverTimestamp() });
  await t('found family', b.commit());
  await t('set trainee (self-claim registry)', setDoc(doc(d, `families/${F}/state/trainees`), tsDoc('mA', ['mA'], { mA: '아버지' })));
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
const nudge = d => { const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/n${Math.random().toString(36).slice(2, 8)}`), msg({ kind: 'nudge', toId: 'mA', text: '아버지, 산책 가요', acks: {} })); b.update(doc(d, `families/${F}/members/mB`), { 'nudgeAt.mA': serverTimestamp() }); return b.commit(); };
await t('nudge without member stamp denied', setDoc(doc(dB, `families/${F}/messages/nx`), msg({ kind: 'nudge', toId: 'mA' })), false);
await t('nudge #1', nudge(dB));
await t('nudge #2 within 115m denied', nudge(dB), false);
await t('nudge to non-trainee denied', (async () => { const d = dA; const b = writeBatch(d); b.set(doc(d, `families/${F}/messages/ny`), msg({ authorId: 'mA', kind: 'nudge', toId: 'mB' })); b.update(doc(d, `families/${F}/members/mA`), { 'nudgeAt.mB': serverTimestamp() }); await b.commit(); })(), false);
await t('set nudgeAt to past denied', updateDoc(doc(dB, `families/${F}/members/mB`), { 'nudgeAt.mA': Timestamp.fromMillis(0) }), false);
await t('remove nudgeAt key (reset limit) denied', updateDoc(doc(dB, `families/${F}/members/mB`), { 'nudgeAt.mA': deleteField() }), false);
await t('remove nudgeAt map (reset limit) denied', updateDoc(doc(dB, `families/${F}/members/mB`), { nudgeAt: deleteField() }), false);
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
await t('alarm by non-admin denied', setDoc(doc(dB, `families/${F}/trainees/mA/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mB', updatedTs: Date.now() }), false);
await t('alarm', setDoc(doc(dA, `families/${F}/trainees/mA/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mA', updatedTs: Date.now() }));
await t('alarm bad day denied', setDoc(doc(dA, `families/${F}/trainees/mA/state/alarm`), { time: '10:00', days: [7], updatedBy: 'mA', updatedTs: Date.now() }), false);
await t('old family-level state/alarm denied', setDoc(doc(dA, `families/${F}/state/alarm`), { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6], updatedBy: 'mA', updatedTs: Date.now() }), false);
await t('levels', setDoc(doc(dA, `families/${F}/trainees/mA/state/levels`), { levels: { flash: 2 }, updatedTs: Date.now() }));
await t('program', setDoc(doc(dA, `families/${F}/trainees/mA/state/program`), { startDate: today }));
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
  const sv = (who, extra = {}) => Object.assign({ kind: 'phq9', version: '1', answers: [0, 1, 0, 0, 1, 0, 0, 0, 0], score: 2, ts: Date.now(), date: today, mode: 'self', answeredBy: who, relation: '본인', subjectId: 'mA' }, extra);
  await t('survey without subjectId denied', (async () => { const x = sv('mB', { mode: 'family' }); delete x.subjectId; await setDoc(doc(dB, `families/${F}/surveys/s0`), x); })(), false);
  await t('survey about a non-trainee denied', setDoc(doc(dB, `families/${F}/surveys/s0b`), sv('mB', { mode: 'family', subjectId: 'mB' })), false);
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
  await t('iadl survey kind allowed (family)', setDoc(doc(dB, `families/${F}/surveys/i1`), { kind: 'iadl', version: '1', answers: [0, 1, 0, 2, 0, 0, 1, 0], score: 4, ts: Date.now(), date: today, mode: 'family', answeredBy: 'mB', relation: '아들', subjectId: 'mA' }));
  await t('trainee cannot read iadl survey', getDoc(doc(dA, `families/${F}/surveys/i1`)), false);
}
// ---- clinicalTests (병원 검사 기록): 가족만 읽기·쓰기
{
  const ct = (who, extra = {}) => Object.assign({ test: 'cist', date: today, score: 25, max: 30, place: '서울 ○○병원', result: '정상', memo: '다음 진료 때 보여 드리기', recordedBy: who, ts: Date.now(), subjectId: 'mA' }, extra);
  await t('clinical without subjectId denied', (async () => { const x = ct('mB'); delete x.subjectId; await setDoc(doc(dB, `families/${F}/clinicalTests/k0`), x); })(), false);
  await t('clinical about a non-trainee denied', setDoc(doc(dB, `families/${F}/clinicalTests/k0b`), ct('mB', { subjectId: 'mB' })), false);
  await t('family records clinical test', setDoc(doc(dB, `families/${F}/clinicalTests/k1`), ct('mB')));
  await t('family reads clinical test', getDoc(doc(dB, `families/${F}/clinicalTests/k1`)));
  await t('trainee cannot read clinical test', getDoc(doc(dA, `families/${F}/clinicalTests/k1`)), false);
  await t('trainee cannot list clinical tests', getDocs(collection(dA, `families/${F}/clinicalTests`)), false);
  await t('trainee cannot write clinical test', setDoc(doc(dA, `families/${F}/clinicalTests/k2`), ct('mA')), false);
  await t('date-only record (no score) ok', setDoc(doc(dB, `families/${F}/clinicalTests/k3`), { test: 'cist', date: today, recordedBy: 'mB', ts: Date.now(), subjectId: 'mA' }));
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
// ---- 방 주인인 훈련하는 분: T 에 있는 동안은 role 을 family 로 못 바꿔요. 같은 배치에서 T 에서 빼면 돼요 (membership.deleteFamily)
await t('trainee-owner cannot flip own role to family while in T', updateDoc(doc(db('uidA2'), `families/${F}/members/mA`), { role: 'family' }), false);
await t('trainee-owner leaves T and flips role in one batch', (async () => { const d = db('uidA2'), b = writeBatch(d); b.set(doc(d, `families/${F}/state/trainees`), tsDoc('mA', [], {})); b.update(doc(d, `families/${F}/members/mA`), { role: 'family' }); await b.commit(); })());
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
  const F2 = 'fam2', C2 = 'FAM234', P = `families/${F2}`, TS = `${P}/trainees/m2/state`;
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
  await t('F2: new trainee claims the empty trainee list (initial join)', setDoc(doc(d2, `${P}/state/trainees`), tsDoc('m2', ['m2'], { m2: '아버지' })));
  await t('F2: daughter joins as family', join(d3, 'u3', 'm3', 'family', '딸'));
  await t('F2: son-in-law joins as trainee', join(d4, 'u4', 'm4', 'trainee', '사위'));
  await t('F2: second trainee joiner cannot self-claim once the list exists', setDoc(doc(d4, `${P}/state/trainees`), tsDoc('m4', ['m4'], { m4: '사위' })), false);
  await t('F2: second trainee joiner cannot append self either', setDoc(doc(d4, `${P}/state/trainees`), tsDoc('m4', ['m2', 'm4'], { m2: '아버지', m4: '사위' })), false);
  await t('F2: joiner switches own role trainee→family within 30 min (onboarding "가족으로 쓸게요")', updateDoc(doc(d4, `${P}/members/m4`), { role: 'family' }));
  await t('F2: grandson joins as family', join(d5, 'u5', 'm5', 'family', '손자'));

  // ---- migration: no admins field → owner is the only admin
  const plan = (by, o = {}) => Object.assign(planDoc({ gamesPerDay: 3, weekdays: [1, 3, 5], games: { odd: { mode: 'fixed', level: 3 } } }, CAT, by, Date.now()), o);
  const disp = (by, o = {}) => Object.assign(displayDoc({ font: 'noto', size: 'max', contrast: true, voice: true, rate: 0.75 }, by, Date.now()), o);
  await t('F2: owner (legacy family, no admins) writes plan', setDoc(doc(d1, `${TS}/plan`), plan('m1')));
  await t('F2: owner writes learner display', setDoc(doc(d1, `${TS}/display`), disp('m1')));
  await t('F2: owner writes alarm', setDoc(doc(d1, `${TS}/alarm`), { time: '09:30', days: [1, 3, 5], updatedBy: 'm1', updatedTs: Date.now() }));
  await t('F2: non-admin family cannot write plan', setDoc(doc(d3, `${TS}/plan`), plan('m3')), false);
  await t('F2: non-admin family cannot write display', setDoc(doc(d3, `${TS}/display`), disp('m3')), false);
  await t('F2: non-admin family cannot write alarm', setDoc(doc(d3, `${TS}/alarm`), { time: '09:30', days: [1], updatedBy: 'm3', updatedTs: Date.now() }), false);
  await t('F2: trainee cannot write plan', setDoc(doc(d2, `${TS}/plan`), plan('m2')), false);
  await t('F2: trainee cannot write display', setDoc(doc(d2, `${TS}/display`), disp('m2', { size: 'normal' })), false);
  await t('F2: everyone reads plan and display', Promise.all([getDoc(doc(d2, `${TS}/plan`)), getDoc(doc(d3, `${TS}/display`))]));
  await t('F2: non-member cannot read plan', getDoc(doc(db('stranger'), `${TS}/plan`)), false);
  await t('F2: non-admin cannot delete state docs', deleteDoc(doc(d3, `${TS}/plan`)), false);
  await t('F2: plan for a member who is not a trainee denied', setDoc(doc(d1, `${P}/trainees/m3/state/plan`), plan('m1')), false);
  await t('F2: old family-level state/plan denied', setDoc(doc(d1, `${P}/state/plan`), plan('m1')), false);

  // ---- plan / display validation (admin m1)
  const badPlan = [['gamesPerDay 10', { gamesPerDay: 10 }], ['gamesPerDay 0', { gamesPerDay: 0 }], ['gamesPerDay 2.5', { gamesPerDay: 2.5 }], ['roundsPerGame 2', { roundsPerGame: 2 }], ['roundsPerGame 11', { roundsPerGame: 11 }],
    ['targetMin 61', { targetMin: 61 }], ['weekdays empty', { weekdays: [] }], ['weekday 7', { weekdays: [7] }], ['checkEveryWeeks 3', { checkEveryWeeks: 3 }], ['order bad', { order: 'random' }],
    ['showScore string', { showScore: 'yes' }], ['games list', { games: [] }], ['forged updatedBy', { updatedBy: 'm3' }], ['future updatedTs', { updatedTs: Date.now() + 3600e3 }], ['extra key', { secret: 1 }], ['v 2', { v: 2 }],
    ['autoNextSec 7', { autoNextSec: 7 }], ['autoNextSec string', { autoNextSec: '10' }], ['autoNextSec 20', { autoNextSec: 20 }]];
  for (const [name, o] of badPlan) await t('F2: plan ' + name + ' denied', setDoc(doc(d1, `${TS}/plan`), plan('m1', o)), false);
  await t('F2: plan missing key denied', (async () => { const x = plan('m1'); delete x.checkin; await setDoc(doc(d1, `${TS}/plan`), x); })(), false);
  for (const v of [0, 5, 10, 15]) await t('F2: plan autoNextSec ' + v + ' ok', setDoc(doc(d1, `${TS}/plan`), plan('m1', { autoNextSec: v })));
  await t('F2: plan without autoNextSec (older writer) ok', (async () => { const x = plan('m1'); delete x.autoNextSec; await setDoc(doc(d1, `${TS}/plan`), x); })());
  await t('F2: plan roundsPerGame null ok', setDoc(doc(d1, `${TS}/plan`), plan('m1', { roundsPerGame: null })));
  await t('F2: plan roundsPerGame 10 + 9 games + off check ok', setDoc(doc(d1, `${TS}/plan`), plan('m1', { roundsPerGame: 10, gamesPerDay: 9, checkEveryWeeks: 0, order: 'fixed' })));
  const badDisp = [['font', { font: 'comic' }], ['size', { size: 'huge' }], ['rate high', { rate: 3 }], ['rate low', { rate: 0.1 }], ['contrast str', { contrast: 'on' }], ['forged by', { updatedBy: 'm3' }], ['extra', { theme: 'dark' }]];
  for (const [name, o] of badDisp) await t('F2: display ' + name + ' denied', setDoc(doc(d1, `${TS}/display`), disp('m1', o)), false);
  await t('F2: display missing voice denied', (async () => { const x = disp('m1'); delete x.voice; await setDoc(doc(d1, `${TS}/display`), x); })(), false);

  // ---- admins list: owner only, one grant at a time, family role only
  await t('F2: non-owner cannot grant admin', updateDoc(doc(d3, 'families', F2), { admins: ['m3'] }), false);
  await t('F2: cannot grant admin to the trainee-role member', updateDoc(doc(d1, 'families', F2), { admins: ['m2'] }), false);
  await t('F2: cannot grant admin to a non-member', updateDoc(doc(d1, 'families', F2), { admins: ['ghost'] }), false);
  await t('F2: cannot grant two at once', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }), false);
  await t('F2: owner grants admin to daughter', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));
  await t('F2: duplicate grant denied', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm3'] }), false);
  await t('F2: grant must append, not reorder', updateDoc(doc(d1, 'families', F2), { admins: ['m5', 'm3'] }), false);
  await t('F2: granted admin writes plan', setDoc(doc(d3, `${TS}/plan`), plan('m3')));
  await t('F2: granted admin writes display', setDoc(doc(d3, `${TS}/display`), disp('m3', { size: 'xlarge' })));
  await t('F2: granted admin cannot change the admins list', updateDoc(doc(d3, 'families', F2), { admins: ['m3', 'm5'] }), false);
  await t('F2: granted admin cannot take ownership', updateDoc(doc(d3, 'families', F2), { ownerMemberId: 'm3' }), false);
  await t('F2: owner grants a second admin (append)', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }));
  await t('F2: owner revokes one admin', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));
  await t('F2: revoked admin cannot write plan', setDoc(doc(d5, `${TS}/plan`), plan('m5')), false);

  // ---- role changes: admin-only after the initial join (closes "trainee switches to 가족 to read family-only data")
  await t('F2: assigned trainee cannot switch own role to family (even right after joining)', updateDoc(doc(d2, `${P}/members/m2`), { role: 'family' }), false);
  await t('F2: so the trainee still cannot read surveys', getDocs(collection(d2, `${P}/surveys`)), false);
  await t('F2: name + role in one self-update denied', updateDoc(doc(d5, `${P}/members/m5`), { name: '손자2', role: 'trainee' }), false);
  await t('F2: self rename still ok', updateDoc(doc(d5, `${P}/members/m5`), { name: '손주' }));
  await ageMember('m5', 2 * 3600e3);
  await t('F2: family member cannot change own role after the join window', updateDoc(doc(d5, `${P}/members/m5`), { role: 'trainee' }), false);
  await t('F2: non-admin cannot change someone else\'s role', updateDoc(doc(d5, `${P}/members/m2`), { role: 'family' }), false);
  await t('F2: admin cannot switch an in-T trainee to family', updateDoc(doc(d3, `${P}/members/m2`), { role: 'family' }), false);
  await t('F2: admin role value must be valid', updateDoc(doc(d3, `${P}/members/m5`), { role: 'admin' }), false);
  // 관리자로 지정된 사람이 훈련하는 분 역할이 되면 관리자 권한이 꺼져요
  await t('F2: owner grants grandson admin again', updateDoc(doc(d1, 'families', F2), { admins: ['m3', 'm5'] }));
  await t('F2: admin makes grandson a trainee-role member', updateDoc(doc(d1, `${P}/members/m5`), { role: 'trainee' }));
  await t('F2: listed admin with trainee role is not an admin', setDoc(doc(d5, `${TS}/plan`), plan('m5')), false);
  await t('F2: ...and cannot give themselves family role back', updateDoc(doc(d5, `${P}/members/m5`), { role: 'family' }), false);
  await t('F2: admin restores grandson to family', updateDoc(doc(d1, `${P}/members/m5`), { role: 'family' }));
  await t('F2: owner revokes grandson admin', updateDoc(doc(d1, 'families', F2), { admins: ['m3'] }));

  // ---- trainee list: admin-only (closes "any member can reassign the trainee")
  await t('F2: non-admin cannot add self', setDoc(doc(d5, `${P}/state/trainees`), tsDoc('m5', ['m2', 'm5'], { m2: '아버지', m5: '손자' })), false);
  await t('F2: non-admin cannot delete the list', deleteDoc(doc(d5, `${P}/state/trainees`)), false);
  await t('F2: trainee cannot add another', setDoc(doc(d2, `${P}/state/trainees`), tsDoc('m2', ['m2', 'm5'], { m2: '아버지', m5: '손자' })), false);
  await t('F2: admin cannot add a family-role member without the role change', setDoc(doc(d3, `${P}/state/trainees`), tsDoc('m3', ['m2', 'm5'], { m2: '아버지', m5: '손자' })), false);
  await t('F2: admin adds grandson with the role change in one batch', (async () => { const b = writeBatch(d3); b.set(doc(d3, `${P}/state/trainees`), tsDoc('m3', ['m2', 'm5'], { m2: '아버지', m5: '손자' })); b.update(doc(d3, `${P}/members/m5`), { role: 'trainee' }); await b.commit(); })());
  await t('F2: admin removes grandson and makes him family in one batch', (async () => { const b = writeBatch(d3); b.set(doc(d3, `${P}/state/trainees`), tsDoc('m3', ['m2'], { m2: '아버지' })); b.update(doc(d3, `${P}/members/m5`), { role: 'family' }); await b.commit(); })());
  await t('F2: admin cannot add a non-member', setDoc(doc(d3, `${P}/state/trainees`), tsDoc('m3', ['m2', 'ghost'], { m2: '아버지', ghost: '유령' })), false);
  await t('F2: admin relabels', setDoc(doc(d3, `${P}/state/trainees`), tsDoc('m3', ['m2'], { m2: '할아버지' })));
  await t('F2: admin clears the list', setDoc(doc(d3, `${P}/state/trainees`), tsDoc('m3', [], {})));
  await t('F2: only the owner deletes the list doc (admin daughter cannot)', deleteDoc(doc(d3, `${P}/state/trainees`)), false);
  await t('F2: owner deletes the list doc', deleteDoc(doc(d1, `${P}/state/trainees`)));
  await t('F2: family-role newcomer cannot claim an empty list', setDoc(doc(d4, `${P}/state/trainees`), tsDoc('m4', ['m4'], { m4: '사위' })), false);
  await ageMember('m2', 2 * 3600e3);
  await t('F2: trainee-role member who joined >1h ago cannot claim an empty list', setDoc(doc(d2, `${P}/state/trainees`), tsDoc('m2', ['m2'], { m2: '아버지' })), false);
  await t('F2: admin creates the list with the trainee', setDoc(doc(d1, `${P}/state/trainees`), tsDoc('m1', ['m2'], { m2: '아버지' })));

  // ---- levels / program
  await t('F2: assigned trainee writes levels', setDoc(doc(d2, `${TS}/levels`), { levels: { odd: 2 }, updatedTs: Date.now() }));
  await t('F2: family member playing cannot overwrite levels', setDoc(doc(d5, `${TS}/levels`), { levels: { odd: 5 }, updatedTs: Date.now() }), false);
  await t('F2: admin may reset levels', setDoc(doc(d3, `${TS}/levels`), { levels: { odd: 1 }, updatedTs: Date.now() }));
  await t('F2: other family member cannot create the program start date', setDoc(doc(d5, `${TS}/program`), { startDate: today }), false);
  await t('F2: trainee creates own program start date once', setDoc(doc(d2, `${TS}/program`), { startDate: today }));
  await t('F2: trainee cannot change program start date', setDoc(doc(d2, `${TS}/program`), { startDate: '2020-01-01' }), false);
  await t('F2: admin changes program start date', setDoc(doc(d3, `${TS}/program`), { startDate: today }));

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
  await t('F2: removed member is locked out', getDoc(doc(d4, `${P}/state/trainees`)), false);
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
  await t('F2: previous owner is still admin', setDoc(doc(d1, `${TS}/display`), disp('m1')));
  await t('F2: new owner can revoke the previous owner', updateDoc(doc(d3, 'families', F2), { admins: ['m3'] }));
  await t('F2: previous owner is no longer admin', setDoc(doc(d1, `${TS}/display`), disp('m1')), false);
}
// =============================================================================
// 공격자 시점 점검 (독립 검증): 내보낸 사람의 재입장, 떠난 사람에게 방 주인 넘기기, 역할·관리자 우회
// F3: o 방 주인(가족) / a 관리자(가족) / f 가족(관리자 아님) / t 훈련하는 분 / k 내보낼 사람(가족)
// =============================================================================
{
  const { planDoc, progressStart } = await import('../js/program.js');
  const F3 = 'fam3', C3 = 'FAQ234', P = `families/${F3}`;
  const dO = db('uo'), dAd = db('ua'), dF = db('uf'), dT = db('ut'), dK = db('uk'), dK2 = db('uk2');
  const join = (dd, u, m, role, name) => { const b = writeBatch(dd); b.set(doc(dd, `${P}/uids/${u}`), { memberId: m, via: 'join', code: C3, addedTs: serverTimestamp() }); b.set(doc(dd, `${P}/members/${m}`), { name, role, joinedTs: serverTimestamp() }); return b.commit(); };
  const age = (m, ms) => env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), `${P}/members/${m}`), { joinedTs: Timestamp.fromMillis(Date.now() - ms) }); });
  {
    const b = writeBatch(dO);
    b.set(doc(dO, 'families', F3), { createdBy: 'uo', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: C3 });
    b.set(doc(dO, 'joinCodes', C3), { familyId: F3, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dO, `${P}/uids/uo`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dO, `${P}/members/o`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F3: found', b.commit());
  }
  await t('F3: admin-to-be joins', join(dAd, 'ua', 'a', 'family', '딸'));
  await t('F3: plain family joins', join(dF, 'uf', 'f', 'family', '사위'));
  await t('F3: trainee joins', join(dT, 'ut', 't', 'trainee', '아버지'));
  await t('F3: trainee claims empty list', setDoc(doc(dT, `${P}/state/trainees`), tsDoc('t', ['t'], { t: '아버지' })));
  await t('F3: member to be kicked joins', join(dK, 'uk', 'k', 'family', '손님'));
  await t('F3: owner grants a', updateDoc(doc(dO, 'families', F3), { admins: ['a'] }));
  for (const m of ['a', 'f', 't', 'k']) await age(m, 3 * 3600e3);

  // -- non-admin family: every escalation path
  await t('F3: family cannot add self to admins', updateDoc(doc(dF, 'families', F3), { admins: ['a', 'f'] }), false);
  await t('F3: family cannot take ownership', updateDoc(doc(dF, 'families', F3), { ownerMemberId: 'f' }), false);
  await t('F3: family cannot set admins + owner together', updateDoc(doc(dF, 'families', F3), { ownerMemberId: 'f', admins: ['f'] }), false);
  await t('F3: family cannot write plan', setDoc(doc(dF, `${P}/trainees/t/state/plan`), planDoc({}, [], 'f', Date.now())), false);
  await t('F3: family cannot replace the trainee list', setDoc(doc(dF, `${P}/state/trainees`), tsDoc('f', ['f'], { f: 'x' })), false);
  await t('F3: family cannot relabel trainee', updateDoc(doc(dF, `${P}/state/trainees`), { labels: { t: '할배' }, updatedBy: 'f', updatedTs: Date.now() }), false);
  await t('F3: family cannot delete display/alarm', deleteDoc(doc(dF, `${P}/trainees/t/state/alarm`)), false);
  await t('F3: family cannot flip trainee role', updateDoc(doc(dF, `${P}/members/t`), { role: 'family' }), false);
  await t('F3: family cannot rotate code', (async () => { const b = writeBatch(dF); b.set(doc(dF, 'joinCodes', 'FFF234'), { familyId: F3, createdBy: 'f', createdTs: serverTimestamp(), expiresTs: in7d() }); b.update(doc(dF, 'families', F3), { joinCode: 'FFF234' }); await b.commit(); })(), false);
  await t('F3: family cannot rewrite own joinedTs to reopen the role window', updateDoc(doc(dF, `${P}/members/f`), { joinedTs: serverTimestamp() }), false);
  await t('F3: family cannot change own role after window', updateDoc(doc(dF, `${P}/members/f`), { role: 'trainee' }), false);

  // -- trainee: role, family-only reads, forging
  await t('F3: trainee cannot switch own role', updateDoc(doc(dT, `${P}/members/t`), { role: 'family' }), false);
  await t('F3: trainee cannot read surveys', getDocs(collection(dT, `${P}/surveys`)), false);
  await t('F3: trainee cannot read clocks', getDocs(collection(dT, `${P}/clocks`)), false);
  await t('F3: trainee cannot delete the trainee list', deleteDoc(doc(dT, `${P}/state/trainees`)), false);
  await t('F3: trainee cannot remove self from the list', setDoc(doc(dT, `${P}/state/trainees`), tsDoc('t', [], {})), false);
  const today3 = new Date().toISOString().slice(0, 10);
  const pr = Object.assign(progressStart(null, { userId: 't', date: today3, planned: ['odd'], gameId: 'odd', now: Date.now() }), { sts: serverTimestamp() });
  await t('F3: family cannot forge trainee progress', setDoc(doc(dF, `${P}/progress/${today3}-t`), pr), false);
  await t('F3: admin cannot forge trainee progress either', setDoc(doc(dAd, `${P}/progress/${today3}-t`), pr), false);
  await t('F3: family cannot forge trainee presence', setDoc(doc(dF, `${P}/presence/t`), { lastSeen: serverTimestamp(), ts: Date.now() }), false);

  // -- kicked member: removal must be final
  await t('F3: k makes an own transfer code before being kicked', setDoc(doc(dK, 'transferCodes', 'KKK234'), { familyId: F3, memberId: 'k', createdBy: 'k', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 20 * 60e3) }));
  await t('F3: admin removes k (uid link)', deleteDoc(doc(dAd, `${P}/uids/uk`)));
  await t('F3: admin marks k as left', updateDoc(doc(dAd, `${P}/members/k`), { leftTs: serverTimestamp() }));
  await t('F3: kicked k cannot read', getDoc(doc(dK, `${P}/state/trainees`)), false);
  await t('F3: kicked k cannot re-enter with the pre-made transfer code', (async () => {
    const b = writeBatch(dK2);
    b.update(doc(dK2, 'transferCodes', 'KKK234'), { usedBy: 'uk2', usedTs: serverTimestamp() });
    b.set(doc(dK2, `${P}/uids/uk2`), { memberId: 'k', via: 'transfer', code: 'KKK234', addedTs: serverTimestamp() });
    await b.commit();
  })(), false);
  await t('F3: kicked k still locked out on a second device', getDoc(doc(dK2, `${P}/state/trainees`)), false);
  await t('F3: admin cannot grant-recover a left member either', setDoc(doc(dAd, 'transferCodes', 'KKL234'), { familyId: F3, memberId: 'k', createdBy: 'a', createdTs: serverTimestamp(), expiresTs: Timestamp.fromMillis(Date.now() + 20 * 60e3) }), false);
  await t('F3: owner cannot grant admin to a left member', updateDoc(doc(dO, 'families', F3), { admins: ['a', 'k'] }), false);

  // -- owner protection and ownership transfer
  await t('F3: admin cannot remove owner link', deleteDoc(doc(dAd, `${P}/uids/uo`)), false);
  await t('F3: admin cannot mark owner left', updateDoc(doc(dAd, `${P}/members/o`), { leftTs: serverTimestamp() }), false);
  await t('F3: admin cannot delete owner member doc', deleteDoc(doc(dAd, `${P}/members/o`)), false);
  await t('F3: admin cannot revoke owner by editing admins', updateDoc(doc(dAd, 'families', F3), { admins: [] }), false);
  await t('F3: admin cannot read owner push devices', getDocs(collection(dAd, `${P}/members/o/devices`)), false);
  await t('F3: owner cannot hand the room to a left member (room would be orphaned)', updateDoc(doc(dO, 'families', F3), { ownerMemberId: 'k' }), false);
  await t('F3: owner cannot hand the room to a non-member', updateDoc(doc(dO, 'families', F3), { ownerMemberId: 'ghost' }), false);
  await t('F3: owner cannot sneak a name change into a handover', updateDoc(doc(dO, 'families', F3), { ownerMemberId: 'a', name: 'x' }), false);
  await t('F3: owner hands room to admin a', updateDoc(doc(dO, 'families', F3), { ownerMemberId: 'a' }));
  await t('F3: old owner is now plain family (not in admins)', setDoc(doc(dO, `${P}/trainees/t/state/plan`), planDoc({}, [], 'o', Date.now())), false);
  await t('F3: old owner cannot take the room back', updateDoc(doc(dO, 'families', F3), { ownerMemberId: 'o' }), false);
  await t('F3: new owner clears the admins list (owner-only edit)', updateDoc(doc(dAd, 'families', F3), { admins: [] }));
  await t('F3: new owner is still admin with empty admins list', setDoc(doc(dAd, `${P}/trainees/t/state/plan`), planDoc({}, [], 'a', Date.now())));
}

// =============================================================================
// AI 문제 은행·리포트 (DESIGN-AI 부록 C): 문항 기록, 묶음, 상태, 관리자 전용 숫자·리포트, 메모, 검토, 안내 동의, 서버 전용 컬렉션
// F4: o 방 주인(가족) / a 관리자(가족) / f 가족(관리자 아님) / t 훈련하는 분(지정됨)
// =============================================================================
{
  const F4 = 'fam4', C4 = 'FAJ234', P = `families/${F4}`;
  const dO = db('u4o'), dAd = db('u4a'), dF = db('u4f'), dT = db('u4t'), dX = db('u4stranger');
  const join = (dd, u, m, role, name) => { const b = writeBatch(dd); b.set(doc(dd, `${P}/uids/${u}`), { memberId: m, via: 'join', code: C4, addedTs: serverTimestamp() }); b.set(doc(dd, `${P}/members/${m}`), { name, role, joinedTs: serverTimestamp() }); return b.commit(); };
  {
    const b = writeBatch(dO);
    b.set(doc(dO, 'families', F4), { createdBy: 'u4o', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: C4 });
    b.set(doc(dO, 'joinCodes', C4), { familyId: F4, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dO, `${P}/uids/u4o`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dO, `${P}/members/o`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F4: found', b.commit());
  }
  await t('F4: admin-to-be joins', join(dAd, 'u4a', 'a', 'family', '딸'));
  await t('F4: plain family joins', join(dF, 'u4f', 'f', 'family', '사위'));
  await t('F4: trainee joins', join(dT, 'u4t', 't', 'trainee', '아버지'));
  await t('F4: trainee claims the list', setDoc(doc(dT, `${P}/state/trainees`), tsDoc('t', ['t'], { t: '아버지' })));
  const TP = `${P}/trainees/t`;
  await t('F4: owner grants a', updateDoc(doc(dO, 'families', F4), { admins: ['a'] }));
  const d4 = new Date().toISOString().slice(0, 10);

  // ---- itemLogs
  const il = (who, o = {}) => Object.assign({ v: 1, userId: who, date: d4, ts: Date.now(), sts: serverTimestamp(), gameId: 'words', inCourse: true, level: 3, speechOn: true, size: 'xlarge', device: 'android', hour: 10, abandoned: false,
    items: [{ id: 'bk_0123456789abcdef0123', role: 'reference', fmt: 'word_recog', cd: 'memory', lv: 3, score: 0.8, ok: false, rt: 6120, rtStart: 'speech_end', err: ['MISS'], pick: [0, 2], intr: false, pos: 1 }] }, o);
  await t('F4: trainee writes an item log', setDoc(doc(dT, `${P}/itemLogs/s1`), il('t')));
  await t('F4: item log forged userId denied', setDoc(doc(dT, `${P}/itemLogs/s2`), il('f')), false);
  await t('F4: family member cannot write item logs', setDoc(doc(dF, `${P}/itemLogs/s3`), il('f')), false);
  await t('F4: admin cannot write item logs', setDoc(doc(dAd, `${P}/itemLogs/s4`), il('a')), false);
  await t('F4: item log > 20 items denied', setDoc(doc(dT, `${P}/itemLogs/s5`), il('t', { items: Array(21).fill({ role: 'training' }) })), false);
  await t('F4: item log with no items denied', setDoc(doc(dT, `${P}/itemLogs/s5b`), il('t', { items: [] })), false);
  await t('F4: item log extra key denied', setDoc(doc(dT, `${P}/itemLogs/s6`), il('t', { note: 'x' })), false);
  await t('F4: item log client sts denied', setDoc(doc(dT, `${P}/itemLogs/s7`), il('t', { sts: Timestamp.fromMillis(Date.now()) })), false);
  await t('F4: item log bad date denied', setDoc(doc(dT, `${P}/itemLogs/s8`), il('t', { date: '2026-13-01' })), false);
  await t('F4: item log v2 denied', setDoc(doc(dT, `${P}/itemLogs/s9`), il('t', { v: 2 })), false);
  await t('F4: item log update denied', updateDoc(doc(dT, `${P}/itemLogs/s1`), { abandoned: true }), false);
  await t('F4: family-role member reads item logs', getDocs(collection(dF, `${P}/itemLogs`)));
  await t('F4: trainee cannot read item logs (family-only)', getDoc(doc(dT, `${P}/itemLogs/s1`)), false);
  await t('F4: non-member cannot read item logs', getDoc(doc(dX, `${P}/itemLogs/s1`)), false);
  await t('F4: non-admin family cannot delete item logs', deleteDoc(doc(dF, `${P}/itemLogs/s1`)), false);
  await t('F4: trainee deletes own item log', (async () => { await setDoc(doc(dT, `${P}/itemLogs/s10`), il('t')); await deleteDoc(doc(dT, `${P}/itemLogs/s10`)); })());
  await t('F4: admin deletes an item log', deleteDoc(doc(dAd, `${P}/itemLogs/s1`)));

  // ---- server-written docs (seeded with rules disabled)
  await env.withSecurityRulesDisabled(async c => {
    const x = c.firestore();
    await setDoc(doc(x, `${TP}/aiPacks/memory-L3`), { v: 1, items: [] });
    await setDoc(doc(x, `${TP}/aiState/plan`), { v: 1, startDate: d4 });
    await setDoc(doc(x, `${TP}/aiStats/summary`), { v: 1, weeks: [] });
    await setDoc(doc(x, `${TP}/aiSignals/S3-speed-${d4}`), { key: 'S3:speed', on: true });
    await setDoc(doc(x, `${TP}/aiReports/r-a-1`), { v: 1, kind: 'daily' });
    await setDoc(doc(x, `${TP}/aiOps/health`), { server: {} });
    await setDoc(doc(x, `${TP}/aiOps/wakes`), { days: {} });
    await setDoc(doc(x, `${P}/aiOps/bank`), { cells: {} });
    await setDoc(doc(x, 'aiConfig/main'), { familyId: F4, routineKeyHash: 'f'.repeat(64) });
    await setDoc(doc(x, 'aiAggregates/current'), { schema: 'bw.agg.v1' });
    await setDoc(doc(x, 'aiJobs/w-20270408-1410-a1'), { schema: 'bw.job.v1' });
    await setDoc(doc(x, 'aiBank/bk_0123456789abcdef0123'), { status: 'ready' });
  });

  // ---- aiPacks
  await t('F4: trainee reads a pack', getDoc(doc(dT, `${TP}/aiPacks/memory-L3`)));
  await t('F4: family lists packs', getDocs(collection(dF, `${TP}/aiPacks`)));
  await t('F4: non-member cannot read packs', getDoc(doc(dX, `${TP}/aiPacks/memory-L3`)), false);
  await t('F4: admin cannot write packs', setDoc(doc(dAd, `${TP}/aiPacks/memory-L3`), { v: 1, items: [] }), false);
  await t('F4: trainee cannot write packs', setDoc(doc(dT, `${TP}/aiPacks/memory-L4`), { v: 1, items: [] }), false);

  // ---- aiState
  const th = (by, o = {}) => Object.assign({ words: ['낚시', '등산', '트로트'], updatedBy: by, updatedTs: Date.now() }, o);
  await t('F4: admin writes theme words', setDoc(doc(dAd, `${TP}/aiState/themes`), th('a')));
  await t('F4: owner writes theme words', setDoc(doc(dO, `${TP}/aiState/themes`), th('o')));
  await t('F4: 9 theme words denied', setDoc(doc(dAd, `${TP}/aiState/themes`), th('a', { words: Array(9).fill('낚시') })), false);
  await t('F4: theme word > 10 chars denied', setDoc(doc(dAd, `${TP}/aiState/themes`), th('a', { words: ['가'.repeat(11)] })), false);
  await t('F4: 8th theme word too long denied', setDoc(doc(dAd, `${TP}/aiState/themes`), th('a', { words: ['가', '나', '다', '라', '마', '바', '사', '아'.repeat(11)] })), false);
  await t('F4: theme word not a string denied', setDoc(doc(dAd, `${TP}/aiState/themes`), th('a', { words: ['낚시', 3] })), false);
  await t('F4: theme forged updatedBy denied', setDoc(doc(dAd, `${TP}/aiState/themes`), th('o')), false);
  await t('F4: non-admin cannot write themes', setDoc(doc(dF, `${TP}/aiState/themes`), th('f')), false);
  await t('F4: trainee cannot write themes', setDoc(doc(dT, `${TP}/aiState/themes`), th('t')), false);
  await t('F4: admin cannot write the server plan', setDoc(doc(dAd, `${TP}/aiState/plan`), { v: 1, startDate: '2020-01-05' }), false);
  await t('F4: admin turns AI reports off', setDoc(doc(dAd, `${P}/aiState/switch`), { enabled: false, updatedBy: 'a', updatedTs: Date.now() }));
  await t('F4: switch must be bool', setDoc(doc(dAd, `${P}/aiState/switch`), { enabled: 'no', updatedBy: 'a', updatedTs: Date.now() }), false);
  await t('F4: non-admin cannot flip the switch', setDoc(doc(dF, `${P}/aiState/switch`), { enabled: true, updatedBy: 'f', updatedTs: Date.now() }), false);
  await t('F4: family-level themes doc denied', setDoc(doc(dAd, `${P}/aiState/themes`), th('a')), false);
  await t('F4: themes for a non-trainee denied', setDoc(doc(dAd, `${P}/trainees/f/aiState/themes`), th('a')), false);
  await t('F4: unknown aiState doc denied', setDoc(doc(dAd, `${P}/aiState/other`), { enabled: true, updatedBy: 'a', updatedTs: Date.now() }), false);
  await t('F4: admin cannot delete aiState docs', deleteDoc(doc(dAd, `${TP}/aiState/themes`)), false);
  await t('F4: trainee reads aiState', getDoc(doc(dT, `${TP}/aiState/plan`)));

  // ---- admin-only server docs: aiStats, aiSignals, aiReports (all admins), aiOps
  for (const [name, path] of [['aiStats', `${TP}/aiStats/summary`], ['aiSignals', `${TP}/aiSignals/S3-speed-${d4}`], ['aiReports', `${TP}/aiReports/r-a-1`], ['aiOps', `${TP}/aiOps/health`]]) {
    await t(`F4: non-owner admin reads ${name}`, getDoc(doc(dAd, path)));
    await t(`F4: owner reads ${name}`, getDoc(doc(dO, path)));
    await t(`F4: plain family cannot read ${name}`, getDoc(doc(dF, path)), false);
    await t(`F4: trainee cannot read ${name}`, getDoc(doc(dT, path)), false);
    await t(`F4: non-member cannot read ${name}`, getDoc(doc(dX, path)), false);
    await t(`F4: admin cannot write ${name}`, setDoc(doc(dAd, path), { v: 9 }), false);
  }
  await t('F4: admin lists reports', getDocs(collection(dAd, `${TP}/aiReports`)));
  await t('F4: plain family cannot list reports', getDocs(collection(dF, `${TP}/aiReports`)), false);
  await t('F4: admin reads nested aiOps doc path', getDoc(doc(dAd, `${TP}/aiOps/wakes`)));
  await t('F4: admin reads family-level aiOps/bank', getDoc(doc(dAd, `${P}/aiOps/bank`)));
  await t('F4: trainee cannot read family-level aiOps/bank', getDoc(doc(dT, `${P}/aiOps/bank`)), false);
  await t('F4: plain family cannot read family-level aiOps/bank', getDoc(doc(dF, `${P}/aiOps/bank`)), false);

  // ---- aiNotes
  const note = (by, o = {}) => Object.assign({ from: '2027-02-28', to: '2027-03-06', codes: ['illness', 'sleep'], text: '기침약 3일', by, ts: Date.now() }, o);
  await t('F4: admin writes a note', setDoc(doc(dAd, `${TP}/aiNotes/n1`), note('a')));
  await t('F4: open-ended note (to null) ok', setDoc(doc(dAd, `${TP}/aiNotes/n2`), note('a', { to: null })));
  await t('F4: note unknown code denied', setDoc(doc(dAd, `${TP}/aiNotes/n3`), note('a', { codes: ['cancer'] })), false);
  await t('F4: note without codes denied', setDoc(doc(dAd, `${TP}/aiNotes/n4`), note('a', { codes: [] })), false);
  await t('F4: note text > 200 denied', setDoc(doc(dAd, `${TP}/aiNotes/n5`), note('a', { text: 'x'.repeat(201) })), false);
  await t('F4: note ends before it starts denied', setDoc(doc(dAd, `${TP}/aiNotes/n6`), note('a', { to: '2027-02-01' })), false);
  await t('F4: note forged author denied', setDoc(doc(dAd, `${TP}/aiNotes/n7`), note('o')), false);
  await t('F4: non-admin cannot write notes', setDoc(doc(dF, `${TP}/aiNotes/n8`), note('f')), false);
  await t('F4: plain family cannot read notes', getDoc(doc(dF, `${TP}/aiNotes/n1`)), false);
  await t('F4: trainee cannot read notes', getDocs(collection(dT, `${TP}/aiNotes`)), false);
  await t('F4: admin updates a note', setDoc(doc(dAd, `${TP}/aiNotes/n1`), note('a', { to: '2027-03-07' })));
  await t('F4: admin deletes a note', deleteDoc(doc(dAd, `${TP}/aiNotes/n2`)));

  // ---- aiReview
  const rv = (by, o = {}) => Object.assign({ decision: 'approve', by, ts: Date.now() }, o);
  await t('F4: admin approves a bank item', setDoc(doc(dAd, `${P}/aiReview/bk_0123456789abcdef0123`), rv('a')));
  await t('F4: review bad item id denied', setDoc(doc(dAd, `${P}/aiReview/evil`), rv('a')), false);
  await t('F4: review bad decision denied', setDoc(doc(dAd, `${P}/aiReview/bk_0123456789abcdef0124`), rv('a', { decision: 'delete' })), false);
  await t('F4: non-admin cannot review', setDoc(doc(dF, `${P}/aiReview/bk_0123456789abcdef0125`), rv('f')), false);
  await t('F4: review cannot be edited', updateDoc(doc(dAd, `${P}/aiReview/bk_0123456789abcdef0123`), { decision: 'retire' }), false);

  // ---- consents
  const cs = (o = {}) => Object.assign({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp(), withFamily: true }, o);
  await t('F4: trainee acknowledges the notice', setDoc(doc(dT, `${P}/consents/t`), cs()));
  await t('F4: consent with client time denied', setDoc(doc(dF, `${P}/consents/f`), cs({ ackTs: Timestamp.fromMillis(Date.now()) })), false);
  await t('F4: consent for someone else denied', setDoc(doc(dAd, `${P}/consents/t`), cs()), false);
  await t('F4: consent wrong kind denied', setDoc(doc(dF, `${P}/consents/f`), cs({ kind: 'other' })), false);
  await t('F4: consent extra key denied', setDoc(doc(dF, `${P}/consents/f`), cs({ note: 1 })), false);
  await t('F4: trainee reads own consent', getDoc(doc(dT, `${P}/consents/t`)));
  await t('F4: admin reads the trainee consent', getDoc(doc(dAd, `${P}/consents/t`)));
  await t('F4: plain family cannot read the trainee consent', getDoc(doc(dF, `${P}/consents/t`)), false);
  await t('F4: trainee withdraws (server time)', updateDoc(doc(dT, `${P}/consents/t`), { withdrawnTs: serverTimestamp() }));
  await t('F4: re-acknowledge a new version clears the withdrawal', updateDoc(doc(dT, `${P}/consents/t`), { version: '2027-01-v2', ackTs: serverTimestamp(), withdrawnTs: deleteField() }));
  await t('F4: consent kind cannot change', updateDoc(doc(dT, `${P}/consents/t`), { kind: 'x' }), false);
  await t('F4: re-ack with client time denied', updateDoc(doc(dT, `${P}/consents/t`), { version: 'v3', ackTs: Timestamp.fromMillis(Date.now()) }), false);
  await t('F4: consent cannot be deleted', deleteDoc(doc(dT, `${P}/consents/t`)), false);

  // ---- consents: 관리자가 훈련하는 분을 대신해 켜기/끄기 ("AI 기록 관찰", byAdmin)
  const ac = (by, o = {}) => Object.assign({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp(), byAdmin: by }, o);
  const clearConsents = () => env.withSecurityRulesDisabled(async c => { const x = c.firestore(); await deleteDoc(doc(x, `${P}/consents/t`)); await deleteDoc(doc(x, `${P}/consents/f`)); });
  await clearConsents();
  await t('F4: admin creates the consent for the trainee', setDoc(doc(dAd, `${P}/consents/t`), ac('a')));
  await t('F4: trainee reads the admin-made consent', getDoc(doc(dT, `${P}/consents/t`)));
  await t('F4: admin withdraws it (server time + byAdmin)', updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }));
  await t('F4: owner (family role) turns it back on', updateDoc(doc(dO, `${P}/consents/t`), { version: '2026-11-v1', ackTs: serverTimestamp(), withdrawnTs: deleteField(), byAdmin: 'o' }));
  await t('F4: admin withdraws and re-enables', (async () => {
    await updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' });
    await updateDoc(doc(dAd, `${P}/consents/t`), { version: '2026-11-v1', ackTs: serverTimestamp(), withdrawnTs: deleteField(), byAdmin: 'a' });
  })());
  await t('F4: another admin update that leaves a stale byAdmin denied', updateDoc(doc(dO, `${P}/consents/t`), { ackTs: serverTimestamp() }), false);
  await t('F4: admin update with forged byAdmin denied', updateDoc(doc(dAd, `${P}/consents/t`), { ackTs: serverTimestamp(), byAdmin: 'o' }), false);
  await t('F4: admin update with client ackTs denied', updateDoc(doc(dAd, `${P}/consents/t`), { ackTs: Timestamp.fromMillis(Date.now()), byAdmin: 'a' }), false);
  await t('F4: admin withdraw with client time denied', updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: Timestamp.fromMillis(Date.now()), byAdmin: 'a' }), false);
  await t('F4: admin cannot change kind', updateDoc(doc(dAd, `${P}/consents/t`), { kind: 'x', byAdmin: 'a' }), false);
  await t('F4: admin cannot add other keys on update', updateDoc(doc(dAd, `${P}/consents/t`), { withFamily: true, byAdmin: 'a' }), false);
  await t('F4: admin cannot delete the consent', deleteDoc(doc(dAd, `${P}/consents/t`)), false);
  await t('F4: plain family cannot update the trainee consent', updateDoc(doc(dF, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'f' }), false);
  await t('F4: trainee still withdraws its own admin-made consent', updateDoc(doc(dT, `${P}/consents/t`), { withdrawnTs: serverTimestamp() }));
  await t('F4: trainee re-acknowledges its own admin-made consent', updateDoc(doc(dT, `${P}/consents/t`), { version: '2026-11-v1', ackTs: serverTimestamp(), withdrawnTs: deleteField() }));
  await t('F4: trainee cannot touch byAdmin', updateDoc(doc(dT, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 't' }), false);
  await clearConsents();
  await t('F4: owner (family role) creates the consent for the trainee', setDoc(doc(dO, `${P}/consents/t`), ac('o')));
  await clearConsents();
  await t('F4: plain family cannot create the trainee consent', setDoc(doc(dF, `${P}/consents/t`), ac('f')), false);
  await t('F4: trainee cannot use the byAdmin field for itself', setDoc(doc(dT, `${P}/consents/t`), ac('t')), false);
  await t('F4: admin cannot target a non-trainee member', setDoc(doc(dAd, `${P}/consents/f`), ac('a')), false);
  await t('F4: admin cannot target itself', setDoc(doc(dAd, `${P}/consents/a`), ac('a')), false);
  await t('F4: admin forged byAdmin denied', setDoc(doc(dAd, `${P}/consents/t`), ac('o')), false);
  await t('F4: admin create without byAdmin denied', setDoc(doc(dAd, `${P}/consents/t`), { kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp() }), false);
  await t('F4: admin create with client ackTs denied', setDoc(doc(dAd, `${P}/consents/t`), ac('a', { ackTs: Timestamp.fromMillis(Date.now()) })), false);
  await t('F4: admin create wrong kind denied', setDoc(doc(dAd, `${P}/consents/t`), ac('a', { kind: 'other' })), false);
  await t('F4: admin create extra key denied', setDoc(doc(dAd, `${P}/consents/t`), ac('a', { note: 1 })), false);
  await t('F4: admin create with withdrawnTs denied', setDoc(doc(dAd, `${P}/consents/t`), ac('a', { withdrawnTs: serverTimestamp() })), false);
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), `${P}/consents/f`), { kind: 'ai-report-notice', version: 'v', ackTs: Timestamp.now() }); });
  await t('F4: admin cannot update a non-trainee consent', updateDoc(doc(dAd, `${P}/consents/f`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }), false);
  await t('F4: admin create with withFamily is allowed', setDoc(doc(dAd, `${P}/consents/t`), ac('a', { withFamily: true })));
  await clearConsents();
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), `${P}/consents/t`), { kind: 'ai-report-notice', version: '2026-11-v1', ackTs: Timestamp.now() }); });
  await t('F4: admin updates a trainee-made consent', updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }));
  // 검증 추가: 철회 표시만 지워 예전 ackTs 로 다시 켜기, 켜기+끄기 한 번에, 철회 중 ackTs 만 새로 쓰기는 거부
  await t('F4v: admin cannot re-enable by only clearing withdrawnTs (stale ackTs)', updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: deleteField(), byAdmin: 'a' }), false);
  await t('F4v: admin cannot re-ack while leaving the withdrawal in place', updateDoc(doc(dAd, `${P}/consents/t`), { version: '2026-11-v1', ackTs: serverTimestamp(), byAdmin: 'a' }), false);
  await t('F4v: admin cannot ack and withdraw in one write', updateDoc(doc(dAd, `${P}/consents/t`), { ackTs: serverTimestamp(), withdrawnTs: serverTimestamp(), byAdmin: 'a' }), false);
  await t('F4v: admin re-enable with an empty version denied', updateDoc(doc(dAd, `${P}/consents/t`), { version: '', ackTs: serverTimestamp(), withdrawnTs: deleteField(), byAdmin: 'a' }), false);
  await t('F4v: admin re-enables (app shape)', updateDoc(doc(dAd, `${P}/consents/t`), { version: '2026-11-v1', ackTs: serverTimestamp(), withdrawnTs: deleteField(), byAdmin: 'a' }));
  await t('F4v: admin cannot drop byAdmin attribution', updateDoc(doc(dAd, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: deleteField() }), false);
  await t('F4v: trainee cannot create a consent for another member (self shape)', setDoc(doc(dT, `${P}/consents/f`), cs()), false);
  await t('F4v: trainee cannot create a consent for another member (admin shape)', setDoc(doc(dT, `${P}/consents/f`), ac('t')), false);
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), `${P}/consents/f`), { kind: 'ai-report-notice', version: 'v', ackTs: Timestamp.now() }); });
  await t('F4v: trainee cannot update another member consent', updateDoc(doc(dT, `${P}/consents/f`), { withdrawnTs: serverTimestamp(), byAdmin: 't' }), false);
  await t('F4v: stranger cannot create the trainee consent', setDoc(doc(dX, `${P}/consents/t`), ac('a')), false);
  await t('F4v: signed-out cannot update the trainee consent', updateDoc(doc(anon, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }), false);

  // ---- server-only top-level AI collections: closed to members, admins, strangers and "worker"-style accounts
  const pw = env.authenticatedContext('worker-uid', { firebase: { sign_in_provider: 'password' }, email: 'bw-ai-worker@example.invalid' }).firestore();
  const anonCtx = env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  for (const [who, d] of [['owner', dO], ['admin', dAd], ['password account', pw], ['anonymous account', anonCtx]]) {
    await t(`F4: ${who} cannot read aiConfig`, getDoc(doc(d, 'aiConfig/main')), false);
    await t(`F4: ${who} cannot read the aggregate`, getDoc(doc(d, 'aiAggregates/current')), false);
    await t(`F4: ${who} cannot read a job`, getDoc(doc(d, 'aiJobs/w-20270408-1410-a1')), false);
    await t(`F4: ${who} cannot read the bank`, getDoc(doc(d, 'aiBank/bk_0123456789abcdef0123')), false);
    await t(`F4: ${who} cannot write the inbox`, setDoc(doc(d, 'aiInbox/h1-0'), { kind: 'items', runId: '20270101-0330', payload: '{}', status: 'new', createdTs: serverTimestamp() }), false);
  }
  await t('F4: admin cannot set the routine key hash', setDoc(doc(dAd, 'aiConfig/main'), { routineKeyHash: 'a'.repeat(64) }), false);
  await t('F4: nobody lists the inbox', getDocs(collection(dO, 'aiInbox')), false);
  await t('F4: nobody lists rejects', getDocs(collection(dO, 'aiRejects')), false);
  await t('F4: nobody reads rate counters', getDoc(doc(dO, 'aiRate/keyuse')), false);
  await t('F4: nobody reads the push heartbeat', getDoc(doc(dO, 'ops/pushTick')), false);
  await t('F4: nobody lists the bank index', getDocs(collection(dAd, 'aiBankIndex')), false);
  await t('F4: nobody reads the Telegram outbox', getDocs(collection(dO, 'tgOutbox')), false);
  await t('F4: nobody writes the Telegram outbox', setDoc(doc(dAd, 'tgOutbox/x'), { kind: 'test', n: 0 }), false);
  await t('F4: unauthenticated cannot read aiConfig', getDoc(doc(anon, 'aiConfig/main')), false);
}

// =============================================================================
// AI: 방 주인이 훈련하는 분이어도(아버지가 가족방을 만든 경우) 숫자·신호·리포트·운영 기록·메모를 못 읽어요.
// F4b: o 방 주인 = 훈련하는 분(role trainee, 지정됨) / a 관리자(가족)
// =============================================================================
{
  const F = 'fam4b', C = 'FBK234', P = `families/${F}`;
  const dO = db('u4bo'), dA = db('u4ba');
  {
    const b = writeBatch(dO);
    b.set(doc(dO, 'families', F), { createdBy: 'u4bo', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: C });
    b.set(doc(dO, 'joinCodes', C), { familyId: F, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dO, `${P}/uids/u4bo`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dO, `${P}/members/o`), { name: '아버지', role: 'trainee', joinedTs: serverTimestamp() });
    await t('F4b: trainee founds the family', b.commit());
  }
  await t('F4b: trainee-owner claims the trainee list', setDoc(doc(dO, `${P}/state/trainees`), tsDoc('o', ['o'], { o: '아버지' })));
  await t('F4b: family member joins', (async () => { const b = writeBatch(dA); b.set(doc(dA, `${P}/uids/u4ba`), { memberId: 'a', via: 'join', code: C, addedTs: serverTimestamp() }); b.set(doc(dA, `${P}/members/a`), { name: '딸', role: 'family', joinedTs: serverTimestamp() }); await b.commit(); })());
  await t('F4b: owner grants a', updateDoc(doc(dO, 'families', F), { admins: ['a'] }));
  await env.withSecurityRulesDisabled(async c => {
    const x = c.firestore();
    await setDoc(doc(x, `${P}/trainees/o/aiStats/summary`), { v: 1 });
    await setDoc(doc(x, `${P}/trainees/o/aiSignals/S1-composite-2027-01-01`), { key: 'S1:composite', on: true });
    await setDoc(doc(x, `${P}/trainees/o/aiReports/r-a-1`), { v: 1 });
    await setDoc(doc(x, `${P}/trainees/o/aiOps/health`), { server: {} });
    await setDoc(doc(x, `${P}/trainees/o/aiNotes/n1`), { from: '2027-01-01', codes: ['sleep'], text: '메모', by: 'a', ts: Date.now() });
  });
  for (const [name, path] of [['aiStats', `${P}/trainees/o/aiStats/summary`], ['aiSignals', `${P}/trainees/o/aiSignals/S1-composite-2027-01-01`], ['aiReports', `${P}/trainees/o/aiReports/r-a-1`], ['aiOps', `${P}/trainees/o/aiOps/health`], ['aiNotes', `${P}/trainees/o/aiNotes/n1`]]) {
    await t(`F4b: trainee-owner cannot read ${name}`, getDoc(doc(dO, path)), false);
    await t(`F4b: family admin reads ${name}`, getDoc(doc(dA, path)));
  }
  await t('F4b: trainee-owner cannot list reports', getDocs(collection(dO, `${P}/trainees/o/aiReports`)), false);
  await t('F4b: trainee-owner cannot write notes', setDoc(doc(dO, `${P}/trainees/o/aiNotes/n2`), { from: '2027-01-01', codes: ['sleep'], by: 'o', ts: Date.now() }), false);
  const ac4b = by => ({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp(), byAdmin: by });
  await t('F4b: trainee-owner cannot use the admin path for itself', setDoc(doc(dO, `${P}/consents/o`), ac4b('o')), false);
  await t('F4b: trainee-owner still acknowledges for itself', setDoc(doc(dO, `${P}/consents/o`), { kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp() }));
  await t('F4b: trainee-owner cannot update through the admin path', updateDoc(doc(dO, `${P}/consents/o`), { ackTs: serverTimestamp(), byAdmin: 'o' }), false);
  await t('F4b: family admin updates the trainee-owner consent', updateDoc(doc(dA, `${P}/consents/o`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }));
}

// =============================================================================
// F4c: 관리자 대신 동의(byAdmin) — 내보낸 관리자, 훈련하는 분이 바뀐 뒤, 관리자가 훈련하는 분이 된 뒤
// o 방 주인(가족) / a·b 관리자(가족) / t 훈련하는 분 / f 가족
// =============================================================================
{
  const F = 'fam4c', C = 'FCK234', P = `families/${F}`;
  const dO = db('u4co'), dA = db('u4ca'), dB = db('u4cb'), dT = db('u4ct'), dF = db('u4cf');
  const join = (dd, u, m, role, name) => { const b = writeBatch(dd); b.set(doc(dd, `${P}/uids/${u}`), { memberId: m, via: 'join', code: C, addedTs: serverTimestamp() }); b.set(doc(dd, `${P}/members/${m}`), { name, role, joinedTs: serverTimestamp() }); return b.commit(); };
  const ac = by => ({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp(), byAdmin: by });
  {
    const b = writeBatch(dO);
    b.set(doc(dO, 'families', F), { createdBy: 'u4co', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: C });
    b.set(doc(dO, 'joinCodes', C), { familyId: F, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dO, `${P}/uids/u4co`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dO, `${P}/members/o`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F4c: found', b.commit());
  }
  await t('F4c: a joins', join(dA, 'u4ca', 'a', 'family', '딸'));
  await t('F4c: b joins', join(dB, 'u4cb', 'b', 'family', '사위'));
  await t('F4c: f joins', join(dF, 'u4cf', 'f', 'family', '손주'));
  await t('F4c: t joins', join(dT, 'u4ct', 't', 'trainee', '아버지'));
  await t('F4c: t claims the trainee list', setDoc(doc(dT, `${P}/state/trainees`), tsDoc('t', ['t'], { t: '아버지' })));
  await t('F4c: owner grants a', updateDoc(doc(dO, 'families', F), { admins: ['a'] }));
  await t('F4c: owner grants b', updateDoc(doc(dO, 'families', F), { admins: ['a', 'b'] }));
  await t('F4c: b creates the trainee consent', setDoc(doc(dB, `${P}/consents/t`), ac('b')));
  // b 를 내보내요 (앱: 기기 연결을 모두 지우고 leftTs). admins 목록에는 남아 있어도 연결이 없으면 구성원이 아니에요.
  await t('F4c: owner removes b (unlink)', deleteDoc(doc(dO, `${P}/uids/u4cb`)));
  await t('F4c: owner removes b (leftTs)', updateDoc(doc(dO, `${P}/members/b`), { leftTs: serverTimestamp() }));
  await t('F4c: removed admin cannot withdraw the trainee consent', updateDoc(doc(dB, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'b' }), false);
  await t('F4c: removed admin cannot read the trainee consent', getDoc(doc(dB, `${P}/consents/t`)), false);
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), `${P}/consents/t`)); });
  await t('F4c: removed admin cannot create the trainee consent', setDoc(doc(dB, `${P}/consents/t`), ac('b')), false);
  await t('F4c: a (still admin) creates the trainee consent', setDoc(doc(dA, `${P}/consents/t`), ac('a')));
  // 훈련하는 분이 f 로 바뀌면: 예전 훈련하는 분 t 의 문서는 관리자 길로 못 바꾸고, 새 훈련하는 분 f 는 돼요.
  await env.withSecurityRulesDisabled(async c => { const x = c.firestore(); await setDoc(doc(x, `${P}/state/trainees`), tsDoc('o', ['f'], { f: '손주' })); await updateDoc(doc(x, `${P}/members/f`), { role: 'trainee' }); });
  await t('F4c: admin cannot update a former trainee consent', updateDoc(doc(dA, `${P}/consents/t`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }), false);
  await t('F4c: admin creates the new trainee consent', setDoc(doc(dA, `${P}/consents/f`), ac('a')));
  // 관리자 a 가 훈련하는 분이 되면 관리자 길은 꺼져요 (자기 것도, 남의 것도).
  await env.withSecurityRulesDisabled(async c => { const x = c.firestore(); await setDoc(doc(x, `${P}/state/trainees`), tsDoc('o', ['a'], { a: '딸' })); });
  await t('F4c: admin-turned-trainee cannot create its own consent via the admin path', setDoc(doc(dA, `${P}/consents/a`), ac('a')), false);
  await t('F4c: admin-turned-trainee cannot withdraw the previous trainee consent', updateDoc(doc(dA, `${P}/consents/f`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }), false);
  await t('F4c: admin-turned-trainee still acknowledges for itself', setDoc(doc(dA, `${P}/consents/a`), { kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp() }));
  await t('F4c: owner (family) can withdraw the new trainee consent', updateDoc(doc(dO, `${P}/consents/a`), { withdrawnTs: serverTimestamp(), byAdmin: 'o' }));
}

// =============================================================================
// 여러 명의 훈련하는 분 (DESIGN-MULTI §3.5): fam5
// o 방 주인(가족) / a 관리자(가족) / f 가족 / t1·t2 훈련하는 분 / t3·t4·t5 훈련하는 분 후보 / p 준비 중(role trainee, T 밖)
// =============================================================================
{
  const { planDoc, displayDoc, progressStart } = await import('../js/program.js');
  const F5 = 'fam5', C5 = 'FMV234', P = `families/${F5}`, ST = `${P}/state/trainees`;
  const U = { o: db('u5o'), a: db('u5a'), f: db('u5f'), t1: db('u5t1'), t2: db('u5t2'), t3: db('u5t3'), t4: db('u5t4'), t5: db('u5t5'), p: db('u5p') };
  const join = (m, role, name) => { const dd = U[m], b = writeBatch(dd); b.set(doc(dd, `${P}/uids/u5${m}`), { memberId: m, via: 'join', code: C5, addedTs: serverTimestamp() }); b.set(doc(dd, `${P}/members/${m}`), { name, role, joinedTs: serverTimestamp() }); return b.commit(); };
  const LB = { t1: '아버지', t2: '어머니', t3: '할머니', t4: '할아버지', t5: '삼촌', f: '사위', p: '이모' };
  const reg = (by, ids, lab) => tsDoc(by, ids, lab || Object.fromEntries(ids.map(i => [i, LB[i]])));
  // 관리자가 한 명 더하기: 목록 + 그 사람 role 'trainee' 를 한 배치로
  const addT = (by, ids, m, role = 'trainee') => { const dd = U[by], b = writeBatch(dd); b.set(doc(dd, ST), reg(by, ids)); if (role) b.update(doc(dd, `${P}/members/${m}`), { role }); return b.commit(); };
  {
    const dd = U.o, b = writeBatch(dd);
    b.set(doc(dd, 'families', F5), { createdBy: 'u5o', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: C5 });
    b.set(doc(dd, 'joinCodes', C5), { familyId: F5, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dd, `${P}/uids/u5o`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dd, `${P}/members/o`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F5: found', b.commit());
  }
  for (const [m, role, name] of [['a', 'family', '딸'], ['f', 'family', '사위'], ['t1', 'trainee', '아버지'], ['t2', 'trainee', '어머니'], ['t3', 'trainee', '할머니'], ['t4', 'trainee', '할아버지'], ['t5', 'trainee', '삼촌'], ['p', 'trainee', '이모']]) await join(m, role, name);
  await t('F5: owner grants a', updateDoc(doc(U.o, 'families', F5), { admins: ['a'] }));

  // ---- 목록 (state/trainees)
  await t('F5: no list yet → t1 cannot write progress', setDoc(doc(U.t1, `${P}/progress/${today}-t1`), Object.assign(progressStart(null, { userId: 't1', date: today, planned: ['odd'], gameId: 'odd', now: Date.now() }), { sts: serverTimestamp() })), false);
  await t('F5: self-claim must list only me', setDoc(doc(U.t1, ST), reg('t1', ['t1', 't2'])), false);
  await t('F5: t1 self-claims the empty list', setDoc(doc(U.t1, ST), reg('t1', ['t1'])));
  await t('F5: t2 cannot self-claim once the list exists', setDoc(doc(U.t2, ST), reg('t2', ['t2'])), false);
  await t('F5: t2 cannot append self', setDoc(doc(U.t2, ST), reg('t2', ['t1', 't2'])), false);
  await t('F5: plain family cannot add t2', addT('f', ['t1', 't2'], 't2'), false);
  await t('F5: admin adds t2 (role batch)', addT('a', ['t1', 't2'], 't2'));
  await t('F5: owner cannot add two at once', (async () => { const b = writeBatch(U.o); b.set(doc(U.o, ST), reg('o', ['t1', 't2', 't3', 't4'])); b.update(doc(U.o, `${P}/members/t3`), { role: 'trainee' }); b.update(doc(U.o, `${P}/members/t4`), { role: 'trainee' }); await b.commit(); })(), false);
  await t('F5: admin cannot add a family-role member', addT('a', ['t1', 't2', 'f'], 'f', null), false);
  await t('F5: admin cannot add with a forged updatedBy', (async () => { const b = writeBatch(U.a); b.set(doc(U.a, ST), reg('o', ['t1', 't2', 't3'])); b.update(doc(U.a, `${P}/members/t3`), { role: 'trainee' }); await b.commit(); })(), false);
  await t('F5: labels must match ids', (async () => { const b = writeBatch(U.a); b.set(doc(U.a, ST), reg('a', ['t1', 't2', 't3'], { t1: '아버지', t2: '어머니' })); b.update(doc(U.a, `${P}/members/t3`), { role: 'trainee' }); await b.commit(); })(), false);
  await t('F5: label longer than 12 denied', setDoc(doc(U.a, ST), reg('a', ['t1', 't2'], { t1: '가'.repeat(13), t2: '어머니' })), false);
  await t('F5: empty label denied', setDoc(doc(U.a, ST), reg('a', ['t1', 't2'], { t1: '', t2: '어머니' })), false);
  await t('F5: duplicate ids denied', setDoc(doc(U.a, ST), Object.assign(reg('a', ['t1', 't2']), { ids: ['t1', 't1'] })), false);
  await t('F5: extra key denied', setDoc(doc(U.a, ST), Object.assign(reg('a', ['t1', 't2']), { x: 1 })), false);
  await t('F5: admin adds t3', addT('a', ['t1', 't2', 't3'], 't3'));
  await t('F5: owner adds t4 (4 trainees)', addT('o', ['t1', 't2', 't3', 't4'], 't4'));
  await t('F5: a 5th trainee is denied', addT('o', ['t1', 't2', 't3', 't4', 't5'], 't5'), false);
  await t('F5: admin relabels t3', setDoc(doc(U.a, ST), reg('a', ['t1', 't2', 't3', 't4'], { t1: '아버지', t2: '어머니', t3: '외할머니', t4: '할아버지' })));
  await t('F5: admin removes t4 and makes him family in one batch', addT('a', ['t1', 't2', 't3'], 't4', 'family'));
  await t('F5: admin removes t3 (list only, role stays trainee)', setDoc(doc(U.a, ST), reg('a', ['t1', 't2'])));
  await t('F5: admin (not the owner) cannot delete the list', deleteDoc(doc(U.a, ST)), false);
  await t('F5: trainee cannot delete the list', deleteDoc(doc(U.t1, ST)), false);
  await t('F5: plain family cannot delete the list', deleteDoc(doc(U.f, ST)), false);
  await t('F5: everyone reads the list (trainee)', getDoc(doc(U.t2, ST)));
  await t('F5: everyone reads the list (family)', getDoc(doc(U.f, ST)));
  await t('F5: non-member cannot read the list', getDoc(doc(db('u5x'), ST)), false);

  // ---- members.role → family while in T
  await t('F5: admin cannot switch t1 to family while in T', updateDoc(doc(U.a, `${P}/members/t1`), { role: 'family' }), false);
  await t('F5: owner cannot switch t2 to family while in T', updateDoc(doc(U.o, `${P}/members/t2`), { role: 'family' }), false);
  await t('F5: t2 cannot self-switch to family within the join window', updateDoc(doc(U.t2, `${P}/members/t2`), { role: 'family' }), false);
  await t('F5: pending trainee (not in T) may self-switch within the join window', updateDoc(doc(U.p, `${P}/members/p`), { role: 'trainee' }));

  // ---- trainees/{t}/state/*
  const CAT = [['odd', 'attention', 5], ['shop', 'executive', 5], ['flash', 'speed', 5]].map(([id, domain, rounds]) => ({ id, domain, rounds }));
  const plan = by => planDoc({ gamesPerDay: 3, weekdays: [1, 3, 5] }, CAT, by, Date.now());
  const disp = by => displayDoc({ font: 'noto', size: 'max', contrast: true, voice: true, rate: 0.75 }, by, Date.now());
  const alarm = by => ({ time: '09:30', days: [1, 3, 5], updatedBy: by, updatedTs: Date.now() });
  const T1 = `${P}/trainees/t1/state`, T2 = `${P}/trainees/t2/state`;
  await t('F5: owner writes t1 plan', setDoc(doc(U.o, `${T1}/plan`), plan('o')));
  await t('F5: admin writes t2 display', setDoc(doc(U.a, `${T2}/display`), disp('a')));
  await t('F5: admin writes t2 alarm', setDoc(doc(U.a, `${T2}/alarm`), alarm('a')));
  await t('F5: plain family cannot write t1 plan', setDoc(doc(U.f, `${T1}/plan`), plan('f')), false);
  await t('F5: t1 cannot write own plan', setDoc(doc(U.t1, `${T1}/plan`), plan('t1')), false);
  await t('F5: t1 cannot write own display', setDoc(doc(U.t1, `${T1}/display`), disp('t1')), false);
  await t('F5: t2 cannot write t1 alarm', setDoc(doc(U.t2, `${T1}/alarm`), alarm('t2')), false);
  await t('F5: admin cannot write plan for someone not in T', setDoc(doc(U.a, `${P}/trainees/t3/state/plan`), plan('a')), false);
  await t('F5: unknown per-trainee state key denied', setDoc(doc(U.a, `${T1}/trainee`), { userId: 't1', displayLabel: 'x' }), false);
  await t('F5: old family-level state/plan denied', setDoc(doc(U.o, `${P}/state/plan`), plan('o')), false);
  await t('F5: t1 writes own levels', setDoc(doc(U.t1, `${T1}/levels`), { levels: { odd: 2 }, updatedTs: Date.now() }));
  await t('F5: t1 cannot write t2 levels', setDoc(doc(U.t1, `${T2}/levels`), { levels: { odd: 5 }, updatedTs: Date.now() }), false);
  await t('F5: plain family cannot write t1 levels', setDoc(doc(U.f, `${T1}/levels`), { levels: { odd: 5 }, updatedTs: Date.now() }), false);
  await t('F5: admin writes t2 levels', setDoc(doc(U.a, `${T2}/levels`), { levels: { odd: 1 }, updatedTs: Date.now() }));
  await t('F5: t1 creates own program', setDoc(doc(U.t1, `${T1}/program`), { startDate: today }));
  await t('F5: t1 cannot change own program', setDoc(doc(U.t1, `${T1}/program`), { startDate: '2020-01-01' }), false);
  await t('F5: t1 cannot create t2 program', setDoc(doc(U.t1, `${T2}/program`), { startDate: today }), false);
  await t('F5: plain family cannot create t2 program', setDoc(doc(U.f, `${T2}/program`), { startDate: today }), false);
  await t('F5: admin creates t2 program', setDoc(doc(U.a, `${T2}/program`), { startDate: today }));
  await t('F5: admin updates t1 program', setDoc(doc(U.a, `${T1}/program`), { startDate: today }));
  await t('F5: plain family reads t1 plan', getDoc(doc(U.f, `${T1}/plan`)));
  await t('F5: t1 reads t2 display', getDoc(doc(U.t1, `${T2}/display`)));
  await t('F5: plain family cannot delete per-trainee state', deleteDoc(doc(U.f, `${T2}/alarm`)), false);
  await t('F5: admin deletes per-trainee state', deleteDoc(doc(U.a, `${T2}/alarm`)));

  // ---- progress / presence / itemLogs / records
  const pr = m => Object.assign(progressStart(null, { userId: m, date: today, planned: ['odd'], gameId: 'odd', now: Date.now() }), { sts: serverTimestamp() });
  await t('F5: t1 writes own progress', setDoc(doc(U.t1, `${P}/progress/${today}-t1`), pr('t1')));
  await t('F5: t2 writes own progress', setDoc(doc(U.t2, `${P}/progress/${today}-t2`), pr('t2')));
  await t('F5: t1 cannot write t2 progress', setDoc(doc(U.t1, `${P}/progress/${today}-t2`), pr('t2')), false);
  await t('F5: t1 cannot write t2 progress under own id', setDoc(doc(U.t1, `${P}/progress/${today}-t1`), pr('t2')), false);
  await t('F5: plain family cannot write own progress', setDoc(doc(U.f, `${P}/progress/${today}-f`), pr('f')), false);
  await t('F5: pending trainee cannot write progress', setDoc(doc(U.p, `${P}/progress/${today}-p`), pr('p')), false);
  await t('F5: plain family writes own presence', setDoc(doc(U.f, `${P}/presence/f`), { lastSeen: serverTimestamp(), ts: Date.now() }));
  await t('F5: t2 cannot write t1 presence', setDoc(doc(U.t2, `${P}/presence/t1`), { lastSeen: serverTimestamp(), ts: Date.now() }), false);
  const il = m => ({ v: 1, userId: m, date: today, ts: Date.now(), sts: serverTimestamp(), gameId: 'words', items: [{ role: 'training' }] });
  await t('F5: t2 writes own item log', setDoc(doc(U.t2, `${P}/itemLogs/l1`), il('t2')));
  await t('F5: t2 cannot write t1 item log', setDoc(doc(U.t2, `${P}/itemLogs/l2`), il('t1')), false);
  await t('F5: plain family cannot write item logs', setDoc(doc(U.f, `${P}/itemLogs/l3`), il('f')), false);
  await t('F5: pending trainee cannot write item logs', setDoc(doc(U.p, `${P}/itemLogs/l4`), il('p')), false);
  await t('F5: t1 session', setDoc(doc(U.t1, `${P}/sessions/s1`), { date: today, ts: Date.now(), gameId: 'odd', userId: 't1', inCourse: true }));
  await t('F5: t1 cannot write a t2 session', setDoc(doc(U.t1, `${P}/sessions/s2`), { date: today, ts: Date.now(), gameId: 'odd', userId: 't2' }), false);
  await t('F5: plain family session (나도 훈련해 보기)', setDoc(doc(U.f, `${P}/sessions/s3`), { date: today, ts: Date.now(), gameId: 'odd', userId: 'f' }));
  await t('F5: t2 checkin', setDoc(doc(U.t2, `${P}/checkins/${today}-t2`), { date: today, ts: Date.now(), mood: 4, userId: 't2' }));
  await t('F5: t2 assessment', setDoc(doc(U.t2, `${P}/assessments/a1`), { date: today, ts: Date.now(), scores: { memory: 80 }, total: 80, userId: 't2' }));
  await t('F5: t2 sleep log', setDoc(doc(U.t2, `${P}/sleeplogs/${today}-t2`), { date: today, ts: Date.now(), userId: 't2', bed: '22:00', wake: '06:00' }));
  await t('F5: t1 task run', setDoc(doc(U.t1, `${P}/taskRuns/r1`), { date: today, ts: Date.now(), userId: 't1', v: 1, tasks: {} }));
  await t('F5: t1 clock drawing', setDoc(doc(U.t1, `${P}/clocks/c1`), { date: today, ts: Date.now(), userId: 't1', img: 'data:image/png;base64,AAAA' }));
  const sv = (by, subj, o = {}) => Object.assign({ kind: 'iqcode', version: '1', answers: [3, 3], score: 3, ts: Date.now(), date: today, mode: 'family', answeredBy: by, relation: '딸', subjectId: subj }, o);
  await t('F5: family survey about t2', setDoc(doc(U.f, `${P}/surveys/v1`), sv('f', 't2')));
  await t('F5: survey about a removed trainee denied', setDoc(doc(U.f, `${P}/surveys/v2`), sv('f', 't3')), false);
  await t('F5: t1 self survey', setDoc(doc(U.t1, `${P}/surveys/v3`), sv('t1', 't1', { mode: 'self', relation: '본인' })));
  const ct = (by, subj) => ({ test: 'cist', date: today, score: 20, max: 30, recordedBy: by, ts: Date.now(), subjectId: subj });
  await t('F5: admin records clinical test for t1', setDoc(doc(U.a, `${P}/clinicalTests/k1`), ct('a', 't1')));
  await t('F5: clinical test about a family member denied', setDoc(doc(U.a, `${P}/clinicalTests/k2`), ct('a', 'f')), false);
  await t('F5: t1 cannot record a clinical test', setDoc(doc(U.t1, `${P}/clinicalTests/k3`), ct('t1', 't2')), false);
  for (const c of ['surveys', 'clocks', 'clinicalTests', 'sleeplogs', 'taskRuns', 'itemLogs']) {
    await t(`F5: owner lists ${c}`, getDocs(collection(U.o, `${P}/${c}`)));
    await t(`F5: admin lists ${c}`, getDocs(collection(U.a, `${P}/${c}`)));
    await t(`F5: plain family lists ${c}`, getDocs(collection(U.f, `${P}/${c}`)));
    await t(`F5: t1 cannot list ${c}`, getDocs(collection(U.t1, `${P}/${c}`)), false);
    await t(`F5: pending trainee cannot list ${c}`, getDocs(collection(U.p, `${P}/${c}`)), false);
  }

  // ---- 훈련하는 분마다의 AI 자료
  await env.withSecurityRulesDisabled(async c => {
    const x = c.firestore();
    for (const m of ['t1', 't2']) {
      await setDoc(doc(x, `${P}/trainees/${m}/aiPacks/memory-L3`), { v: 1, itemsJson: '[]' });
      await setDoc(doc(x, `${P}/trainees/${m}/aiState/plan`), { v: 1 });
      await setDoc(doc(x, `${P}/trainees/${m}/aiStats/summary`), { v: 1 });
      await setDoc(doc(x, `${P}/trainees/${m}/aiSignals/S1`), { on: true });
      await setDoc(doc(x, `${P}/trainees/${m}/aiReports/r-a-1`), { v: 1 });
      await setDoc(doc(x, `${P}/trainees/${m}/aiOps/health`), { v: 1 });
      await setDoc(doc(x, `${P}/trainees/${m}/aiNotes/n1`), { from: today, codes: ['sleep'], by: 'a', ts: Date.now() });
    }
  });
  await t('F5: t1 reads own packs', getDocs(collection(U.t1, `${P}/trainees/t1/aiPacks`)));
  await t('F5: t1 cannot read t2 packs', getDoc(doc(U.t1, `${P}/trainees/t2/aiPacks/memory-L3`)), false);
  await t('F5: plain family reads t2 packs', getDoc(doc(U.f, `${P}/trainees/t2/aiPacks/memory-L3`)));
  await t('F5: owner reads t1 packs', getDoc(doc(U.o, `${P}/trainees/t1/aiPacks/memory-L3`)));
  await t('F5: pending trainee cannot read packs', getDoc(doc(U.p, `${P}/trainees/t1/aiPacks/memory-L3`)), false);
  await t('F5: admin cannot write packs', setDoc(doc(U.a, `${P}/trainees/t1/aiPacks/memory-L4`), { v: 1 }), false);
  for (const k of ['aiStats/summary', 'aiSignals/S1', 'aiReports/r-a-1', 'aiOps/health', 'aiNotes/n1']) {
    const path = `${P}/trainees/t1/${k}`;
    await t(`F5: owner reads t1 ${k}`, getDoc(doc(U.o, path)));
    await t(`F5: admin reads t1 ${k}`, getDoc(doc(U.a, path)));
    await t(`F5: plain family cannot read t1 ${k}`, getDoc(doc(U.f, path)), false);
    await t(`F5: t1 cannot read own ${k}`, getDoc(doc(U.t1, path)), false);
    await t(`F5: t2 cannot read t1 ${k}`, getDoc(doc(U.t2, path)), false);
  }
  await t('F5: admin lists t2 reports', getDocs(collection(U.a, `${P}/trainees/t2/aiReports`)));
  const th = by => ({ words: ['낚시', '등산'], updatedBy: by, updatedTs: Date.now() });
  await t('F5: admin writes t1 themes', setDoc(doc(U.a, `${P}/trainees/t1/aiState/themes`), th('a')));
  await t('F5: owner writes t2 themes', setDoc(doc(U.o, `${P}/trainees/t2/aiState/themes`), th('o')));
  await t('F5: plain family cannot write themes', setDoc(doc(U.f, `${P}/trainees/t1/aiState/themes`), th('f')), false);
  await t('F5: t1 cannot write own themes', setDoc(doc(U.t1, `${P}/trainees/t1/aiState/themes`), th('t1')), false);
  await t('F5: themes for someone not in T denied', setDoc(doc(U.a, `${P}/trainees/t3/aiState/themes`), th('a')), false);
  await t('F5: admin cannot write the server ai plan', setDoc(doc(U.a, `${P}/trainees/t1/aiState/plan`), { v: 2 }), false);
  await t('F5: t1 reads own aiState', getDoc(doc(U.t1, `${P}/trainees/t1/aiState/plan`)));
  const note = by => ({ from: today, codes: ['sleep'], text: '메모', by, ts: Date.now() });
  await t('F5: admin writes a t2 note', setDoc(doc(U.a, `${P}/trainees/t2/aiNotes/n2`), note('a')));
  await t('F5: plain family cannot write notes', setDoc(doc(U.f, `${P}/trainees/t2/aiNotes/n3`), note('f')), false);
  await t('F5: admin deletes a t1 note', deleteDoc(doc(U.a, `${P}/trainees/t1/aiNotes/n1`)));

  // ---- consents
  const ac = by => ({ kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp(), byAdmin: by });
  await t('F5: admin creates the t2 consent', setDoc(doc(U.a, `${P}/consents/t2`), ac('a')));
  await t('F5: owner creates the t1 consent', setDoc(doc(U.o, `${P}/consents/t1`), ac('o')));
  await t('F5: plain family cannot create a trainee consent', setDoc(doc(U.f, `${P}/consents/t1`), ac('f')), false);
  await t('F5: admin cannot create a consent for someone not in T', setDoc(doc(U.a, `${P}/consents/t3`), ac('a')), false);
  await t('F5: t1 cannot create t2 consent (admin shape)', setDoc(doc(U.t1, `${P}/consents/t2`), ac('t1')), false);
  await t('F5: t2 reads own consent', getDoc(doc(U.t2, `${P}/consents/t2`)));
  await t('F5: t1 cannot read t2 consent', getDoc(doc(U.t1, `${P}/consents/t2`)), false);
  await t('F5: plain family cannot read consents', getDoc(doc(U.f, `${P}/consents/t2`)), false);
  await t('F5: admin withdraws t1 consent', updateDoc(doc(U.a, `${P}/consents/t1`), { withdrawnTs: serverTimestamp(), byAdmin: 'a' }));
  await t('F5: plain family acknowledges own notice', setDoc(doc(U.f, `${P}/consents/f`), { kind: 'ai-report-notice', version: '2026-11-v1', ackTs: serverTimestamp() }));

  // ---- 훈련 알림 (받는 사람마다 115분)
  const msg5 = (by, to) => ({ authorId: by, text: '산책 가요', ts: Date.now(), sts: serverTimestamp(), kind: 'nudge', push: 'pending', reactions: {}, acks: {}, toId: to });
  const nudge5 = (by, to, stampKey = to) => { const dd = U[by], b = writeBatch(dd); b.set(doc(dd, `${P}/messages/n${Math.random().toString(36).slice(2, 9)}`), msg5(by, to)); b.update(doc(dd, `${P}/members/${by}`), { ['nudgeAt.' + stampKey]: serverTimestamp() }); return b.commit(); };
  await t('F5: nudge without a stamp denied', setDoc(doc(U.a, `${P}/messages/nx1`), msg5('a', 't1')), false);
  await t('F5: a → t1', nudge5('a', 't1'));
  await t('F5: a → t2 right away', nudge5('a', 't2'));
  await t('F5: a → t1 again within 115 min denied', nudge5('a', 't1'), false);
  await t('F5: f → t1 (other sender, own limit)', nudge5('f', 't1'));
  await t('F5: t1 → t2 (trainee to another trainee)', nudge5('t1', 't2'));
  await t('F5: t1 → t1 (self) denied', nudge5('t1', 't1'), false);
  await t('F5: a → f (not in T) denied', nudge5('a', 'f'), false);
  await t('F5: a → t3 (removed) denied', nudge5('a', 't3'), false);
  await t('F5: o → t1 with a stamp for t2 denied', nudge5('o', 't1', 't2'), false);
  await t('F5: stamp for a non-trainee key denied', updateDoc(doc(U.o, `${P}/members/o`), { 'nudgeAt.f': serverTimestamp() }), false);
  await t('F5: stamp with a client time denied', updateDoc(doc(U.o, `${P}/members/o`), { 'nudgeAt.t1': Timestamp.fromMillis(Date.now()) }), false);
  await t('F5: reset of a stamp denied', updateDoc(doc(U.a, `${P}/members/a`), { 'nudgeAt.t1': deleteField() }), false);
  await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), `${P}/members/a`), { 'nudgeAt.t1': Timestamp.fromMillis(Date.now() - 116 * 60e3) }); });
  await t('F5: a → t1 after 115 min', nudge5('a', 't1'));
  await t('F5: t2 sends text', setDoc(doc(U.t2, `${P}/messages/x1`), { authorId: 't2', text: '고마워', ts: Date.now(), sts: serverTimestamp(), kind: 'text', push: 'pending' }));
  await t('F5: t2 reacts', updateDoc(doc(U.t2, `${P}/messages/x1`), { 'reactions.t2': ['👍'] }));
  await t('F5: t1 reads messages', getDocs(collection(U.t1, `${P}/messages`)));
  await t('F5: t1 writes own read mark', setDoc(doc(U.t1, `${P}/reads/t1`), { lastReadTs: Date.now() }));

  // ---- "모든 기록 삭제": 방 주인은 목록(state/trainees)과 훈련하는 분마다의 하위 자료를 지울 수 있어요 (membership.js deleteFamily 순서)
  await env.withSecurityRulesDisabled(async c => {
    const x = c.firestore();
    await setDoc(doc(x, `${P}/trainees/t1/aiState/themes`), { words: ['낚시'], updatedBy: 'a', updatedTs: Date.now() });
    await setDoc(doc(x, `${P}/trainees/t1/aiNotes/nd1`), { from: today, to: null, codes: ['sleep'], by: 'a', ts: Date.now() });
  });
  await t('F5: del: admin (not the owner) cannot delete themes', deleteDoc(doc(U.a, `${P}/trainees/t1/aiState/themes`)), false);
  await t('F5: del: trainee cannot delete themes', deleteDoc(doc(U.t1, `${P}/trainees/t1/aiState/themes`)), false);
  await t('F5: del: owner cannot delete the server plan (the server purge does)', deleteDoc(doc(U.o, `${P}/trainees/t1/aiState/plan`)), false);
  await t('F5: del: owner cannot delete server-written reports', deleteDoc(doc(U.o, `${P}/trainees/t1/aiReports/r-a-1`)), false);
  await t('F5: del: t1 deletes own levels', deleteDoc(doc(U.t1, `${T1}/levels`)));
  await t('F5: del: t1 deletes own program', deleteDoc(doc(U.t1, `${T1}/program`)));
  await t('F5: del: t1 cannot delete t2 levels', deleteDoc(doc(U.t1, `${T2}/levels`)), false);
  await t('F5: del: t1 cannot delete own plan (admin-only)', deleteDoc(doc(U.t1, `${T1}/plan`)), false);
  await t('F5: del: plain family cannot delete levels', deleteDoc(doc(U.f, `${T2}/levels`)), false);
  await t('F5: del: owner deletes every per-trainee state doc', (async () => { for (const [m, k] of [['t1', 'plan'], ['t2', 'display'], ['t2', 'levels'], ['t2', 'program']]) await deleteDoc(doc(U.o, `${P}/trainees/${m}/state/${k}`)); })());
  await t('F5: del: owner deletes the per-trainee note', deleteDoc(doc(U.o, `${P}/trainees/t1/aiNotes/nd1`)));
  await t('F5: del: owner deletes themes', deleteDoc(doc(U.o, `${P}/trainees/t1/aiState/themes`)));
  await t('F5: del: owner deletes the trainee list', deleteDoc(doc(U.o, ST)));
  await t('F5: del: the list is gone', (async () => { if ((await getDoc(doc(U.o, ST))).exists()) throw new Error('still there'); })());
  await t('F5: del: deleting an already deleted list is fine for the owner', deleteDoc(doc(U.o, ST)));
  await t('F5: del: with no list nobody is a trainee any more (t1 cannot write levels)', setDoc(doc(U.t1, `${T1}/levels`), { levels: { odd: 2 }, updatedTs: Date.now() }), false);
}
// =============================================================================
// fam5c: 목록(state/trainees)이 없으면 아무도 훈련하는 분이 아니에요
// =============================================================================
{
  const { planDoc, progressStart } = await import('../js/program.js');
  const FC = 'fam5c', CC5 = 'FMC234', P = `families/${FC}`;
  const dO = db('u5co'), dT = db('u5ct');
  {
    const b = writeBatch(dO);
    b.set(doc(dO, 'families', FC), { createdBy: 'u5co', createdTs: serverTimestamp(), ownerMemberId: 'o', joinCode: CC5 });
    b.set(doc(dO, 'joinCodes', CC5), { familyId: FC, createdBy: 'o', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(dO, `${P}/uids/u5co`), { memberId: 'o', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(dO, `${P}/members/o`), { name: '아들', role: 'family', joinedTs: serverTimestamp() });
    await t('F5c: found', b.commit());
  }
  await t('F5c: trainee-role member joins', (async () => { const b = writeBatch(dT); b.set(doc(dT, `${P}/uids/u5ct`), { memberId: 't', via: 'join', code: CC5, addedTs: serverTimestamp() }); b.set(doc(dT, `${P}/members/t`), { name: '아버지', role: 'trainee', joinedTs: serverTimestamp() }); await b.commit(); })());
  await t('F5c: no list → trainee-role member cannot write progress', setDoc(doc(dT, `${P}/progress/${today}-t`), Object.assign(progressStart(null, { userId: 't', date: today, planned: ['odd'], gameId: 'odd', now: Date.now() }), { sts: serverTimestamp() })), false);
  await t('F5c: no list → item logs denied', setDoc(doc(dT, `${P}/itemLogs/l1`), { v: 1, userId: 't', date: today, ts: Date.now(), sts: serverTimestamp(), gameId: 'words', items: [{ role: 'training' }] }), false);
  await t('F5c: no list → owner cannot write per-trainee plan', setDoc(doc(dO, `${P}/trainees/t/state/plan`), planDoc({}, [], 'o', Date.now())), false);
  await t('F5c: no list → old state/plan denied', setDoc(doc(dO, `${P}/state/plan`), planDoc({}, [], 'o', Date.now())), false);
  await t('F5c: no list → old state/trainee denied', setDoc(doc(dO, `${P}/state/trainee`), { userId: 't', displayLabel: '아버지' }), false);
  await t('F5c: no list → nudge denied', (async () => { const b = writeBatch(dO); b.set(doc(dO, `${P}/messages/n1`), { authorId: 'o', text: 'x', ts: Date.now(), sts: serverTimestamp(), kind: 'nudge', push: 'pending', toId: 't' }); b.update(doc(dO, `${P}/members/o`), { 'nudgeAt.t': serverTimestamp() }); await b.commit(); })(), false);
  await t('F5c: no list → admin consent for t denied', setDoc(doc(dO, `${P}/consents/t`), { kind: 'ai-report-notice', version: 'v1', ackTs: serverTimestamp(), byAdmin: 'o' }), false);
  await t('F5c: admin creates the list with t', setDoc(doc(dO, `${P}/state/trainees`), tsDoc('o', ['t'], { t: '아버지' })));
  await t('F5c: now t writes progress', setDoc(doc(dT, `${P}/progress/${today}-t`), Object.assign(progressStart(null, { userId: 't', date: today, planned: ['odd'], gameId: 'odd', now: Date.now() }), { sts: serverTimestamp() })));
}

// =============================================================================
// 새 가족방 만들기는 '만들기 코드'를 아는 사람만 (appConfig/creation, createProofs)
// =============================================================================
{
  const FP = 'famP', CP = 'PQR234', P = `families/${FP}`;
  const found = (d, uid, fid, code, withProof, proof = sha(CREATE_CODE)) => {
    const b = writeBatchRaw(d);
    if (withProof) b.set(doc(d, 'createProofs', uid), { proof, ts: serverTimestamp() });
    b.set(doc(d, 'families', fid), { createdBy: uid, createdTs: serverTimestamp(), ownerMemberId: 'm' + uid, joinCode: code });
    b.set(doc(d, 'joinCodes', code), { familyId: fid, createdBy: 'm' + uid, createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d, `families/${fid}/uids/${uid}`), { memberId: 'm' + uid, via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d, `families/${fid}/members/m${uid}`), { name: '나', role: 'family', joinedTs: serverTimestamp() });
    return b.commit();
  };
  const hashOf = c => ({ codeHash: sha(sha(c)), setBy: 'mP', updatedTs: serverTimestamp() });
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'appConfig/creation')); });
  await t('CC: no creation doc → nobody can create a family', found(db('p1'), 'p1', 'famN1', 'NNN234', true), false);
  await t('CC: no creation doc → the proof itself is denied', setDoc(doc(db('p1'), 'createProofs/p1'), { proof: sha(CREATE_CODE), ts: serverTimestamp() }), false);
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'appConfig/creation'), { codeHash: sha(sha(CREATE_CODE)), setBy: 'seed', updatedTs: Timestamp.now() }); });
  await t('CC: no proof → family create denied', found(db('p2'), 'p2', 'famN2', 'NNN235', false), false);
  await t('CC: wrong code → family create denied', found(db('p3'), 'p3', 'famN3', 'NNN236', true, sha('wrong-code-123')), false);
  await t('CC: wrong code → the proof write is denied (the screen can tell right away)', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: sha('wrong-code-123'), ts: serverTimestamp() }), false);
  await t('CC: the stored double hash is not a proof (sending codeHash itself is denied)', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: sha(sha(CREATE_CODE)), ts: serverTimestamp() }), false);
  await t('CC: a RAW code in proof is rejected (single hash is the only accepted form)', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: CREATE_CODE, ts: serverTimestamp() }), false);
  await t('CC: a raw code in proof is rejected inside a founding batch', found(db('p3'), 'p3', 'famN3', 'NNN236', true, CREATE_CODE), false);
  await t('CC: raw code, normalized form (uppercase, no dashes) in proof is rejected', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: 'ABCD2345EFGH', ts: serverTimestamp() }), false);
  await t('CC: uppercase hex of the right proof is rejected (must be lowercase hex)', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: sha(CREATE_CODE).toUpperCase(), ts: serverTimestamp() }), false);
  await t('CC: old single-hash scheme (codeHash = sha256(code)) is rejected for both sha256(code) and the raw code as proof', (async () => {
    await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'appConfig/creation'), { codeHash: sha(CREATE_CODE), setBy: 'seed', updatedTs: Timestamp.now() }); });
    try { await assertFails(setDoc(doc(db('p3'), 'createProofs/p3'), { proof: sha(CREATE_CODE), ts: serverTimestamp() })); await assertFails(setDoc(doc(db('p3'), 'createProofs/p3'), { proof: CREATE_CODE, ts: serverTimestamp() })); }
    finally { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'appConfig/creation'), { codeHash: sha(sha(CREATE_CODE)), setBy: 'seed', updatedTs: Timestamp.now() }); }); }
  })());
  await t('CC: proof with a client time denied', setDoc(doc(db('p3'), 'createProofs/p3'), { proof: sha(CREATE_CODE), ts: Timestamp.fromMillis(Date.now()) }), false);
  await t('CC: proof for someone else denied', setDoc(doc(db('p3'), 'createProofs/other'), { proof: sha(CREATE_CODE), ts: serverTimestamp() }), false);
  await t('CC: proofs cannot be read', getDoc(doc(db('p3'), 'createProofs/p3')), false);
  await t('CC: right code → family create allowed (proof in the same batch)', found(db('pP'), 'pP', FP, CP, true));
  await t('CC: right code → the proof write alone is allowed, then the family create (screen flow)', (async () => { const d = db('p4'); await setDoc(doc(d, 'createProofs/p4'), { proof: sha(CREATE_CODE), ts: serverTimestamp() }); await found(d, 'p4', 'famN4', 'NNN237', false); })());
  await t('CC: own proof can be deleted', deleteDoc(doc(db('p4'), 'createProofs/p4')));
  await t('CC: after deleting the proof a new family is denied again', found(db('p4'), 'p4', 'famN5', 'NNN238', false), false);
  await t('CC: existing family still lets people join by code', (async () => { const d = db('pJ'), b = writeBatchRaw(d); b.set(doc(d, `${P}/uids/pJ`), { memberId: 'mJ', via: 'join', code: CP, addedTs: serverTimestamp() }); b.set(doc(d, `${P}/members/mJ`), { name: '딸', role: 'family', joinedTs: serverTimestamp() }); await b.commit(); })());
  // appConfig: 읽기 금지, primary 는 서버만
  for (const [who, d] of [['owner', db('pP')], ['member', db('pJ')], ['stranger', db('p9')], ['signed-out', anon]]) {
    await t(`CC: ${who} cannot read appConfig/creation`, getDoc(doc(d, 'appConfig/creation')), false);
    await t(`CC: ${who} cannot read appConfig/primary`, getDoc(doc(d, 'appConfig/primary')), false);
  }
  await t('CC: nobody can list appConfig', getDocs(collection(db('pP'), 'appConfig')), false);
  await t('CC: nobody writes appConfig/primary', setDoc(doc(db('pP'), 'appConfig/primary'), { fid: FP }), false);
  // 코드 바꾸기: appConfig/primary 의 가족방 방 주인만
  await t('CC: without appConfig/primary even a family owner cannot set the code', setDoc(doc(db('pP'), 'appConfig/creation'), hashOf('new-code-12345')), false);
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'appConfig/primary'), { fid: FP }); });
  await t('CC: a non-owner member cannot set the code', setDoc(doc(db('pJ'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { setBy: 'mJ' })), false);
  await t('CC: a stranger cannot set the code', setDoc(doc(db('p9'), 'appConfig/creation'), hashOf('x-code-12345')), false);
  await t('CC: the owner of ANOTHER family cannot set the code', setDoc(doc(db('p4'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { setBy: 'mp4' })), false);
  await t('CC: owner with a forged setBy denied', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { setBy: 'mJ' })), false);
  await t('CC: owner with a client time denied', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { updatedTs: Timestamp.fromMillis(Date.now()) })), false);
  await t('CC: owner with a non-hash value denied (raw code is not accepted)', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('x'), { codeHash: 'x-code-12345' })), false);
  await t('CC: owner with an extra key denied', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { raw: 'x-code-12345' })), false);
  await t('CC: the primary owner sets a new code', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('new-code-12345'), { setBy: 'mpP' })));
  await t('CC: nobody deletes the code doc', deleteDoc(doc(db('pP'), 'appConfig/creation')), false);
  await t('CC: the old code no longer works', setDoc(doc(db('p5'), 'createProofs/p5'), { proof: sha(CREATE_CODE), ts: serverTimestamp() }), false);
  await t('CC: the new code works', setDoc(doc(db('p5'), 'createProofs/p5'), { proof: sha('new-code-12345'), ts: serverTimestamp() }));
  await t('CC: a proof made with the old code stops working after the code changes', (async () => { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'createProofs/p6'), { proof: sha(CREATE_CODE), ts: Timestamp.now() }); }); await found(db('p6'), 'p6', 'famN6', 'NNN239', false); })(), false);

  // ---- 검증 추가 (CCv): 만료, 남의 증거, 증거 꾸미기, 배치 시각 꾸미기, 관리자·예전 방 주인의 코드 바꾸기
  const NEW = sha('new-code-12345');
  const seedProof = (u, ms) => env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), `createProofs/${u}`), { proof: NEW, ts: Timestamp.fromMillis(ms) }); });
  await seedProof('v1', Date.now() - 31 * 60 * 1000);
  await t('CCv: a proof older than 30 minutes is rejected', found(db('v1'), 'v1', 'famV1', 'VVV234', false), false);
  await seedProof('v1', Date.now() - 29 * 60 * 1000);
  await t('CCv: a proof younger than 30 minutes works (boundary sanity)', found(db('v1'), 'v1', 'famV1', 'VVV234', false));
  await seedProof('victim', Date.now());
  await t('CCv: replaying another user\'s proof (createdBy = me) is denied', found(db('x1'), 'x1', 'famX1', 'XXX234', false), false);
  await t('CCv: claiming createdBy = victim from my uid is denied', (async () => {
    const d = db('x1'), b = writeBatchRaw(d);
    b.set(doc(d, 'families', 'famX2'), { createdBy: 'victim', createdTs: serverTimestamp(), ownerMemberId: 'mx1', joinCode: 'XXY234' });
    b.set(doc(d, 'joinCodes', 'XXY234'), { familyId: 'famX2', createdBy: 'mx1', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d, 'families/famX2/uids/x1'), { memberId: 'mx1', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d, 'families/famX2/members/mx1'), { name: '나', role: 'family', joinedTs: serverTimestamp() });
    await b.commit();
  })(), false);
  await t('CCv: cannot read another user\'s proof', getDoc(doc(db('x1'), 'createProofs/victim')), false);
  await t('CCv: cannot list proofs', getDocs(collection(db('x1'), 'createProofs')), false);
  await t('CCv: cannot overwrite another user\'s proof', setDoc(doc(db('x1'), 'createProofs/victim'), { proof: NEW, ts: serverTimestamp() }), false);
  await t('CCv: cannot delete another user\'s proof', deleteDoc(doc(db('x1'), 'createProofs/victim')), false);
  await t('CCv: signed-out cannot write a proof', setDoc(doc(anon, 'createProofs/x'), { proof: NEW, ts: serverTimestamp() }), false);
  await t('CCv: signed-out cannot create a family', setDoc(doc(anon, 'families/famAnon'), { createdBy: 'x', createdTs: serverTimestamp(), ownerMemberId: 'mx', joinCode: 'ANN234' }), false);
  await t('CCv: stranger without any proof cannot create a bare family doc', setDoc(doc(db('x2'), 'families/famX3'), { createdBy: 'x2', createdTs: serverTimestamp(), ownerMemberId: 'mx2', joinCode: 'XXZ234' }), false);
  // 증거 꾸미기: 시각을 남기고 proof 만 바꾸기, 키 더하기, 너무 긴 값, 배치에서 꾸민 시각
  await seedProof('x3', Date.now() - 60 * 60 * 1000);
  await t('CCv: refreshing an expired proof without a new server time is denied', updateDoc(doc(db('x3'), 'createProofs/x3'), { proof: NEW }), false);
  await t('CCv: refreshing with a client time is denied', updateDoc(doc(db('x3'), 'createProofs/x3'), { ts: Timestamp.fromMillis(Date.now()) }), false);
  await t('CCv: proof with an extra key denied', setDoc(doc(db('x3'), 'createProofs/x3'), { proof: NEW, ts: serverTimestamp(), ok: true }), false);
  await t('CCv: proof longer than 100 chars denied', setDoc(doc(db('x3'), 'createProofs/x3'), { proof: 'a'.repeat(101), ts: serverTimestamp() }), false);
  await t('CCv: proof that is not a string denied', setDoc(doc(db('x3'), 'createProofs/x3'), { proof: 12345, ts: serverTimestamp() }), false);
  await t('CCv: batch with a wrong-code proof and a forged (client) time is denied', (async () => {
    const d = db('x4'), b = writeBatchRaw(d);
    b.set(doc(d, 'createProofs/x4'), { proof: sha('guess-123456'), ts: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) });
    b.set(doc(d, 'families/famX4'), { createdBy: 'x4', createdTs: serverTimestamp(), ownerMemberId: 'mx4', joinCode: 'XXA234' });
    b.set(doc(d, 'joinCodes/XXA234'), { familyId: 'famX4', createdBy: 'mx4', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d, 'families/famX4/uids/x4'), { memberId: 'mx4', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d, 'families/famX4/members/mx4'), { name: '나', role: 'family', joinedTs: serverTimestamp() });
    await b.commit();
  })(), false);
  await t('CCv: batch with the right code but a forged future time is denied', (async () => {
    const d = db('x4'), b = writeBatchRaw(d);
    b.set(doc(d, 'createProofs/x4'), { proof: NEW, ts: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) });
    b.set(doc(d, 'families/famX4'), { createdBy: 'x4', createdTs: serverTimestamp(), ownerMemberId: 'mx4', joinCode: 'XXA234' });
    b.set(doc(d, 'joinCodes/XXA234'), { familyId: 'famX4', createdBy: 'mx4', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d, 'families/famX4/uids/x4'), { memberId: 'mx4', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d, 'families/famX4/members/mx4'), { name: '나', role: 'family', joinedTs: serverTimestamp() });
    await b.commit();
  })(), false);
  await seedProof('x5', Date.now());
  await t('CCv: deleting my proof inside the founding batch is denied', (async () => {
    const d = db('x5'), b = writeBatchRaw(d);
    b.delete(doc(d, 'createProofs/x5'));
    b.set(doc(d, 'families/famX5'), { createdBy: 'x5', createdTs: serverTimestamp(), ownerMemberId: 'mx5', joinCode: 'XXB234' });
    b.set(doc(d, 'joinCodes/XXB234'), { familyId: 'famX5', createdBy: 'mx5', createdTs: serverTimestamp(), expiresTs: in7d() });
    b.set(doc(d, 'families/famX5/uids/x5'), { memberId: 'mx5', via: 'create', addedTs: serverTimestamp() });
    b.set(doc(d, 'families/famX5/members/mx5'), { name: '나', role: 'family', joinedTs: serverTimestamp() });
    await b.commit();
  })(), false);
  // 코드 바꾸기: primary 가족방의 관리자(방 주인 아님), 예전 방 주인은 거부. 새 방 주인은 허용.
  await t('CCv: owner grants mJ admin in the primary family', updateDoc(doc(db('pP'), 'families', FP), { admins: ['mJ'] }));
  await t('CCv: a primary-family admin (not owner) cannot set the code', setDoc(doc(db('pJ'), 'appConfig/creation'), Object.assign(hashOf('admin-code-123'), { setBy: 'mJ' })), false);
  await t('CCv: a primary-family admin cannot update the code with merge', setDoc(doc(db('pJ'), 'appConfig/creation'), { setBy: 'mJ', updatedTs: serverTimestamp() }, { merge: true }), false);
  await t('CCv: owner hands the primary family to mJ', updateDoc(doc(db('pP'), 'families', FP), { ownerMemberId: 'mJ' }));
  await t('CCv: the former primary owner cannot set the code', setDoc(doc(db('pP'), 'appConfig/creation'), Object.assign(hashOf('old-owner-123'), { setBy: 'mpP' })), false);
  await t('CCv: the new primary owner can set the code', setDoc(doc(db('pJ'), 'appConfig/creation'), Object.assign(hashOf('handover-code-1'), { setBy: 'mJ' })));
  await t('CCv: the owner of a family created with the code still cannot set it', setDoc(doc(db('v1'), 'appConfig/creation'), Object.assign(hashOf('x-code-12345'), { setBy: 'mv1' })), false);
  await t('CCv: owner cannot read the code doc after setting it', getDoc(doc(db('pJ'), 'appConfig/creation')), false);
  await t('CCv: writing appConfig/other is denied', setDoc(doc(db('pJ'), 'appConfig/other'), { x: 1 }), false);
  // 들어가기(가입 코드)·기기 옮기기는 만들기 코드와 상관없어요: 코드를 바꾼 뒤에도 기존 가족방에 가입돼요.
  await t('CCv: joining an existing family still works after the creation code changes', (async () => { const d = db('pK'), b = writeBatchRaw(d); b.set(doc(d, `${P}/uids/pK`), { memberId: 'mK', via: 'join', code: CP, addedTs: serverTimestamp() }); b.set(doc(d, `${P}/members/mK`), { name: '손주', role: 'family', joinedTs: serverTimestamp() }); await b.commit(); })());
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'appConfig/creation')); });
  await t('CCv: joining still works even with no creation doc at all', (async () => { const d = db('pL'), b = writeBatchRaw(d); b.set(doc(d, `${P}/uids/pL`), { memberId: 'mL', via: 'join', code: CP, addedTs: serverTimestamp() }); b.set(doc(d, `${P}/members/mL`), { name: '조카', role: 'family', joinedTs: serverTimestamp() }); await b.commit(); })());
}

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
