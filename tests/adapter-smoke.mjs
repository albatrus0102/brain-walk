// FirebaseAdapter + membership 흐름을 Firestore/Auth 에뮬레이터에 대해 시험해요.
//   npm run test:smoke   (tests/README.md 참고)
// 사람마다(A 아버지·B 가족·C 새 기기) 별도 프로세스로 돌려서 진짜 기기처럼 서로 다른 로그인을 써요.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { CREATE_CODE, seedCreation } from './seed-creation.mjs';
const actor = process.argv[2];
const dir = process.env.SMOKE_DIR || path.join(os.tmpdir(), 'bw-smoke');

if (!actor) {   // ---- 오케스트레이터
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await seedCreation();   // 가족방 만들기 코드(해시)를 심어요. appConfig/primary 는 일부러 안 심어요 (방 주인이 코드를 못 바꾸는 것도 확인)
  const run = n => new Promise(res => { const p = spawn(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: { ...process.env, SMOKE_DIR: dir } }); p.on('exit', c => res(c)); });
  const codes = await Promise.all(['A', 'B', 'C', 'D'].map(run));
  console.log(codes.every(c => c === 0) ? 'SMOKE: ALL PASSED' : 'SMOKE: FAILED ' + codes);
  process.exit(codes.every(c => c === 0) ? 0 : 1);
}

// ---- 노드에서 브라우저 환경 흉내
const mem = new Map();
globalThis.self = globalThis;
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.location = new URL('http://localhost:8765/brain-walk/');
self.BW_CONFIG = { firebase: { apiKey: 'fake-key', authDomain: 'demo-bw.firebaseapp.com', projectId: 'demo-bw', appId: 'x' }, vapidKey: 'x', emulator: { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 } };
const { setSdkImporter } = await import('../js/store/firebase-sdk.js');
setSdkImporter(name => import('firebase/' + name.replace('firebase-', '')));
const { FirebaseAdapter: FA } = await import('../js/store/firebase-adapter.js');
const M = await import('../js/store/membership.js');
const PG = await import('../js/program.js');
const CAT = [{ id: 'cards', domain: 'memory', rounds: 2 }, { id: 'words', domain: 'memory', rounds: 3 }, { id: 'odd', domain: 'attention', rounds: 5 }, { id: 'trail', domain: 'attention', rounds: 3 }, { id: 'shop', domain: 'executive', rounds: 5 }, { id: 'order', domain: 'executive', rounds: 3 }, { id: 'today', domain: 'orientation', rounds: 5 }, { id: 'proverb', domain: 'orientation', rounds: 5 }, { id: 'flash', domain: 'speed', rounds: 5 }];
const ymdNow = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { try { if (await f()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 100)); } return false; };

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log(`[${actor}] ${c ? 'ok  ' : 'FAIL'} ${msg}`); };
const signal = (n, d) => fs.writeFileSync(path.join(dir, n), JSON.stringify(d ?? {}));
const wait = async n => { for (let i = 0; i < 600; i++) { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { await new Promise(r => setTimeout(r, 100)); } } throw new Error('timeout waiting ' + n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const denied = async p => { try { await p; return false; } catch (e) { return e && e.code === 'permission-denied'; } };
const msg = (text, kind = 'text') => ({ authorId: FA.mid, text, ts: Date.now(), kind, reactions: {} });
const mid1 = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);

try {
  if (actor === 'A') {
    ok(await FA.init() === false, '새 기기는 가입 필요(온보딩)');
    ok(await M.checkCreateCode('틀린 코드').then(() => false, e => e && e.code === 'bad-code'), '만들기 코드가 틀리면 화면에서 바로 알 수 있어요');
    ok(await denied(M.createFamily({ name: '아버지', role: 'trainee' })), '만들기 코드 없이는 가족방을 못 만들어요');
    ok(await denied(M.createFamily({ name: '아버지', role: 'trainee', createCode: 'wrong-code-123' })), '틀린 만들기 코드로는 가족방을 못 만들어요');
    ok(await M.checkCreateCode(CREATE_CODE) === true, '맞는 만들기 코드는 통과');
    const r = await M.createFamily({ name: '아버지', role: 'trainee', createCode: CREATE_CODE });
    ok(await (async () => { const { F, db } = FA.sdk; try { await F.getDoc(F.doc(db, 'createProofs', FA.uid)); return false; } catch (e) { return e.code === 'permission-denied'; } })(), '만들기 증거 문서는 아무도 읽지 못해요');
    ok(await denied(M.setCreateCode('another-code-12345')), 'appConfig/primary 가 없으면 방 주인도 코드를 못 바꿔요');
    ok(await M.setCreateCode('short').then(() => false, e => e && e.code === 'short-code'), '8글자 미만 코드는 거절');
    ok(/^[2-9A-HJ-NP-Z]{6}$/.test(r.code), '가족 만들기 + 6글자 코드 ' + r.code);
    ok(FA.me().id === r.mid && FA.me().name === '아버지', 'me() = memberId');
    ok((await FA.getDoc('state/trainee')).userId === r.mid, 'state/trainee 설정');
    signal('created', { code: r.code, mid: r.mid });
    const j = await wait('joined');
    await sleep(500);
    ok((await FA.profiles([j.mid]))[j.mid].name === '큰아들', '프로필: 가입한 가족 이름');
    const today = new Date().toISOString().slice(0, 10);
    await FA.setDoc('surveys/a1', { kind: 'smcq', version: '1', answers: Array(14).fill(0), score: 0, ts: Date.now(), date: today, mode: 'self', answeredBy: FA.mid, relation: '본인' });
    ok(true, '훈련하는 분이 직접 답한 설문 저장(create)');
    ok(await denied(FA.query('surveys', { orderBy: ['ts', 'desc'], limit: 10 })), '훈련하는 분은 설문을 읽을 수 없음');
    signal('a-survey', {});
    const b = await wait('b-sent');
    const msgs = await FA.query('messages', { orderBy: ['ts', 'desc'], limit: 20 });
    const hello = msgs.find(m => m.text === '안녕하세요 아버지');
    ok(!!hello && !('sts' in hello) && !('push' in hello), '메시지 수신(내부 필드 숨김)');
    ok(msgs.some(m => m.kind === 'system' && /들어왔어요/.test(m.text)), '가입 시스템 메시지');
    const nudge = msgs.find(m => m.kind === 'nudge');
    ok(!!nudge, '넛지 수신');
    await FA.updateDoc('messages/' + hello.id, { reactions: { '❤️': [FA.mid] } });
    await FA.updateDoc('messages/' + nudge.id, { acks: { [FA.mid]: Date.now() } });
    const again = await FA.getDoc('messages/' + hello.id);
    ok(JSON.stringify(again.reactions) === JSON.stringify({ '❤️': [FA.mid] }), '반응 저장/복원 {이모지:[id]}');
    // 자기 글 삭제(소프트)
    const mine = mid1(); await FA.setDoc('messages/' + mine, msg('지울 글')); await FA.updateDoc('messages/' + mine, { deleted: true, text: '' });
    ok((await FA.getDoc('messages/' + mine)).deleted === true, '내 글 삭제');
    // 기록 저장 (roundSec 배열 변환)
    await FA.setDoc('sessions/s1', { date: '2026-10-09', ts: Date.now(), gameId: 'cards', gameName: '카드', domain: 'memory', level: 1, correct: 1, total: 2, accuracy: 0.5, durationSec: 10, inCourse: true, roundSec: [3, 5], userId: FA.mid });
    ok((await FA.getDoc('sessions/s1')).roundSec === 4, '세션 저장 (roundSec 평균)');
    await FA.setDoc('checkins/2026-10-09-' + FA.mid, { date: '2026-10-09', ts: Date.now(), mood: 4, sleepHours: 7, exercise: true, social: false, meals: true, userId: FA.mid });
    ok(true, '생활 체크 저장');
    await FA.setDoc('state/alarm', { time: '09:30', days: [1, 2], updatedBy: FA.mid, updatedTs: Date.now() });
    ok(true, '알람 저장');
    const t = await M.createTransferCode();
    signal('transfer', { code: t.code });
    await wait('c-done');
    const devs = await M.listMyDevices();
    ok(devs.length === 2 && devs.filter(d => d.current).length === 1, '연결된 기기 2대 (이 기기 + 옮긴 기기)');
    await M.revokeDevice(devs.find(d => !d.current).uid);
    ok((await M.listMyDevices()).length === 1, '다른 기기 연결 끊기');
    await FA.setDoc('taskRuns/' + Date.now(), { date: '2026-10-09', ts: Date.now(), userId: FA.mid, v: 1, tasks: {} });
    ok(await denied(FA.query('taskRuns', { limit: 5 })), '훈련하는 분은 점검 과제 상세를 읽을 수 없음(쓰기만)');
    const inv = await M.getInviteInfo();
    ok(inv.code === r.code && !inv.expired, '가족 코드 다시 보기');
    const rot = await M.rotateJoinCode();
    ok(rot.code !== r.code, '가족 코드 새로 만들기');
    ok((await M.getInviteInfo()).code === rot.code, '새 코드 반영');
    await M.renameSelf('아버님'); await sleep(400); ok((await FA.profiles([FA.mid]))[FA.mid].name === '아버님', '이름 바꾸기');
    await M.renameSelf('아버지'); await sleep(300);
    // ===== 관리자·원격 설정·실시간 진행 (DESIGN.md) =====
    const seenDisp = []; const unsubD = FA.subscribe('state/display', {}, d => seenDisp.push(d));
    const seenPlan = []; const unsubP = FA.subscribe('state/plan', {}, d => seenPlan.push(d));
    signal('p1', { mid: r.mid });
    await wait('b-denied');
    await M.grantAdmin(j.mid); ok(true, '방 주인이 B(가족 역할)를 관리자로 지정');
    ok(await denied(M.grantAdmin('nobody-here')), '없는 사람은 관리자로 못 정해요');
    signal('granted', {});
    await wait('b-saved');
    ok(await until(() => seenDisp.some(d => d && d.size === 'max' && d.font === 'noto')), '훈련하는 분 기기가 관리자의 화면 설정을 실시간으로 받아요 (display)');
    ok(await until(() => seenPlan.some(d => d && d.gamesPerDay === 3 && d.autoNextSec === 5)), '훈련 계획도 실시간 (gamesPerDay 3, autoNextSec 5)');
    const alarm = await FA.getDoc('state/alarm'); ok(alarm && alarm.time === '08:30' && alarm.days.join() === '1,2,3,4,5', '계획과 알람이 한 배치로 저장');
    unsubD(); unsubP();
    // 훈련하는 분 기기가 진행 상황과 접속 기록을 써요
    const day = ymdNow(), pid = day + '-' + r.mid, planned = ['odd', 'words'];
    let prog = PG.progressStart(null, { userId: r.mid, date: day, planned, gameId: 'odd', now: Date.now() });
    await FA.setDoc('progress/' + pid, prog); ok(true, '진행 문서 쓰기: 게임 시작 (서버 도장은 어댑터가)');
    signal('a-p1', { pid });
    await wait('b-saw1');
    prog = PG.progressFinish(prog, { gameId: 'odd', result: { acc: 0.8, correct: 4, total: 5, sec: 70, level: 2 }, now: Date.now() });
    await FA.setDoc('progress/' + pid, prog); signal('a-p2', {});
    await wait('b-saw2');
    ok(await denied(FA.setDoc('progress/' + day + '-' + j.mid, Object.assign({}, prog, { userId: j.mid }))), '남의 진행 문서는 쓸 수 없어요');
    await FA.setDoc('presence/' + r.mid, { ts: Date.now(), screen: 'home', device: 'smoke' }); ok(true, '접속 기록(presence) 쓰기');
    ok(await denied(FA.setDoc('presence/' + r.mid, { ts: Date.now(), screen: 'home' })), '바로 이어 쓰면 거부 (20초 제한 → 앱은 조용히 무시)');
    signal('a-hb', {});
    // 관리자 B 가 훈련하는 분을 B 로 바꾸면 A 의 진행 쓰기는 거부돼요
    await wait('b-assigned');
    ok((await FA.getDoc('state/trainee')).userId === j.mid, 'B 가 훈련하는 분으로 정해졌어요');
    await sleep(300); ok((FA.members()[r.mid] || {}).role === 'family', '이전 훈련하는 분(A)은 가족 역할로');
    ok(await denied(FA.setDoc('progress/' + pid, Object.assign({}, prog, { updatedTs: Date.now() }))), '훈련하는 분이 아니면 진행 문서를 쓸 수 없어요');
    signal('a-saw-assign', {});
    // B 는 훈련하는 분(트레이니) 역할이 되어 더 이상 관리자가 아니에요 → 방 주인이 해제하고 되돌려요
    await M.clearTrainee(j.mid); await sleep(300);
    ok(!(await FA.getDoc('state/trainee')) && (FA.members()[j.mid] || {}).role === 'family', '방 주인이 훈련하는 분을 해제 (B 는 가족 역할로)');
    await M.assignTrainee(r.mid, '아버지', null); await sleep(300);
    ok((await FA.getDoc('state/trainee')).userId === r.mid && (FA.members()[r.mid] || {}).role === 'trainee', '방 주인이 다시 A 를 훈련하는 분으로 (역할도 함께)');
    ok(await denied(FA.query('taskRuns', { limit: 5 })), '다시 훈련하는 분: 가족 전용 자료는 못 읽어요');
    signal('a-restored', {});
    // 방 주인 넘기기 (훈련하는 분 역할이라 관리자로 남기기는 안 돼요)
    await M.transferOwnership(j.mid, false); ok(true, '방 주인을 B 에게 넘김');
    signal('a-handed', {});
    await wait('b-back');
    const fam = await (async () => { const { F, db } = FA.sdk; return (await F.getDoc(F.doc(db, 'families', FA.fid))).data(); })();
    ok(fam.ownerMemberId === r.mid && fam.admins.includes(j.mid), 'B 가 방 주인을 돌려줬어요 (B 는 관리자로 남음)');
    // 모르는 사람 내보내기
    signal('p-d', { code: (await M.getInviteInfo()).code });
    const dj = await wait('d-joined');
    await M.removeMember(dj.mid); ok(true, '관리자가 D 를 가족방에서 내보냄');
    signal('d-removed', {});
    await wait('d-done'); await sleep(300);
    ok((await FA.profiles([dj.mid]))[dj.mid].name === '떠난 가족', '내보낸 사람은 "떠난 가족"');
    signal('rotated', { code: rot.code });
    await wait('b-left');
    await sleep(500);
    ok((await FA.profiles([j.mid]))[j.mid].name === '떠난 가족', '나간 가족은 "떠난 가족"');
    await M.deleteFamily();
    const after = await FA.resolveMembership().catch(() => false);
    ok(after === false, '삭제 후 멤버십 없음');
    signal('done', {});
  }
  if (actor === 'B') {
    const c = await wait('created');
    ok(await FA.init() === false, '가입 전');
    ok(await denied(M.previewJoinCode('ZZZZZZ').catch(e => Promise.reject({ code: 'permission-denied' }))), '틀린 코드는 거부');
    ok((await M.previewJoinCode(c.code)).length > 5, '코드 확인');
    const r = await M.joinFamily({ code: c.code, name: '큰아들', role: 'family' });
    ok(r.mid && !r.needsConfirm, '가족으로 들어가기');
    signal('joined', { mid: r.mid });
    const t0 = await FA.getDoc('state/trainee'); ok(t0.userId === c.mid, '아버지가 훈련하는 분');
    await FA.setDoc('messages/' + mid1(), msg('안녕하세요 아버지'));
    await FA.setDoc('messages/' + mid1(), msg('이번 주 요약', 'summary'));
    ok(true, '메시지 보내기');
    const n1 = mid1();
    await FA.setDoc('messages/' + n1, msg('아버지 훈련하셨어요?', 'nudge'));
    ok(true, '넛지 보내기 (members.lastNudgeAt 와 한 번에)');
    ok(await denied(FA.setDoc('messages/' + mid1(), msg('또 보내요', 'nudge'))), '넛지 2시간 제한(규칙)');
    ok(await denied(FA.updateDoc('state/trainee', { userId: 'nope', displayLabel: 'x' })), '없는 사람은 훈련하는 분이 될 수 없음');
    ok(await denied(FA.deleteDoc('state/trainee')), '소유자가 아니면 훈련하는 분 해제 불가');
    ok(await denied(M.createTransferCode(c.mid)), '방금 들어온 가족은 아버지(방 주인)의 복구 코드를 만들 수 없음');
    await wait('a-survey');
    const svs = await FA.query('surveys', { orderBy: ['ts', 'desc'], limit: 10 });
    ok(svs.length === 1 && svs[0].kind === 'smcq', '가족은 설문을 읽을 수 있음');
    await FA.setDoc('surveys/b1', { kind: 'iqcode', version: '1', answers: Array(16).fill(3), score: 3, ts: Date.now(), date: new Date().toISOString().slice(0, 10), mode: 'family', answeredBy: FA.mid, subjectId: c.mid, relation: '아들' });
    ok(true, '가족이 정보제공자 설문 저장');
    signal('b-sent', {});
    await wait('p1');
    ok(await denied(M.savePlan({ gamesPerDay: 3 }, CAT, FA.mid, '08:30')), '관리자가 아닌 가족은 훈련 계획을 저장할 수 없어요 (permission-denied)');
    ok(await denied(M.saveDisplay({ size: 'max' }, FA.mid)), '관리자가 아닌 가족은 화면 설정을 저장할 수 없어요');
    ok(await denied(FA.setDoc('state/alarm', { time: '09:00', days: [1], updatedBy: FA.mid, updatedTs: Date.now() })), '알람도 관리자만');
    ok(await denied(M.assignTrainee(FA.mid, '어머니', null)), '훈련하는 분 정하기는 관리자만');
    ok(await denied(M.removeMember(c.mid)), '내보내기는 관리자만');
    signal('b-denied', {});
    await wait('granted');
    const seenProg = []; const unsubG = FA.subscribe('progress', { orderBy: ['date', 'desc'], limit: 14 }, l => seenProg.push(l));
    await M.savePlan({ gamesPerDay: 3, autoNextSec: 5, weekdays: [1, 2, 3, 4, 5] }, CAT, FA.mid, '08:30'); ok(true, '관리자가 된 B 가 훈련 계획 저장 (계획+알람 한 번에)');
    await M.saveDisplay({ font: 'noto', size: 'max', contrast: true, rate: 1.05 }, FA.mid); ok(true, 'B 가 화면 설정 저장');
    ok(await denied(M.revokeAdmin(FA.mid)), '관리자는 관리자 목록을 바꿀 수 없어요 (방 주인만)');
    signal('b-saved', {});
    const a1 = await wait('a-p1');
    ok(await until(() => seenProg.some(l => l.some(x => x.id === a1.pid && x.idx === 0 && x.current === 'odd' && x.status === 'started'))), '가족 화면: 게임이 시작되면 진행 현황이 실시간으로 보여요 (idx 0, current odd)');
    signal('b-saw1', {});
    await wait('a-p2');
    ok(await until(() => seenProg.some(l => l.some(x => x.id === a1.pid && x.idx === 1 && x.results[0] && x.results[0].g === 'odd' && x.current === null))), '게임이 끝나면 결과가 실시간으로 (idx 1, results[0])');
    signal('b-saw2', {});
    unsubG();
    await wait('a-hb');
    const pres = await FA.getDoc('presence/' + c.mid); ok(pres && pres.lastSeen && pres.device === 'smoke', '가족이 훈련하는 분의 마지막 접속 시간을 읽어요');
    await M.assignTrainee(FA.mid, '어머니', c.mid); ok(true, '관리자 B 가 자신을 훈련하는 분으로 (배치: trainee + 두 사람 역할)');
    ok(await denied(M.clearTrainee(FA.mid)), '훈련하는 분 역할이 된 B 는 관리자가 아니에요 (관리자 목록에 있어도 역할이 가족일 때만)');
    signal('b-assigned', {});
    await wait('a-saw-assign');
    await wait('a-restored'); await sleep(300);
    ok((FA.members()[FA.mid] || {}).role === 'family' && await denied(M.savePlan({ gamesPerDay: 2 }, CAT, FA.mid, '09:00')) === false, '가족 역할로 돌아오면 B 는 다시 관리자');
    await wait('a-handed');
    await M.transferOwnership(c.mid, true); ok(true, 'B 가 방 주인을 A 에게 돌려주고 관리자로 남기 (한 번의 쓰기)');
    signal('b-back', {});
    await wait('p-d');
    await wait('rotated');
    await M.leaveFamily();
    ok(FA.fid === null, '가족 나가기');
    signal('b-left', {});
  }
  if (actor === 'C') {
    const t = await wait('transfer');
    ok(await FA.init() === false, '새 기기는 가입 필요');
    const r = await M.redeemTransfer(t.code);
    const a = await wait('created');
    ok(r.mid === a.mid && FA.me().id === a.mid, '기기 옮기기: 같은 사람(memberId)으로 연결');
    ok(FA.me().name === '아버지', '이름 유지');
    await FA.setDoc('messages/' + mid1(), msg('새 기기예요'));
    ok(true, '새 기기에서 메시지');
    signal('c-done', {});
  }
  if (actor === 'D') {
    const p = await wait('p-d');
    ok(await FA.init() === false, '가입 전');
    const r = await M.joinFamily({ code: p.code, name: '낯선 사람', role: 'family' });
    ok(r.mid, '새 코드로 가족으로 들어가기 (승인 단계 없음, 들어왔어요 안내)');
    signal('d-joined', { mid: r.mid });
    await wait('d-removed');
    ok(await until(async () => (await FA.resolveMembership().catch(() => false)) === false), '내보내진 기기는 가족방이 닫혀요');
    signal('d-done', {});
  }
} catch (e) { fails++; console.log(`[${actor}] ERROR`, e && (e.stack || e.message || JSON.stringify(e))); }
console.log(`[${actor}] done fails=${fails}`);
process.exit(fails ? 1 : 0);
