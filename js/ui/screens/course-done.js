import { allSessions, chatAvail, streakOf } from '../../data.js';
import { GAMES } from '../../games/registry.js';
import { P } from '../../icons.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';
import { switchRow } from '../widgets.js';
import { esc, fmtDur, mean } from '../../util.js';

SCREENS.courseDone = {
  html() {
    const res = S.course.results, now = new Date(), st = streakOf(allSessions(), now);
    const dur = res.reduce((a, r) => a + (r.dur || 0), 0), avg = res.length ? Math.round(mean(res.map(r => r.acc || 0)) * 100) : 0;
    const dots = Array.from({ length: 18 }, (_, i) => '<i style="left:' + (i * 5.5 + 2) + '%;animation-delay:' + (i % 6) * 120 + 'ms"></i>').join('');
    return '<div class="stack"><div class="confetti" aria-hidden="true">' + dots + '</div>' +
      '<svg class="badge" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" transform="translate(4.8 4.4) scale(.6)" d="' + P.star + '"/></svg>' +
      '<h1 class="t-headline center" id="done-h">오늘 훈련을 모두 마치셨어요!</h1>' +
      '<section class="card primary center"><p class="t-title">연속 ' + st + '일째 훈련 중이에요</p><p class="t-body mt">정말 수고 많으셨어요. 꾸준함이 가장 큰 힘이에요.</p></section>' +
      '<section class="card elevated" aria-label="오늘의 기록"><ul class="course-list t-body">' + res.map(r => '<li><span>' + esc(GAMES[r.gameId].name) + '</span><b>' + r.correct + '/' + r.total + '</b></li>').join('') + '</ul>' +
      '<p class="t-small muted mt">평균 정답률 ' + avg + '% · 총 ' + fmtDur(dur) + '</p></section>' +
      (chatAvail() ? '<section class="card outlined">' + switchRow('notify-switch', '가족에게 알리기', S.notifyFamily ? '켜져 있어요. 나갈 때 가족 대화방에 알려요.' : '꺼져 있어요.', S.notifyFamily, 'notify', false) + '</section>' : '') +
      '<p class="sync-note" id="sync-note"></p>' +
      '<button class="btn filled" id="btn-done-home" type="button" data-act="home">처음으로</button>' +
      '<button class="btn outlined" id="btn-done-family" type="button" data-act="nav" data-to="family">가족이 보는 기록</button></div>';
  },
  bind() { const st = streakOf(allSessions(), new Date()); say('오늘 훈련을 모두 마치셨어요. 정말 수고 많으셨어요. 연속 ' + st + '일째 훈련 중이에요.'); }
};
