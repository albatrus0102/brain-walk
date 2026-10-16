import { displayDoc, planDoc } from '../program.js';
import { FirebaseAdapter as FA } from './firebase-adapter.js';
import { LocalAdapter } from './local-adapter.js';
import { Store } from './store.js';

/* 가족 만들기 / 들어가기 / 기기 옮기기 / 나가기 / 삭제 (ARCHITECTURE.md §5)
 * 모든 쓰기는 규칙이 같은 배치 안에서 서로를 확인하도록 writeBatch 로 묶어요. */
export const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';     // 0 O 1 I 없음
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHA[b & 31]).join('');
const DAY = 864e5;
export const JOIN_DAYS = 7;
export const TRANSFER_MIN = 25;        // 규칙 한도는 30분. 기기 시계 오차를 고려해 25분으로 해요.

/* 사용자 입력 정리: 대문자, 공백/하이픈 제거. {code, bad:true} 이면 0/O/1/I 가 섞인 거예요. */
export function normalizeCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[\s\-]/g, '');
  return { code: raw, bad: /[01OI]/.test(raw), valid: new RegExp('^[' + ALPHA + ']{6}$').test(raw) };
}
export function baseUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
export const inviteLink = code => baseUrl() + '?join=' + code;
export const transferLink = code => baseUrl() + '?transfer=' + code;
export const inviteText = (code, label) => (label || '아버지') + '와 함께 쓰는 두뇌 산책 가족방에 초대해요.\n아래 링크를 열고 이름을 입력해 주세요.\n' + inviteLink(code) + '\n가족 코드: ' + code;

const ts = ms => FA.sdk.F.Timestamp.fromMillis(ms);
const sv = () => FA.sdk.F.serverTimestamp();
const newId = () => FA.sdk.F.doc(FA.sdk.F.collection(FA.sdk.db, 'ids')).id;
const deviceLabel = () => { try { const p = navigator.userAgent; return (/iPhone|iPad/.test(p) ? 'iPhone/iPad' : /Android/.test(p) ? 'Android' : '컴퓨터').slice(0, 40); } catch (e) { return ''; } };

async function sendSystem(text) {
  try { await FA.setDoc('messages/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), { authorId: FA.mid, text, ts: Date.now(), kind: 'system', reactions: {} }); } catch (e) {}
}

/* 가족 코드가 맞는지만 확인. 성공하면 familyId. 틀림/만료는 같은 오류로 나와요. */
export async function previewJoinCode(code) {
  const { F, db } = FA.sdk;
  try {
    const s = await F.getDoc(F.doc(db, 'joinCodes', code));
    if (!s.exists()) throw { code: 'bad-code' };
    return s.data().familyId;
  } catch (e) { throw { code: 'bad-code', message: '코드가 맞지 않거나 기간이 지났어요' }; }
}

/* ---- 가족방 만들기 코드 (firestore.rules: appConfig/creation, createProofs) ----
 * 새 가족방은 '만들기 코드'를 아는 사람만 만들 수 있어요. 코드는 앱이 무작위로 만들어요 (방 주인이 고르지 않아요).
 * 정리한 코드(대문자, 공백·줄표 없음) = N.  증거 proof = sha256(N),  서버 appConfig/creation.codeHash = sha256(sha256(N)).
 * 생 코드는 서버에 가지 않아요. 증거는 createProofs/{내 uid} 에 쓰는데, 규칙이 sha256(proof) == codeHash 일 때만 받아 줘요
 * (그래서 화면에서 바로 맞는지 알 수 있어요). 체험 모드(LocalAdapter)는 같은 검사를 appConfig/creation 문서로 흉내 내요. */
export const CREATE_CODE_LEN = 12;
export const CREATE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // 0 O 1 I L 없음 (31글자)
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
/* 입력 정리: 대문자, 공백·줄표(여러 종류) 제거 */
export const normalizeCreateCode = c => String(c == null ? '' : c).toUpperCase().replace(/[\s\-\u2010-\u2015\u2212]+/g, '');
export const proofOf = code => sha256Hex(normalizeCreateCode(code));
export const formatCreateCode = n => (String(n).match(/.{1,4}/g) || []).join('-');
/* 무작위 12글자 (crypto.getRandomValues, 한쪽으로 쏠리지 않게 거절 추출) → XXXX-XXXX-XXXX */
export function generateCreateCode() {
  const A = CREATE_CODE_ALPHABET, limit = 256 - (256 % A.length), out = [];
  while (out.length < CREATE_CODE_LEN) {
    const buf = new Uint8Array(32); crypto.getRandomValues(buf);
    for (const x of buf) { if (x < limit && out.length < CREATE_CODE_LEN) out.push(A[x % A.length]); }
  }
  return formatCreateCode(out.join(''));
}
export async function checkCreateCode(code) {
  const n = normalizeCreateCode(code);
  if (!n || n.length > 100) throw { code: 'bad-code' };
  const proof = await sha256Hex(n);
  if (Store.mode === 'local') {
    const cfg = await LocalAdapter.getDoc('appConfig/creation');
    if (!cfg || cfg.codeHash !== await sha256Hex(proof)) throw { code: 'bad-code' };
    return true;
  }
  try { await FA.sdk.F.setDoc(FA.sdk.F.doc(FA.sdk.db, 'createProofs', FA.uid), { proof, ts: sv() }); }
  catch (e) { throw { code: e && e.code === 'permission-denied' ? 'bad-code' : (e && e.code) || 'failed' }; }
  return true;
}
/* 증거 지우기 (만들기를 그만두거나 실패했을 때, 되도록이면). 지우지 못해도 30분 뒤 규칙이 거절해요. */
export async function clearCreateProof() {
  if (Store.mode === 'local' || !FA.sdk || !FA.uid) return;
  try { await FA.sdk.F.deleteDoc(FA.sdk.F.doc(FA.sdk.db, 'createProofs', FA.uid)); } catch (e) {}
}
/* 방 주인이 새 만들기 코드를 만들어요. 서버에는 이중 해시만 보내요. 이전 코드는 바로 못 써요. 만든 코드(XXXX-XXXX-XXXX)를 돌려줘요. */
export async function createNewCreateCode() {
  const code = generateCreateCode(), codeHash = await sha256Hex(await proofOf(code));
  if (Store.mode === 'local') { await LocalAdapter.setDoc('appConfig/creation', { codeHash, setBy: 'local', updatedTs: Date.now() }); return code; }
  await FA.sdk.F.setDoc(FA.sdk.F.doc(FA.sdk.db, 'appConfig', 'creation'), { codeHash, setBy: FA.mid, updatedTs: sv() });
  return code;
}

export async function createFamily({ name, role, createCode }) {
  const { F, db } = FA.sdk, uid = FA.uid, fid = newId(), mid = newId(), proof = await proofOf(createCode);
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = newCode(), b = F.writeBatch(db);
    b.set(F.doc(db, 'createProofs', uid), { proof, ts: sv() });
    b.set(F.doc(db, 'families', fid), { createdBy: uid, createdTs: sv(), ownerMemberId: mid, joinCode: code, name: '우리 가족', schemaVersion: 1 });
    b.set(F.doc(db, 'joinCodes', code), { familyId: fid, createdBy: mid, createdTs: sv(), expiresTs: ts(Date.now() + JOIN_DAYS * DAY) });
    b.set(F.doc(db, 'families', fid, 'uids', uid), { memberId: mid, via: 'create', addedTs: sv(), device: deviceLabel() });
    b.set(F.doc(db, 'families', fid, 'members', mid), { name, role, joinedTs: sv() });
    b.set(F.doc(db, 'users', uid), { familyId: fid, memberId: mid, updatedAt: sv() });
    try { await b.commit(); lastErr = null; await FA.setMembership(fid, mid); await clearCreateProof(); if (role === 'trainee') await setTrainee(); return { fid, mid, code }; }
    catch (e) { lastErr = e; if (!(e && e.code === 'permission-denied')) break; }
  }
  await clearCreateProof();
  throw lastErr;
}

/* 훈련하는 분으로 등록 (state/trainee) */
export async function setTrainee(label) {
  const cur = await FA.getDoc('state/trainee').catch(() => null);
  await FA.setDoc('state/trainee', { userId: FA.mid, displayLabel: label || (cur && cur.displayLabel) || '아버지' });
}

export async function joinFamily({ code, name, role }) {
  const { F, db } = FA.sdk, uid = FA.uid, fid = await previewJoinCode(code), mid = newId();
  const b = F.writeBatch(db);
  b.set(F.doc(db, 'families', fid, 'uids', uid), { memberId: mid, via: 'join', code, addedTs: sv(), device: deviceLabel() });
  b.set(F.doc(db, 'families', fid, 'members', mid), { name, role, joinedTs: sv() });
  b.set(F.doc(db, 'users', uid), { familyId: fid, memberId: mid, updatedAt: sv() });
  try { await b.commit(); } catch (e) { throw { code: e && e.code === 'permission-denied' ? 'bad-code' : (e && e.code), message: '코드가 맞지 않거나 기간이 지났어요' }; }
  await FA.setMembership(fid, mid);
  await sendSystem(name + '님이 가족방에 들어왔어요');
  // 훈련하는 분은 가족방에 한 명이에요. 이미 있으면 가족으로 들어가요 (가입 30분 안에는 본인 역할을 바꿀 수 있어요). 바꾸려면 관리자에게 부탁해요.
  let traineeTaken = false;
  if (role === 'trainee') {
    const t = await FA.getDoc('state/trainee').catch(() => null);
    if (!t || !t.userId) await setTrainee();
    else if (t.userId !== mid) { traineeTaken = true; try { await FA.updateDoc('members/' + mid, { role: 'family' }); } catch (e) {} }
  }
  return { fid, mid, traineeTaken, label: null };
}

/* ---- 기기 옮기기 ---- */
/* forMember 를 주면 "가족 기기 복구 코드": 폰을 잃어버린 다른 가족(예: 아버지)의 새 기기용.
 * 규칙: 방 주인이거나, 가입한 지 24시간이 지난 '가족' 역할만 다른 사람의 코드를 만들 수 있어요. */
export async function createTransferCode(forMember) {
  const { F, db } = FA.sdk, target = forMember || FA.mid;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = newCode(), expires = Date.now() + TRANSFER_MIN * 60000;
    try {
      await F.setDoc(F.doc(db, 'transferCodes', code), { familyId: FA.fid, memberId: target, createdBy: FA.mid, createdTs: sv(), expiresTs: ts(expires) });
      return { code, expires };
    } catch (e) { lastErr = e; if (!(e && e.code === 'permission-denied')) break; }
  }
  throw lastErr;
}
export async function redeemTransfer(code) {
  const { F, db } = FA.sdk, uid = FA.uid;
  let t;
  try { const s = await F.getDoc(F.doc(db, 'transferCodes', code)); if (!s.exists()) throw 0; t = s.data(); }
  catch (e) { throw { code: 'bad-code', message: '코드가 맞지 않거나 기간이 지났어요' }; }
  const b = F.writeBatch(db);
  b.update(F.doc(db, 'transferCodes', code), { usedBy: uid, usedTs: sv() });
  b.set(F.doc(db, 'families', t.familyId, 'uids', uid), { memberId: t.memberId, via: 'transfer', code, addedTs: sv(), device: deviceLabel() });
  b.set(F.doc(db, 'users', uid), { familyId: t.familyId, memberId: t.memberId, updatedAt: sv() });
  try { await b.commit(); } catch (e) { throw { code: 'bad-code', message: '코드가 맞지 않거나 기간이 지났어요' }; }
  await FA.setMembership(t.familyId, t.memberId);
  await sendSystem((FA.me().name || '가족') + '님이 새 기기에서 연결되었어요');
  return { fid: t.familyId, mid: t.memberId };
}

/* ---- 연결된 기기: 이 사람(memberId)에 연결된 기기(uid) 목록과 연결 끊기 ---- */
export async function listMyDevices() {
  const { F } = FA.sdk, s = await F.getDocs(F.query(FA._col('uids'), F.where('memberId', '==', FA.mid)));
  return s.docs.map(d => ({ uid: d.id, device: d.data().device || '', addedTs: d.data().addedTs && d.data().addedTs.toMillis ? d.data().addedTs.toMillis() : 0, current: d.id === FA.uid }))
    .sort((a, b) => b.addedTs - a.addedTs);
}
export async function revokeDevice(uid) {
  if (uid === FA.uid) throw { code: 'self' };
  await FA.sdk.F.deleteDoc(FA._ref('uids/' + uid));
}

/* ---- 가족 코드 보기 / 새로 만들기 ---- */
export async function getInviteInfo() {
  const { F, db } = FA.sdk, fam = await F.getDoc(F.doc(db, 'families', FA.fid));
  const code = fam.exists() ? fam.data().joinCode : null;
  if (!code) return { code: null, expired: true };
  try { const s = await F.getDoc(F.doc(db, 'joinCodes', code)); if (s.exists()) return { code, expired: false, expires: s.data().expiresTs.toMillis() }; } catch (e) {}
  return { code, expired: true };
}
export async function rotateJoinCode() {
  const { F, db } = FA.sdk, old = (await getInviteInfo()).code;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = newCode(), b = F.writeBatch(db);
    b.set(F.doc(db, 'joinCodes', code), { familyId: FA.fid, createdBy: FA.mid, createdTs: sv(), expiresTs: ts(Date.now() + JOIN_DAYS * DAY) });
    b.update(F.doc(db, 'families', FA.fid), { joinCode: code });
    try { await b.commit(); if (old) { try { await F.deleteDoc(F.doc(db, 'joinCodes', old)); } catch (e) {} } return { code, expires: Date.now() + JOIN_DAYS * DAY }; }
    catch (e) { lastErr = e; if (!(e && e.code === 'permission-denied')) break; }
  }
  throw lastErr;
}

export async function renameSelf(name) {
  await FA.updateDoc('members/' + FA.mid, { name });
  FA._me.name = name;
}
export async function setMyRole(role) { await FA.updateDoc('members/' + FA.mid, { role }); }
/* ============ 관리자 기능 (DESIGN.md §4.2) ============
 * 어댑터는 Store.adapter(앱) 또는 FA(스모크 시험). 체험 모드에서도 계획·화면 저장은 같은 코드를 써요. */
const A = () => Store.adapter || FA;
/* 훈련 계획 + 알람(시간·요일)을 한 번에 저장해요. alarmTime 은 'HH:MM'. 반환: 저장한 계획 문서 */
export async function savePlan(plan, catalog, by, alarmTime) {
  const now = Date.now(), doc = planDoc(plan, catalog, by, now), ops = [{ set: 'state/plan', data: doc }];
  if (/^\d{2}:\d{2}$/.test(alarmTime || '')) ops.push({ set: 'state/alarm', data: { time: alarmTime, days: doc.weekdays, updatedBy: by, updatedTs: now } });
  await A().batch(ops);
  return doc;
}
export async function saveDisplay(d, by) { const doc = displayDoc(d, by, Date.now()); await A().setDoc('state/display', doc); return doc; }
/* 훈련하는 분 정하기: state/trainee + 새 사람의 역할 + (다른 사람이었다면) 이전 분을 가족으로 */
export async function assignTrainee(mid, label, prevMid) {
  const ops = [{ set: 'state/trainee', data: { userId: mid, displayLabel: String(label || '아버지').slice(0, 12) } }, { update: 'members/' + mid, data: { role: 'trainee' } }];
  if (prevMid && prevMid !== mid) ops.push({ update: 'members/' + prevMid, data: { role: 'family' } });
  await A().batch(ops);
}
export async function clearTrainee(mid) {
  const ops = [{ del: 'state/trainee' }]; if (mid) ops.push({ update: 'members/' + mid, data: { role: 'family' } });
  await A().batch(ops);
}
export async function setMemberRole(mid, role) { await A().updateDoc('members/' + mid, { role }); }
export async function setTraineeLabel(label) { await A().updateDoc('state/trainee', { displayLabel: String(label).trim().slice(0, 12) }); }
async function familyDoc() { const { F, db } = FA.sdk, ref = F.doc(db, 'families', FA.fid), s = await F.getDoc(ref); return { F, ref, data: s.exists() ? s.data() : {} }; }
/* 관리자 지정/해제: 방 주인만. 목록은 항상 새로 읽어서 고쳐요 (한 번에 한 명 더하기). */
export async function grantAdmin(mid) { const { F, ref, data } = await familyDoc(), cur = Array.isArray(data.admins) ? data.admins : []; if (cur.includes(mid)) return; await F.updateDoc(ref, { admins: cur.concat([mid]) }); }
export async function revokeAdmin(mid) { const { F, ref, data } = await familyDoc(), cur = Array.isArray(data.admins) ? data.admins : []; await F.updateDoc(ref, { admins: cur.filter(x => x !== mid) }); }
/* 방 주인 넘기기. keepAdmin: 나를 관리자 목록에 남겨요 (내 역할이 '가족'일 때만 규칙이 허용해요). 한 번의 쓰기로 해요. */
export async function transferOwnership(mid, keepAdmin) {
  const { F, ref, data } = await familyDoc(), cur = Array.isArray(data.admins) ? data.admins : [], patch = { ownerMemberId: mid };
  if (keepAdmin && FA.mid && !cur.includes(FA.mid)) patch.admins = cur.concat([FA.mid]);
  await F.updateDoc(ref, patch);
}
/* 가족방에서 내보내기 (관리자, 방 주인은 못 내보내요): 그 사람의 기기 연결을 모두 끊고 떠난 가족으로 표시 */
export async function removeMember(mid) {
  const { F } = FA.sdk;
  const links = await refsOf('uids', [F.where('memberId', '==', mid)]);
  await deleteRefs(links);
  await F.updateDoc(FA._ref('members/' + mid), { leftTs: sv() });
  return links.length;
}
export async function isOwner() {
  const { F, db } = FA.sdk, fam = await F.getDoc(F.doc(db, 'families', FA.fid));
  return fam.exists() && fam.data().ownerMemberId === FA.mid;
}

/* ---- 기기(푸시 토큰) ---- */
export async function saveDevice(deviceId, doc) {
  const { F } = FA.sdk;
  await F.setDoc(FA._ref('members/' + FA.mid + '/devices/' + deviceId), Object.assign({}, doc, { uid: FA.uid, updatedAt: sv() }));
}
export async function removeDevice(deviceId) { try { await FA.sdk.F.deleteDoc(FA._ref('members/' + FA.mid + '/devices/' + deviceId)); } catch (e) {} }

/* ---- 삭제 도우미 ---- */
async function deleteRefs(refs) {
  const { F, db } = FA.sdk;
  for (let i = 0; i < refs.length; i += 400) { const b = F.writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
}
async function refsOf(coll, constraints) {
  const { F } = FA.sdk, s = await F.getDocs(constraints ? F.query(FA._col(coll), ...constraints) : FA._col(coll));
  return s.docs.map(d => d.ref);
}
export function clearLocalData() {
  try {
    const keep = ['bw.size', 'bw.font', 'bw.sound', 'bw.contrast', 'bw.seenDisc', 'bw.deviceId', 'bw.mode'];
    Object.keys(localStorage).filter(k => k.indexOf('bw.') === 0 && !keep.includes(k)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

/* 가족 나가기 (§5.7): 이 사람의 기기 연결은 맨 마지막에 지워요. */
export async function leaveFamily() {
  const { F, db } = FA.sdk, me = FA.mid, fid = FA.fid;
  const fam = await F.getDoc(F.doc(db, 'families', fid));
  if (fam.exists() && fam.data().ownerMemberId === me) {
    const others = Object.entries(FA.members()).filter(([id, m]) => id !== me && !m.leftTs).sort((a, b) => ((a[1].joinedTs && a[1].joinedTs.toMillis && a[1].joinedTs.toMillis()) || 0) - ((b[1].joinedTs && b[1].joinedTs.toMillis && b[1].joinedTs.toMillis()) || 0));
    if (others.length) await F.updateDoc(F.doc(db, 'families', fid), { ownerMemberId: others[0][0] });
  }
  await F.updateDoc(FA._ref('members/' + me), { name: '떠난 가족', leftTs: sv() });
  await deleteRefs(await refsOf('members/' + me + '/devices'));
  for (const p of ['reads/' + me, 'reminders/' + me, 'presence/' + me]) { try { await F.deleteDoc(FA._ref(p)); } catch (e) {} }
  const links = await refsOf('uids', [F.where('memberId', '==', me)]);
  const mine = links.filter(r => r.id !== FA.uid), own = links.filter(r => r.id === FA.uid);
  await deleteRefs(mine); await deleteRefs(own);
  try { await F.deleteDoc(F.doc(db, 'users', FA.uid)); } catch (e) {}
  FA.clearMembership(); clearLocalData();
}

/* 가족 데이터 모두 삭제 (소유자만, §5.7 순서) */
export async function deleteFamily() {
  const { F, db } = FA.sdk, fid = FA.fid;
  const fam = await F.getDoc(F.doc(db, 'families', fid));
  const code = fam.exists() ? fam.data().joinCode : null;
  // 가족 전용 자료(설문 등)는 role 이 'family' 인 사람만 읽고 지울 수 있어요. 훈련하는 분이 방 주인이면 지우는 동안만 role 을 바꿔요.
  try { await F.updateDoc(FA._ref('members/' + FA.mid), { role: 'family' }); } catch (e) {}
  for (const c of ['messages', 'sessions', 'assessments', 'checkins', 'taskRuns', 'sleeplogs', 'surveys', 'clocks', 'clinicalTests', 'reads', 'reminders', 'progress', 'presence', 'state', 'pushState']) await deleteRefs(await refsOf(c));
  // AI 문항 기록·메모·안내 동의·검토 결정 (읽을 수 없는 칸이 있어도 삭제는 계속해요. 서버가 만든 aiStats·aiReports 등은 서버가 하루 안에 지워요)
  for (const c of ['itemLogs', 'aiNotes', 'consents', 'aiReview']) { try { await deleteRefs(await refsOf(c)); } catch (e) {} }
  const memberRefs = await refsOf('members');
  for (const m of memberRefs) await deleteRefs(await refsOf('members/' + m.id + '/devices'));
  await deleteRefs(memberRefs);
  await deleteRefs((await refsOf('uids')).filter(r => r.id !== FA.uid));
  if (code) { try { await F.deleteDoc(F.doc(db, 'joinCodes', code)); } catch (e) {} }
  await F.deleteDoc(F.doc(db, 'families', fid));
  await deleteRefs((await Promise.resolve([FA._ref('uids/' + FA.uid)])));
  try { await F.deleteDoc(F.doc(db, 'users', FA.uid)); } catch (e) {}
  FA.clearMembership(); clearLocalData();
}

/* 내 기록만 지우기 (소유자가 아닌 분의 "모든 기록 삭제") */
export async function deleteMyRecords() {
  const { F } = FA.sdk;
  for (const c of ['sessions', 'assessments', 'checkins', 'progress']) await deleteRefs(await refsOf(c, [F.where('userId', '==', FA.mid)]));
  // 내가 쓴 가족 전용 기록(설문·시계 그림·잠 기록·과제 상세 등)은 role 이 'family' 일 때만 찾을 수 있어요.
  // 훈련하는 분이면 지우는 동안만 role 을 바꿨다가 되돌려요 (deleteFamily 와 같은 방식).
  const role = (FA.members()[FA.mid] || {}).role;
  if (role !== 'family') { try { await F.updateDoc(FA._ref('members/' + FA.mid), { role: 'family' }); } catch (e) {} }
  try {
    for (const [c, f] of [['taskRuns', 'userId'], ['sleeplogs', 'userId'], ['surveys', 'answeredBy'], ['clocks', 'userId'], ['clinicalTests', 'recordedBy'], ['itemLogs', 'userId']]) { try { await deleteRefs(await refsOf(c, [F.where(f, '==', FA.mid)])); } catch (e) {} }
  } finally {
    if (role && role !== 'family') { try { await F.updateDoc(FA._ref('members/' + FA.mid), { role }); } catch (e) {} }
  }
  for (const p of ['reads/' + FA.mid, 'reminders/' + FA.mid, 'presence/' + FA.mid]) { try { await F.deleteDoc(FA._ref(p)); } catch (e) {} }
  ['bw.sessions', 'bw.levels', 'bw.hist', 'bw.assess', 'bw.checkins', 'bw.course', 'bw.aiSeen', 'bw.aiPacks'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
}
