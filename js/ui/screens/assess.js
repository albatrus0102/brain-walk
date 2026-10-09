import { allAssessments } from '../../data.js';
import { DOM, DOMAINS } from '../../games/registry.js';
import { changeWord, nextCheckInfo } from '../../logic.js';
import { mdLabel } from '../../records.js';
import { ASSESS_STEPS } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';
import { progressBar } from '../widgets.js';
import { esc, ymd } from '../../util.js';

export const arrowHtml = (delta) => { const c = changeWord(delta); return '<span class="arrow ' + c.dir + '">' + c.arrow + ' ' + c.word + (c.dir === 'same' ? '' : ' (' + (delta > 0 ? '+' : '') + delta + '점)') + '</span>'; };
function scoreRows(scores, prevScores) {
  return DOMAINS.map(d => { const v = Number(scores[d.id]) || 0, p = prevScores ? Number(prevScores[d.id]) : null;
    return '<div class="domscore"><div class="bar-top"><span>' + d.name + '</span><span>' + v + '점</span></div><div class="bar" role="img" aria-label="' + d.name + ' ' + v + '점"><span style="width:' + v + '%"></span></div>' + (p != null && !isNaN(p) ? '<div class="t-small">' + arrowHtml(v - p) + '</div>' : '') + '</div>'; }).join('');
}
SCREENS.assess = {
  html() {
    const as = allAssessments(), last = as[0], prev = as[1], today = ymd(new Date()), nc = nextCheckInfo(last && last.date, today);
    let h2 = '<div class="stack"><h1 class="t-headline" id="as-h">두뇌 건강 점검</h1>' +
      '<section class="card elevated"><p class="t-body">다섯 가지 영역(기억력, 주의집중력, 계산·실행기능, 지남력·언어, 처리속도)을 <b>항상 같은 난이도</b>로 살펴봐요. 약 8~10분이 걸리고, 한 달에 한 번 다시 해서 변화를 비교해요.</p>' +
      '<p class="t-small muted mt">진단이 아니라 변화를 살펴보는 참고용이에요. 천천히, 편하게 해 주세요.</p>' +
      '<div class="mt"><button class="btn filled" id="btn-assess-start" type="button" data-act="assessstart">' + (nc.state === 'wait' ? '다시 점검해 보기' : '점검 시작하기') + '</button></div></section>';
    if (nc.state === 'due') h2 += '<section class="card tertiary"><p class="t-title-m">다시 점검할 때예요</p><p class="t-body">마지막 점검이 ' + nc.days + '일 전이에요.</p></section>';
    if (last) {
      h2 += '<section class="card outlined" aria-labelledby="la-h"><h2 class="t-title" id="la-h">가장 최근 점검 · ' + mdLabel(last.date) + '</h2><p class="t-display mt">' + last.total + '점</p>' +
        (prev ? '<p class="t-body">' + arrowHtml(last.total - prev.total) + ' <span class="muted">(지난번 ' + prev.total + '점)</span></p>' : '') + '<div class="stack mt">' + scoreRows(last.scores, prev && prev.scores) + '</div></section>';
      h2 += '<section class="card elevated" aria-labelledby="ah-h"><h2 class="t-title" id="ah-h">점검 기록</h2><ul class="slist">' + as.slice(0, 12).map(a => '<li><span class="t-small muted">' + mdLabel(a.date) + '</span><span class="t-title-m">총점 ' + a.total + '점</span></li>').join('') + '</ul></section>';
    }
    return h2 + '</div>';
  }
};
SCREENS.assessStep = {
  html() {
    const i = S.assess.idx, st = ASSESS_STEPS[i], d = DOM[st.key];
    return '<div class="stack"><div class="prog-label"><span>점검 ' + (i + 1) + ' / ' + ASSESS_STEPS.length + '</span></div>' + progressBar(i / ASSESS_STEPS.length * 100, '점검 진행') +
      '<h1 class="t-headline" id="ast-h">' + d.name + '</h1><section class="card elevated"><p class="t-body">' + esc(d.desc) + '. 짧은 문제를 풀어 볼게요. 맞고 틀린 것보다 편하게 해 보는 게 중요해요.</p></section>' +
      '<button class="btn filled" id="btn-assess-begin" type="button" data-act="assessbegin">시작하기</button></div>';
  }
};
SCREENS.assessDone = {
  html() {
    const L = S.lastAssess, r = L.rec, p = L.prev;
    return '<div class="stack"><h1 class="t-headline" id="ad-h">점검을 마치셨어요</h1>' +
      '<section class="card primary center"><p class="t-label">총점</p><p class="t-display">' + r.total + '점</p>' + (p ? '<p class="t-title-m mt">' + arrowHtml(r.total - p.total) + '</p><p class="t-small">지난번 ' + p.total + '점</p>' : '<p class="t-body mt">처음 점검이에요. 이 점수가 기준이 돼요.</p>') + '</section>' +
      '<section class="card outlined"><h2 class="t-title">영역별 점수</h2><div class="stack mt">' + scoreRows(r.scores, p && p.scores) + '</div></section>' +
      '<p class="t-small muted">이 결과는 진단이 아니에요. 점수가 계속 낮아지면 치매안심센터(1899-9988)나 병원에서 상담받으세요.</p><p class="sync-note" id="sync-note"></p>' +
      '<button class="btn filled" id="btn-ad-home" type="button" data-act="home">처음으로</button></div>';
  },
  bind() { say('점검을 마치셨어요. 수고 많으셨어요.'); }
};
