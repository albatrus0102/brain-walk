import { disconnectData } from '../data.js';
import { Platform } from '../platform.js';
import { disablePush, enablePush, pushIsOn, pushReasonText } from '../push.js';
import { S } from '../state.js';
import { FirebaseAdapter } from '../store/firebase-adapter.js';
import { TRANSFER_MIN, clearLocalData, createTransferCode, deleteFamily, deleteMyRecords, getInviteInfo, isOwner, leaveFamily, listMyDevices, renameSelf, revokeDevice, rotateJoinCode, transferLink } from '../store/membership.js';
import { Store } from '../store/store.js';
import { LS } from '../util.js';
import { closeSheet, dialog, h, openSheet, toast } from './dom.js';
import { inviteBlock } from './onboarding.js';
import { render } from './shell.js';
import { switchRow } from './widgets.js';

/* 설정 > 가족방 / 알림 / 내 정보 / 삭제 */
const reloadHome = () => { location.replace(location.pathname); };
const sec = (title, ...kids) => h('section', { class: 'card outlined' }, h('h2', { class: 't-title', text: title }), h('div', { class: 'stack mt' }, ...kids));
const btn = (label, cls, onclick, id) => h('button', { class: 'btn ' + cls, type: 'button', id, onclick }, label);

function pushStateText() {
  const st = S.pushState;
  if (st === 'granted' && pushIsOn()) return '켜져 있어요. 훈련 시간과 가족 소식을 알려 드려요.';
  if (st === 'ios-install-first') return '아이폰은 공유 → 홈 화면에 추가 후 알림을 켤 수 있어요.';
  if (st === 'unsupported') return '이 브라우저에서는 알림을 쓸 수 없어요.';
  if (st === 'denied') return '차단되어 있어요. 기기 설정에서 허용해 주세요.';
  return '꺼져 있어요.';
}
function iosSteps() {
  return h('ol', { class: 't-body', id: 'ios-steps', style: 'padding-left:1.4em;margin:8px 0 0' },
    h('li', { text: '사파리 아래의 공유 버튼(네모에 위쪽 화살표)을 눌러요' }), h('li', { text: '"홈 화면에 추가"를 눌러요' }), h('li', { text: '홈 화면에 생긴 아이콘으로 앱을 다시 열어요' }), h('li', { text: '설정에서 "알림 받기"를 켜요 (아이폰은 iOS 16.4 이상)' }));
}

/* "알림 받기" 스위치 / 홈의 부드러운 안내 카드가 공통으로 써요 */
export async function togglePush(btnEl) {
  if (pushIsOn()) { await disablePush(); toast('알림을 껐어요.'); if (S.screen === 'settings') render(true); return; }
  if (S.pushState === 'ios-install-first') { dialog('홈 화면에 추가해 주세요', pushReasonText('ios-install-first'), [{ label: '확인', kind: 'filled' }], null, iosSteps()); return; }
  if (btnEl) btnEl.disabled = true;
  const r = await enablePush();
  if (btnEl) btnEl.disabled = false;
  if (r.ok) toast('알림을 켰어요.'); else toast(pushReasonText(r.reason));
  render(true);
}
export function pushRow() {
  const wrap = h('div', {});
  wrap.innerHTML = switchRow('push-switch', '알림 받기', pushStateText(), pushIsOn(), 'push', S.pushState === 'unsupported');
  return wrap;
}

function openInvite() {
  openSheet('가족 코드', (body) => {
    body.append(h('p', { class: 't-body muted', id: 'inv-loading', text: '불러오는 중이에요…' }));
    getInviteInfo().then(info => {
      body.textContent = '';
      if (info.code && !info.expired) {
        body.append(inviteBlock(info.code, { prefix: 'set-inv' }), h('p', { class: 't-small muted', text: '코드는 ' + new Date(info.expires).toLocaleDateString('ko-KR') + '까지 쓸 수 있어요.' }));
      } else body.append(h('p', { class: 't-body', id: 'inv-expired', text: '코드 기간이 지났어요. 새로 만들어 주세요.' }));
      body.append(btn('새 코드 만들기', 'outlined', () => dialog('새 코드를 만들까요?', '이전 코드는 더 이상 쓸 수 없어요. 가족을 내보낸 뒤라면 새 코드를 만드는 것이 좋아요.', [{ label: '취소', kind: 'text' }, { label: '만들기', kind: 'filled', run: async () => { try { await rotateJoinCode(); toast('새 코드를 만들었어요.'); openInvite(); } catch (e) { toast(Store.explain(e)); } } }]), 'btn-rotate'),
        btn('닫기', 'text', closeSheet, 'inv-close'));
    }).catch(e => { body.textContent = ''; body.append(h('p', { class: 't-body', text: Store.explain(e) }), btn('닫기', 'text', closeSheet)); });
  });
}
/* forMember: 다른 가족의 새 기기용 복구 코드 (예: 아버지가 폰을 잃어버렸을 때) */
function openTransfer(forMember, forName) {
  openSheet(forMember ? forName + '님의 새 기기 연결 코드' : '다른 기기로 옮기기', (body) => {
    body.append(h('p', { class: 't-body muted', text: (forMember ? forName + '님의 새 기기에서' : '새 기기에서') + ' 앱을 열고 "기기 옮기기 코드가 있어요"를 눌러 아래 코드를 입력하세요. 코드는 약 ' + TRANSFER_MIN + '분 동안, 한 번만 쓸 수 있어요.' + (forMember ? ' 이 코드를 받은 기기는 ' + forName + '님으로 연결되니, 다른 사람에게 보내지 마세요.' : '') }));
    const slot = h('div', { class: 'stack' }, h('p', { class: 't-body', text: '코드를 만드는 중이에요…' })); body.append(slot);
    createTransferCode(forMember).then(({ code, expires }) => {
      slot.textContent = '';
      const link = transferLink(code);
      slot.append(h('p', { class: 't-display center', id: 'transfer-code-show', text: code, style: 'letter-spacing:.2em;user-select:all' }),
        h('input', { class: 'input', id: 'transfer-link', readonly: '', value: link, 'aria-label': '옮기기 링크' }),
        btn('링크 복사', 'tonal', async () => { toast((await Platform.copy(link, document.getElementById('transfer-link'))) ? '복사했어요.' : '길게 눌러 복사해 주세요.'); }, 'transfer-copy'),
        h('p', { class: 't-small muted', text: new Date(expires).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) + '까지 쓸 수 있어요.' }));
    }).catch(e => { slot.textContent = ''; slot.append(h('p', { class: 't-body', id: 'transfer-err', text: forMember && e && e.code === 'permission-denied' ? '다른 가족의 코드는 방을 만든 분이나, 가족방에 들어온 지 하루가 지난 가족만 만들 수 있어요.' : Store.explain(e) })); });
    body.append(btn('닫기', 'text', closeSheet, 'transfer-close'));
  });
}
/* 가족 기기 복구 코드: 누구의 새 기기인지 고르기 */
function openRecover() {
  openSheet('가족 기기 복구 코드', (body) => {
    const others = Object.entries(FirebaseAdapter.members()).filter(([id, m]) => id !== FirebaseAdapter.mid && m && !m.leftTs);
    body.append(h('p', { class: 't-body muted', text: '폰을 잃어버렸거나 앱을 지운 가족의 새 기기를 연결할 코드를 만들어요. 누구의 새 기기인가요?' }));
    if (!others.length) body.append(h('p', { class: 't-body', text: '다른 가족이 아직 없어요.' }));
    others.forEach(([id, m], i) => body.append(btn(String(m.name || '가족'), 'outlined menuitem', () => openTransfer(id, String(m.name || '가족')), 'recover-' + i)));
    body.append(btn('닫기', 'text', closeSheet, 'recover-close'));
  });
}
/* 연결된 기기: 내 이름으로 연결된 기기 목록. 잃어버린 기기는 여기서 끊어요. */
function openDevices() {
  openSheet('연결된 기기', (body) => {
    const slot = h('div', { class: 'stack' }, h('p', { class: 't-body muted', text: '불러오는 중이에요…' })); body.append(slot);
    const load = () => listMyDevices().then(list => {
      slot.textContent = '';
      slot.append(h('p', { class: 't-body muted', text: '내 이름으로 연결된 기기예요. 잃어버린 기기는 연결을 끊어 주세요.' }));
      list.forEach((d, i) => slot.append(h('div', { class: 'card outlined', id: 'dev-' + i },
        h('p', { class: 't-title-m', text: (d.device || '기기') + (d.current ? ' (지금 이 기기)' : '') }),
        h('p', { class: 't-small muted', text: d.addedTs ? new Date(d.addedTs).toLocaleDateString('ko-KR') + ' 연결' : '' }),
        d.current ? null : h('div', { class: 'mt' }, btn('연결 끊기', 'outlined', () => dialog('이 기기의 연결을 끊을까요?', '그 기기에서는 더 이상 가족방을 볼 수 없어요.', [{ label: '취소', kind: 'text' }, { label: '연결 끊기', kind: 'filled', run: async () => { try { await revokeDevice(d.uid); toast('연결을 끊었어요.'); load(); } catch (e) { toast(Store.explain(e)); } } }]), 'dev-revoke-' + i)))));
    }).catch(e => { slot.textContent = ''; slot.append(h('p', { class: 't-body', text: Store.explain(e) })); });
    load();
    body.append(btn('닫기', 'text', closeSheet, 'devices-close'));
  });
}
function openRename() {
  openSheet('내 이름 바꾸기', (body) => {
    const input = h('input', { class: 'input', id: 'rename-input', type: 'text', maxlength: '20', 'aria-label': '새 이름' }); input.value = (FirebaseAdapter.me() || {}).name || '';
    const save = async () => {
      const v = input.value.trim(); if (!v) { toast('이름을 적어 주세요.'); return; }
      try { await renameSelf(v.slice(0, 20)); S.profiles[S.myId] = { name: v.slice(0, 20) }; if (S.me) S.me.name = v.slice(0, 20); closeSheet(); toast('이름을 바꿨어요.'); render(true); } catch (e) { toast(Store.explain(e)); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.append(h('div', { class: 'field' }, h('label', { for: 'rename-input', text: '이름 (최대 20글자)' }), input), btn('저장', 'filled', save, 'rename-save'), btn('취소', 'text', closeSheet, 'rename-cancel'));
  });
}

function confirmLeave() {
  dialog('가족에서 나갈까요?', '이 기기와 가족방의 연결이 끊기고, 내 훈련·점검 기록과 알림 설정이 사라져요. 지난 대화는 "떠난 가족"으로 남아요. 다시 들어오려면 가족 코드가 필요해요.', [
    { label: '취소', kind: 'text' },
    { label: '가족 나가기', kind: 'filled', run: async () => { try { await disablePush().catch(() => {}); await leaveFamily(); disconnectData(); reloadHome(); } catch (e) { toast(Store.explain(e)); } } }]);
}
/* "삭제"라고 직접 입력해야 눌리는 마지막 확인창 */
function confirmTyped(title, text, onOk) {
  const input = h('input', { class: 'input', id: 'del-confirm-input', type: 'text', autocomplete: 'off', 'aria-label': '확인을 위해 삭제 입력', placeholder: '삭제' });
  input.addEventListener('input', () => { const b = document.getElementById('dlg-btn-1'); if (b) b.disabled = input.value.trim() !== '삭제'; });
  dialog(title, text, [{ label: '취소', kind: 'text' }, { label: '완전히 삭제', kind: 'filled', run: onOk }], null, h('div', { class: 'field mt' }, h('label', { for: 'del-confirm-input', text: '계속하려면 "삭제"라고 입력해 주세요' }), input));
  const b = document.getElementById('dlg-btn-1'); if (b) b.disabled = true;
}
async function confirmDeleteAll() {
  let owner = false; try { owner = await isOwner(); } catch (e) {}
  if (!owner) {
    dialog('내 기록을 모두 삭제할까요?', '내 훈련·점검·생활 체크 기록이 지워지고 되돌릴 수 없어요. 가족방의 대화와 다른 가족의 기록은 그대로예요. (가족방 전체 삭제는 방을 만든 분만 할 수 있어요.)', [
      { label: '취소', kind: 'text' }, { label: '내 기록 삭제', kind: 'filled', run: async () => { try { await deleteMyRecords(); toast('내 기록을 삭제했어요.'); setTimeout(reloadHome, 600); } catch (e) { toast(Store.explain(e)); } } }]);
    return;
  }
  dialog('가족방의 모든 기록을 삭제할까요?', '대화, 모든 가족의 훈련·점검·생활 체크 기록, 가족 코드와 가족방 자체가 지워지고 되돌릴 수 없어요. 다른 가족의 앱은 처음 화면으로 돌아가요. 필요하면 먼저 기록을 내려받아 두세요.', [
    { label: '취소', kind: 'text' },
    { label: '계속', kind: 'filled', run: () => setTimeout(() => confirmTyped('정말 삭제할까요?', '이 작업은 되돌릴 수 없어요.', async () => { try { await disablePush().catch(() => {}); await deleteFamily(); disconnectData(); reloadHome(); } catch (e) { toast(Store.explain(e)); } }), 50) }]);
}
function confirmDeleteLocal() {
  dialog('이 기기의 기록을 모두 삭제할까요?', '체험 모드로 저장된 훈련·점검·생활 체크 기록과 설정이 지워지고 되돌릴 수 없어요.', [
    { label: '취소', kind: 'text' }, { label: '모두 삭제', kind: 'filled', run: () => { clearLocalData(); try { localStorage.removeItem('bw.localdb'); } catch (e) {} reloadHome(); } }]);
}

export function buildRoomSection(slot) {
  if (!slot) return;
  slot.textContent = '';
  if (Store.mode === 'firebase') {
    const me = FirebaseAdapter.me() || {};
    slot.append(
      sec('가족방', h('p', { class: 't-body', text: '내 이름: ' + (me.name || '') }),
        btn('가족 코드 다시 보기 / 새로 만들기', 'tonal', openInvite, 'btn-invite'),
        btn('다른 기기로 옮기기', 'tonal', () => openTransfer(), 'btn-transfer'),
        btn('가족 기기 복구 코드 만들기', 'tonal', openRecover, 'btn-recover'),
        btn('연결된 기기', 'tonal', openDevices, 'btn-devices'),
        btn('내 이름 바꾸기', 'tonal', openRename, 'btn-rename')),
      (() => { const c = h('section', { class: 'card outlined' }, h('h2', { class: 't-title', text: '알림' })); const row = pushRow(); row.className = 'mt'; c.append(row); if (S.pushState === 'ios-install-first') c.append(iosSteps()); if (S.installEvt) c.append(btn('앱으로 설치', 'outlined', async () => { S.installEvt.prompt(); S.installEvt = null; render(true); }, 'btn-install')); return c; })(),
      sec('내 정보 정리', btn('가족 나가기', 'outlined', confirmLeave, 'btn-leave'), btn('모든 기록 삭제', 'outlined', confirmDeleteAll, 'btn-delete-all')));
  } else if (Store.mode === 'local') {
    slot.append(sec('체험 모드', h('p', { class: 't-body', text: '지금은 체험 모드예요. 기록은 이 기기에만 저장되고, 가족 대화와 알림은 쓸 수 없어요.' }), btn('모든 기록 삭제 (이 기기)', 'outlined', confirmDeleteLocal, 'btn-delete-local')));
  }
}

export function pushPromptCard() {
  if (Store.mode !== 'firebase' || LS.get('bw.pushDismiss', false)) return null;
  const st = S.pushState;
  if (st === 'granted' && pushIsOn()) return null;
  if (st === 'denied' || st === 'unsupported' || !st) return null;
  const dismiss = h('button', { class: 'btn text', type: 'button', id: 'push-later', onclick: () => { LS.set('bw.pushDismiss', true); render(true); } }, '나중에');
  if (st === 'ios-install-first') {
    return h('section', { class: 'card filled', id: 'push-card', 'aria-labelledby': 'push-h' }, h('h2', { class: 't-title', id: 'push-h', text: '알림을 받으려면 홈 화면에 추가해요' }), iosSteps(), h('div', { class: 'mt' }, dismiss));
  }
  return h('section', { class: 'card filled', id: 'push-card', 'aria-labelledby': 'push-h' }, h('h2', { class: 't-title', id: 'push-h', text: '알림을 받아 볼까요?' }),
    h('p', { class: 't-body mt', text: '훈련 시간과 가족의 응원 메시지를 알려 드려요. 언제든 설정에서 끌 수 있어요.' }),
    h('div', { class: 'row mt' }, btn('알림 받기', 'filled', ev => togglePush(ev.currentTarget), 'push-enable'), dismiss));
}
