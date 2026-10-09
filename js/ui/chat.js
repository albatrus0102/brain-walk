import { alarmTick } from '../alarm.js';
import { NO_WRITE_MSG, allAssessments, allCheckins, allSessions, chatAvail, dbReady, ensureProfiles, isTrainee, nameOf, subscribeMessages, todayS, traineeId, traineeLabel } from '../data.js';
import { P } from '../icons.js';
import { fmtClock } from '../logic.js';
import { deleteMessage, markRead, memberIds, readCountFor, sendMessage, toggleReaction } from '../messages.js';
import { nudgePanel, refreshNudgePanels } from '../nudge.js';
import { Platform } from '../platform.js';
import { recordOfAssess, recordOfCheck, recordOfSession, shareSummary } from '../records.js';
import { say } from '../sound.js';
import { S } from '../state.js';
import { btnEl, closeSheet, dialog, h, openSheet, svgIcon, toast } from './dom.js';
import { SCREENS } from './registry.js';
import { QUICK_REPLIES } from './screens/home.js';
import { render } from './shell.js';
import { statusChip } from './widgets.js';
import { $, WD, ymd } from '../util.js';

/* ================= 대화방 ================= */
const REACTS = ['👍', '❤️', '👏', '😂', '🙏'];
const CHEER_TEMPLATES = ['오늘도 훈련하셨네요, 최고예요!', '이번 주도 힘내세요', '점수가 많이 좋아졌어요', '이번 주 병원 예약했어요'];
const dayLabel = ts => { const d = new Date(ts); return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WD[d.getDay()] + '요일'; };
const sameDayMsg = (a, b) => a && b && ymd(new Date(a.ts)) === ymd(new Date(b.ts));
const minuteKey = m => Math.floor(m.ts / 60000);
const nearBottom = () => document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 140;
const scrollBottom = () => { window.scrollTo(0, document.documentElement.scrollHeight); const p = $('#newpill'); if (p) p.hidden = true; };
const hashId = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
function avatarNode(id) { return h('span', { class: 'avatar a' + (hashId(id) % 3), 'aria-hidden': 'true', text: Array.from(nameOf(id))[0] || '가' }); }
function nameNode(id) { const n = h('div', { class: 'mname' }, h('span', { text: nameOf(id) })); if (id === traineeId()) n.append(h('span', { class: 'role-badge', text: traineeLabel() })); return n; }
function snippet(m) { if (!m) return '원본 메시지'; if (m.deleted) return '삭제된 메시지입니다'; const t = m.text || (m.record && m.record.title) || ''; const a = Array.from(t); return a.length > 40 ? a.slice(0, 40).join('') + '…' : t; }
function reactionsNode(m) {
  const r = m.reactions || {}, keys = Object.keys(r).filter(k => Array.isArray(r[k]) && r[k].length);
  if (!keys.length || m.deleted) return null;
  return h('div', { class: 'rx' }, keys.map(k => h('button', { type: 'button', 'aria-pressed': String(r[k].includes(S.myId)), 'aria-label': k + ' ' + r[k].length + '명', onclick: () => toggleReaction(m, k) }, k + ' ' + r[k].length)));
}
function cardNode(m, mine) {
  const k = m.kind || 'text', rec = m.record || {};
  let icon = 'chart', cls = 'xcard', kids = [];
  if (k === 'nudge') {
    icon = 'alarm'; cls += ' nudge';
    const acks = Object.keys(m.acks || {}).length;
    kids = [h('span', { class: 'xt', text: nameOf(m.authorId) + '님이 훈련 알림을 보냈어요:' }), h('span', { text: '‘' + m.text + '’' }), acks ? h('span', { class: 't-small', text: '확인한 사람 ' + acks + '명' }) : null];
  } else if (k === 'summary') { kids = [h('span', { class: 'xt', text: '이번 주 요약' }), h('span', { text: m.text })]; }
  else if (k === 'system') { icon = 'check'; cls += ' sys'; kids = [h('span', { class: 'xt', text: (m.record && m.record.type === 'course') ? '훈련 완료' : '가족 소식' }), h('span', { text: m.text })]; }
  else { kids = [h('span', { class: 'xt', text: rec.title || '기록' }), rec.score != null ? h('span', { text: (rec.type === 'assessment' ? '점검 총점 ' : '정답률 ') + rec.score + (rec.type === 'assessment' ? '점' : '%') }) : null, m.text ? h('span', { text: m.text }) : null]; }
  return h('button', { type: 'button', class: cls, id: 'bubble-' + m.id, onclick: () => openMenu(m) }, svgIcon(icon), h('span', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' }, kids));
}
function bubbleNode(m, mine) {
  if (m.deleted) return h('button', { type: 'button', class: 'bubble deleted', id: 'bubble-' + m.id, onclick: () => openMenu(m) }, '삭제된 메시지입니다');
  const b = h('button', { type: 'button', class: 'bubble', id: 'bubble-' + m.id, title: '눌러서 답장·공감', onclick: () => openMenu(m) });
  if (m.replyTo) { const q = S.messages.find(x => x.id === m.replyTo); b.append(h('span', { class: 'quote' }, q ? nameOf(q.authorId) + ': ' : '', snippet(q))); }
  b.append(h('span', { text: m.text })); return b;
}
function appendMsg(list, m, prev, next) {
  if (!sameDayMsg(prev, m)) list.append(h('div', { class: 'day-sep' }, h('span', { text: dayLabel(m.ts) })));
  const k = m.kind || 'text', mine = m.authorId === S.myId;
  if (k === 'system' && !m.deleted) { list.append(h('div', { class: 'xwrap', id: 'msg-' + m.id }, cardNode(m, false))); return; }
  const groupedPrev = prev && sameDayMsg(prev, m) && prev.authorId === m.authorId && prev.kind !== 'system';
  const showTime = !(next && sameDayMsg(next, m) && next.authorId === m.authorId && next.kind !== 'system' && minuteKey(next) === minuteKey(m));
  const row = h('div', { class: 'msg ' + (mine ? 'mine' : 'other') + (groupedPrev ? '' : ' first'), id: 'msg-' + m.id });
  if (!mine) row.append(groupedPrev ? h('span', { class: 'avatar sp', 'aria-hidden': 'true' }) : avatarNode(m.authorId));
  const col = h('div', { class: 'mcol' });
  if (!mine && !groupedPrev) col.append(nameNode(m.authorId));
  const rc = readCountFor(m);
  const meta = h('div', { class: 'meta' }, rc > 0 ? h('span', { class: 'rc', 'aria-label': rc + '명이 아직 읽지 않았어요', text: String(rc) }) : null, showTime ? h('span', { text: fmtClock(m.ts) }) : null);
  const content = (k === 'text' || m.deleted) ? bubbleNode(m, mine) : cardNode(m, mine);
  const brow = h('div', { class: 'brow' }, content);
  if (!mine && !m.deleted && m.text && isTrainee()) brow.append(h('button', { type: 'button', class: 'tts-btn', id: 'tts-' + m.id, 'aria-label': '소리로 듣기', onclick: () => say(nameOf(m.authorId) + '님 말씀. ' + m.text, true) }, svgIcon('vol')));
  col.append(brow, meta);
  const rx = reactionsNode(m); if (rx) col.append(rx);
  row.append(col); list.append(row);
}
export function refreshChat() {
  if (S.screen !== 'chat' || !chatAvail()) return;
  const list = $('#chat-list'); if (!list) return;
  const near = nearBottom(), first = !S._chatBuilt, prevLen = S._chatLen || 0, msgs = S.messages;
  list.textContent = '';
  if (S.msgHasMore) list.append(h('div', { class: 'center' }, btnEl('이전 대화 더 보기', 'text', () => { S.msgLimit += 100; subscribeMessages(); }, 'btn-older')));
  if (!msgs.length) list.append(h('div', { class: 'empty' }, svgIcon('chat'), h('p', { class: 't-title', text: '아직 대화가 없어요' }), h('p', { class: 't-body muted', text: '아래 입력창에서 첫 인사를 남겨 보세요.' })));
  msgs.forEach((m, i) => appendMsg(list, m, msgs[i - 1], msgs[i + 1]));
  ensureProfiles(msgs.map(m => m.authorId).concat(Object.keys(S.reads)));
  const last = msgs[msgs.length - 1], grew = msgs.length > prevLen;
  S._chatLen = msgs.length; S._chatBuilt = true;
  if (first || near || (last && last.authorId === S.myId && grew)) scrollBottom(); else if (grew && last && last.authorId !== S.myId) $('#newpill').hidden = false;
  const tt = $('#appbar-title'); if (tt) tt.textContent = '우리 가족 대화방 · ' + memberIds().length + '명';
  const top = $('#chat-top'); if (top) { top.textContent = ''; top.append(statusChip()); }
  refreshNudgePanels(); markRead(); renderChromeBadge();
}
function renderChromeBadge() { /* 채팅 화면에서는 하단 메뉴가 없어 배지 갱신 불필요 */ }
function fitComposer() { const c = $('#composer'); if (c) document.documentElement.style.setProperty('--composer-h', (c.offsetHeight + 8) + 'px'); }
function refreshComposer() {
  const top = $('#composer-top'); if (!top) return; top.textContent = '';
  if (S.canWrite === false) top.append(h('p', { class: 't-small muted', text: '지금은 읽기만 할 수 있어요. ' + NO_WRITE_MSG }));
  if (S.reply) {
    const q = S.messages.find(x => x.id === S.reply);
    top.append(h('div', { class: 'replybar', id: 'replybar' }, h('span', { text: '답장: ' + (q ? nameOf(q.authorId) + ' · ' : '') + snippet(q) }), h('button', { class: 'icon-btn', type: 'button', id: 'btn-reply-cancel', 'aria-label': '답장 취소', onclick: () => { S.reply = null; refreshComposer(); } }, svgIcon('close'))));
  }
  if (S.attach) top.append(h('div', { class: 'replybar', id: 'attachbar' }, svgIcon('chart'), h('span', { text: '첨부: ' + S.attach.title }), h('button', { class: 'icon-btn', type: 'button', id: 'btn-attach-cancel', 'aria-label': '첨부 취소', onclick: () => { S.attach = null; refreshComposer(); } }, svgIcon('close'))));
  if (isTrainee()) top.append(h('div', { class: 'quick', 'aria-label': '한 번에 답장하기' }, QUICK_REPLIES.map((t, i) => h('button', { class: 'chip', type: 'button', id: 'quick-' + i, onclick: () => {
    const lastOther = S.messages.slice().reverse().find(m => m.authorId !== S.myId && !m.deleted && m.kind === 'text');
    sendMessage({ kind: 'text', text: t, replyTo: lastOther ? lastOther.id : null });
  } }, t))));
  updateSend(); fitComposer();
}
function updateSend() { const b = $('#btn-send'), ta = $('#chat-input'); if (b && ta) b.disabled = !(ta.value.trim() || S.attach); }
async function sendFromComposer() {
  const ta = $('#chat-input'); if (!ta) return;
  const text = ta.value.trim().slice(0, 500); if (!text && !S.attach) return;
  const o = S.attach ? { kind: 'record', text, record: S.attach } : { kind: 'text', text };
  if (S.reply) o.replyTo = S.reply;
  ta.value = ''; ta.style.height = ''; S.reply = null; S.attach = null; refreshComposer();
  await sendMessage(o);
}
function openPlus() {
  openSheet('보내기 더하기', (body) => {
    body.append(h('div', { class: 't-label muted', text: '응원 문구 (눌러서 입력창에 넣기)' }));
    body.append(h('div', { class: 'chips' }, CHEER_TEMPLATES.map((t, i) => h('button', { class: 'chip', type: 'button', id: 'tpl-' + i, onclick: () => { const ta = $('#chat-input'); closeSheet(); if (ta) { ta.value = t; ta.focus(); updateSend(); } } }, t))));
    body.append(btnEl('이번 주 요약 보내기', 'tonal', () => { closeSheet(); shareSummary(); }, 'sheet-summary'));
    body.append(btnEl('기록 첨부', 'tonal', () => {
      body.textContent = '';
      const recs = [];
      allSessions().slice(0, 6).forEach(s => recs.push(recordOfSession(s)));
      const a = allAssessments()[0]; if (a) recs.push(recordOfAssess(a));
      const c = allCheckins()[todayS()]; if (c) recs.push(recordOfCheck(c));
      if (!recs.length) body.append(h('p', { class: 't-body muted', text: '붙일 기록이 아직 없어요.' }));
      recs.forEach((r, i) => body.append(h('button', { class: 'btn outlined menuitem', type: 'button', id: 'rec-' + i, onclick: () => { S.attach = r; closeSheet(); refreshComposer(); const ta = $('#chat-input'); if (ta) ta.focus(); } }, r.title)));
    }, 'sheet-attach'));
    if (!isTrainee()) body.append(btnEl('훈련 알림 보내기', 'tonal', () => { body.textContent = ''; S.nudgeUpdaters = S.nudgeUpdaters.filter(u => u.el.isConnected); body.append(nudgePanel('sheet-nudge')); }, 'sheet-nudge-open'));
    body.append(btnEl('닫기', 'text', closeSheet, 'sheet-close'));
  });
}
function openMenu(m) {
  openSheet('메시지', (body) => {
    body.append(h('p', { class: 't-body muted', style: 'white-space:pre-wrap;overflow-wrap:anywhere', text: snippet(m) }));
    if (m.deleted) { body.append(btnEl('닫기', 'text', closeSheet, 'menu-close')); return; }
    body.append(btnEl('답장', 'tonal menuitem', () => { S.reply = m.id; closeSheet(); refreshComposer(); const ta = $('#chat-input'); if (ta) ta.focus(); }, 'menu-reply'));
    body.append(h('div', { class: 'reacts', role: 'group', 'aria-label': '공감' }, REACTS.map((e, i) => h('button', { type: 'button', id: 'react-' + i, 'aria-label': '공감 ' + e, 'aria-pressed': String(!!(m.reactions && Array.isArray(m.reactions[e]) && m.reactions[e].includes(S.myId))), onclick: () => { closeSheet(); toggleReaction(m, e); } }, e))));
    if (m.text) body.append(btnEl('복사', 'outlined menuitem', async () => { const ok = await Platform.copy(m.text, null); closeSheet(); toast(ok ? '복사했어요.' : '복사하지 못했어요. 글자를 길게 눌러 복사해 주세요.'); }, 'menu-copy'));
    if (m.text && m.authorId !== S.myId) body.append(btnEl('소리로 듣기', 'outlined menuitem', () => { closeSheet(); say(nameOf(m.authorId) + '님 말씀. ' + m.text, true); }, 'menu-tts', 'vol'));
    if (m.authorId === S.myId) body.append(btnEl('삭제', 'outlined menuitem', () => { closeSheet(); dialog('이 메시지를 삭제할까요?', '삭제하면 “삭제된 메시지입니다”로 바뀌어요.', [{ label: '취소', kind: 'text' }, { label: '삭제', kind: 'filled', run: () => deleteMessage(m) }]); }, 'menu-delete'));
    body.append(btnEl('닫기', 'text', closeSheet, 'menu-close'));
  });
}
SCREENS.chat = {
  html() {
    if (!chatAvail()) {
      return '<div class="stack"><h1 class="t-headline" id="chat-h">우리 가족 대화방</h1><section class="card outlined empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + P.chat + '"/></svg>' +
        (S.dbState === 'pending' ? '<p class="t-title">불러오는 중이에요…</p>' : '<p class="t-title">가족 대화는 가족방을 만들거나 가족 코드로 들어가면 쓸 수 있어요. 지금은 체험 모드라 이 기기에만 저장돼요.</p>') + '</section></div>';
    }
    return '<h1 class="sr" id="chat-h">우리 가족 대화방</h1><div class="chat-top" id="chat-top"></div><div id="chat-list" role="log" aria-label="대화 내용"></div>' +
      '<div class="composer" id="composer"><div class="composer-in"><div id="composer-top" class="stack" style="gap:8px"></div><div class="cbar" id="cbar"></div></div></div><button class="newpill" id="newpill" type="button" hidden>새 메시지 ↓</button>';
  },
  bind(el) {
    S._chatBuilt = false; S._chatLen = 0;
    if (!chatAvail()) { if (S.dbState === 'pending') dbReady.then(() => { if (S.screen === 'chat') render(); }); return; }
    const ta = h('textarea', { class: 'input', id: 'chat-input', rows: '1', maxlength: '500', placeholder: '메시지 입력', 'aria-label': '메시지 입력' });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; updateSend(); fitComposer(); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromComposer(); } });
    $('#cbar', el).append(h('button', { class: 'icon-btn', id: 'btn-plus', type: 'button', 'aria-label': '더하기: 응원 문구, 이번 주 요약, 기록 첨부', onclick: openPlus }, svgIcon('add')), ta,
      h('button', { class: 'sendbtn', id: 'btn-send', type: 'button', 'aria-label': '보내기', onclick: sendFromComposer }, svgIcon('send')));
    $('#newpill', el).addEventListener('click', scrollBottom);
    refreshComposer(); refreshChat();
    setTimeout(fitComposer, 50);
  }
};
window.addEventListener('scroll', () => { if (S.screen === 'chat' && nearBottom()) { const p = $('#newpill'); if (p) p.hidden = true; markRead(); } }, { passive: true });
window.addEventListener('resize', fitComposer);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { alarmTick(); if (S.screen === 'chat') markRead(); } });
