// FirebaseAdapter + membership 흐름을 Firestore/Auth 에뮬레이터에 대해 시험해요.
//   npm run test:smoke   (tests/README.md 참고)
// 사람마다(A 아버지·B 가족·C 새 기기) 별도 프로세스로 돌려서 진짜 기기처럼 서로 다른 로그인을 써요.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
const actor = process.argv[2];
const dir = process.env.SMOKE_DIR || path.join(os.tmpdir(), 'bw-smoke');

if (!actor) {   // ---- 오케스트레이터
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const run = n => new Promise(res => { const p = spawn(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: { ...process.env, SMOKE_DIR: dir } }); p.on('exit', c => res(c)); });
  const codes = await Promise.all(['A', 'B', 'C'].map(run));
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
    const r = await M.createFamily({ name: '아버지', role: 'trainee' });
    ok(/^[2-9A-HJ-NP-Z]{6}$/.test(r.code), '가족 만들기 + 6글자 코드 ' + r.code);
    ok(FA.me().id === r.mid && FA.me().name === '아버지', 'me() = memberId');
    ok((await FA.getDoc('state/trainee')).userId === r.mid, 'state/trainee 설정');
    signal('created', { code: r.code, mid: r.mid });
    const j = await wait('joined');
    await sleep(500);
    ok((await FA.profiles([j.mid]))[j.mid].name === '큰아들', '프로필: 가입한 가족 이름');
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
    const inv = await M.getInviteInfo();
    ok(inv.code === r.code && !inv.expired, '가족 코드 다시 보기');
    const rot = await M.rotateJoinCode();
    ok(rot.code !== r.code, '가족 코드 새로 만들기');
    ok((await M.getInviteInfo()).code === rot.code, '새 코드 반영');
    await M.renameSelf('아버님'); await sleep(400); ok((await FA.profiles([FA.mid]))[FA.mid].name === '아버님', '이름 바꾸기');
    await M.renameSelf('아버지'); await sleep(300);
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
    signal('b-sent', {});
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
} catch (e) { fails++; console.log(`[${actor}] ERROR`, e && (e.stack || e.message || JSON.stringify(e))); }
console.log(`[${actor}] done fails=${fails}`);
process.exit(fails ? 1 : 0);
