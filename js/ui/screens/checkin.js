import { FACES, tipHtml } from '../../records.js';
import { S } from '../../state.js';
import { SCREENS } from '../registry.js';

SCREENS.checkin = {
  html() {
    const c = S.ci, sleeps = [[4, '4시간 이하'], [5, '5시간'], [6, '6시간'], [7, '7시간'], [8, '8시간'], [9, '9시간 이상']];
    const yn = (k, label) => '<fieldset class="card outlined" style="border:2px solid var(--md-sys-color-outline-variant)"><legend class="t-title-m" style="padding:0 8px">' + label + '</legend><div class="yn mt">' +
      [[true, '예'], [false, '아니요']].map(o => '<button type="button" id="ci-' + k + '-' + (o[0] ? 'yes' : 'no') + '" aria-pressed="' + (c[k] === o[0]) + '" data-act="ci" data-k="' + k + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div></fieldset>';
    const ready = c.mood && c.sleepHours && c.exercise != null && c.social != null && c.meals != null;
    return '<div class="stack"><h1 class="t-headline" id="ci-h">오늘의 생활 체크</h1><p class="t-body muted">30초면 끝나요. 편하게 눌러 주세요.</p>' +
      '<fieldset class="card outlined" style="border:2px solid var(--md-sys-color-outline-variant)"><legend class="t-title-m" style="padding:0 8px">오늘 기분은 어떠세요?</legend><div class="faces mt">' +
      [5, 4, 3, 2, 1].map(v => '<button type="button" class="face" id="ci-mood-' + v + '" aria-pressed="' + (c.mood === v) + '" data-act="ci" data-k="mood" data-v="' + v + '"><span class="e" aria-hidden="true">' + FACES[v][0] + '</span><span class="l">' + FACES[v][1] + '</span></button>').join('') + '</div></fieldset>' +
      '<fieldset class="card outlined" style="border:2px solid var(--md-sys-color-outline-variant)"><legend class="t-title-m" style="padding:0 8px">어젯밤 몇 시간 주무셨어요?</legend><div class="chips mt">' +
      sleeps.map(s => '<button type="button" class="chip" id="ci-sleep-' + s[0] + '" aria-pressed="' + (c.sleepHours === s[0]) + '" data-act="ci" data-k="sleepHours" data-v="' + s[0] + '">' + s[1] + '</button>').join('') + '</div></fieldset>' +
      '<details class="field-opt card outlined" id="sl-details"' + (c._sl ? ' open' : '') + '><summary id="sl-summary">잠을 더 자세히 적기 (선택)</summary><div class="stack mt">' +
        '<div class="field"><label for="sl-bed">잠든 시각</label><input class="input" type="time" id="sl-bed" value="' + (c.bed || '') + '"></div>' +
        '<div class="field"><label for="sl-wake">일어난 시각</label><input class="input" type="time" id="sl-wake" value="' + (c.wake || '') + '"></div>' +
        '<div><div class="t-title-m" id="wk-label">밤에 몇 번 깨셨어요?</div><div class="chips mt" role="group" aria-labelledby="wk-label">' + [0, 1, 2, 3].map(n => '<button type="button" class="chip" id="ci-wk-' + n + '" aria-pressed="' + (c.wakings === n) + '" data-act="ci" data-k="wakings" data-v="' + n + '">' + (n === 3 ? '3번 이상' : n === 0 ? '안 깼어요' : n + '번') + '</button>').join('') + '</div></div></div></details>' +
      yn('exercise', '오늘 걷기·운동을 하셨나요?') + yn('social', '사람을 만나거나 통화하셨나요?') + yn('meals', '골고루 드셨나요?') +
      '<section class="card filled">' + tipHtml() + '</section>' +
      '<button class="btn filled" id="btn-ci-save" type="button" data-act="cisave"' + (ready ? '' : ' disabled') + '>저장하기</button>' + (ready ? '' : '<p class="t-small muted center">모두 고르시면 저장할 수 있어요.</p>') + '</div>';
  }
};
