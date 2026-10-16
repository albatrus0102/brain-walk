import { adminNames, courseStatus, focusId, isAdmin, isTrainee, selTrainee, setSelT, traineeLabel, trainees } from '../data.js';
import { followsAdmin } from '../display.js';
import { ic } from '../icons.js';
import { fmtClock } from '../logic.js';
import { synth } from '../sound.js';
import { S } from '../state.js';
import { ACTS } from './acts.js';
import { h } from './dom.js';
import { esc } from '../util.js';

/* 훈련하는 분 고르기 (M3 filter chips, 하나만 고름). 2명 이상일 때만 보여요. withAll: [모두] 를 맨 앞에 */
export function traineeChipsHtml(withAll) {
  const ids = trainees(); if (isTrainee() || ids.length < 2) return '';
  const cur = withAll ? selTrainee() : focusId(), opts = (withAll ? [['all', '모두']] : []).concat(ids.map(id => [id, traineeLabel(id)]));
  return '<div class="fchips" id="tsel" role="radiogroup" aria-label="훈련하는 분">' + opts.map((o, i) => '<button type="button" class="fchip" id="tsel-' + (o[0] === 'all' ? 'all' : i - (withAll ? 1 : 0)) + '" role="radio" aria-checked="' + (cur === o[0]) + '" data-act="selT" data-v="' + esc(o[0]) + '">' + (cur === o[0] ? ic('check') : '') + '<span>' + esc(o[1]) + '</span></button>').join('') + '</div>';
}
export function traineeChipsEl(withAll) { const w = document.createElement('div'); w.innerHTML = traineeChipsHtml(withAll); return w.firstElementChild; }
ACTS.selT = b => { setSelT(b.dataset.v); const nb = document.querySelector('#tsel [data-v="' + CSS.escape(b.dataset.v) + '"]'); if (nb) nb.focus(); };
export function switchRow(id, label, stateText, checked, act, disabled) {
  return '<div class="switch-row"><div><div class="t-title-m" id="' + id + '-label">' + label + '</div><div class="t-small muted" id="' + id + '-state">' + stateText + '</div></div>' +
    '<button class="switch" id="' + id + '" type="button" role="switch" aria-checked="' + checked + '" aria-labelledby="' + id + '-label" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '></button></div>';
}
const soundRow = () => switchRow('sound-switch', '소리 안내', synth ? (S.prefs.sound ? '켜져 있어요.' : '꺼져 있어요.') : '이 기기에서는 소리 안내를 쓸 수 없어요.', S.prefs.sound, 'sound', !synth);
const contrastRow = () => switchRow('contrast-switch', '고대비 모드', S.prefs.contrast ? '켜져 있어요.' : '꺼져 있어요.', S.prefs.contrast, 'contrast', false);
export const SIZE_OPTS = [['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게'], ['max', '최대']];
export const FONT_OPTS = [['pretendard', '프리텐다드'], ['noto', '노토 산스'], ['system', '휴대폰 기본']];
/* 라디오 묶음 (M3 segmented button). opts = [[값, 글자]], cur = 지금 값, act = data-act, idp = 버튼 id 앞부분, extra = 버튼에 붙일 속성 */
export function segHtml(label, labelId, opts, cur, act, idp, disabled, extra) {
  return '<div class="t-title-m" id="' + labelId + '">' + label + '</div><div class="seg mt' + (opts.length >= 3 ? (opts.some(o => String(o[1]).length >= 4) ? ' many long' : ' many') : '') + '" role="radiogroup" aria-labelledby="' + labelId + '">' +
    opts.map(o => '<button type="button" id="' + idp + '-' + o[0] + '" role="radio" aria-checked="' + (String(cur) === String(o[0])) + '" data-act="' + act + '" data-v="' + o[0] + '"' + (disabled ? ' disabled' : '') + (extra || '') + '>' + (String(cur) === String(o[0]) ? ic('check') : '') + o[1] + '</button>').join('') + '</div>';
}
/* 이 기기에서만 쓰는 보기 설정 (글꼴·크기·소리·고대비). 훈련하는 분 기기에서 관리자가 정해 두었으면 그 안내만 보여요. */
export const prefsCard = () => followsAdmin()
  ? '<section class="card outlined" aria-labelledby="set-h" id="prefs-remote"><h2 class="t-title" id="set-h">화면과 소리</h2></section>'
  : '<section class="card outlined" aria-labelledby="set-h"><h2 class="t-title" id="set-h">보기 설정</h2>' +
    '<div class="mt">' + segHtml('글꼴', 'font-label', FONT_OPTS, S.prefs.font, 'font', 'font') + '</div>' +
    '<div class="mt">' + segHtml('글자 크기', 'size-label', SIZE_OPTS, S.prefs.size, 'size', 'size') + '</div><div class="mt">' + soundRow() + '</div><div class="mt">' + contrastRow() + '</div></section>';
/* 펼치고 접는 카드 (M3 expandable card). summary = 지금 값을 한 줄로. 펼친 상태는 화면을 다시 그려도 유지돼요. */
export function xpCard(key, title, summary, bodyHtml, defaultOpen) {
  const open = S.xpOpen[key] === undefined ? !!defaultOpen : S.xpOpen[key];
  return '<details class="card outlined xp" id="xpc-' + key + '" data-xp="' + key + '"' + (open ? ' open' : '') + '><summary class="xp-sum" id="xp-' + key + '"><span class="xp-t"><h2 class="t-title">' + title + '</h2>' +
    (summary != null ? '<span class="t-small muted xp-v" id="xpv-' + key + '">' + summary + '</span>' : '') + '</span>' + ic('expand') + '</summary><div class="xp-body stack">' + bodyHtml + '</div></details>';
}
/* 관리자가 아니면: 값은 보이되 바꿀 수 없고, 이유를 한 줄로 알려요 */
export const adminOnlyNote = () => isAdmin() ? '' : '';
export const levelDots = l => '<span class="lv" role="img" aria-label="' + l + '단계">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= l ? 'f' : '') + '"></i>').join('') + '</span>';
export const slotText = (root, name, text) => root.querySelectorAll('[data-slot="' + name + '"]').forEach(e => { e.textContent = text; });
export function statusChip() {
  const cs = courseStatus();
  return h('span', { class: 'chip-status' + (cs.done ? ' done' : ''), id: 'today-status' }, cs.done ? '오늘 훈련 완료 ✓ (' + fmtClock(cs.ts) + ')' : '오늘 아직 훈련 전이에요');
}
/* 점수 변화 막대 (가족 기록): items = [{ t: '9/8', v: 0~100, s: '24점' }]. 막대마다 값과 날짜를 적어요. */
export function barsHtml(items, label) {
  return '<div class="hbar" role="img" aria-label="' + esc(label) + ': ' + items.map(i => i.t + ' ' + i.s).join(', ') + '">' +
    items.map((i, k) => '<div class="col' + (k === items.length - 1 ? ' last' : '') + '"><span class="v">' + esc(i.s) + '</span><i style="--h:' + Math.round(Math.max(6, Math.min(100, Number(i.v) || 0)) * 0.9) + 'px"></i><span>' + esc(i.t) + '</span></div>').join('') + '</div>';
}
export const mdShort = date => String(date).slice(5).replace('-', '/');
export function progressBar(pct, label) { return '<div class="progress" role="progressbar" aria-label="' + label + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + pct + '%"></span></div>'; }

/* ================= 가족·관리자(촘촘한) 화면의 M3 조각들 ================= */
/* M3 list item (HTML 문자열): o = { id, act, to, data:{}, icon, emoji, title, sub, value, chevron, cls, trail(HTML) }. act/to 가 있으면 누르는 줄(button) */
export function liHtml(o) {
  const btn = !!(o.act || o.to), lead = o.icon ? '<span class="lead' + (o.tint ? ' tint' : '') + '">' + ic(o.icon) + '</span>' : o.emoji ? '<span class="lead e" aria-hidden="true">' + o.emoji + '</span>' : '';
  const attrs = (o.id ? ' id="' + o.id + '"' : '') + (btn ? ' data-act="' + (o.act || 'nav') + '"' : '') + (o.to ? ' data-to="' + o.to + '"' : '') + Object.keys(o.data || {}).map(k => ' data-' + k + '="' + esc(o.data[k]) + '"').join('') + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '');
  const trail = (o.value != null && o.value !== '' ? '<b>' + o.value + '</b>' : '') + (o.trail || '') + (o.chevron === false || (!btn && !o.chevron) ? '' : ic('chevron'));
  return '<' + (btn ? 'button type="button"' : 'div') + ' class="li' + (o.cls ? ' ' + o.cls : '') + '"' + attrs + '>' + lead +
    '<span class="body"><span class="hl">' + o.title + '</span>' + (o.sub ? '<span class="sl"' + (o.subId ? ' id="' + o.subId + '"' : '') + '>' + o.sub + '</span>' : '') + '</span>' +
    (trail ? '<span class="trail">' + trail + '</span>' : '') + '</' + (btn ? 'button' : 'div') + '>';
}
/* DOM 버전 (설정처럼 onclick 이 필요한 줄) */
export function liEl(o, onclick) {
  const tmp = h('div'); tmp.innerHTML = liHtml(Object.assign({ act: onclick ? 'noop' : undefined }, o));
  const el = tmp.firstChild; if (onclick) { el.removeAttribute('data-act'); el.addEventListener('click', onclick); }
  return el;
}
export const subheadHtml = (text, id) => '<h2 class="subhead"' + (id ? ' id="' + id + '"' : '') + '>' + text + '</h2>';
export const listHtml = (rows, id, cls) => '<div class="list' + (cls ? ' ' + cls : '') + '"' + (id ? ' id="' + id + '"' : '') + '>' + rows.join('') + '</div>';
/* M3 탭 (기록 화면: 훈련 기록 / 점검) */
export function tabsHtml(tabs, cur, label) {
  return '<div class="tabs" role="tablist" aria-label="' + esc(label || '') + '">' + tabs.map(t => '<button type="button" role="tab" class="tab" id="tab-' + t[0] + '" aria-selected="' + (cur === t[0]) + '" data-act="nav" data-to="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
}
export const RECORD_TABS = [['family', '훈련 기록'], ['assess', '점검·설문']];
/* 요약 타일: o = { id, icon, label, value(HTML), sub(HTML), cls, to/act, num } */
export function tileHtml(o) {
  const btn = !!(o.to || o.act);
  return '<' + (btn ? 'button type="button"' : 'div') + ' class="tile' + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + (btn ? ' data-act="' + (o.act || 'nav') + '"' : '') + (o.to ? ' data-to="' + o.to + '"' : '') + '>' +
    '<span class="tl">' + (o.icon ? ic(o.icon) : '') + o.label + '</span><span class="tv' + (o.num ? ' num' : '') + '"' + (o.valueId ? ' id="' + o.valueId + '"' : '') + '>' + o.value + '</span>' + (o.sub != null ? '<span class="ts"' + (o.subId ? ' id="' + o.subId + '"' : '') + '>' + o.sub + '</span>' : '') + (o.extra || '') + '</' + (btn ? 'button' : 'div') + '>';
}
void adminNames;
