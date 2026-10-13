import { chatAvail, getPlan, isAdmin, isOwnerNow, isTrainee, traineeId, traineeLabel } from '../../data.js';
import { refreshRole } from '../../data.js';
import { FirebaseAdapter } from '../../store/firebase-adapter.js';
import { Store } from '../../store/store.js';
import { S } from '../../state.js';
import { LS, esc, iga } from '../../util.js';
import { ACTS } from '../acts.js';
import { dialog, h } from '../dom.js';
import { installSlot } from '../install.js';
import { planSummary } from '../plan-text.js';
import { SCREENS } from '../registry.js';
import { btn, confirmDeleteAll, confirmDeleteLocal, confirmLeave, openDevices, openInvite, openOwnerTransfer, openRename, openTransfer, pushRow } from '../room-settings.js';
import { go } from '../shell.js';
import { FONT_OPTS, SIZE_OPTS, prefsCard, segHtml, slotText, switchRow, xpCard } from '../widgets.js';
import { $ } from '../../util.js';

/* 설정 (DESIGN.md §5 L3, §6.1). 훈련하는 분 기기: 아주 단순하게(가족이 도와줄 때만 열어요). 가족 기기: 칸마다 펼치고 접는 카드. */
const rowBtn = (id, title, sub) => '<button type="button" class="hub-item" id="' + id + '" data-act="' + id + '"><span><strong>' + title + '</strong><span class="sub">' + sub + '</span></span><span class="t-title-m" aria-hidden="true">›</span></button>';
const fontName = () => (FONT_OPTS.find(o => o[0] === S.prefs.font) || [0, ''])[1], sizeName = () => (SIZE_OPTS.find(o => o[0] === S.prefs.size) || [0, ''])[1];
const adminChip = () => isAdmin() && Store.mode === 'firebase' ? '<p class="chip-status done" id="admin-chip">관리자</p>' : '';

/* 훈련하는 분 기기를 관리하는 줄들 (가족 기기의 3번 카드, 훈련하는 분 기기에서 관리자가 여는 '가족방 관리'가 함께 써요) */
function mgmtRows() {
  const none = !traineeId() && Store.mode === 'firebase';
  return none ? '<p class="t-body" id="no-trainee">훈련하는 분이 없어요</p>'
    : '<p class="t-body" id="plan-summary">' + esc(planSummary(getPlan())) + '</p>' +
      rowBtn('row-display', esc(traineeLabel()) + ' 화면 (글자·소리)', '글꼴·글자 크기·소리를 ' + esc(traineeLabel()) + ' 휴대폰에 바로 적용해요') +
      rowBtn('row-plan', '훈련 계획 (분량·요일·알람·게임·난이도)', '하루 게임 수, 문제 수, 요일, 게임 고르기, 난이도');
}
function roomRows(forLearner) {
  return (Store.mode === 'firebase' ? rowBtn('row-invite', '가족 초대 코드 보기', '코드와 링크를 가족에게 보내요') + rowBtn('row-members', '가족 구성원', '관리자와 훈련하는 분을 정하고, 모르는 사람은 내보내요') : '');
}

SCREENS.settings = {
  html() {
    const fb = Store.mode === 'firebase', local = Store.mode === 'local';
    if (!S.remDraft) { const rem = S.myReminder || { time: '20:00', enabled: false }; S.remDraft = { time: rem.time || '20:00', enabled: !!rem.enabled }; }
    if (isTrainee()) {
      const mg = isAdmin() && (fb || local) ? xpCard('mgmt', '가족방 관리 (관리자)', fb ? '화면·계획·구성원' : '화면·계획', '<div class="stack" id="mgmt-body">' + mgmtRows() + roomRows(true) + '</div>') : '';
      return '<div class="stack"><h1 class="t-headline" id="set-main-h">이 기기는 ' + esc(traineeLabel()) + ' 훈련용이에요</h1>' + prefsCard() +
        (fb ? '<section class="card outlined" aria-labelledby="push-h2"><h2 class="t-title" id="push-h2">알림 받기</h2><div class="mt" id="push-slot"></div></section>' : '') +
        '<section class="card outlined" aria-labelledby="inst-h"><h2 class="t-title" id="inst-h">앱 설치</h2><div class="mt" id="install-slot"></div></section>' +
        (fb ? '<section class="card outlined" aria-label="이 기기"><div class="stack" id="dev-slot"></div></section>' : '') + mg +
        (local ? '<section class="card outlined" id="demo-card" aria-labelledby="demo-h"><h2 class="t-title" id="demo-h">체험 모드</h2><div class="stack mt"><button class="btn tonal" id="btn-role-switch" type="button" data-act="roleswitch">가족(관리자) 화면으로 보기</button></div></section>' : '') +
        '<div class="cta"><button class="btn filled" id="btn-set-home" type="button" data-act="home">처음으로</button></div></div>';
    }
    // ---- 가족(관리자 포함) 기기
    const rem = chatAvail() ? xpCard('notif', '알림', '훈련 시간 · 내 확인 시간', '<div id="push-slot"></div>' +
      '<div class="field"><label for="rem-time">내 확인 시간 (매일)</label><input class="input" type="time" id="rem-time" value="' + esc(S.remDraft.time) + '"></div>' +
      switchRow('rem-switch', '이 시간에 알려 주기', S.remDraft.enabled ? '켜져 있어요.' : '꺼져 있어요.', S.remDraft.enabled, 'remsw', false) + '<button class="btn filled" id="btn-rem-save" type="button" data-act="remsave">저장</button>') : '';
    const own = fb && isOwnerNow() ? xpCard('owner', '방 주인 전용', '관리자 넘기기 · 가족방 삭제', '<div id="owner-slot" class="stack"></div>') : '';
    return '<div class="stack"><h1 class="t-headline" id="set-main-h">설정</h1>' + adminChip() +
      xpCard('mine', '내 화면', esc(fontName()) + ' · 글자 ' + esc(sizeName()), segHtml('글꼴', 'font-label', FONT_OPTS, S.prefs.font, 'font', 'font') + segHtml('글자 크기', 'size-label', SIZE_OPTS, S.prefs.size, 'size', 'size') +
        switchRow('sound-switch', '소리 안내', S.prefs.sound ? '켜져 있어요. 문제를 읽어 드려요.' : '꺼져 있어요.', S.prefs.sound, 'sound', false) + switchRow('contrast-switch', '고대비 모드', S.prefs.contrast ? '켜져 있어요. 글자와 테두리가 더 진해요.' : '꺼져 있어요.', S.prefs.contrast, 'contrast', false), true) +
      rem +
      xpCard('mgmt', esc(traineeLabel()) + ' 기기 관리', fb && !traineeId() ? '아직 정하지 않았어요' : esc(planSummary(getPlan())), '<div class="stack" id="mgmt-body">' + mgmtRows() + '' + '</div>') +
      (fb ? xpCard('room', '가족방', '초대 코드 · 가족 구성원', '<div class="stack">' + roomRows(false) + '</div>') : '') +
      '<section class="card outlined" aria-labelledby="inst-h"><h2 class="t-title" id="inst-h">앱 설치</h2><div class="mt" id="install-slot"></div></section>' +
      (fb ? xpCard('me', '내 정보', '이름 · 기기 · 나가기', '<div class="stack" id="me-slot"></div>') : '') + own +
      (local ? '<section class="card outlined" id="demo-card" aria-labelledby="demo-h"><h2 class="t-title" id="demo-h">체험 모드</h2><div class="stack mt"><button class="btn tonal" id="btn-role-switch" type="button" data-act="roleswitch">훈련하는 분 화면으로 보기</button><button class="btn outlined" id="btn-delete-local" type="button">모든 기록 삭제 (이 기기)</button></div></section>' : '') + '</div>';
  },
  bind(el) {
    const local = Store.mode === 'local';
    $('#install-slot', el).append(installSlot('settings'));
    slotText(el, 'tlabel', traineeLabel()); slotText(el, 'tiga', iga(traineeLabel()));
    const ps = $('#push-slot', el); if (ps) ps.append(pushRow());
    const ds = $('#dev-slot', el); if (ds) ds.append(btn('다른 기기로 옮기기', 'tonal', () => openTransfer(), 'btn-transfer'), btn('연결된 기기', 'tonal', openDevices, 'btn-devices'));
    const me = $('#me-slot', el);
    if (me) {
      me.append(h('p', { class: 't-body', text: '내 이름: ' + ((FirebaseAdapter.me() || {}).name || '') }), btn('내 이름 바꾸기', 'tonal', openRename, 'btn-rename'), btn('다른 기기로 옮기기', 'tonal', () => openTransfer(), 'btn-transfer'), btn('연결된 기기', 'tonal', openDevices, 'btn-devices'),
        btn('가족 나가기', 'outlined', confirmLeave, 'btn-leave'), btn('모든 기록 삭제', 'outlined', confirmDeleteAll, 'btn-delete-all'));
    }
    const ow = $('#owner-slot', el); if (ow) ow.append(btn('관리자 넘기기 (가족방 주인 바꾸기)', 'tonal', openOwnerTransfer, 'btn-owner-transfer'));
    if (local) { const d = $('#btn-delete-local', el); if (d) d.addEventListener('click', confirmDeleteLocal); }
  }
};
/* 줄 눌렀을 때 */
ACTS['row-display'] = () => { S.dispDraft = null; go('adminDisplay'); };
ACTS['row-plan'] = () => { S.planDraft = null; go('adminPlan'); };
ACTS['row-members'] = () => go('members');
ACTS['row-invite'] = () => openInvite();
/* 체험 모드: 한 기기에서 훈련하는 분 화면과 가족(관리자) 화면을 오가며 미리 봐요 */
ACTS.roleswitch = () => {
  const toFamily = isTrainee();
  dialog(toFamily ? '가족 화면으로 바꿀까요?' : '훈련하는 분 화면으로 볼까요?', toFamily ? '체험 모드에서는 언제든 다시 바꿀 수 있어요.' : '훈련하는 분이 보는 화면으로 미리 보여 드려요. 설정의 톱니바퀴로 돌아올 수 있어요.', [{ label: '취소', kind: 'text' }, { label: '바꾸기', kind: 'filled', run: () => {
    S.roleLocal = toFamily ? 'family' : 'trainee'; LS.set('bw.role', S.roleLocal); refreshRole(); go('home');
  } }]);
};
