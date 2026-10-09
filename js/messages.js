import { writeErrMsg, chatAvail, rebuildMessages } from './data.js';
import { S } from './state.js';
import { Store } from './store/store.js';
import { refreshChat } from './ui/chat.js';
import { toast } from './ui/dom.js';
import { LS } from './util.js';

/* ================= 대화방: 쓰기 / 읽음 ================= */
const newMsgId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
export async function sendMessage(o) {
  if (!chatAvail()) return false;
  const ts = Date.now(), id = newMsgId();
  const doc = { authorId: S.myId, text: String(o.text || '').slice(0, 500), ts, kind: o.kind || 'text', reactions: {} };
  if (o.replyTo) doc.replyTo = o.replyTo;
  if (o.record) doc.record = o.record;
  if (doc.kind === 'nudge') doc.acks = {};
  S.pendingMsgs[id] = Object.assign({}, doc, { id }); rebuildMessages(); if (S.screen === 'chat') refreshChat();
  try {
    if (S.canWrite === false) throw new Error('read-only');
    await Store.setDoc('messages/' + id, doc); return true;
  } catch (e) { delete S.pendingMsgs[id]; rebuildMessages(); if (S.screen === 'chat') refreshChat(); toast(writeErrMsg(e)); return false; }
}
export async function toggleReaction(m, emoji) {
  if (!chatAvail()) return;
  const path = 'messages/' + m.id;
  try {
    const cur = ((await Store.getDoc(path)) || {}).reactions || {};
    const arr = Array.isArray(cur[emoji]) ? cur[emoji].slice() : [], i = arr.indexOf(S.myId);
    if (i >= 0) arr.splice(i, 1); else arr.push(S.myId);
    const next = Object.assign({}, cur); if (arr.length) next[emoji] = arr; else delete next[emoji];
    await Store.updateDoc(path, { reactions: next });
  } catch (e) { toast(writeErrMsg(e)); }
}
export async function deleteMessage(m) {
  try { await Store.updateDoc('messages/' + m.id, { deleted: true, text: '' }); } catch (e) { toast(writeErrMsg(e)); }
}
export async function ackNudges(list) {
  for (const m of list) {
    try { const cur = ((await Store.getDoc('messages/' + m.id)) || {}).acks || {}; await Store.updateDoc('messages/' + m.id, { acks: Object.assign({}, cur, { [S.myId]: Date.now() }) }); } catch (e) {}
  }
}
const lastReadKey = () => 'bw.lastRead.' + S.myId;
function myLastRead() { return Math.max(Number(LS.get(lastReadKey(), 0)) || 0, S.reads[S.myId] || 0); }
export function markRead() {
  if (!chatAvail() || S.screen !== 'chat') return;
  const newest = S.messages.length ? S.messages[S.messages.length - 1].ts : 0, cur = myLastRead(), val = Math.max(newest, cur, 1);
  if (val === cur && S.reads[S.myId] != null && S.reads[S.myId] >= val) return;
  LS.set(lastReadKey(), val); S.reads[S.myId] = val;
  if (S.readT) return;
  S.readT = setTimeout(() => { S.readT = null; if (S.canWrite === false) return; Promise.resolve().then(() => Store.setDoc('reads/' + S.myId, { lastReadTs: S.reads[S.myId] })).catch(() => {}); }, 1500);
}
export function unreadCount() { if (!chatAvail()) return 0; const lr = myLastRead(); return S.messages.filter(m => m.authorId !== S.myId && m.ts > lr && !m.deleted).length; }
export function memberIds() { const s = new Set(Object.keys(S.reads)); if (S.myId) s.add(S.myId); return Array.from(s); }
export function readCountFor(m) { return memberIds().filter(id => id !== m.authorId && (S.reads[id] || 0) < m.ts).length; }
