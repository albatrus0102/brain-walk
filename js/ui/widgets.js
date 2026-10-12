import { adminNames, courseStatus, isAdmin } from '../data.js';
import { followsAdmin } from '../display.js';
import { ic } from '../icons.js';
import { fmtClock } from '../logic.js';
import { synth } from '../sound.js';
import { S } from '../state.js';
import { h } from './dom.js';
import { esc } from '../util.js';

export function switchRow(id, label, stateText, checked, act, disabled) {
  return '<div class="switch-row"><div><div class="t-title-m" id="' + id + '-label">' + label + '</div><div class="t-small muted" id="' + id + '-state">' + stateText + '</div></div>' +
    '<button class="switch" id="' + id + '" type="button" role="switch" aria-checked="' + checked + '" aria-labelledby="' + id + '-label" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '></button></div>';
}
const soundRow = () => switchRow('sound-switch', '소리 안내', synth ? (S.prefs.sound ? '켜져 있어요. 문제를 읽어 드려요.' : '꺼져 있어요.') : '이 기기에서는 소리 안내를 쓸 수 없어요.', S.prefs.sound, 'sound', !synth);
const contrastRow = () => switchRow('contrast-switch', '고대비 모드', S.prefs.contrast ? '켜져 있어요. 글자와 테두리가 더 진해요.' : '꺼져 있어요.', S.prefs.contrast, 'contrast', false);
export const SIZE_OPTS = [['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게'], ['max', '최대']];
export const FONT_OPTS = [['pretendard', '프리텐다드'], ['noto', '노토 산스'], ['system', '휴대폰 기본']];
/* 라디오 묶음 (M3 segmented button). opts = [[값, 글자]], cur = 지금 값, act = data-act, idp = 버튼 id 앞부분, extra = 버튼에 붙일 속성 */
export function segHtml(label, labelId, opts, cur, act, idp, disabled, extra) {
  return '<div class="t-title-m" id="' + labelId + '">' + label + '</div><div class="seg mt' + (opts.length >= 3 ? (opts.some(o => String(o[1]).length >= 4) ? ' many long' : ' many') : '') + '" role="radiogroup" aria-labelledby="' + labelId + '">' +
    opts.map(o => '<button type="button" id="' + idp + '-' + o[0] + '" role="radio" aria-checked="' + (String(cur) === String(o[0])) + '" data-act="' + act + '" data-v="' + o[0] + '"' + (disabled ? ' disabled' : '') + (extra || '') + '>' + (String(cur) === String(o[0]) ? ic('check') : '') + o[1] + '</button>').join('') + '</div>';
}
/* 이 기기에서만 쓰는 보기 설정 (글꼴·크기·소리·고대비). 훈련하는 분 기기에서 관리자가 정해 두었으면 그 안내만 보여요. */
export const prefsCard = () => followsAdmin()
  ? '<section class="card outlined" aria-labelledby="set-h" id="prefs-remote"><h2 class="t-title" id="set-h">화면과 소리</h2><p class="t-body mt">글자 크기와 소리 안내는 가족(관리자)이 정해요. 바꾸려면 가족에게 말씀해 주세요.</p></section>'
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
export const adminOnlyNote = () => isAdmin() ? '' : '<p class="t-body muted adminonly" id="admin-note">관리자만 바꿀 수 있어요. 관리자: ' + esc(adminNames().join(', ') || '방 주인') + '</p>';
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
