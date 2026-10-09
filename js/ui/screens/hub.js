import { traineeLabel } from '../../data.js';
import { esc } from '../../util.js';

/* 가족용 "점검" 탭: 한 가지씩 고르는 목록 */
export const HUB_ITEMS = [
  { to: 'surveys', id: 'hub-surveys', title: '설문', sub: '가족이 답하는 설문, 아버지가 직접 답하는 설문 (결과는 가족만 봐요)' },
  { to: 'assessView', id: 'hub-assess', title: '두뇌 건강 점검 결과', sub: '한 달에 한 번, 같은 문제로 변화를 살펴봐요' }
];
export function hubHtml() {
  return '<div class="stack"><h1 class="t-headline" id="hub-h">점검과 기록</h1><p class="t-body muted">' + esc(traineeLabel()) + '의 변화를 살펴보는 곳이에요. 하나씩 골라 주세요.</p><div class="rows">' +
    HUB_ITEMS.map(i => '<button type="button" class="hub-item" id="' + i.id + '" data-act="nav" data-to="' + i.to + '"><span><strong>' + esc(i.title) + '</strong><span class="sub">' + esc(i.sub) + '</span></span><span class="t-title-m" aria-hidden="true">›</span></button>').join('') +
    '</div><p class="t-small muted">진단이 아니에요. 걱정되는 변화가 있으면 치매안심센터(1899-9988)나 병원과 상담하세요.</p></div>';
}
