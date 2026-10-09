import { FirebaseAdapter as FA } from './firebase-adapter.js';

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

export async function createFamily({ name, role }) {
  const { F, db } = FA.sdk, uid = FA.uid, fid = newId(), mid = newId();
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = newCode(), b = F.writeBatch(db);
    b.set(F.doc(db, 'families', fid), { createdBy: uid, createdTs: sv(), ownerMemberId: mid, joinCode: code, name: '우리 가족', schemaVersion: 1 });
    b.set(F.doc(db, 'joinCodes', code), { familyId: fid, createdBy: mid, createdTs: sv(), expiresTs: ts(Date.now() + JOIN_DAYS * DAY) });
    b.set(F.doc(db, 'families', fid, 'uids', uid), { memberId: mid, via: 'create', addedTs: sv(), device: deviceLabel() });
    b.set(F.doc(db, 'families', fid, 'members', mid), { name, role, joinedTs: sv() });
    b.set(F.doc(db, 'users', uid), { familyId: fid, memberId: mid, updatedAt: sv() });
    try { await b.commit(); lastErr = null; await FA.setMembership(fid, mid); if (role === 'trainee') await setTrainee(); return { fid, mid, code }; }
    catch (e) { lastErr = e; if (!(e && e.code === 'permission-denied')) break; }
  }
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
  let needsConfirm = false;
  if (role === 'trainee') {
    const t = await FA.getDoc('state/trainee').catch(() => null);
    if (!t || !t.userId) await setTrainee(); else needsConfirm = t.userId !== mid;
  }
  return { fid, mid, needsConfirm };
}

/* ---- 기기 옮기기 ---- */
export async function createTransferCode() {
  const { F, db } = FA.sdk;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const code = newCode(), expires = Date.now() + TRANSFER_MIN * 60000;
    try {
      await F.setDoc(F.doc(db, 'transferCodes', code), { familyId: FA.fid, memberId: FA.mid, createdBy: FA.mid, createdTs: sv(), expiresTs: ts(expires) });
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
    const keep = ['bw.size', 'bw.sound', 'bw.contrast', 'bw.seenDisc', 'bw.deviceId', 'bw.mode'];
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
  for (const p of ['reads/' + me, 'reminders/' + me]) { try { await F.deleteDoc(FA._ref(p)); } catch (e) {} }
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
  for (const c of ['messages', 'sessions', 'assessments', 'checkins', 'taskRuns', 'sleeplogs', 'surveys', 'clocks', 'clinicalTests', 'reads', 'reminders', 'state', 'pushState']) await deleteRefs(await refsOf(c));
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
  for (const c of ['sessions', 'assessments', 'checkins', 'taskRuns', 'sleeplogs']) await deleteRefs(await refsOf(c, [F.where('userId', '==', FA.mid)]));
  // 내가 쓴 가족 전용 기록 (훈련하는 분은 읽기 권한이 없어 건너뛰어요)
  for (const [c, f] of [['surveys', 'answeredBy'], ['clocks', 'userId'], ['clinicalTests', 'recordedBy']]) { try { await deleteRefs(await refsOf(c, [F.where(f, '==', FA.mid)])); } catch (e) {} }
  for (const p of ['reads/' + FA.mid, 'reminders/' + FA.mid]) { try { await F.deleteDoc(FA._ref(p)); } catch (e) {} }
  ['bw.sessions', 'bw.levels', 'bw.hist', 'bw.assess', 'bw.checkins', 'bw.course'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
}
