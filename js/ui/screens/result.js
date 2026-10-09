import { GAMES } from '../../games/registry.js';
import { COURSE_N, praise } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';
import { esc, fmtDur } from '../../util.js';

SCREENS.result = {
  html() {
    const L = S.last, r = L.rec, g = GAMES[r.gameId];
    const msgs = {
      up: ['정말 잘하셨어요! 다음 번에는 조금 더 어렵게 해볼게요.', L.nl + '단계로 올라갔어요.'],
      max: ['훌륭해요! 가장 높은 5단계에서도 잘하고 계세요.', '5단계를 유지해요.'],
      down: ['오늘은 조금 어려우셨죠? 괜찮아요. 다음 번에는 조금 더 쉽게 해볼게요.', L.nl + '단계로 맞춰 드릴게요.'],
      down2: ['두 번 연속 조금 어려우셨죠? 괜찮아요. 한 단계 쉽게 맞춰 드릴게요. 천천히 해도 충분해요.', L.nl + '단계로 맞춰 드릴게요.'],
      min: ['괜찮아요. 천천히 하시면 돼요. 같은 단계로 다시 해 봐요.', '1단계를 유지해요.'],
      same: ['지금 단계가 딱 좋아요. 다음에도 같은 단계로 이어서 해 봐요.', L.nl + '단계를 유지해요.']
    }[L.kind];
    const inC = S.sess && S.sess.inCourse && S.course;
    const nextLabel = inC ? (S.course.results.length >= COURSE_N ? '오늘 훈련 마무리하기' : '다음 훈련으로 (' + (S.course.results.length + 1) + '/' + COURSE_N + ')') : '다음';
    return '<div class="stack"><h1 class="t-headline" id="res-h">' + esc(g.name) + ' 결과</h1>' +
      '<section class="card primary center" aria-label="점수"><p class="t-label">점수</p><p class="t-display" id="res-score">' + L.score + '점</p><p class="t-title-m mt">' + praise() + '</p></section>' +
      '<div class="stat"><div><span class="t-label">정답</span><b>' + r.correct + ' / ' + r.total + '</b></div><div><span class="t-label">걸린 시간</span><b>' + fmtDur(r.durationSec) + '</b></div><div><span class="t-label">이번 단계</span><b>' + r.level + '단계</b></div></div>' +
      '<section class="card tertiary" aria-label="난이도"><p class="t-title-m">' + msgs[0] + '</p><p class="t-body mt">' + msgs[1] + '</p></section>' +
      '<p class="sync-note" id="sync-note"></p>' +
      '<div class="cta"><button class="btn filled" id="btn-next-after" type="button" data-act="after">' + nextLabel + '</button>' +
      (inC ? '' : '<button class="btn tonal" id="btn-again" type="button" data-act="again">한 번 더 하기</button>') +
      '<button class="btn text" id="btn-home" type="button" data-act="home">처음으로</button></div>';
  },
  bind() { say(praise() + ' 훈련을 마치셨어요.'); }
};
