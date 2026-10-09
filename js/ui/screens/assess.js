import { allAssessments, isTrainee } from '../../data.js';
import { hubHtml } from './hub.js';
import { DOM, DOMAINS, GAMES } from '../../games/registry.js';
import { changeWord, nextCheckInfo } from '../../logic.js';
import { mdLabel } from '../../records.js';
import { ASSESS_STEPS, assessDraft } from '../../session.js';
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
function assessMainHtml() {
  {
    const as = allAssessments(), last = as[0], prev = as[1], today = ymd(new Date()), nc = nextCheckInfo(last && last.date, today);
    let h2 = '<div class="stack"><h1 class="t-headline" id="as-h">두뇌 건강 점검</h1>' +
      '<section class="card elevated"><p class="t-body">다섯 가지 영역(기억력, 집중력, 계산·순서, 날짜·시간 감각, 빠른 반응)을 <b>항상 같은 난이도</b>로 살펴봐요. 약 15분이 걸리고(두 번에 나눠 해도 돼요), 한 달에 한 번 다시 해서 변화를 비교해요.</p>' +
      '<p class="t-small muted mt">진단이 아니라 변화를 살펴보는 참고용이에요. 천천히, 편하게 해 주세요.</p>' +
      '<div class="mt"><button class="btn filled" id="btn-assess-start" type="button" data-act="assessstart">' + (nc.state === 'wait' ? '다시 점검해 보기' : '점검 시작하기') + '</button></div></section>';
    const dr = assessDraft();
    if (dr) h2 += '<section class="card primary" id="assess-resume"><p class="t-title-m">점검을 이어서 할 수 있어요</p><p class="t-body mt">1부분은 마쳤어요. 남은 2부분(약 7분)을 이어서 해 볼까요?</p><div class="mt"><button class="btn filled" id="btn-assess-resume" type="button" data-act="assessresume">이어서 하기</button></div></section>';
    if (nc.state === 'due') h2 += '<section class="card tertiary"><p class="t-title-m">다시 점검할 때예요</p><p class="t-body">마지막 점검이 ' + nc.days + '일 전이에요.</p></section>';
    if (last) {
      h2 += '<section class="card outlined" aria-labelledby="la-h"><h2 class="t-title" id="la-h">가장 최근 점검 · ' + mdLabel(last.date) + '</h2><p class="t-display mt">' + last.total + '점</p>' +
        (prev ? '<p class="t-body">' + arrowHtml(last.total - prev.total) + ' <span class="muted">(지난번 ' + prev.total + '점)</span></p>' : '') + '<div class="stack mt">' + scoreRows(last.scores, prev && prev.scores) + '</div></section>';
      h2 += '<section class="card elevated" aria-labelledby="ah-h"><h2 class="t-title" id="ah-h">점검 기록</h2><ul class="slist">' + as.slice(0, 12).map(a => '<li><span class="t-small muted">' + mdLabel(a.date) + '</span><span class="t-title-m">총점 ' + a.total + '점</span></li>').join('') + '</ul></section>';
    }
    return h2 + '</div>';
  }
}
SCREENS.assessView = { html: assessMainHtml };
/* 점검 탭: 훈련하는 분은 월간 점검 화면, 가족은 한 가지씩 고르는 목록 */
SCREENS.assess = { html() { return isTrainee() ? assessMainHtml() : hubHtml(); } };
SCREENS.assessStep = {
  html() {
    const i = S.assess.idx, st = ASSESS_STEPS[i], d = DOM[st.key], g = GAMES[st.gameId], n = ASSESS_STEPS.length;
    const title = st.task ? g.name : d.name, desc = st.task ? g.desc : d.desc;
    return '<div class="stack"><div class="prog-label"><span>점검 ' + (i + 1) + ' / ' + n + '</span><span>' + (st.part === 2 ? '2부분' : '1부분') + '</span></div>' + progressBar(i / n * 100, '점검 진행') +
      '<h1 class="t-headline" id="ast-h">' + esc(title) + '</h1><section class="card elevated"><p class="t-body">' + esc(desc) + '. 짧은 문제를 풀어 볼게요. 맞고 틀린 것보다 편하게 해 보는 게 중요해요.</p></section>' +
      '<div class="cta"><button class="btn filled" id="btn-assess-begin" type="button" data-act="assessbegin">시작하기</button></div></div>';
  }
};
SCREENS.assessBreak = {
  html() {
    const left = ASSESS_STEPS.filter(x => x.part === 2).length;
    return '<div class="stack"><h1 class="t-headline" id="ab-h">1부분을 마치셨어요</h1>' +
      '<section class="card primary"><p class="t-title">여기까지 약 8분 걸렸어요.</p><p class="t-body mt">남은 과제는 ' + left + '개, 약 7분이에요. 이어서 해도 되고, 힘들면 내일 이어서 해도 괜찮아요. (3일 안에)</p></section>' +
      '<p class="t-small muted">남은 과제는 낱말 기억, 점 잇기, 숫자 기억, 반응 속도, 색 고르기, 동물 이름 대기예요. 마지막에 처음 본 낱말을 다시 물어봐요.</p>' +
      '<div class="cta"><button class="btn filled" id="btn-ab-continue" type="button" data-act="assesscontinue">이어서 하기 (약 7분)</button>' +
      '<button class="btn tonal" id="btn-ab-later" type="button" data-act="assesslater">내일 이어서 하기</button>' +
      '<button class="btn text" id="btn-ab-end" type="button" data-act="assessend">여기서 마치기</button></div></div>';
  }
};
SCREENS.assessDone = {
  html() {
    const L = S.lastAssess, r = L.rec, p = L.prev;
    return '<div class="stack"><h1 class="t-headline" id="ad-h">점검을 마치셨어요</h1>' +
      '<section class="card primary center"><p class="t-label">총점</p><p class="t-display">' + r.total + '점</p>' + (p ? '<p class="t-title-m mt">' + arrowHtml(r.total - p.total) + '</p><p class="t-small">지난번 ' + p.total + '점</p>' : '<p class="t-body mt">처음 점검이에요. 이 점수가 기준이 돼요.</p>') + '</section>' +
      '<section class="card outlined"><h2 class="t-title">영역별 점수</h2><div class="stack mt">' + scoreRows(r.scores, p && p.scores) + '</div></section>' +
      '<p class="t-small muted">이 결과는 진단이 아니에요. 점수가 계속 낮아지면 치매안심센터(<span class="nw">1899-9988</span>)나 병원에서 상담받으세요.</p><p class="sync-note" id="sync-note"></p>' +
      '<div class="cta"><button class="btn filled" id="btn-ad-home" type="button" data-act="home">처음으로</button></div></div>';
  },
  bind() { say('점검을 마치셨어요. 수고 많으셨어요.'); }
};
