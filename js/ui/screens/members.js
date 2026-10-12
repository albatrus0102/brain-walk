import { adminNames, isAdmin, isOwnerNow, traineeId, traineeLabel } from '../../data.js';
import { FirebaseAdapter } from '../../store/firebase-adapter.js';
import { assignTrainee, clearTrainee, grantAdmin, removeMember, revokeAdmin, setMemberRole, setTraineeLabel } from '../../store/membership.js';
import { S } from '../../state.js';
import { Store } from '../../store/store.js';
import { ACTS } from '../acts.js';
import { closeSheet, dialog, h, openSheet, toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { btn, openInvite, openTransfer } from '../room-settings.js';
import { render } from '../shell.js';
import { esc } from '../../util.js';

/* 가족 구성원 (DESIGN.md §6.4, 결정 3): 누가 훈련하는 분이고 관리자인지 보고, 관리자는 훈련하는 분을 정하거나 모르는 사람을 내보내요. */
const ms = () => FirebaseAdapter.members();
const joined = m => (m.joinedTs && m.joinedTs.toMillis ? m.joinedTs.toMillis() : Number(m.joinedTs) || 0);
const isAdminId = id => id === S.family.ownerMemberId || ((S.family.admins || []).includes(id) && (ms()[id] || {}).role === 'family');
function rows() {
  const all = Object.entries(ms()).filter(([, m]) => m && !m.leftTs), t = traineeId(), o = S.family.ownerMemberId;
  const rank = id => (id === o ? 0 : id === t ? 1 : 2);
  return all.sort((a, b) => rank(a[0]) - rank(b[0]) || joined(a[1]) - joined(b[1]));
}
const mismatch = (id, m) => (id === traineeId() && m.role !== 'trainee') || (m.role === 'trainee' && id !== traineeId());
const refresh = async () => { try { await FirebaseAdapter.refreshMembers(); } catch (e) {} if (S.screen === 'members') render(true); };
const fail = e => toast(Store.explain(e, true));

SCREENS.members = {
  html() {
    if (Store.mode !== 'firebase') return '<div class="stack"><h1 class="t-headline" id="mem-h">가족 구성원</h1><p class="t-body" id="mem-demo">체험 모드에서는 한 사람만 있어요. 가족방을 만들면 가족 구성원을 정할 수 있어요.</p></div>';
    const admin = isAdmin(), me = FirebaseAdapter.mid;
    return '<div class="stack"><h1 class="t-headline" id="mem-h">가족 구성원</h1>' +
      (admin ? '<p class="t-body muted">이름을 누르면 할 수 있는 일이 나와요. 모르는 사람이 들어왔다면 내보내고, 가족 코드를 새로 만들어 주세요.</p>' : '<p class="t-body muted" id="admin-note">관리자만 바꿀 수 있어요. 관리자: ' + esc(adminNames().join(', ') || '방 주인') + '</p>') +
      '<ul class="mlist" id="mem-list">' + rows().map(([id, m], i) => {
        const badges = (id === traineeId() ? '<span class="pill tr">훈련하는 분</span>' : '') + (id === S.family.ownerMemberId ? '<span class="pill">방 주인</span>' : '') + (isAdminId(id) ? '<span class="pill ad">관리자</span>' : '') + (id === me ? '<span class="pill me">나</span>' : '');
        return '<li><button type="button" class="hub-item mrow" id="mem-' + i + '" data-act="mem-open" data-id="' + esc(id) + '"><span><strong>' + esc(m.name || '가족') + '</strong><span class="badges">' + badges + '</span>' +
          (admin && mismatch(id, m) ? '<span class="sub warn" id="mem-warn-' + i + '">역할이 맞지 않아요</span>' : '') + '</span><span class="t-title-m" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul>' +
      (admin && rows().some(([id, m]) => mismatch(id, m)) ? '<p class="t-small muted">‘역할이 맞지 않아요’가 보이면 그 사람을 눌러 ‘고치기’를 해 주세요.</p>' : '') +
      '<button class="btn tonal" id="btn-mem-invite" type="button" data-act="row-invite">가족 초대 코드 보기</button></div>';
  },
  bind() {
    if (Store.mode !== 'firebase') return;
    const off = FirebaseAdapter.onMembers(() => { if (S.screen === 'members' && document.getElementById('sheet').hidden) render(true); });
    S.onLeave = () => off();
  }
};
function openMember(id) {
  const m = ms()[id]; if (!m) return;
  const nm = String(m.name || '가족'), admin = isAdmin(), me = FirebaseAdapter.mid, t = traineeId(), isT = id === t, owner = id === S.family.ownerMemberId;
  openSheet(nm, (body) => {
    body.append(h('p', { class: 't-body muted', id: 'mem-desc', text: (isT ? '훈련하는 분이에요. ' : '') + (owner ? '방 주인이에요. ' : '') + (isAdminId(id) ? '관리자예요.' : (isT ? '' : '가족이에요.')) }));
    if (!admin) { body.append(h('p', { class: 't-body', id: 'mem-ro', text: '관리자만 바꿀 수 있어요.' }), btn('닫기', 'text', closeSheet, 'mem-close')); return; }
    const old = t && ms()[t] ? String(ms()[t].name || '가족') : '';
    const label = traineeLabel();
    if (mismatch(id, m)) body.append(btn('역할 고치기', 'filled', async () => { try { await setMemberRole(id, isT ? 'trainee' : 'family'); closeSheet(); toast('고쳤어요.'); await refresh(); } catch (e) { fail(e); } }, 'mem-fix'));
    if (!isT) body.append(btn('훈련하는 분으로 정하기', 'tonal', () => dialog(nm + '님을 훈련하는 분으로 정할까요?', nm + '님의 휴대폰이 훈련 화면으로 바뀌어요.' + (old ? ' 지금 훈련하는 분(' + old + ')은 가족으로 바뀌어요.' : '') + (isAdminId(id) || (S.family.admins || []).includes(id) ? ' ' + nm + '님의 관리자 권한도 꺼져요.' : ''), [{ label: '취소', kind: 'text' }, { label: '정하기', kind: 'filled', run: async () => { try { await assignTrainee(id, label, t); closeSheet(); toast(nm + '님을 훈련하는 분으로 정했어요.'); await refresh(); } catch (e) { fail(e); } } }]), 'mem-assign'));
    if (isT) {
      body.append(btn('훈련하는 분 해제', 'tonal', () => dialog('훈련하는 분을 해제할까요?', '훈련하는 분이 없어지고, ' + nm + '님은 가족으로 바뀌어요.', [{ label: '취소', kind: 'text' }, { label: '해제', kind: 'filled', run: async () => { try { await clearTrainee(id); closeSheet(); toast('해제했어요.'); await refresh(); } catch (e) { fail(e); } } }]), 'mem-clear'));
      body.append(btn('호칭 바꾸기', 'tonal', () => openLabel(), 'mem-label'));
    }
    if (isOwnerNow() && !owner && m.role === 'family') {
      const adm = (S.family.admins || []).includes(id);
      body.append(btn(adm ? '관리자 해제' : '관리자로 정하기', 'tonal', () => dialog(adm ? nm + '님의 관리자 권한을 끌까요?' : nm + '님을 관리자로 정할까요?', adm ? '관리자 권한이 없어져요.' : nm + '님도 훈련 계획, 화면, 알람, 가족 구성원을 바꿀 수 있게 돼요.', [{ label: '취소', kind: 'text' }, { label: adm ? '해제' : '정하기', kind: 'filled', run: async () => { try { await (adm ? revokeAdmin(id) : grantAdmin(id)); closeSheet(); toast(adm ? '관리자를 해제했어요.' : '관리자로 정했어요.'); } catch (e) { fail(e); } } }]), adm ? 'mem-revoke' : 'mem-grant'));
    }
    if (id !== me) body.append(btn('새 기기 연결 코드 만들기', 'tonal', () => openTransfer(id, nm), 'mem-transfer'));
    if (id !== me && !owner) body.append(btn('가족방에서 내보내기', 'outlined', () => dialog(nm + '님을 내보낼까요?', nm + '님의 기기에서 가족방이 닫혀요. 지난 대화와 기록은 남아요. 다시 들어오지 못하게 가족 코드도 새로 만드는 것이 좋아요.', [{ label: '취소', kind: 'text' }, { label: '내보내기', kind: 'filled', run: async () => {
      try { await removeMember(id); closeSheet(); toast(nm + '님을 내보냈어요.'); await refresh(); setTimeout(() => dialog('가족 코드를 새로 만들까요?', '이전 코드로는 더 이상 들어올 수 없게 돼요.', [{ label: '나중에', kind: 'text' }, { label: '새로 만들기', kind: 'filled', run: () => openInvite() }]), 300); } catch (e) { fail(e); }
    } }]), 'mem-remove'));
    body.append(btn('닫기', 'text', closeSheet, 'mem-close'));
  });
}
function openLabel() {
  openSheet('호칭 바꾸기', (body) => {
    const input = h('input', { class: 'input', id: 'label-input', type: 'text', maxlength: '12', 'aria-label': '가족이 부르는 호칭' }); input.value = traineeLabel();
    const save = async () => { const v = input.value.trim(); if (!v) { toast('호칭을 적어 주세요.'); return; } try { await setTraineeLabel(v); closeSheet(); toast('호칭을 바꿨어요.'); } catch (e) { fail(e); } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.append(h('div', { class: 'field' }, h('label', { for: 'label-input', text: '가족이 부르는 호칭 (최대 12글자)' }), input), h('div', { class: 'chips' }, ['아버지', '어머니', '할머니', '할아버지'].map((n, i) => h('button', { class: 'chip', type: 'button', id: 'label-chip-' + i, onclick: () => { input.value = n; } }, n))), btn('저장', 'filled', save, 'label-save'), btn('취소', 'text', closeSheet, 'label-cancel'));
  });
}
ACTS['mem-open'] = b => openMember(b.dataset.id);
