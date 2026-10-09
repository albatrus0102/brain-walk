import { S } from '../../state.js';
import { esc } from '../../util.js';

/* 점검 과제 상세 (가족용): 규준·기준점 없이 "처음 기록(기준선)"과만 비교해요. */
const INFO = {
  t_words: { name: '낱말 기억하기 (바로)', show: m => '바로 ' + (m.imm ?? '-') + '개 / 10' },
  t_delayed: { name: '낱말 기억하기 (조금 뒤)', show: m => (m.skipped ? '건너뜀' : (m.del ?? '-') + '개 / 10') },
  t_trails_a: { name: '점 잇기 (숫자)', show: m => (m.sec ?? '-') + '초' + (m.err ? ' · 잘못 누름 ' + m.err : '') },
  t_trails_b: { name: '점 잇기 (숫자와 글자)', show: m => (m.sec ?? '-') + '초' + (m.err ? ' · 잘못 누름 ' + m.err : '') },
  t_digits: { name: '숫자 기억하기', show: m => '앞으로 ' + (m.fwd ?? '-') + '개 · 거꾸로 ' + (m.bwd ?? '-') + '개' },
  t_reaction: { name: '반응 속도', show: m => (m.ms ?? '-') + '밀리초' + (m.early ? ' · 먼저 누름 ' + m.early : '') },
  t_stroop: { name: '색 고르기', show: m => '정답 ' + (m.acc ?? '-') + '% · ' + (m.ms ?? '-') + '밀리초' },
  t_fluency: { name: '동물 이름 대기 (1분)', show: m => (m.n ?? '-') + '마리' }
};
const runs = () => (S.taskRuns || []).filter(r => r && r.tasks && typeof r.ts === 'number').sort((a, b) => a.ts - b.ts);

export function taskReportHtml() {
  const rs = runs();
  let o = '<section class="card outlined" aria-labelledby="tk-h" id="task-report"><h2 class="t-title" id="tk-h">점검 과제 상세</h2><p class="t-small muted">정해진 기준점은 없어요. 처음 점검(기준선)과 비교한 변화만 보여요.</p>';
  if (!rs.length) return o + '<p class="t-body muted mt">아직 과제 기록이 없어요. 두뇌 건강 점검의 2부분을 마치면 나타나요.</p></section>';
  o += '<div class="rows mt">';
  Object.keys(INFO).forEach(id => {
    const hist = rs.filter(r => r.tasks[id]).map(r => ({ date: r.date, sc: Number(r.tasks[id].score) || 0, m: r.tasks[id].m || {} }));
    if (!hist.length) return;
    const first = hist[0], last = hist[hist.length - 1], d = last.sc - first.sc;
    const trend = hist.length < 2 ? '첫 기록이에요. 다음 점검부터 비교해요.' : Math.abs(d) < 5 ? '처음과 비슷해요' : d > 0 ? '처음보다 점수가 높아요 (+' + d + ')' : '처음보다 점수가 낮아요 (' + d + ')';
    o += '<div id="tk-' + id + '"><div class="rowline"><b>' + esc(INFO[id].name) + '</b><span class="t-small muted">' + last.date + '</span></div><p class="t-body">' + esc(INFO[id].show(last.m)) + '</p>' +
      (hist.length > 1 ? '<p class="t-small muted">처음: ' + esc(INFO[id].show(first.m)) + '</p>' : '') + '<p class="t-small">' + trend + '</p>' +
      (hist.length > 1 ? '<div class="hbar" role="img" aria-label="점수 변화">' + hist.slice(-6).map((h, i, a) => '<i class="' + (i === a.length - 1 ? 'last' : '') + '" style="height:' + Math.max(6, h.sc) + '%"></i>').join('') + '</div>' : '') + '</div>';
  });
  return o + '</div><p class="t-small muted mt">점수 환산은 이 앱 자체 눈금이며 규준이 아니에요. 진단이 아니에요.</p></section>';
}
