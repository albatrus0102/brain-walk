import { isTrainee } from './data.js';
import { effectiveDisplay } from './program.js';
import { effectiveSound, speechRate, stopSpeech } from './sound.js';
import { S } from './state.js';
import { render } from './ui/shell.js';

/* ================= 화면 설정 적용 (DESIGN.md §4.5) =================
 * 훈련하는 분의 기기: 관리자가 정한 state/display 가 있으면 그 값을 바로(누르지 않아도) 적용해요.
 * 그 밖의 기기(가족, 체험 모드): 이 기기에서 고른 글꼴·크기·소리·고대비.
 * 모든 글자는 <html data-font data-size data-contrast> 로 바뀌는 M3 타이포 토큰을 따라가요. */
export { effectiveSound, speechRate };
export const localDisplay = () => ({ font: S.prefs.font, size: S.prefs.size, contrast: S.prefs.contrast, voice: S.prefs.sound, rate: 0.9 });
/* 이 기기가 관리자 설정을 따르고 있는지 (훈련하는 분 기기이고 설정 문서가 있을 때) */
export const followsAdmin = () => !!(S.displayRemote && isTrainee());

/* 가족·관리자 화면은 촘촘한(M3 기본 밀도) 모드, 훈련하는 분 화면과 게임 흐름·가입 화면은 큰 글자 그대로예요 (styles/compact.css) */
const LARGE_SCREENS = ['game', 'result', 'courseBreak', 'checkIntro', 'checkin', 'courseDone', 'assessStep', 'assessBreak', 'assessDone', 'clock', 'clockDone', 'setup', 'ob-loading'];
export const isCompact = () => !isTrainee() && !LARGE_SCREENS.includes(S.screen) && String(S.screen).indexOf('ob-') !== 0;
export function syncDensity() {
  const r = document.documentElement, want = isCompact() ? 'compact' : 'large';
  if (r.getAttribute('data-ui') !== want) r.setAttribute('data-ui', want);
}

let lastKey = '';
export function applyDisplay(opts) {
  const eff = effectiveDisplay(S.displayRemote, localDisplay(), isTrainee()), r = document.documentElement;
  S.eff = eff;
  r.setAttribute('data-size', eff.size); r.setAttribute('data-font', eff.font);
  syncDensity();
  if (eff.contrast) r.setAttribute('data-contrast', 'high'); else r.removeAttribute('data-contrast');
  const key = JSON.stringify(eff), changed = key !== lastKey; lastKey = key;
  if (!eff.voice) stopSpeech();
  // 게임 중에는 글꼴·크기만 바로 바뀌고(CSS), 문제 화면을 다시 그리지는 않아요
  if (changed && !(opts && opts.noRender) && S.screen !== 'game' && document.getElementById('screen')) render(true);
}
