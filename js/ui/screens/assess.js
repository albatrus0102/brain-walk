import { allAssessments, getPlan, isTrainee } from '../../data.js';
import { hubHtml } from './hub.js';
import { DOM, DOMAINS, GAMES } from '../../games/registry.js';
import { changeWord } from '../../logic.js';
import { checkDue } from '../../program.js';
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
    const as = allAssessments(), last = as[0], prev = as[1], today = ymd(new Date()), cd = checkDue(getPlan(), last && last.date, today, true), nc = cd.state === 'due' ? { state: 'due', days: cd.days == null ? 0 : cd.days } : cd.state === 'wait' ? { state: 'wait', days: cd.days, remain: cd.remain } : { state: 'none' };
    let h2 = '<div class="stack"><h1 class="t-headline" id="as-h">두뇌 건강 점검</h1>' +
      '<section class="card elevated">' +
      '<div class="mt"><button class="btn filled" id="btn-assess-start" type="button" data-act="assessstart">' + (nc.state === 'wait' ? '다시 점검해 보기' : '점검 시작하기') + '</button></div></section>';
    const dr = assessDraft();
    if (dr) h2 += '<section class="card primary" id="assess-resume"><p class="t-title-m">점검을 이어서 할 수 있어요</p><div class="mt"><button class="btn filled" id="btn-assess-resume" type="button" data-act="assessresume">이어서 하기</button></div></section>';
    if (nc.state === 'due') h2 += '<section class="card tertiary"><p class="t-title-m">다시 점검할 때예요</p></section>';
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
      '<h1 class="t-headline" id="ast-h">' + esc(title) + '</h1>' +
      '<div class="cta"><button class="btn filled" id="btn-assess-begin" type="button" data-act="assessbegin">시작하기</button></div></div>';
  }
};
SCREENS.assessBreak = {
  html() {
    const left = ASSESS_STEPS.filter(x => x.part === 2).length;
    return '<div class="stack"><h1 class="t-headline" id="ab-h">1부분을 마치셨어요</h1>' +
      '<section class="card primary"><p class="t-title">여기까지 약 8분 걸렸어요.</p></section>' +
      '' +
      '<div class="cta"><button class="btn filled" id="btn-ab-continue" type="button" data-act="assesscontinue">이어서 하기 (약 7분)</button>' +
      '<button class="btn tonal" id="btn-ab-later" type="button" data-act="assesslater">내일 이어서 하기</button>' +
      '<button class="btn text" id="btn-ab-end" type="button" data-act="assessend">여기서 마치기</button></div></div>';
  }
};
SCREENS.assessDone = {
  html() {
    const L = S.lastAssess, r = L.rec, p = L.prev;
    // 훈련하는 분에게는 점수를 보여 주지 않아요 (관리자가 '점수 보여 주기'를 켠 경우만): 점수 걱정 없이 마치도록
    if (isTrainee() && !getPlan().showScore) {
      return '<div class="stack"><h1 class="t-headline" id="ad-h">점검을 모두 마치셨어요!</h1>' +
        '<section class="card primary center"><p class="t-title">수고하셨어요</p></section>' +
        '<p class="sync-note" id="sync-note"></p>' +
        '<div class="cta"><button class="btn filled" id="btn-ad-home" type="button" data-act="home">처음으로</button></div></div>';
    }
    return '<div class="stack"><h1 class="t-headline" id="ad-h">점검을 마치셨어요</h1>' +
      '<section class="card primary center"><p class="t-label">총점</p><p class="t-display">' + r.total + '점</p>' + (p ? '<p class="t-title-m mt">' + arrowHtml(r.total - p.total) + '</p><p class="t-small">지난번 ' + p.total + '점</p>' : '') + '</section>' +
      '<section class="card outlined"><h2 class="t-title">영역별 점수</h2><div class="stack mt">' + scoreRows(r.scores, p && p.scores) + '</div></section>' +
      '<p class="sync-note" id="sync-note"></p>' +
      '<div class="cta"><button class="btn filled" id="btn-ad-home" type="button" data-act="home">처음으로</button></div></div>';
  },
  bind() { say('점검을 마치셨어요. 수고 많으셨어요.'); }
};
