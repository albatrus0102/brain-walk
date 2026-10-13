import { chatAvail, getPlan, isTrainee, streakNow } from '../../data.js';
import { GAMES } from '../../games/registry.js';
import { P } from '../../icons.js';
import { maybeNotify } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';
import { switchRow } from '../widgets.js';
import { esc, fmtDur, mean } from '../../util.js';

/* 코스를 모두 마친 화면 (DESIGN.md §5 L7). 훈련하는 분: 처음으로 버튼 하나. 점수는 관리자가 켰을 때만 보여요. */
SCREENS.courseDone = {
  html() {
    const res = S.course.results, tr = isTrainee(), show = getPlan().showScore, st = streakNow(new Date());
    const dur = res.reduce((a, r) => a + (r.dur || 0), 0), avg = res.length ? Math.round(mean(res.map(r => r.acc || 0)) * 100) : 0;
    const dots = Array.from({ length: 18 }, (_, i) => '<i style="left:' + (i * 5.5 + 2) + '%;animation-delay:' + (i % 6) * 120 + 'ms"></i>').join('');
    const list = '<section class="card elevated" aria-label="오늘의 기록"><ul class="course-list t-body" id="done-list">' + res.map(r => '<li><span>' + esc(GAMES[r.gameId].name) + '</span><b>' + r.correct + '/' + r.total + '</b></li>').join('') + '</ul>' +
      '<p class="t-small muted mt">평균 정답률 ' + avg + '% · 총 ' + fmtDur(dur) + '</p></section>';
    return '<div class="stack"><div class="confetti" aria-hidden="true">' + dots + '</div>' +
      '<svg class="badge" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" transform="translate(4.8 4.4) scale(.6)" d="' + P.star + '"/></svg>' +
      '<h1 class="t-headline center" id="done-h">오늘 훈련을 모두 마치셨어요!</h1>' +
      '<section class="card primary center"><p class="t-title" id="done-streak">' + (st >= 2 ? st + '일째 꾸준히 하고 계세요' : '정말 수고 많으셨어요.') + '</p></section>' +
      (tr ? (chatAvail() && !S.course.replay ? '' : '') + (show ? list : '')
        : list + (chatAvail() ? '<section class="card outlined">' + switchRow('notify-switch', '가족에게 알리기', S.notifyFamily ? '켜져 있어요. 나갈 때 가족 대화방에 알려요.' : '꺼져 있어요.', S.notifyFamily, 'notify', false) + '</section>' : '')) +
      '<p class="sync-note" id="sync-note"></p>' +
      '<div class="cta"><button class="btn filled" id="btn-done-home" type="button" data-act="home">처음으로</button></div></div>';
  },
  bind() {
    maybeNotify();       // 가족에게 알림은 이 화면이 열릴 때 한 번 보내요
    say('오늘 훈련을 모두 마치셨어요. 정말 수고 많으셨어요.');
  }
};
