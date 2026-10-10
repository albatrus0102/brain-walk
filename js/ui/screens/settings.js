import { alarmCfg } from '../../alarm.js';
import { chatAvail, isTrainee, traineeLabel } from '../../data.js';
import { Platform } from '../../platform.js';
import { S } from '../../state.js';
import { installSlot } from '../install.js';
import { buildRoomSection } from '../room-settings.js';
import { SCREENS } from '../registry.js';
import { prefsCard, slotText, switchRow } from '../widgets.js';
import { $, esc } from '../../util.js';

SCREENS.settings = {
  html() {
    if (!S.alarmDraft) { const c = alarmCfg(); S.alarmDraft = { time: c.time, days: (c.days || []).slice() }; }
    const d = S.alarmDraft, order = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [0, '일']];
    const rem = S.myReminder || { time: '20:00', enabled: false };
    if (!S.remDraft) S.remDraft = { time: rem.time || '20:00', enabled: !!rem.enabled };
    return '<div class="stack"><h1 class="t-headline" id="set-main-h">설정</h1>' +
      '<section class="card outlined" aria-labelledby="role-h"><h2 class="t-title" id="role-h">사용 방식</h2><p class="t-body mt">지금은 <b>' + (isTrainee() ? '훈련하는 분' : '가족') + '</b>으로 쓰고 있어요.</p>' +
      '<div class="mt"><button class="btn tonal" id="btn-role-switch" type="button" data-act="roleswitch">' + (isTrainee() ? '가족으로 바꾸기' : '훈련하는 분으로 바꾸기') + '</button></div></section>' +
      '<section class="card outlined" aria-labelledby="inst-h"><h2 class="t-title" id="inst-h">앱 설치</h2><div class="mt" id="install-slot"></div></section>' +
      '<div class="stack" id="room-slot"></div>' +
      '<section class="card elevated" aria-labelledby="alarm-h"><h2 class="t-title" id="alarm-h">훈련 알람 (함께 쓰는 설정)</h2><p class="t-small muted">앱이 열려 있을 때 이 시간이 지나면 \'훈련할 시간이에요\'를 알려 드려요. 가족 누구나 바꿀 수 있어요.</p>' +
      '<div class="field mt"><label for="alarm-time">알람 시간</label><input class="input" type="time" id="alarm-time" value="' + esc(d.time) + '"></div>' +
      '<div class="mt"><div class="t-title-m" id="days-label">반복 요일</div><div class="days mt" role="group" aria-labelledby="days-label">' + order.map(o => '<button type="button" class="chip" id="alarm-day-' + o[0] + '" aria-pressed="' + d.days.includes(o[0]) + '" data-act="aday" data-d="' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div>' +
      '<div class="stack mt"><button class="btn filled" id="btn-alarm-save" type="button" data-act="alarmsave">알람 저장</button>' +
      (Platform.canSaveFile() ? '<button class="btn outlined" id="btn-ics" type="button" data-act="ics">휴대폰 알람에 등록하기</button><p class="t-small muted">파일을 열면 휴대폰 캘린더에 매일 알림이 등록돼요. (선택한 요일마다 반복)</p>' : '') + '</div>' +
      (S.icsText ? '<div class="field mt"><label for="ics-text">파일이 저장되지 않으면 아래 내용을 복사해 \'brainwalk-alarm.ics\' 파일로 저장해 쓰세요.</label><textarea class="input copybox" id="ics-text" readonly rows="6"></textarea><button class="btn tonal mt" id="btn-ics-copy" type="button" data-act="icscopy">내용 복사하기</button></div>' : '') + '</section>' +
      (!isTrainee() && chatAvail() ? '<section class="card elevated" aria-labelledby="rem-h"><h2 class="t-title" id="rem-h">내 확인 시간</h2><p class="t-small muted">이 시간에 앱이 열려 있고 <span data-slot="tlabel"></span>이(가) 아직 훈련 전이면 알려 드려요.</p>' +
        '<div class="field mt"><label for="rem-time">매일 확인 시간</label><input class="input" type="time" id="rem-time" value="' + esc(S.remDraft.time) + '"></div>' +
        '<div class="mt">' + switchRow('rem-switch', '이 시간에 알려 주기', S.remDraft.enabled ? '켜져 있어요.' : '꺼져 있어요.', S.remDraft.enabled, 'remsw', false) + '</div>' +
        '<div class="mt"><button class="btn filled" id="btn-rem-save" type="button" data-act="remsave">저장</button></div></section>' : '') +
      prefsCard() + '</div>';
  },
  bind(el) { $('#install-slot', el).append(installSlot('settings')); buildRoomSection($('#room-slot', el)); slotText(el, 'tlabel', traineeLabel()); const t = $('#ics-text', el); if (t) t.value = S.icsText; }
};
