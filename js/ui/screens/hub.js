import { esc } from '../../util.js';

/* 가족용 "점검" 탭: 한 가지씩 고르는 목록 */
export const HUB_ITEMS = [
  { to: 'surveys', id: 'hub-surveys', title: '설문', sub: '가족이 답하는 설문, 아버지가 직접 답하는 설문 (결과는 가족만 봐요)' },
  { act: 'svopen', k: 'iadl', id: 'hub-iadl', title: '일상생활 체크', sub: '약, 돈 계산, 전화, 길 찾기… 가족이 8문항으로 답해요' },
  { to: 'clocks', id: 'hub-clocks', title: '시계 그림', sub: '아버지가 그린 시계를 나란히 보고, 그리기를 부탁해요' },
  { to: 'clinical', id: 'hub-clinical', title: '병원 검사 기록', sub: '병원에서 받은 검사 점수를 기록해요' },
  { to: 'assessView', id: 'hub-assess', title: '두뇌 건강 점검 결과', sub: '한 달에 한 번, 같은 문제로 변화를 살펴봐요' },
  { to: 'aiReports', id: 'hub-ai', title: 'AI 리포트', sub: '기록의 흐름을 쉬운 말로 정리한 리포트 (관리자만 봐요)' }
];
export function hubHtml() {
  return '<div class="stack"><h1 class="t-headline" id="hub-h">점검과 기록</h1><div class="rows">' +
    HUB_ITEMS.map(i => '<button type="button" class="hub-item" id="' + i.id + '" data-act="' + (i.act || 'nav') + '"' + (i.k ? ' data-k="' + i.k + '"' : ' data-to="' + i.to + '"') + '><span><strong>' + esc(i.title) + '</strong></span><span class="t-title-m" aria-hidden="true">›</span></button>').join('') +
    '</div></div>';
}
