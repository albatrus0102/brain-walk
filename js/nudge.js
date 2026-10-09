import { chatAvail, ensureProfiles, isTrainee, nameOf, todayS, traineeLabel } from './data.js';
import { fmtWait, nudgeCooldown, nudgesToday, unackedNudges } from './logic.js';
import { ackNudges, sendMessage } from './messages.js';
import { Platform } from './platform.js';
import { startCourse } from './session.js';
import { say } from './sound.js';
import { S } from './state.js';
import { btnEl, dialog, h, toast } from './ui/dom.js';
import { $ } from './util.js';

/* ================= 훈련 알림(넛지) ================= */
const NUDGE_TEMPLATES = ['아버지, 오늘 두뇌 산책 하셨어요? 😊', '시간 되실 때 훈련 한번 해보세요', '오늘 훈련 같이 힘내요!'];
const KAKAO_TEXT = '아버지, 오늘 두뇌 훈련 하셨어요? 링크 열어서 시작해보세요!';
export function nudgePanel(prefix) {
  const ta = h('textarea', { class: 'input', id: prefix + '-text', rows: '2', maxlength: '200', 'aria-label': '알림 문구' }); ta.value = NUDGE_TEMPLATES[0];
  const chips = h('div', { class: 'chips' }, NUDGE_TEMPLATES.map((t, i) => h('button', { class: 'chip', type: 'button', id: prefix + '-tpl-' + i, onclick: () => { ta.value = t; ta.focus(); } }, t)));
  const send = h('button', { class: 'btn filled', type: 'button', id: prefix + '-send' });
  const info = h('p', { class: 't-small muted', id: prefix + '-info', 'aria-live': 'polite' });
  const copyBox = h('textarea', { class: 'input copybox', id: prefix + '-copybox', readonly: '', hidden: '', 'aria-label': '복사할 문구' });
  const copyBtn = btnEl('카톡으로도 보내기', 'outlined', () => {
    copyBox.value = KAKAO_TEXT;
    Platform.copy(KAKAO_TEXT, copyBox).then(ok => {
      if (ok) { copyBox.hidden = true; toast('복사했어요. 카톡에 붙여넣어 보내세요'); }
      else { copyBox.hidden = false; copyBox.focus(); copyBox.select(); toast('아래 문구를 길게 눌러 복사해 주세요.'); }
    });
  }, prefix + '-copy');
  send.onclick = async () => {
    const cd = nudgeCooldown(S.messages, S.myId, Date.now()); if (!cd.ok) return;
    const text = ta.value.trim(); if (!text) { toast('알림 문구를 적어 주세요.'); return; }
    if (await sendMessage({ kind: 'nudge', text })) toast('알림을 보냈어요.'); update();
  };
  function update() {
    const cd = nudgeCooldown(S.messages, S.myId, Date.now());
    send.disabled = !cd.ok;
    send.textContent = cd.ok ? traineeLabel() + '께 훈련 알림 보내기' : '2시간 뒤 다시 보낼 수 있어요';
    const authors = new Set(nudgesToday(S.messages, todayS()).map(m => m.authorId)).size;
    info.textContent = (cd.ok ? '' : '약 ' + fmtWait(cd.waitMs) + ' 뒤에 다시 보낼 수 있어요. ') + (authors ? '오늘 ' + authors + '명이 알림을 보냈어요.' : '오늘 아직 보낸 알림이 없어요.');
  }
  S.nudgeUpdaters.push({ el: send, fn: update }); update();
  return h('div', { class: 'stack' }, chips, ta, send, info, copyBtn, copyBox);
}
export function refreshNudgePanels() { S.nudgeUpdaters = S.nudgeUpdaters.filter(u => u.el.isConnected); S.nudgeUpdaters.forEach(u => u.fn()); }

export async function checkNudgeDialog() {
  if (S.nudgeBusy || S.firstRunBusy || !chatAvail() || !isTrainee() || !S.msgsReady) return;
  if (S.screen === 'game' || S.screen === 'chat' || !$('#scrim').hidden || !$('#sheet').hidden) return;
  const list = unackedNudges(S.messages, S.myId, todayS()).filter(m => !S.nudgeShown[m.id]);
  if (!list.length) return;
  S.nudgeBusy = true; list.forEach(x => { S.nudgeShown[x.id] = true; });
  const m = list[list.length - 1];
  try { await ensureProfiles([m.authorId]); } catch (e) {}
  const nm = nameOf(m.authorId);
  const reply = async text => { await ackNudges(list); await sendMessage({ kind: 'text', text, replyTo: m.id }); };
  dialog(nm + '님이 훈련하자고 하셨어요', '‘' + m.text + '’', [
    { label: '지금 할게요', kind: 'filled', run: () => { reply('지금 시작할게요!'); startCourse(); } },
    { label: '이따가 할게요', kind: 'tonal', run: () => { reply('이따가 할게요'); } },
    { label: '소리로 듣기', kind: 'text', keep: true, run: () => say(nm + '님이 훈련하자고 하셨어요. ' + m.text, true) }
  ]);
  S.nudgeBusy = false;
}
