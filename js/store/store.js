import { LS } from '../util.js';
import { LocalAdapter } from './local-adapter.js';
import { FirebaseAdapter } from './firebase-adapter.js';

/* 앱 화면 코드는 Store 와 Platform 만 씁니다. 경로는 Firestore 와 1:1 (컬렉션/문서/컬렉션/문서…).
 *   Store.me() → {id,name}|null   Store.profiles(ids) → {id:{name}}
 *   Store.getDoc/setDoc/updateDoc/deleteDoc/query/subscribe  (subscribe 는 구독 해제 함수를 돌려줘요)
 * 어댑터: FirebaseAdapter(가족 공유) / LocalAdapter(체험 모드·오프라인 데모, 이 기기에만 저장)
 */
export function isConfigured() {
  const c = self.BW_CONFIG;
  return !!(c && c.firebase && c.firebase.apiKey && !JSON.stringify(c.firebase).includes('REPLACE_ME'));
}

export const Store = {
  adapter: null, shared: false, mode: null, ready: null, initError: null,
  /* 결과: 'setup' 설정 비어 있음 | 'onboarding' 가입 필요 | 'ready' 사용 가능 | 'error' 연결 실패 */
  init() {
    if (!this.ready) this.ready = this._init();
    return this.ready;
  },
  async _init() {
    if (!isConfigured()) {
      if (LS.get('bw.mode', null) === 'local') { await this.useLocal(false); return 'ready'; }
      return 'setup';
    }
    try {
      const member = await FirebaseAdapter.init();
      this.adapter = FirebaseAdapter; this.shared = true; this.mode = 'firebase';
      return member ? 'ready' : 'onboarding';
    } catch (e) { this.initError = e; try { console.warn('Firebase 연결 실패', e); } catch (x) {} return 'error'; }
  },
  async useLocal(remember) {
    await LocalAdapter.init();
    this.adapter = LocalAdapter; this.shared = false; this.mode = 'local';
    if (remember !== false && !isConfigured()) LS.set('bw.mode', 'local');
    this.ready = Promise.resolve('ready');
    return 'ready';
  },
  /* 가입(만들기/들어가기/옮기기)이 끝난 뒤 */
  becomeMember() { this.adapter = FirebaseAdapter; this.shared = true; this.mode = 'firebase'; },
  retry() { this.ready = null; return this.init(); },
  me() { return this.adapter ? this.adapter.me() : null; },
  canWrite() { return this.adapter ? this.adapter.canWrite() : null; },
  explain(e) { return this.adapter && this.adapter.explain ? this.adapter.explain(e) : '저장하지 못했어요'; },
  profiles(ids) { return this.adapter.profiles(ids); },
  getDoc(p) { return this.adapter.getDoc(p); },
  setDoc(p, d) { return this.adapter.setDoc(p, d); },
  updateDoc(p, d) { return this.adapter.updateDoc(p, d); },
  deleteDoc(p) { return this.adapter.deleteDoc(p); },
  query(c, o) { return this.adapter.query(c, o); },
  subscribe(t, o, cb) { return this.adapter.subscribe(t, o, cb); }
};
