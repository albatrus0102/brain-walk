import { ensureProfiles, isTrainee, nameOf, traineeLabel } from '../../data.js';
import { S } from '../../state.js';
import { NOT_DIAGNOSIS, RELATIONS, SURVEYS, SURVEY_GAP_NOTE, SURVEY_ORDER } from '../../surveys/content.js';
import { saveSurvey, summaryOf } from '../../surveys/engine.js';
import { LS, esc } from '../../util.js';
import { dialog, h } from '../dom.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { barsHtml, mdShort, progressBar } from '../widgets.js';

/* 설문: 한 화면에 한 문항. 문항 글은 surveys/content.js (원문 그대로). */
const visibleKinds = () => SURVEY_ORDER.filter(k => SURVEYS[k].enabled !== false && (!isTrainee() || SURVEYS[k].modes.includes('self')));
const whoText = sv => sv.modes.length === 2 ? '가족이 답하거나 아버지가 직접 답해요' : sv.who === 'family' ? '가족이 아버지에 대해 답해요' : '아버지가 직접 답해요';

export function sourceBlock(kinds) {
  return '<details class="src"><summary>출처와 이용 조건</summary>' + kinds.map(k => { const s = SURVEYS[k]; return '<p><b>' + esc(s.formal) + '</b><br>' + esc(s.source) + '<br>' + esc(s.license) + '</p>'; }).join('') + '</details>';
}

SCREENS.surveys = {
  html() {
    const fam = !isTrainee(), kinds = visibleKinds();
    let o = '<div class="stack"><h1 class="t-headline" id="sv-h">' + (fam ? '설문' : '마음·기억 설문 (선택)') + '</h1>' +
      '<p class="t-body muted">' + (fam ? '결과는 가족만 볼 수 있어요. 한 번에 한 문항씩 천천히 답해요.' : '하고 싶을 때만 해도 괜찮아요. 한 번에 한 문항씩 답해요.') + '</p><div class="rows">';
    kinds.forEach(k => {
      const sv = SURVEYS[k], sm = fam ? summaryOf(k) : null;
      o += '<button type="button" class="hub-item" id="sv-open-' + k + '" data-act="svopen" data-k="' + k + '"><span><strong>' + esc(sv.name) + '</strong><span class="sub">' + sv.items.length + '문항 · 약 ' + sv.minutes + '분 · ' + whoText(sv) + (sm ? ' · 마지막 ' + sm.last.date : '') + '</span></span><span class="t-title-m" aria-hidden="true">›</span></button>';
    });
    o += '</div>';
    if (fam) o += '<p class="t-small muted">' + SURVEY_GAP_NOTE + '</p><p class="t-small muted">' + NOT_DIAGNOSIS + '</p>' + sourceBlock(kinds);
    return o + '</div>';
  }
};

SCREENS.surveyIntro = {
  html() {
    const v = S.sv, sv = SURVEYS[v.kind], fam = !isTrainee();
    const both = fam && sv.modes.length > 1;
    let o = '<div class="stack"><h1 class="t-headline" id="svi-h">' + esc(sv.name) + '</h1><p class="t-small muted">' + esc(sv.formal) + ' · ' + sv.items.length + '문항 · 약 ' + sv.minutes + '분</p>';
    if (both) o += '<section class="card outlined"><h2 class="t-title-m" id="mode-h">누가 답하나요?</h2><div class="chips mt" role="radiogroup" aria-labelledby="mode-h">' +
      [['family', '가족이 대신 답해요'], ['self', '아버지가 직접 답해요']].map(m => '<button type="button" class="chip" id="mode-' + m[0] + '" role="radio" aria-checked="' + (v.mode === m[0]) + '" aria-pressed="' + (v.mode === m[0]) + '" data-act="svmode" data-v="' + m[0] + '">' + m[1] + '</button>').join('') + '</div></section>';
    if (fam && v.mode === 'family') o += '<section class="card outlined"><h2 class="t-title-m" id="rel-h">나는 ' + esc(traineeLabel()) + '의…</h2><div class="chips mt" role="radiogroup" aria-labelledby="rel-h">' +
      RELATIONS.map((r, i) => '<button type="button" class="chip" id="rel-' + i + '" role="radio" aria-checked="' + (v.relation === r) + '" aria-pressed="' + (v.relation === r) + '" data-act="svrel" data-v="' + esc(r) + '">' + r + '</button>').join('') + '</div></section>';
    if (fam && v.mode === 'self') o += '<section class="card tertiary"><p class="t-body">' + esc(traineeLabel()) + '에게 기기를 건네 주세요. 답이 끝나면 결과는 가족만 볼 수 있어요.</p></section>';
    o += '<section class="card elevated"><p class="t-body" style="white-space:pre-wrap">' + esc(sv.intro) + '</p></section>';
    if (fam) o += '<p class="t-small muted">' + NOT_DIAGNOSIS + '</p>' + sourceBlock([v.kind]);
    const need = fam && v.mode === 'family' && !v.relation;
    o += '<div class="cta"><button class="btn filled" id="btn-sv-start" type="button" data-act="svstart"' + (need ? ' disabled' : '') + '>' + (need ? '관계를 먼저 골라 주세요' : '시작하기') + '</button><button class="btn text" id="btn-sv-cancel" type="button" data-act="svcancel">그만두기</button></div></div>';
    return o;
  }
};

function crisisDialog() {
  const extra = h('div', { class: 'stack mt', id: 'crisis-box' },
    h('p', { class: 't-body' }, '자살예방상담전화 ', h('b', { class: 't-title', text: '109', style: 'user-select:all' }), ' (24시간)'),
    h('p', { class: 't-body' }, '정신건강위기상담 ', h('b', { class: 't-title', text: '1577-0199', style: 'user-select:all' })),
    h('p', { class: 't-small muted', text: '번호를 길게 누르면 복사할 수 있어요. 지금 위험하다고 느끼면 119에 바로 전화해 주세요.' }));
  dialog('혼자 힘들어하지 않으셔도 괜찮아요', '마음이 많이 힘들다면 전문 상담원이 언제든 들어 줘요. 아래 번호로 전화해 보세요.', [{ label: '확인했어요', kind: 'filled' }], null, extra);
}

SCREENS.surveyQ = {
  html() {
    const v = S.sv, sv = SURVEYS[v.kind], i = v.idx, total = sv.items.length + (sv.extra ? 1 : 0), isExtra = sv.extra && i === sv.items.length;
    const text = isExtra ? sv.extra.text : sv.items[i], scale = isExtra ? sv.extra.scale : sv.scale;
    const stem = sv.stem ? sv.stem.replace('{이름}', esc(traineeLabel())) : '';
    const cur = v.answers[i];
    return '<div class="stack"><div class="prog-label"><span>문항 ' + (i + 1) + ' / ' + total + '</span></div>' + progressBar(i / total * 100, '설문 진행') +
      (stem ? '<p class="t-body q-stem" id="q-stem">' + stem + '</p>' : '') +
      '<h1 class="q-text" id="q-text">' + (i + 1) + '. ' + esc(text) + '</h1>' +
      '<div class="choices" role="group" aria-label="답 고르기">' + scale.map((o, k) => '<button type="button" class="choice' + (cur === o.v ? ' right' : '') + '" id="ans-' + k + '" data-act="svans" data-v="' + o.v + '" aria-pressed="' + (cur === o.v) + '">' + esc(o.t) + '</button>').join('') + '</div>' +
      '<div class="cta">' + (i > 0 ? '<button class="btn outlined" id="btn-sv-prev" type="button" data-act="svprev">이전 문항</button>' : '') + '<button class="btn text" id="btn-sv-quit" type="button" data-act="svcancel">그만두기</button></div></div>';
  }
};

/* 답 고르기 → 다음 문항 (이벤트 위임에서 호출) */
export async function answerSurvey(val) {
  const v = S.sv, sv = SURVEYS[v.kind], i = v.idx, total = sv.items.length + (sv.extra ? 1 : 0);
  v.answers[i] = val;
  if (sv.selfHarmItem === i && val > 0) crisisDialog();     // PHQ-9 9번: 답한 사람에게 바로 안내
  if (i + 1 < total) { v.idx++; render(); return; }
  if (v.saving) return; v.saving = true;
  const rec = await saveSurvey(v.kind, v.answers, v.mode, v.mode === 'family' ? v.relation : (isTrainee() ? '본인' : traineeLabel()));
  v.saving = false;
  if (!rec) return;
  v.rec = rec; if (v.relation) LS.set('bw.relation', v.relation);
  go('surveyDone');
}

SCREENS.surveyDone = {
  html() {
    const v = S.sv, sv = SURVEYS[v.kind], rec = v.rec;
    const hideScore = v.mode === 'self' || isTrainee();
    if (hideScore) {
      return '<div class="stack"><h1 class="t-headline center" id="svd-h">오늘도 수고하셨어요</h1><section class="card primary center"><p class="t-title">답해 주셔서 고마워요.</p><p class="t-body mt">' +
        (isTrainee() ? '결과는 가족이 함께 살펴볼게요.' : esc(traineeLabel()) + '께 고맙다고 전해 주세요. 이제 기기를 돌려받으세요. 결과는 가족만 볼 수 있어요.') + '</p></section>' +
        '<div class="cta"><button class="btn filled" id="btn-svd-home" type="button" data-act="home">처음으로</button></div></div>';
    }
    const sm = summaryOf(v.kind);
    return '<div class="stack"><h1 class="t-headline" id="svd-h">저장했어요</h1><section class="card elevated"><p class="t-label">' + esc(sv.name) + '</p><p class="t-display" id="svd-score">' + rec.score + '<span class="t-title">' + esc(sv.unit.startsWith('점') ? '점' : sv.unit) + '</span></p>' +
      (sm && sm.band.text ? '<p class="mt"><span class="refband" id="svd-band">' + esc(sm.band.text) + '</span></p><p class="t-small mt">' + esc(sm.band.note) + '</p>' : '') +
      '<p class="t-small muted mt">' + NOT_DIAGNOSIS + ' 걱정되면 치매안심센터(1899-9988)나 병원과 상담해 보세요.</p></section>' +
      (sm && sm.trend ? '<p class="t-body" id="svd-trend">' + esc(sm.trend.text) + '</p>' : '') +
      '<div class="cta"><button class="btn filled" id="btn-svd-list" type="button" data-act="nav" data-to="surveys">설문 목록으로</button><button class="btn text" id="btn-svd-home" type="button" data-act="home">처음으로</button></div></div>';
  },
  bind() { ensureProfiles([S.sv.rec && S.sv.rec.answeredBy]); }
};

/* 가족 기록 화면의 "설문 결과" 구역 */
export function surveyReportHtml() {
  const kinds = SURVEY_ORDER.filter(k => summaryOf(k)); let o = '<section class="card outlined" aria-labelledby="svr-h" id="survey-report"><h2 class="t-title" id="svr-h">설문 결과</h2>';
  if (!kinds.length) o += '<p class="t-body muted mt">아직 설문 기록이 없어요.</p>';
  else {
    o += '<div class="rows mt">';
    ensureProfiles(kinds.map(k => summaryOf(k).last.answeredBy));
    kinds.forEach(k => {
      const sv = SURVEYS[k], sm = summaryOf(k), max = sv.max;
      o += '<div class="svrow" id="svr-' + k + '"><div class="rowline"><b>' + esc(sv.name) + '</b><span class="t-small muted">' + sm.last.date + '</span></div>' +
        '<p class="t-title">' + sm.last.score + '<span class="t-body"> / ' + max + '점</span></p>' +
        (sm.band.text ? '<p><span class="refband">' + esc(sm.band.text) + '</span></p>' : '') +
        (sm.trend ? '<p class="t-small">' + esc(sm.trend.text) + '</p>' : '') +
        (sm.history.length > 1 ? barsHtml(sm.history.map(r => ({ t: mdShort(r.date), v: r.score / max * 100, s: String(r.score) })), sv.name + ' 점수 변화') : '') +
        '<p class="t-small muted">' + esc(nameOf(sm.last.answeredBy)) + (sm.last.relation ? ' (' + esc(sm.last.relation) + ')' : '') + ' · ' + (sm.last.mode === 'self' ? '본인 답' : '가족 답') + ' · 문항판 v' + esc(sm.last.version) + '</p></div>';
    });
    o += '</div><p class="t-small muted mt">' + NOT_DIAGNOSIS + ' 기준은 연구에서 쓰인 참고값이에요.</p>' + sourceBlock(kinds);
  }
  o += '<div class="mt"><button class="btn tonal" id="btn-open-surveys" type="button" data-act="nav" data-to="surveys">설문 하러 가기</button></div></section>';
  return o;
}
