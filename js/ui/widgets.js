import { courseStatus } from '../data.js';
import { ic } from '../icons.js';
import { fmtClock } from '../logic.js';
import { synth } from '../sound.js';
import { S } from '../state.js';
import { h } from './dom.js';

export function switchRow(id, label, stateText, checked, act, disabled) {
  return '<div class="switch-row"><div><div class="t-title-m" id="' + id + '-label">' + label + '</div><div class="t-small muted" id="' + id + '-state">' + stateText + '</div></div>' +
    '<button class="switch" id="' + id + '" type="button" role="switch" aria-checked="' + checked + '" aria-labelledby="' + id + '-label" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '></button></div>';
}
const soundRow = () => switchRow('sound-switch', '소리 안내', synth ? (S.prefs.sound ? '켜져 있어요. 문제를 읽어 드려요.' : '꺼져 있어요.') : '이 기기에서는 소리 안내를 쓸 수 없어요.', S.prefs.sound, 'sound', !synth);
const contrastRow = () => switchRow('contrast-switch', '고대비 모드', S.prefs.contrast ? '켜져 있어요. 글자와 테두리가 더 진해요.' : '꺼져 있어요.', S.prefs.contrast, 'contrast', false);
export const levelDots = l => '<span class="lv" role="img" aria-label="' + l + '단계">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= l ? 'f' : '') + '"></i>').join('') + '</span>';
export const prefsCard = () => '<section class="card outlined" aria-labelledby="set-h"><h2 class="t-title" id="set-h">보기 설정</h2>' +
  '<div class="mt"><div class="t-title-m" id="size-label">글자 크기</div><div class="seg mt" role="radiogroup" aria-labelledby="size-label">' +
  [['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']].map(s => '<button type="button" id="size-' + s[0] + '" role="radio" aria-checked="' + (S.prefs.size === s[0]) + '" data-act="size" data-v="' + s[0] + '">' + (S.prefs.size === s[0] ? ic('check') : '') + s[1] + '</button>').join('') +
  '</div></div><div class="mt">' + soundRow() + '</div><div class="mt">' + contrastRow() + '</div></section>';
export const slotText = (root, name, text) => root.querySelectorAll('[data-slot="' + name + '"]').forEach(e => { e.textContent = text; });
export function statusChip() {
  const cs = courseStatus();
  return h('span', { class: 'chip-status' + (cs.done ? ' done' : ''), id: 'today-status' }, cs.done ? '오늘 훈련 완료 ✓ (' + fmtClock(cs.ts) + ')' : '오늘 아직 훈련 전이에요');
}
export function progressBar(pct, label) { return '<div class="progress" role="progressbar" aria-label="' + label + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + pct + '%"></span></div>'; }
