import { isAdmin } from '../../data.js';
import { esc } from '../../util.js';
import { RECORD_TABS, liHtml, listHtml, tabsHtml } from '../widgets.js';

/* 가족용 "점검·설문" 탭 (기록 화면의 둘째 탭): 한 가지씩 고르는 M3 목록. AI 리포트는 관리자에게만 보여요. */
export const HUB_ITEMS = [
  { to: 'surveys', id: 'hub-surveys', title: '설문', icon: 'list' },
  { act: 'svopen', k: 'iadl', id: 'hub-iadl', title: '일상생활 체크', icon: 'clip' },
  { to: 'clinical', id: 'hub-clinical', title: '병원 검사 기록', icon: 'hospital' },
  { to: 'assessView', id: 'hub-assess', title: '두뇌 건강 점검 결과', icon: 'trend' },
  { to: 'aiReports', id: 'hub-ai', title: 'AI 리포트', icon: 'sparkle', admin: true }
];
export function hubHtml() {
  const items = HUB_ITEMS.filter(i => !i.admin || isAdmin());
  return '<div class="stack">' + tabsHtml(RECORD_TABS, 'assess', '기록') + '<h1 class="t-headline dup" id="hub-h">점검과 기록</h1>' +
    listHtml(items.map(i => liHtml({ id: i.id, act: i.act || 'nav', to: i.to, data: i.k ? { k: i.k } : null, icon: i.icon, tint: true, title: esc(i.title) })), 'hub-list') + '</div>';
}
