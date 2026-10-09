import { allAssessments, dateSet, allSessions, getLevel, isTrainee } from '../../data.js';
import { DOMAINS, GAMES, gamesOf } from '../../games/registry.js';
import { nextCheckInfo, programInfo } from '../../logic.js';
import { mdLabel } from '../../records.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';
import { levelDots, progressBar } from '../widgets.js';
import { esc, ymd } from '../../util.js';

/* 훈련 탭: 훈련하는 분의 "나머지 전부"가 여기에 있어요 (홈은 큰 버튼 하나) */
function monthlyCard() {
  const today = ymd(new Date()), lastA = allAssessments()[0], nc = nextCheckInfo(lastA && lastA.date, today);
  const t = nc.state === 'none' ? ['아직 두뇌 건강 점검을 하지 않았어요', '처음 상태를 기록해 두면 변화를 비교할 수 있어요. (약 15분, 나눠서 해도 돼요)', '점검 시작하기', 'tertiary']
    : nc.state === 'due' ? ['다시 점검할 때예요', '마지막 점검이 ' + nc.days + '일 전이에요. 한 달에 한 번 같은 문제로 비교해요.', '점검 시작하기', 'tertiary']
      : ['다음 점검은 ' + nc.remain + '일 뒤예요', '마지막 점검: ' + mdLabel(lastA.date) + ' (총점 ' + lastA.total + ')', '점검 결과 보기', 'outlined'];
  return '<section class="card ' + t[3] + '" aria-labelledby="nc-h"><h2 class="t-title" id="nc-h">' + t[0] + '</h2><p class="t-body mt">' + t[1] + '</p><div class="mt"><button class="btn ' + (t[3] === 'tertiary' ? 'filled' : 'tonal') + '" id="btn-nextcheck" type="button" data-act="nav" data-to="assess">' + t[2] + '</button></div></section>';
}
function programCard() {
  const today = ymd(new Date()), pi = programInfo(S.program.startDate, today, dateSet(allSessions()));
  return '<section class="card filled" aria-labelledby="prog-h"><h2 class="t-title" id="prog-h">12주 프로그램 · ' + pi.week + '주차</h2><div class="mt">' + progressBar(pi.overall * 100, '12주 프로그램 진행') + '</div>' +
    '<p class="t-body mt">이번 주 ' + pi.weekDays + '/' + pi.goal + '일 훈련 (목표 주 5일)</p>' + progressBar(Math.min(100, pi.weekDays / pi.goal * 100), '이번 주 목표') +
    (pi.done ? '<p class="t-title-m mt">12주 프로그램을 끝까지 해내셨어요! 완주 배지를 드려요.</p>' : '') + '</section>';
}

SCREENS.pick = {
  html() {
    const tr = isTrainee();
    return '<div class="stack"><h1 class="t-headline" id="pick-h">' + (tr ? '훈련' : '어떤 훈련을 해 볼까요?') + '</h1>' +
      (tr ? programCard() + monthlyCard() : '') +
      '<h2 class="t-title">' + (tr ? '골라서 하기' : '훈련 고르기') + '</h2><p class="t-body muted">하고 싶은 훈련을 하나 골라 주세요. 단계는 정답률에 따라 자동으로 맞춰져요.</p>' +
      DOMAINS.map(d => '<section aria-labelledby="dom-' + d.id + '"><h2 class="t-title-m" id="dom-' + d.id + '">' + d.name + '</h2><p class="t-small muted">' + d.desc + '</p><div class="pick-list mt">' +
        gamesOf(d.id).map(id => '<button type="button" class="gamebtn" id="game-' + id + '" data-act="game" data-id="' + id + '"><span><strong>' + esc(GAMES[id].name) + '</strong><span class="t-small muted">' + esc(GAMES[id].desc) + '</span></span><span class="t-small" style="text-align:right">' + getLevel(id) + '단계<br>' + levelDots(getLevel(id)) + '</span></button>').join('') +
        '</div></section>').join('') +
      (tr ? '<h2 class="t-title">더 해 보기 (선택)</h2><section class="card outlined" aria-labelledby="clk-p"><h3 class="t-title-m" id="clk-p">시계 그리기 (한 달에 한 번)</h3><p class="t-body muted mt">손가락으로 시계를 그려 봐요. 채점은 하지 않아요.</p><div class="mt"><button class="btn tonal" id="btn-open-clock" type="button" data-act="nav" data-to="clock">그리러 가기</button></div></section>' +
        '<section class="card outlined" aria-labelledby="svp-h"><h3 class="t-title-m" id="svp-h">마음·기억 설문</h3><p class="t-body muted mt">하고 싶을 때만 해도 괜찮아요.</p><div class="mt"><button class="btn tonal" id="btn-open-surveys" type="button" data-act="nav" data-to="surveys">설문 보기</button></div></section>' : '') + '</div>';
  }
};
