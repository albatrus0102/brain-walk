import { S } from '../state.js';

/* ================= 뒤로 가기 (History API) =================
 * 목표: 뒤로 가기(Back)가 앱을 갑자기 끝내지 않고, 앱 안에서 먼저 한 칸 돌아가요.
 * 주소(URL)는 건드리지 않고 history.state 만 써요: { bw: 1, i: 번호, s: 화면, f: 흐름 화면?, d: 창? }
 *   i=0  앱이 처음 열린 칸 (이 앞으로 가면 앱을 나가요)
 *   i=1  첫 화면(보통 홈) = '뒤 지킴이' 칸
 *   i>=2 화면 이동, 열려 있는 창(대화상자·시트)이 한 칸씩
 * Chrome 은 사용자가 아무것도 누르지 않고 쌓은 칸을 Back 이 건너뛰게 해요. 그래서 지킴이 칸은 첫 터치·키 입력 뒤에 쌓아요.
 * 화면 그리기·대화상자 만들기는 shell.js 가 hooks 로 알려 줘요 (이 파일은 state.js 만 알아요). */
const FLOW_SCREENS = ['game', 'result', 'courseBreak', 'checkIntro', 'checkin', 'courseDone', 'assessStep', 'assessBreak', 'assessDone', 'surveyIntro', 'surveyQ', 'surveyDone'];
export const isFlowScreen = n => FLOW_SCREENS.includes(n) || n === 'setup' || String(n).indexOf('ob-') === 0;

let hooks = null, armed = false, exiting = false;
let stack = [];            // 우리가 아는 history 칸들 (stack[i] = i번 칸)
let layers = [];           // 열려 있는 창 (아래→위)
let awaiting = null;       // 우리가 일부러 돌린 back 이 끝나길 기다리는 중
let chain = Promise.resolve();

const mk = (i, e) => Object.assign({ bw: 1, i }, e.d ? { d: 1 } : { s: e.s, f: !!e.f });
const safe = f => { try { f(); } catch (e) {} };
const doPush = e => { stack.push(e); safe(() => history.pushState(mk(stack.length - 1, e), '')); };
const doReplace = e => { stack[stack.length - 1] = e; safe(() => history.replaceState(mk(stack.length - 1, e), '')); };
/* n 칸 뒤로 (우리가 한 일이라 popstate 는 처리하지 않고, 끝날 때까지 다음 일을 미뤄요) */
function back(n) {
  chain = chain.then(() => new Promise(res => {
    let t = null;
    awaiting = () => { clearTimeout(t); res(); };
    t = setTimeout(() => { awaiting = null; res(); }, 600);
    safe(() => history.go(-n));
  }));
}
const later = f => { chain = chain.then(() => { safe(f); }); };
/* 지킴이 칸이 없으면(맨 앞 칸만 남았으면) 다시 쌓아요. 단, 앱 닫기 확인창이 떠 있는 동안엔 그 창이 지킴이 대신이에요 */
function ensureGuard() {
  if (armed && !exiting && stack.length === 1 && !layers.some(l => l.nopush)) doPush({ s: S.screen, f: isFlowScreen(S.screen) });
}

/* ---------- 창(대화상자·시트) ---------- */
/* opts.nopush: 칸을 쌓지 않아요 (앱 닫기 확인창: 이 창이 떠 있을 때 Back 을 또 누르면 그대로 앱을 나가요) */
export function openLayer(dismiss, opts) {
  const l = { dismiss, pushed: false, nopush: !!(opts && opts.nopush) };
  layers.push(l);
  if (armed && !l.nopush) { l.pushed = true; later(() => doPush({ d: 1 })); }
  return l;
}
/* 코드가 창을 닫을 때 (버튼 등): 쌓았던 칸도 한 칸 되돌려요 */
export function closeLayer(l) {
  const k = layers.indexOf(l); if (k < 0) return;
  layers.splice(k, 1);
  if (l.pushed) { l.pushed = false; later(() => { if (stack.length > 1 && stack[stack.length - 1].d) { stack.pop(); back(1); } later(ensureGuard); }); }
}
/* Escape: Back 과 같아요 */
export function dismissTop() {
  const l = layers[layers.length - 1]; if (!l) return false;
  if (l.pushed) { safe(() => history.back()); return true; }   // popstate 가 닫아 줘요
  layers.pop(); safe(l.dismiss); return true;
}
export const hasLayer = () => layers.length > 0;

/* ---------- 화면 이동 ---------- */
/* go() 가 화면을 바꿀 때 불러요 */
export function navTo(name) {
  if (!armed) return;
  const flow = isFlowScreen(name);
  later(() => {
    const cur = stack.length - 1, top = stack[cur];
    if (top.d) { stack.forEach(e => { if (e.d) e.dead = true; }); layers.forEach(l => { l.pushed = false; }); doPush({ s: name, f: flow }); return; }
    if (top.s === name) { doReplace({ s: name, f: flow }); return; }
    for (let k = cur - 1; k >= 1; k--) {
      if (stack[k].s === name && !stack[k].f && !stack[k].d) { stack.length = k + 1; back(cur - k); return; }   // 이미 지나온 화면이면 거기로 돌아가요
    }
    if (top.f && cur >= 1) doReplace({ s: name, f: flow });
    else doPush({ s: name, f: flow });
  });
}

/* ---------- 뒤로 가기 처리 ---------- */
function onPop(e) {
  if (awaiting) { const r = awaiting; awaiting = null; r(); return; }
  if (!armed || exiting) return;
  const s = e.state;
  if (!s || !s.bw) return;
  const from = stack.length - 1, i = s.i;
  if (i > from) { back(i - from); return; }       // 앞으로 가기(데스크톱): 원래 자리로
  if (i === from) return;
  const removed = stack.splice(i + 1);
  const top = removed[removed.length - 1];
  const dcount = removed.filter(x => x.d && !x.dead).length;
  if (dcount > 0 && layers.some(l => l.pushed)) {
    for (let n = 0; n < dcount; n++) { const l = layers.slice().reverse().find(x => x.pushed); if (!l) break; layers.splice(layers.indexOf(l), 1); l.pushed = false; safe(l.dismiss); }
    later(ensureGuard);   // 맨 앞 칸까지 돌아왔으면 지킴이 칸을 다시 쌓아요
    return;
  }
  // 창이 없으면 화면 단위 Back
  const land = stack[i];
  if (hooks.isTask(S.screen)) { doPush(top.d ? { s: S.screen, f: true } : top); hooks.confirmQuit(); return; }
  if (land.d && land.dead) { back(1); return; }
  if (i === 0) {
    const rootE = { s: 'home', f: false };
    if (S.screen === (removed[0] && removed[0].s) || hooks.isBare(S.screen)) { hooks.confirmExit(); return; }
    // 첫 화면이 아닌 곳(딥링크 등)에서 맨 뒤로 왔어요: 홈으로 가고 지킴이 칸을 다시 쌓아요
    stack = [stack[0]]; doPush(rootE); hooks.show('home'); return;
  }
  hooks.show(land.s || 'home');
}

function arm() {
  if (armed) return;
  armed = true;
  const s = S.screen;
  stack = [{ base: true }];
  safe(() => history.replaceState({ bw: 1, i: 0 }, ''));
  doPush({ s, f: isFlowScreen(s) });
  layers.forEach(l => { if (!l.nopush) { l.pushed = true; doPush({ d: 1 }); } });   // 첫 터치 때 이미 떠 있던 창
}

/* 앱 닫기 확인창에서 '계속하기' (또는 Escape): 지킴이 칸을 다시 쌓아요 */
export function rearm() {
  if (!armed || exiting) return;
  later(ensureGuard);
}
/* '닫기': 지킴이 칸을 지나 앞으로 돌아가요. 갈 곳이 없으면 창 닫기를 시도하고, 그래도 남으면 계속 쓸 수 있게 다시 지켜요 */
export function exitApp() {
  exiting = true;
  safe(() => history.go(-stack.length));
  setTimeout(() => {
    safe(() => window.close());
    setTimeout(() => { exiting = false; rearm(); }, 300);
  }, 400);
}
export const isExiting = () => exiting;

export function initNav(h) {
  hooks = h;
  window.addEventListener('popstate', onPop);
  const once = () => { document.removeEventListener('pointerdown', once, true); document.removeEventListener('keydown', once, true); arm(); };
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('keydown', once, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && hasLayer() && !e.defaultPrevented) { e.preventDefault(); dismissTop(); } });
  window.addEventListener('beforeunload', e => { if (!exiting && hooks.isActive()) { e.preventDefault(); e.returnValue = ''; } });
}
