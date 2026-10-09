import { LS, isDocPath, withId } from '../util.js';
import { loadSdk } from './firebase-sdk.js';

/* FirebaseAdapter: Store API 를 Firestore 에 연결합니다. (ARCHITECTURE.md §3.2, §5, §6)
 *  - 앱 코드는 'messages/<id>' 같은 상대 경로만 쓰고, 여기서 families/{fid}/ 를 붙여요.
 *  - S.myId 는 memberId (사람). 기기(uid)와 사람(memberId)은 families/{fid}/uids/{uid} 로 이어져요.
 *  - 저장 모양이 앱 모양과 다른 곳은 여기서 변환해요:
 *      reactions  앱 {이모지:[id]}  <->  저장 {memberId:[이모지]}   (규칙이 반복문을 못 써서)
 *      messages   쓸 때 sts / push / expireAt 추가, 읽을 때 제거
 *      nudge      members/{me}.lastNudgeAt 와 한 번에 묶어서 저장
 *      sessions   roundSec 배열 -> 평균 초(숫자). 규칙이 숫자만 허용해요.
 */
const DAY = 864e5;
const CACHE_KEY = 'bw.fam';

export const toUiReactions = (r = {}) => {
  const o = {};
  for (const [mid, list] of Object.entries(r || {})) for (const e of (Array.isArray(list) ? list : [])) (o[e] ||= []).push(mid);
  return o;
};
export const myEmojiList = (uiMap, me) => Object.keys(uiMap || {}).filter(e => (uiMap[e] || []).includes(me)).slice(0, 6);

export const FirebaseAdapter = {
  name: 'firebase', shared: true,
  sdk: null, fid: null, mid: null, uid: null, _me: null, _members: {}, _membersReady: null, _membersUnsub: null,

  config() { return (self.BW_CONFIG && self.BW_CONFIG.firebase) || null; },

  /* SDK 로드 + 앱/인증/Firestore 준비 + 익명 로그인 */
  async load() {
    if (this.sdk) return this.sdk;
    const cfgAll = self.BW_CONFIG || {}, cfg = cfgAll.firebase;
    const [appM, A, F] = await Promise.all([loadSdk('app'), loadSdk('auth'), loadSdk('firestore')]);
    const app = appM.initializeApp(cfg);
    let db;
    const base = { ignoreUndefinedProperties: true };
    try { db = F.initializeFirestore(app, Object.assign({ localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }, base)); }
    catch (e) { try { db = F.initializeFirestore(app, Object.assign({ localCache: F.memoryLocalCache() }, base)); } catch (e2) { db = F.getFirestore(app); } }
    const auth = A.getAuth(app);
    const emu = cfgAll.emulator;            // 개발/시험용 (README 의 tests 참고)
    if (emu) { F.connectFirestoreEmulator(db, emu.host || '127.0.0.1', emu.firestorePort || 8080); A.connectAuthEmulator(auth, 'http://' + (emu.host || '127.0.0.1') + ':' + (emu.authPort || 9099), { disableWarnings: true }); }
    if (cfgAll.appCheckSiteKey) {
      try { const AC = await loadSdk('app-check'); AC.initializeAppCheck(app, { provider: new AC.ReCaptchaV3Provider(cfgAll.appCheckSiteKey), isTokenAutoRefreshEnabled: true }); } catch (e) {}
    }
    this.sdk = { app, db, auth, A, F };
    return this.sdk;
  },

  /* true: 이미 가족의 구성원 / false: 가입 필요 (온보딩) */
  async init() {
    const { auth, A } = await this.load();
    await auth.authStateReady();
    if (!auth.currentUser) await A.signInAnonymously(auth);
    this.uid = auth.currentUser.uid;
    try { if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    return this.resolveMembership();
  },

  async resolveMembership() {
    const { db, F } = this.sdk, uid = this.uid;
    let c = LS.get(CACHE_KEY, null);
    if (c && c.uid !== uid) c = null;
    try {
      if (!c) {
        const u = await F.getDoc(F.doc(db, 'users', uid));
        if (!u.exists()) return false;
        c = { uid, fid: u.data().familyId, mid: u.data().memberId };
      }
      const link = await F.getDoc(F.doc(db, 'families', c.fid, 'uids', uid));
      if (!link.exists()) { this.clearMembership(); return false; }
      c.mid = link.data().memberId;
    } catch (e) {
      const k = e && e.code;
      if (k === 'permission-denied') { this.clearMembership(); return false; }
      if (!c) throw e;                         // 캐시도 없고 연결도 안 되면 진짜 오류
    }
    await this.setMembership(c.fid, c.mid);
    return true;
  },

  async setMembership(fid, mid) {
    this.fid = fid; this.mid = mid;
    LS.set(CACHE_KEY, { uid: this.uid, fid, mid });
    this._me = { id: mid, name: (this._members[mid] && this._members[mid].name) || '' };
    this._watchMembers();
    await Promise.race([this._membersReady, new Promise(r => setTimeout(r, 2500))]);
    if (this._members[mid]) this._me.name = this._members[mid].name;
  },
  clearMembership() { this.fid = null; this.mid = null; this._me = null; LS.set(CACHE_KEY, null); this._unwatchMembers(); },

  _watchMembers() {
    this._unwatchMembers();
    const { db, F } = this.sdk;
    this._membersReady = new Promise(res => {
      this._membersUnsub = F.onSnapshot(F.collection(db, 'families', this.fid, 'members'), s => {
        const m = {}; s.docs.forEach(d => { m[d.id] = d.data(); });
        this._members = m; if (this._me && m[this.mid]) this._me.name = m[this.mid].name;
        res();
      }, () => res());
    });
  },
  _unwatchMembers() { if (this._membersUnsub) { try { this._membersUnsub(); } catch (e) {} } this._membersUnsub = null; this._members = {}; },

  me() { return this._me; },
  canWrite() { return !!this.mid; },
  async profiles(ids) {
    await Promise.race([this._membersReady, new Promise(r => setTimeout(r, 2500))]);
    const out = {};
    ids.forEach(i => { const m = this._members[i]; out[i] = { name: m ? (m.leftTs ? '떠난 가족' : String(m.name || '')) : '' }; });
    return out;
  },
  members() { return this._members; },
  /* members 스냅샷이 내 변경(예: role)을 반영할 때까지 잠깐 기다려요 */
  async refreshMembers() {
    const { F } = this.sdk, s = await F.getDocs(F.collection(this.sdk.db, 'families', this.fid, 'members'));
    const m = {}; s.docs.forEach(d => { m[d.id] = d.data(); }); this._members = m;
  },

  /* ---- 경로/변환 ---- */
  _ref(path) { const { db, F } = this.sdk; return F.doc(db, 'families/' + this.fid + '/' + path); },
  _col(path) { const { db, F } = this.sdk; return F.collection(db, 'families/' + this.fid + '/' + path); },
  _fromDb(path, d) {
    if (!d) return d;
    if (/^messages\//.test(path) || path === 'messages') {
      const o = Object.assign({}, d);
      o.reactions = toUiReactions(d.reactions);
      delete o.sts; delete o.push; delete o.expireAt; delete o.toId;
      return o;
    }
    return d;
  },
  _offline() { return typeof navigator !== 'undefined' && navigator.onLine === false; },
  /* 오프라인이면 Firestore 가 나중에 보내 주므로 기다리지 않아요. */
  _commit(p) { if (this._offline()) { Promise.resolve(p).catch(() => {}); return Promise.resolve(); } return p; },

  async getDoc(path) {
    const { F } = this.sdk, s = await F.getDoc(this._ref(path));
    return s.exists() ? this._fromDb(path, s.data()) : null;
  },
  async setDoc(path, data) {
    const { F } = this.sdk;
    if (/^messages\/[^/]+$/.test(path)) return this._setMessage(path, data);
    let d = Object.assign({}, data);
    if (/^sessions\//.test(path) && Array.isArray(d.roundSec)) {
      const xs = d.roundSec.map(Number).filter(x => isFinite(x));
      d.roundSec = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : 0;
    }
    return this._commit(F.setDoc(this._ref(path), d));
  },
  async _setMessage(path, data) {
    const { F, db } = this.sdk, ref = this._ref(path), me = this.mid;
    const doc = Object.assign({}, data, { sts: F.serverTimestamp(), push: data.kind === 'summary' ? 'none' : 'pending', expireAt: F.Timestamp.fromMillis(Date.now() + 365 * DAY) });
    if (data.kind === 'nudge') {
      if (this._offline()) throw { code: 'offline-nudge', message: '알림은 인터넷이 연결되어야 보낼 수 있어요' };
      const t = await this.getDoc('state/trainee');
      if (!t || !t.userId || t.userId === me) throw { code: 'no-trainee', message: '훈련하는 분이 아직 없어요' };
      doc.toId = t.userId;
      const b = F.writeBatch(db);
      b.set(ref, doc);
      b.update(this._ref('members/' + me), { lastNudgeAt: F.serverTimestamp() });
      return b.commit();
    }
    return this._commit(F.setDoc(ref, doc));
  },
  async updateDoc(path, patch) {
    const { F } = this.sdk;
    if (/^messages\/[^/]+$/.test(path)) {
      const upd = {}, me = this.mid;
      Object.keys(patch).forEach(k => {
        if (k === 'reactions') { const l = myEmojiList(patch.reactions, me); upd['reactions.' + me] = l.length ? l : F.deleteField(); }
        else if (k === 'acks') upd['acks.' + me] = (patch.acks || {})[me] || Date.now();
        else upd[k] = patch[k];
      });
      return this._commit(F.updateDoc(this._ref(path), upd));
    }
    return this._commit(F.updateDoc(this._ref(path), patch));
  },
  async deleteDoc(path) { const { F } = this.sdk; return F.deleteDoc(this._ref(path)); },
  _q(coll, o) {
    const { F } = this.sdk, cs = [];
    (o.where || []).forEach(w => cs.push(F.where(w[0], w[1], w[2])));
    if (o.orderBy) cs.push(F.orderBy(o.orderBy[0], o.orderBy[1] || 'asc'));
    if (o.limit) cs.push(F.limit(o.limit));
    return F.query(this._col(coll), ...cs);
  },
  async query(coll, o) { const { F } = this.sdk, s = await F.getDocs(this._q(coll, o || {})); return s.docs.map(d => this._fromDb(coll + '/' + d.id, withId(d))); },
  subscribe(target, o, cb) {
    const { F } = this.sdk; o = o || {}; const err = o.onError || function () {};
    if (isDocPath(target)) return F.onSnapshot(this._ref(target), s => cb(s.exists() ? this._fromDb(target, s.data()) : null), err);
    return F.onSnapshot(this._q(target, o), s => cb(s.docs.map(d => this._fromDb(target + '/' + d.id, withId(d)))), err);
  },

  /* ---- 오류 해석: 화면에 보여 줄 한국어 문구 ---- */
  explain(e) {
    const k = e && e.code;
    if (k === 'offline-nudge') return '알림은 인터넷이 연결되어야 보낼 수 있어요';
    if (k === 'no-trainee') return '훈련하는 분이 아직 정해지지 않았어요';
    if (k === 'unavailable') return '인터넷 연결이 약해요. 연결되면 자동으로 보낼게요';
    if (k === 'permission-denied') return '지금은 쓸 수 없어요. 가족방에서 나가졌거나 삭제됐을 수 있어요';
    return '저장하지 못했어요. 잠시 뒤 다시 해 보세요';
  }
};
