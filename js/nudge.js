import { chatAvail, ensureProfiles, focusId, myTrainee, nameOf, todayS, traineeLabel, trainees } from './data.js';
import { fmtWait, nudgeCooldown, nudgesToday, unackedNudges } from './logic.js';
import { ackNudges, sendMessage } from './messages.js';
import { Platform } from './platform.js';
import { startCourse } from './session.js';
import { say } from './sound.js';
import { S } from './state.js';
import { btnEl, dialog, h, toast } from './ui/dom.js';
import { $ } from './util.js';

/* ================= 훈련 알림(넛지): 받는 사람(훈련하는 분)을 골라 보내요. 보낸 사람·받는 사람마다 2시간에 1번 ================= */
const NUDGE_TEMPLATES = ['{label}, 오늘 두뇌 산책 하셨어요? 😊', '시간 되실 때 훈련 한번 해보세요', '오늘 훈련 같이 힘내요!'];
const KAKAO_TEXT = '{label}, 오늘 두뇌 훈련 하셨어요? 링크 열어서 시작해보세요!';
const fill = (t, id) => t.replace('{label}', traineeLabel(id));
/* 보낼 수 있는 사람: 목록에서 나를 뺀 사람들 */
const targets = () => trainees().filter(id => id !== S.myId);
function curTarget() {
  const ts = targets();
  if (ts.includes(S.nudgeTo)) return S.nudgeTo;
  const f = focusId(); return ts.includes(f) ? f : (ts[0] || null);
}
export function nudgePanel(prefix) {
  const ta = h('textarea', { class: 'input', id: prefix + '-text', rows: '2', maxlength: '200', 'aria-label': '알림 문구' });
  const tplBox = h('div', { class: 'chips' });
  const pick = h('div', { class: 'fchips', id: prefix + '-to', role: 'radiogroup', 'aria-label': '받는 사람' });
  const send = h('button', { class: 'btn filled', type: 'button', id: prefix + '-send' });
  const info = h('p', { class: 't-small muted', id: prefix + '-info', 'aria-live': 'polite' });
  const copyBox = h('textarea', { class: 'input copybox', id: prefix + '-copybox', readonly: '', hidden: '', 'aria-label': '복사할 문구' });
  const copyBtn = btnEl('카톡으로도 보내기', 'outlined', () => {
    const txt = fill(KAKAO_TEXT, curTarget()); copyBox.value = txt;
    Platform.copy(txt, copyBox).then(ok => {
      if (ok) { copyBox.hidden = true; }
      else { copyBox.hidden = false; copyBox.focus(); copyBox.select(); }
    });
  }, prefix + '-copy');
  let tplFor = null;
  function drawTpl() {
    const to = curTarget(); if (tplFor === to) return; tplFor = to;
    tplBox.replaceChildren(...NUDGE_TEMPLATES.map((t, i) => h('button', { class: 'chip', type: 'button', id: prefix + '-tpl-' + i, onclick: () => { ta.value = fill(t, curTarget()); ta.focus(); } }, fill(t, to))));
    if (!ta.value || ta.dataset.auto === '1') { ta.value = fill(NUDGE_TEMPLATES[0], to); ta.dataset.auto = '1'; }
  }
  ta.addEventListener('input', () => { ta.dataset.auto = '0'; });
  send.onclick = async () => {
    const to = curTarget(); if (!to) return;
    const cd = nudgeCooldown(S.messages, S.myId, to, Date.now()); if (!cd.ok) return;
    const text = ta.value.trim(); if (!text) { toast('알림 문구를 적어 주세요.'); return; }
    await sendMessage({ kind: 'nudge', text, toId: to }); update();
  };
  function update() {
    const ts = targets(), to = curTarget();
    pick.hidden = ts.length < 2;
    pick.replaceChildren(...ts.map((id, i) => h('button', { class: 'chip fchip', type: 'button', role: 'radio', id: prefix + '-to-' + i, 'aria-checked': String(id === to), onclick: () => { S.nudgeTo = id; update(); } }, traineeLabel(id))));
    drawTpl();
    const cd = to ? nudgeCooldown(S.messages, S.myId, to, Date.now()) : { ok: false, waitMs: 0 };
    send.disabled = !cd.ok;
    send.textContent = !to ? '훈련하는 분이 없어요' : cd.ok ? traineeLabel(to) + '께 훈련 알림 보내기' : '약 ' + fmtWait(cd.waitMs) + ' 뒤';
    const authors = new Set(nudgesToday(S.messages, todayS()).filter(m => m.toId === to).map(m => m.authorId)).size;
    info.textContent = authors ? '오늘 ' + authors + '명' : '';
  }
  S.nudgeUpdaters.push({ el: send, fn: update }); update();
  return h('div', { class: 'stack' }, pick, tplBox, ta, send, info, copyBtn, copyBox);
}
export function refreshNudgePanels() { S.nudgeUpdaters = S.nudgeUpdaters.filter(u => u.el.isConnected); S.nudgeUpdaters.forEach(u => u.fn()); }

export async function checkNudgeDialog() {
  if (S.nudgeBusy || S.firstRunBusy || !chatAvail() || !myTrainee() || !S.msgsReady) return;
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
