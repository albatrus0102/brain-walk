import { getPlan } from '../../data.js';
import { GAMES } from '../../games/registry.js';
import { nextCourseStep, praise } from '../../session.js';
import { sayThen, stopSpeech } from '../../sound.js';
import { S } from '../../state.js';
import { ACTS } from '../acts.js';
import { dialog } from '../dom.js';
import { SCREENS } from '../registry.js';
import { go } from '../shell.js';
import { esc } from '../../util.js';

/* 게임과 게임 사이 쉬는 화면 (DESIGN.md §5 L5) + 점검 날 안내(checkIntro, L8).
 * 칭찬 → (점수) → 난이도 한마디 → 다음 게임 소개 → "다음" 큰 버튼. 정해진 초가 지나면 저절로 다음으로 가요 (관리자가 끄거나 5·10·15초로 정해요). */
/* 이름 끝 글자에 받침이 있으면 "이에요", 없으면 "예요". 한글이 아니면(예: '오늘은 며칠?') "게임이에요" */
export function iyeyo(name) {
  const c = String(name).slice(-1).charCodeAt(0);
  return c >= 0xAC00 && c <= 0xD7A3 ? (((c - 0xAC00) % 28) ? '이에요' : '예요') : null;
}
export const nextLine = name => { const y = iyeyo(name); return y == null ? '다음은 ‘' + name + '’ 게임이에요' : '다음은 ‘' + name + '’' + y; };
const LEVEL_LINES = { up: '아주 잘하셔서 다음에는 조금 더 어렵게 해 볼게요.', down: '다음에는 조금 쉽게 해 드릴게요.', down2: '조금 어려우셨죠? 괜찮아요. 다음에는 조금 쉽게 해 드릴게요.' };
const state = () => {
  const n = S.course.results.length;
  if (!S.brk || S.brk.n !== n) S.brk = { n, praise: praise(), left: null, stopped: false, started: false };
  return S.brk;
};
const countText = b => b.stopped ? '‘다음’을 누르면 시작해요.' : b.left == null ? '' : b.left + '초 뒤에 저절로 시작해요';

SCREENS.courseBreak = {
  html() {
    const c = S.course, b = state(), L = S.last, nid = c.games[c.results.length], g = GAMES[nid], plan = getPlan();
    const lv = LEVEL_LINES[L && L.kind];
    return '<div class="stack brk"><h1 class="t-headline center" id="brk-h">' + esc(b.praise) + '</h1>' +
      (plan.showScore && L ? '<p class="t-title-m center" id="brk-score">정답 ' + L.rec.correct + ' / ' + L.rec.total + '</p>' : '') +
      (lv ? '<p class="t-body center muted" id="brk-level">' + lv + '</p>' : '') +
      '<section class="card primary" id="brk-next" aria-label="다음 게임"><p class="t-title">' + esc(nextLine(g.name)) + '</p><p class="t-body mt">' + esc(g.desc) + '</p></section>' +
      '<div class="cta"><button class="btn filled huge" id="btn-brk-next" type="button" data-act="brk-next">다음</button>' +
      '<p class="t-small center brk-count" id="brk-count" role="status">' + esc(countText(b)) + '</p>' +
      '<button class="btn text" id="btn-brk-stop" type="button" data-act="brk-stop">오늘은 여기까지</button></div></div>';
  },
  bind(el) {
    const c = S.course, b = state(), nid = c.games[c.results.length], g = GAMES[nid], sec = getPlan().autoNextSec;
    const timers = [];
    const cleanup = () => { timers.forEach(clearTimeout); timers.length = 0; if (iv) clearInterval(iv); iv = null; document.removeEventListener('pointerdown', stopOnTap, true); document.removeEventListener('keydown', stopOnTap, true); };
    let iv = null, cancelSay = null;
    const paint = () => { const e = document.getElementById('brk-count'); if (e) e.textContent = countText(b); };
    const stop = () => { if (b.stopped) return; b.stopped = true; b.left = null; cleanup(); paint(); };
    // 버튼이 아닌 곳을 누르거나 키를 누르면 저절로 넘어가는 것을 멈춰요 (읽는 중이에요)
    function stopOnTap(ev) { const t = ev.target; if (t && t.closest && (t.closest('button') || t.closest('#scrim') || t.closest('#sheet'))) return; stop(); }
    const run = () => {
      if (iv) return;
      iv = setInterval(() => {
        if (S.screen !== 'courseBreak' || b.stopped) { cleanup(); return; }
        b.left -= 1; paint();
        if (b.left <= 0) { cleanup(); b.stopped = true; nextCourseStep(); }
      }, 1000);
    };
    S.onLeave = () => { cleanup(); if (cancelSay) cancelSay(); };
    if (sec > 0 && !b.stopped) {
      document.addEventListener('pointerdown', stopOnTap, true); document.addEventListener('keydown', stopOnTap, true);
      if (b.left != null) { run(); }                              // 화면만 다시 그려진 경우: 남은 초에서 이어가요
      else if (!b.started) { b.started = true; paint(); cancelSay = sayThen(b.praise + ' ' + nextLine(g.name) + '.', () => { if (S.screen !== 'courseBreak' || b.stopped) return; b.left = sec; paint(); run(); }, 3000, 9000); }
      else if (b.left == null) { b.left = sec; paint(); run(); }
    } else if (!b.started) { b.started = true; sayThen(b.praise + ' ' + nextLine(g.name) + '.', () => {}, 0, 9000); }
  }
};
ACTS['brk-next'] = () => { if (S.brk) S.brk.stopped = true; stopSpeech(); nextCourseStep(); };
ACTS['brk-stop'] = () => {
  if (S.brk) S.brk.stopped = true;
  dialog('오늘은 여기까지 할까요?', '지금까지 한 것은 저장돼요. 나중에 ‘이어서 하기’로 계속할 수 있어요.', [{ label: '계속하기', kind: 'filled' }, { label: '그만하기', kind: 'text', run: () => go('home') }]);
};

/* 점검 날 안내: 평소 훈련 대신 월간 점검 */
SCREENS.checkIntro = {
  html() {
    return '<div class="stack"><h1 class="t-headline" id="ci-intro-h">오늘은 두뇌 점검 날이에요</h1>' +
      '<section class="card primary"><p class="t-body">평소 훈련 대신, 한 달에 한 번 같은 문제로 두뇌 상태를 살펴봐요. 맞히지 못해도 괜찮아요. 약 15분 걸려요.</p></section>' +
      '<div class="cta"><button class="btn filled huge" id="btn-check-start" type="button" data-act="check-start">점검 시작</button>' +
      '<button class="btn text" id="btn-check-skip" type="button" data-act="checkskip">오늘은 평소 훈련만 할게요</button></div></div>';
  }
};
