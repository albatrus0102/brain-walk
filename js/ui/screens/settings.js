import { chatAvail, displayOf, focusId, getPlan, isAdmin, isOwnerNow, isTrainee, traineeLabel } from '../../data.js';
import { refreshRole } from '../../data.js';
import { aiAccess } from '../../ai/admin-data.js';
import { alarmCfg } from '../../alarm.js';
import { DISPLAY_DEFAULTS, normalizeDisplay } from '../../program.js';
import { pushIsOn } from '../../push.js';
import { FirebaseAdapter } from '../../store/firebase-adapter.js';
import { Store } from '../../store/store.js';
import { S } from '../../state.js';
import { LS, esc, iga } from '../../util.js';
import { ACTS } from '../acts.js';
import { dialog, h } from '../dom.js';
import { installSlot } from '../install.js';
import { planSummary } from '../plan-text.js';
import { SCREENS } from '../registry.js';
import { btn, confirmDeleteAll, confirmDeleteLocal, confirmLeave, newCreateCode, openDevices, openInvite, openOwnerTransfer, openRename, openTransfer, pushRow } from '../room-settings.js';
import { go } from '../shell.js';
import { FONT_OPTS, SIZE_OPTS, liEl, prefsCard, segHtml, slotText, switchRow, traineeChipsEl, xpCard } from '../widgets.js';
import { $ } from '../../util.js';

/* 설정 (DESIGN.md §5 L3, §6.1).
 * 훈련하는 분 기기: 아주 단순하게(가족이 도와줄 때만 열어요), 큰 글자 그대로.
 * 가족 기기: M3 목록 — 소제목(가족 · ○○ 화면 · 학습 설정 · AI · 알림 · 앱)으로 묶고, 줄마다 아이콘 + 한 줄 + 값/›. 관리자만 쓰는 줄은 관리자에게만 보여요. */
const rowBtn = (id, title, sub) => '<button type="button" class="hub-item" id="' + id + '" data-act="' + id + '"><span><strong>' + title + '</strong><span class="sub">' + sub + '</span></span><span class="t-title-m" aria-hidden="true">›</span></button>';
const fontName = () => (FONT_OPTS.find(o => o[0] === S.prefs.font) || [0, ''])[1], sizeName = () => (SIZE_OPTS.find(o => o[0] === S.prefs.size) || [0, ''])[1];
const nameOfOpt = (opts, v) => (opts.find(o => o[0] === v) || [0, ''])[1];
const adminChip = () => isAdmin() && Store.mode === 'firebase' ? '<p class="chip-status done" id="admin-chip">관리자</p>' : '';
const hm = t => { const p = String(t || '').split(':').map(Number); if (p.length < 2 || isNaN(p[0])) return ''; return (p[0] < 12 ? '오전 ' : '오후 ') + (p[0] % 12 || 12) + ':' + String(p[1]).padStart(2, '0'); };

/* 훈련하는 분 기기를 관리하는 줄들 (훈련하는 분 기기에서 관리자가 여는 '가족방 관리'가 써요) */
function mgmtRows() {
  const none = !focusId() && Store.mode === 'firebase';
  return none ? '<p class="t-body" id="no-trainee">훈련하는 분이 없어요</p>'
    : '<p class="t-body" id="plan-summary">' + esc(planSummary(getPlan())) + '</p>' +
      rowBtn('row-display', esc(traineeLabel()) + ' 화면 (글자·소리)', '글꼴·글자 크기·소리를 ' + esc(traineeLabel()) + ' 휴대폰에 바로 적용해요') +
      rowBtn('row-plan', '훈련 계획 (분량·요일·알람·게임·난이도)', '하루 게임 수, 문제 수, 요일, 게임 고르기, 난이도');
}
function roomRows() {
  return (Store.mode === 'firebase' ? rowBtn('row-invite', '가족 초대 코드 보기', '코드와 링크를 가족에게 보내요') + rowBtn('row-members', '가족 구성원', '관리자와 훈련하는 분을 정하고, 모르는 사람은 내보내요') : '');
}

/* ---- 가족 기기: M3 목록 ---- */
const group = (title, rows, id) => { const g = h('section', { class: 'group', id, 'aria-label': title }, h('h2', { class: 'subhead', text: title }), h('div', { class: 'list' }, rows.filter(Boolean))); return g; };
function familyList() {
  const fb = Store.mode === 'firebase', local = Store.mode === 'local', admin = isAdmin(), L = esc(traineeLabel());
  const me = fb ? (FirebaseAdapter.me() || {}) : {};
  const d = normalizeDisplay(displayOf() || DISPLAY_DEFAULTS);
  const out = [];
  // 가족
  if (fb) out.push(group('가족', [
    liEl({ id: 'row-members', icon: 'group', title: '가족 구성원', value: String(Object.values(FirebaseAdapter.members() || {}).filter(m => m && !m.leftTs).length) + '명' }, () => go('members')),
    liEl({ id: 'row-invite', icon: 'key', title: '가족 초대 코드' }, openInvite),
    liEl({ id: 'btn-rename', icon: 'person', title: '내 이름', value: esc(me.name || '') }, openRename),
    liEl({ id: 'btn-transfer', icon: 'swap', title: '다른 기기로 옮기기' }, () => openTransfer()),
    liEl({ id: 'btn-devices', icon: 'devices', title: '연결된 기기' }, openDevices),
    isOwnerNow() ? liEl({ id: 'btn-owner-transfer', icon: 'swap', title: '관리자 넘기기 (가족방 주인 바꾸기)' }, openOwnerTransfer) : null,
    liEl({ id: 'btn-leave', icon: 'logout', title: '가족 나가기' }, confirmLeave)
  ], 'set-family'));
  // 훈련하는 분 화면 · 학습 설정 · AI: 고른 훈련하는 분 것 (2명 이상이면 고르는 칩, '모두' 없음)
  const none = fb && !focusId();
  const chips = traineeChipsEl(false); if (chips) out.push(chips);
  out.push(group(L + ' 화면', [
    none ? liEl({ id: 'no-trainee', icon: 'phone', title: '훈련하는 분이 없어요', chevron: false }) : liEl({ id: 'row-display', icon: 'phone', title: '화면 (글자·소리)', value: esc(nameOfOpt(FONT_OPTS, d.font) + ' · ' + nameOfOpt(SIZE_OPTS, d.size)) }, () => { S.dispDraft = null; go('adminDisplay'); })
  ], 'set-display'));
  out.push(group('학습 설정', [
    none ? null : liEl({ id: 'row-plan', icon: 'school', title: '훈련 계획', sub: esc(planSummary(getPlan())), subId: 'plan-summary' }, () => { S.planDraft = null; go('adminPlan'); }),
    none ? null : liEl({ id: 'row-alarm', icon: 'alarm', title: L + ' 알람', value: esc(hm(alarmCfg().time) || '끔') }, () => { S.planDraft = null; S.xpOpen.p2 = true; go('adminPlan'); })
  ], 'set-plan'));
  // AI (관리자만)
  if (admin && aiAccess() === 'ok') out.push(group('AI', [
    liEl({ id: 'row-ai-reports', icon: 'sparkle', title: 'AI 리포트' }, () => go('aiReports')),
    liEl({ id: 'row-ai-settings', icon: 'tune', title: 'AI 리포트 설정' }, () => go('aiSettings'))
  ], 'set-ai'));
  // 알림
  if (chatAvail()) out.push(group('알림', [
    pushRow(true),
    liEl({ id: 'row-reminder', icon: 'clock', title: '내 확인 시간', value: S.remDraft.enabled ? esc(hm(S.remDraft.time)) : '끔' }, () => go('setNotify'))
  ], 'set-notify'));
  // 앱
  const inst = liEl({ id: 'row-install', icon: 'download', title: '앱 설치', chevron: false });
  inst.querySelector('.body').append(h('div', { id: 'install-slot', class: 'mt' }, installSlot('settings')));
  out.push(group('앱', [
    liEl({ id: 'row-mine', icon: 'text', title: '내 화면', value: esc(fontName() + ' · ' + sizeName()) }, () => go('setMine')),
    inst,
    (fb || local) && isOwnerNow() ? liEl({ id: 'btn-create-code', icon: 'key', title: '새 코드 만들기' }, newCreateCode) : null,
    local ? liEl({ id: 'btn-role-switch', icon: 'eye', title: '훈련하는 분 화면으로 보기' }, () => ACTS.roleswitch()) : null,
    fb ? liEl({ id: 'btn-delete-all', icon: 'trash', title: '모든 기록 삭제' }, confirmDeleteAll) : null,
    local ? liEl({ id: 'btn-delete-local', icon: 'trash', title: '모든 기록 삭제 (이 기기)' }, confirmDeleteLocal) : null
  ], 'set-app'));
  return out;
}

SCREENS.settings = {
  html() {
    const fb = Store.mode === 'firebase', local = Store.mode === 'local';
    if (!S.remDraft) { const rem = S.myReminder || { time: '20:00', enabled: false }; S.remDraft = { time: rem.time || '20:00', enabled: !!rem.enabled }; }
    if (isTrainee()) {
      const mg = isAdmin() && (fb || local) ? xpCard('mgmt', '가족방 관리 (관리자)', fb ? '화면·계획·구성원' : '화면·계획', '<div class="stack" id="mgmt-body">' + mgmtRows() + roomRows() + '</div>') : '';
      return '<div class="stack"><h1 class="t-headline" id="set-main-h">이 기기는 ' + esc(traineeLabel()) + ' 훈련용이에요</h1>' + prefsCard() +
        (fb ? '<section class="card outlined" aria-labelledby="push-h2"><h2 class="t-title" id="push-h2">알림 받기</h2><div class="mt" id="push-slot"></div></section>' : '') +
        '<section class="card outlined" aria-labelledby="inst-h"><h2 class="t-title" id="inst-h">앱 설치</h2><div class="mt" id="install-slot"></div></section>' +
        (fb ? '<section class="card outlined" aria-label="이 기기"><div class="stack" id="dev-slot"></div></section>' : '') + mg +
        (local ? '<section class="card outlined" id="demo-card" aria-labelledby="demo-h"><h2 class="t-title" id="demo-h">체험 모드</h2><div class="stack mt"><button class="btn tonal" id="btn-role-switch" type="button" data-act="roleswitch">가족(관리자) 화면으로 보기</button></div></section>' : '') +
        '<div class="cta"><button class="btn filled" id="btn-set-home" type="button" data-act="home">처음으로</button></div></div>';
    }
    // ---- 가족(관리자 포함) 기기: 목록은 bind 에서 그려요
    return '<div class="stack" id="set-root"><h1 class="t-headline" id="set-main-h">설정</h1>' + adminChip() + '</div>';
  },
  bind(el) {
    const local = Store.mode === 'local';
    if (isTrainee()) {
      $('#install-slot', el).append(installSlot('settings'));
      slotText(el, 'tlabel', traineeLabel()); slotText(el, 'tiga', iga(traineeLabel()));
      const ps = $('#push-slot', el); if (ps) ps.append(pushRow());
      const ds = $('#dev-slot', el); if (ds) ds.append(btn('다른 기기로 옮기기', 'tonal', () => openTransfer(), 'btn-transfer'), btn('연결된 기기', 'tonal', openDevices, 'btn-devices'));
      if (local) { const d = $('#btn-delete-local', el); if (d) d.addEventListener('click', confirmDeleteLocal); }
      return;
    }
    $('#set-root', el).append(...familyList());
  }
};
/* 내 화면 (이 폰에만): 글꼴·글자 크기·소리·고대비 */
SCREENS.setMine = {
  html() {
    return '<div class="stack"><h1 class="t-headline" id="set-mine-h">내 화면</h1>' +
      '<section class="card outlined stack" aria-label="내 화면">' + segHtml('글꼴', 'font-label', FONT_OPTS, S.prefs.font, 'font', 'font') + segHtml('글자 크기', 'size-label', SIZE_OPTS, S.prefs.size, 'size', 'size') +
      switchRow('sound-switch', '소리 안내', S.prefs.sound ? '켜져 있어요.' : '꺼져 있어요.', S.prefs.sound, 'sound', false) + switchRow('contrast-switch', '고대비 모드', S.prefs.contrast ? '켜져 있어요.' : '꺼져 있어요.', S.prefs.contrast, 'contrast', false) + '</section></div>';
  }
};
/* 알림: 알림 받기 스위치 + 내 확인 시간 */
SCREENS.setNotify = {
  html() {
    if (!S.remDraft) { const rem = S.myReminder || { time: '20:00', enabled: false }; S.remDraft = { time: rem.time || '20:00', enabled: !!rem.enabled }; }
    return '<div class="stack"><h1 class="t-headline" id="set-notify-h">알림</h1><section class="card outlined stack" aria-label="알림"><div id="push-slot"></div>' +
      '<div class="field"><label for="rem-time">내 확인 시간 (매일)</label><input class="input" type="time" id="rem-time" value="' + esc(S.remDraft.time) + '"></div>' +
      switchRow('rem-switch', '이 시간에 알려 주기', S.remDraft.enabled ? '켜져 있어요.' : '꺼져 있어요.', S.remDraft.enabled, 'remsw', false) + '</section>' +
      '<div class="cta"><button class="btn filled" id="btn-rem-save" type="button" data-act="remsave">저장</button></div></div>';
  },
  bind(el) { const ps = $('#push-slot', el); if (ps) ps.append(pushRow()); }
};
/* 줄 눌렀을 때 (훈련하는 분 기기의 '가족방 관리' 카드) */
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
void pushIsOn;
