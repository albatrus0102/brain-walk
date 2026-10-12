'use strict';
/**
 * "간단판" (template) report: built by the server from the aggregate with fixed sentences,
 * used when the routine is late, fails, or its report is rejected. Same bw.report.v1 shape,
 * passes the same checkReport, filled the same way.
 */
const NAME = { composite: '전체', memory: '기억', attention: '주의', executive: '계산·순서', language: '언어', visuospatial: '모양·공간', speed: '반응 속도', participation: '참여', anchor: '같은 문제 다시 풀기' };
const LIGHT = { green: '평소 범위 안이에요.', blue: '평소보다 좋은 쪽이에요. 연습 효과일 수 있어요.', yellow: '경계선을 넘어 지켜보는 중이에요.', orange: '몇 주째 이어진 변화예요.', gray: '아직 판단하기 일러요.' };
const MAIN = { composite: ['comp_ma4', 'comp_base'], memory: ['mem_ma4', 'mem_base'], attention: ['att_ma4', 'att_base'], executive: ['exe_ma4', 'exe_base'], language: ['lan_ma4', 'lan_base'], visuospatial: ['vis_ma4', 'vis_base'] };
const GLOSS = {
  baseline: ['처음 네 주 동안의 평소 실력이에요.', '체중계의 평소 몸무게'],
  band: ['이 범위 안의 차이는 재는 도구의 흔들림일 수 있어요.', '체중계가 조금씩 흔들리는 것'],
  mdc: ['측정 오차보다 큰 변화인지 가르는 선이에요.', '흔들림과 진짜 변화를 가르는 선'],
  rt: ['문제를 보고 답할 때까지 걸린 시간이에요.', '같은 길을 걷는 시간'],
  ewma: ['최근 주에 조금 더 무게를 둔 평균이에요.', '기온 대신 요즘 날씨를 보는 것'],
  slope: ['한 달에 얼마나 움직이는지예요.', '언덕의 경사'],
  cusum: ['작은 하락이 계속 쌓이는지 세는 방법이에요.', '조금씩 새는 물통'],
  anchor: ['같은 문제를 다시 풀었을 때를 비교해요.', '같은 산을 다시 오르기'],
  rci: ['차이가 측정 흔들림보다 몇 배 큰지예요.', '잡음 속 목소리가 얼마나 또렷한지'],
  practice: ['같은 문제를 다시 보면 익숙해서 오르는 몫이에요.', '같은 시험지를 두 번 푸는 것'],
  iiv: ['답하는 속도가 얼마나 고르지 않은지예요. 참고만 해요.', '걸음이 고른지'],
  ies: ['속도와 정확도를 합친 점수예요. 참고만 해요.', '연비'],
  participation: ['계획한 날 중 훈련한 날의 비율이에요.', '출석부'],
};
const CONF = { illness: '감기·몸살', sleep: '잠 부족', med_change: '약 변경', hospital: '입원·수술', event: '가족 행사', travel: '이사·여행', device: '기기 변경', mood: '기분 저하', other: '기타 메모' };

function templateReport(agg, jobId = 'scheduled') {
  const N = agg.numbers || {};
  const has = (k) => N[k] != null;
  const domains = agg.domains.map((d) => {
    const main = MAIN[d.domain];
    let s = `${NAME[d.domain] || d.domain}: `;
    if (main && has(main[0]) && has(main[1])) s += `{{${main[0]}}} (평소 {{${main[1]}}}). `;
    else if (d.domain === 'speed' && has('spd_change')) s += '평소보다 {{spd_change}}. ';
    else if (d.domain === 'participation' && has('part_days14') && has('part_planned14')) s += '최근 계획한 {{part_planned14}} 중 {{part_days14}} 훈련. ';
    s += LIGHT[d.light] || LIGHT.gray;
    return { domain: d.domain, light: d.light, sentence: s };
  });
  const orange = agg.signals.filter((s) => s.level === 'orange').length, yellow = agg.signals.filter((s) => s.level === 'yellow').length;
  const headline = agg.mode === 'alert' ? '주의 신호가 있어요. 아래 설명을 확인해 주세요.'
    : orange ? '몇 주째 이어진 변화가 있어 살펴볼 만해요.' : yellow ? '대부분 평소 범위이고, 지켜보는 항목이 있어요.' : '기록의 흐름이 평소 범위 안이에요.';
  const summary = [
    agg.phase === 'monitoring' ? '처음 네 주의 평소 실력과 비교한 흐름이에요.' : '아직 평소 실력을 재는 기간이라 판단은 뒤로 미뤄요.',
    orange ? '의사와 이야기해 볼 만해요. 급한 상황을 뜻하지는 않아요.' : '하루 숫자는 원래 흔들려서, 몇 주의 흐름을 함께 지켜봐요.',
  ];
  const confounders = agg.confounders.slice(0, 5).map((c) => `${CONF[c.code] || '메모'} {{${c.from}}}${c.to ? `~{{${c.to}}}` : ''}`);
  const doctorPoints = orange
    ? [{ text: '이 리포트의 그래프를 보여 드리고, 최근 잠·약·기분의 변화를 함께 이야기해 보세요. 의사와 상담해 보시길 권해요.', evidence: agg.signals.filter((s) => s.level === 'orange').flatMap((s) => s.evidence).slice(0, 6) }]
    : [{ text: '지금은 급하게 상의할 일은 없어요. 정기 진료 때 흐름을 함께 보여 드리면 충분해요.', evidence: [] }];
  const glossary = agg.glossaryKeys.filter((k) => GLOSS[k]).slice(0, 8).map((k) => ({ key: k, plain: GLOSS[k][0], analogy: GLOSS[k][1] }));
  const rep = {
    schema: 'bw.report.v1', jobId, basedOn: agg.id, mode: agg.mode, headline, summary, domains, notable: [], confounders, doctorPoints, glossary, confidence: agg.confidence,
  };
  if (agg.mode === 'weekly') {
    rep.trend = [has('comp_slope') ? '최근 몇 주의 전체 흐름은 {{comp_slope}}예요.' : '흐름을 말하기에는 아직 주가 모자라요.', '좋아진 것처럼 보여도 연습 효과일 수 있어서 지켜봐요.'];
    if (agg.anchor) rep.anchor = ['같은 문제를 다시 푼 결과는 위의 같은 문제 다시 풀기 줄에 있어요.', '문항 하나보다 묶음 전체의 흐름으로 판단해요.'];
  }
  return rep;
}

module.exports = { templateReport, NAME };
