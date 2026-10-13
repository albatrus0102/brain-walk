import { isAdmin, traineeLabel, writeErrMsg } from '../../data.js';
import { DISPLAY_DEFAULTS, normalizeDisplay, presenceState } from '../../program.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { saveDisplay } from '../../store/membership.js';
import { ACTS } from '../acts.js';
import { toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { render } from '../shell.js';
import { FONT_OPTS, SIZE_OPTS, adminOnlyNote, segHtml, switchRow } from '../widgets.js';
import { $, esc, iga } from '../../util.js';

/* 훈련하는 분 화면 설정 (DESIGN.md §6.2): 관리자가 정하면 그 휴대폰이 바로(누르지 않아도) 바뀌어요. */
const SCALE = { normal: 1, large: 1.2, xlarge: 1.4, max: 1.6 };
const STACKS = {
  pretendard: "'Pretendard Variable',Pretendard,'Noto Sans KR',system-ui,'Apple SD Gothic Neo',sans-serif",
  noto: "'Noto Sans KR',system-ui,'Apple SD Gothic Neo',sans-serif",
  system: 'system-ui,"Apple SD Gothic Neo",sans-serif'
};
const RATES = [[0.75, '천천히'], [0.9, '보통'], [1.05, '조금 빠르게']];
const draft = () => S.dispDraft || (S.dispDraft = normalizeDisplay(S.displayRemote || DISPLAY_DEFAULTS));
const dirty = () => !S.displayRemote || JSON.stringify(normalizeDisplay(S.displayRemote)) !== JSON.stringify(draft());
const nearRate = r => RATES.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a))[0];

function previewHtml(d) {
  const sc = SCALE[d.size] || 1, body = Math.round(22 * sc), big = Math.round(28 * sc), hi = d.contrast;
  const bd = hi ? '3px solid var(--md-sys-color-on-surface)' : '1px solid var(--md-sys-color-outline-variant)';
  return '<div id="disp-preview" aria-hidden="true" data-font="' + d.font + '" data-size="' + d.size + '" style="font-family:' + STACKS[d.font] + ';font-size:' + body + 'px;line-height:1.45;padding:16px;border-radius:var(--md-sys-shape-corner-large);background:var(--md-sys-color-surface-container-lowest);color:var(--md-sys-color-on-surface);border:' + bd + ';' + (hi ? 'font-weight:700;' : '') + '">' +
    '<div style="color:var(--md-sys-color-on-surface-variant)">좋은 아침이에요</div><div style="font-size:' + Math.round(32 * sc) + 'px;font-weight:700;line-height:1.25">10월 12일 월요일</div>' +
    '<div style="margin-top:12px;padding:16px;border-radius:var(--md-sys-shape-corner-extra-large);text-align:center;font-size:' + big + 'px;font-weight:700;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);' + (hi ? 'border:3px solid var(--md-sys-color-on-surface);' : '') + '">오늘 훈련 시작</div></div>';
}
SCREENS.adminDisplay = {
  html() {
    const d = draft(), ro = !isAdmin(), L = esc(traineeLabel());
    const lead = '' + (S.displayRemote ? '' : '');
    return '<div class="stack"><h1 class="t-headline" id="dd-h">' + L + ' 화면</h1>' + lead + adminOnlyNote() +
      '<section class="card elevated" aria-label="미리보기"><div class="t-label muted">미리보기</div><div class="mt">' + previewHtml(d) + '</div></section>' +
      '<section class="card outlined stack" aria-label="화면 설정">' +
      '<div>' + segHtml('글꼴', 'dd-font-l', FONT_OPTS.map(o => o[0] === 'pretendard' ? [o[0], '프리텐다드 (추천)'] : o), d.font, 'dd-font', 'dd-font', ro) + '</div>' +
      '<div>' + segHtml('글자 크기', 'dd-size-l', SIZE_OPTS, d.size, 'dd-size', 'dd-size', ro) + '</div>' +
      switchRow('dd-contrast', '고대비', '', d.contrast, 'dd-contrast', ro) +
      switchRow('dd-voice', '소리 안내', '', d.voice, 'dd-voice', ro) +
      (d.voice ? '<div>' + segHtml('말 빠르기', 'dd-rate-l', RATES, nearRate(d.rate), 'dd-rate', 'dd-rate', ro) + '<div class="mt"><button class="btn tonal" id="dd-hear" type="button" data-act="dd-hear">들어 보기</button></div></div>' : '') +
      '</section>' +
      '' +
      (ro ? '' : '<div class="cta"><button class="btn filled" id="dd-save" type="button" data-act="dd-save"' + (dirty() ? '' : ' disabled') + '>저장</button><button class="btn text" id="dd-revert" type="button" data-act="dd-revert">되돌리기</button></div>') + '</div>';
  }
};
const keep = id => { const b = document.getElementById(id); if (b) b.focus(); };
function set(patch, focusId) { if (!isAdmin()) return; Object.assign(draft(), patch); render(true); keep(focusId); }
ACTS['dd-font'] = b => set({ font: b.dataset.v }, 'dd-font-' + b.dataset.v);
ACTS['dd-size'] = b => set({ size: b.dataset.v }, 'dd-size-' + b.dataset.v);
ACTS['dd-contrast'] = () => set({ contrast: !draft().contrast }, 'dd-contrast');
ACTS['dd-voice'] = () => set({ voice: !draft().voice }, 'dd-voice');
ACTS['dd-rate'] = b => set({ rate: Number(b.dataset.v) }, 'dd-rate-' + b.dataset.v);
ACTS['dd-hear'] = () => say('오늘의 두뇌 산책을 시작해 볼까요?', true, draft().rate);
ACTS['dd-revert'] = () => { S.dispDraft = null; render(true); };
ACTS['dd-save'] = async () => {
  if (!isAdmin()) return;
  try {
    await saveDisplay(draft(), S.myId || 'local');
    S.dispDraft = null; render(true);
  } catch (e) { toast(writeErrMsg(e, true)); }
};
