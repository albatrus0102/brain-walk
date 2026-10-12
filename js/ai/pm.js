import { todayS } from '../data.js';
import { roundsFor } from '../program.js';
import { GAMES } from '../games/registry.js';
import { getPlan } from '../data.js';
import { say } from '../sound.js';
import { S } from '../state.js';
import { dialog, h, toast } from '../ui/dom.js';
import { ACTS } from '../ui/acts.js';
import { LS } from '../util.js';
import { drawPm, markSeen } from './bank.js';
import { canLog, entryOf, writeDocs } from './itemlog.js';

/* ================= 잊지 말고 누르기 (prospective memory, CLIENT-CONTRACT §2.3) =================
 * 은행에 이 문항이 있으면 코스를 시작할 때 부탁을 하나 해요: "마지막 문제가 끝나면 🌼 단추를 눌러 주세요."
 * 단추는 코스 내내 위쪽 바에 있어요. 정해진 순간 ±1 문항 안에 누르면 맞음, 일찍 누르면 PM_EARLY, 안 누르면 PM_MISS, 다른 단추(🌻)는 PM_WRONG_CUE.
 * 한 코스에 하나만, 끝나면 문항 기록 한 줄을 남겨요. */
const KEY = 'bw.aiPm';
/* 부탁 글은 "화면 아래 🌼 단추"라고 와요. 이 앱은 단추를 위쪽 바에 두니까, 보이는 곳에 맞춰 말해요 */
const where = t => String(t || '').replace(/화면\s*(아래|밑)(쪽)?/g, '화면 위쪽').slice(0, 120);
export const pmState = () => { const p = LS.get(KEY, null); return p && p.date === todayS() && !p.done ? p : null; };
const save = p => LS.set(KEY, p);
const roundsOf = id => roundsFor(GAMES[id], getPlan());
/* 코스에서 지금까지 끝낸 문항 수 (지금 풀고 있는 게임 안의 문항 포함) */
function itemsDone() {
  const c = S.course; if (!c) return 0;
  let n = 0; c.results.forEach((r, i) => { n += roundsOf(c.games[i]); });
  if (S.screen === 'game' && S.sess && !S.sess.delayed && S.sess.flow) n += S.sess.idx + (S.ctx && S.ctx.finished ? 1 : 0);
  return n;
}
function target(p) {
  const c = S.course; if (!c) return 0;
  const ev = p.event; const m = /^after_game:([1-9])$/.exec(ev);
  const upto = m ? Math.min(Number(m[1]), c.games.length) : c.games.length;
  let n = 0; for (let i = 0; i < upto; i++) n += roundsOf(c.games[i]); return n;
}
/* 코스를 시작할 때 (이어하기 포함): 오늘 이미 정한 부탁이 있으면 이어 가고, 새로 시작하면 은행에서 하나 꺼내 부탁해요 */
export function pmStart(fresh) {
  if (!canLog() || !S.course || S.course.replay) return;
  const cur = pmState();
  if (cur) return;
  if (!fresh) return;
  const it = drawPm(); if (!it) return;
  markSeen(it.id);
  const b = it.body || {};
  save({ date: todayS(), id: it.id, lv: it.level, event: String(b.event), cue: String(b.cue || '🌼'), wrongCue: it.level >= 5, mid: !!b.reminderMid, instruction: where(b.instruction), early: false, wrong: false, midDone: false, done: false });
  const text = where(b.instruction);
  say(text);
  dialog('부탁이 하나 있어요', text, [{ label: '알겠어요', kind: 'filled' }]);
}
export function pmVisible() { return !!pmState() && !!S.course && ['game', 'courseBreak', 'checkin', 'courseDone', 'result'].includes(S.screen); }
/* 위쪽 바에 둘 단추 (꽃 🌼, 다섯 단계에서는 닮은 🌻도 함께) */
export function pmButtons() {
  const p = pmState(); if (!p) return null;
  const btn = (cue, name) => h('button', { class: 'icon-btn pm-btn', id: 'btn-pm-' + (cue === p.cue ? 'cue' : 'other'), type: 'button', 'data-act': 'pm-press', 'data-cue': cue, 'aria-label': name + ' 단추', text: cue });
  const other = p.cue === '🌼' ? '🌻' : '🌼';
  return h('span', { class: 'pm-wrap' + (p.wrongCue ? ' two' : ''), id: 'pm-wrap' }, btn(p.cue, '꽃'), p.wrongCue ? btn(other, '다른 꽃') : null);
}
function finalize(p, ok, err) {
  p.done = true; save(p);
  const e = entryOf({ id: p.id, role: 'training', fmt: 'prospective', cd: 'memory', lv: p.lv, score: ok ? 1 : 0, ok, err, pick: [] });
  writeDocs({ g: { id: 'prospective' }, level: p.lv, inCourse: true, date: p.date }, [e], false, 'pm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
}
export function pmPress(cue) {
  const p = pmState(); if (!p) return;
  if (cue !== p.cue) { p.wrong = true; save(p); toast('그 단추가 아니에요.'); return; }
  const done = itemsDone(), t = target(p);
  if (done >= t - 1) { finalize(p, true, p.wrong ? ['PM_WRONG_CUE'] : []); toast('잘 기억하셨어요!'); say('잘 기억하셨어요!'); }
  else { p.early = true; save(p); toast('아직이에요. 부탁하신 때가 되면 눌러 주세요.'); }
  const bar = document.getElementById('pm-wrap'); if (bar && pmState() == null) bar.remove();
}
/* 코스가 끝난 뒤 다른 화면으로 나가면, 누르지 않은 것으로 기록해요 */
export function pmOnNav(name) {
  const p = pmState(); if (!p) return;
  const c = S.course; if (!c || c.results.length < c.games.length) return;
  if (['courseDone', 'checkin', 'game', 'result'].includes(name)) return;
  finalize(p, false, (p.early ? ['PM_EARLY'] : ['PM_MISS']).concat(p.wrong ? ['PM_WRONG_CUE'] : []));
}
/* 코스 중간에 한 번 다시 알려 주기 (reminderMid) */
export function pmMidReminder() {
  const p = pmState(); if (!p || !p.mid || p.midDone || !S.course) return;
  if (S.course.results.length !== Math.floor(S.course.games.length / 2)) return;
  p.midDone = true; save(p);
  toast(p.instruction.slice(0, 80)); say(p.instruction);
}
ACTS['pm-press'] = b => pmPress(b.dataset.cue);
