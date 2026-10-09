import { LS, isDocPath } from '../util.js';

export const LocalAdapter = {
  name: 'local', shared: false, _subs: [],
  async init() { return true; },
  me() { return { id: 'local', name: '나' }; },
  canWrite() { return true; },
  async profiles(ids) { const out = {}; ids.forEach(i => { out[i] = { name: i === 'local' ? '나' : '' }; }); return out; },
  _load() { const o = LS.get('bw.localdb', {}); return o && typeof o === 'object' ? o : {}; },
  _save(o) { LS.set('bw.localdb', o); this._subs.slice().forEach(f => { try { f(); } catch (e) {} }); },
  async getDoc(path) { const o = this._load(); return o[path] ? JSON.parse(JSON.stringify(o[path])) : null; },
  async setDoc(path, data) { const o = this._load(); o[path] = JSON.parse(JSON.stringify(data)); this._save(o); },
  async updateDoc(path, patch) { const o = this._load(); if (!o[path]) throw { code: 'not_found', message: 'no doc' }; o[path] = Object.assign({}, o[path], JSON.parse(JSON.stringify(patch))); this._save(o); },
  async deleteDoc(path) { const o = this._load(); delete o[path]; this._save(o); },
  _list(coll, opts) {
    const o = this._load(), pre = coll + '/';
    let rows = Object.keys(o).filter(k => k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') < 0).map(k => Object.assign({}, o[k], { id: k.slice(pre.length) }));
    (opts.where || []).forEach(w => {
      const f = w[0], op = w[1], v = w[2];
      rows = rows.filter(r => op === '==' ? r[f] === v : op === '<' ? r[f] < v : op === '<=' ? r[f] <= v : op === '>' ? r[f] > v : op === '>=' ? r[f] >= v : true);
    });
    if (opts.orderBy) { const f = opts.orderBy[0], dir = opts.orderBy[1] === 'desc' ? -1 : 1; rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * dir); }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return JSON.parse(JSON.stringify(rows));
  },
  async query(coll, o) { return this._list(coll, o || {}); },
  subscribe(target, o, cb) {
    o = o || {};
    const fire = () => { if (isDocPath(target)) this.getDoc(target).then(cb); else cb(this._list(target, o)); };
    this._subs.push(fire); setTimeout(fire, 0);
    return () => { this._subs = this._subs.filter(f => f !== fire); };
  }
};
