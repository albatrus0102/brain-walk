import { adminNames, isAdmin, isOwnerNow, isTraineeId, traineeLabel, trainees } from '../../data.js';
import { FirebaseAdapter } from '../../store/firebase-adapter.js';
import { addTrainee, grantAdmin, removeMember, removeTrainee, revokeAdmin, setMemberRole, setTraineeLabel } from '../../store/membership.js';
import { S } from '../../state.js';
import { Store } from '../../store/store.js';
import { LABEL_CHOICES, MAX_TRAINEES } from '../../trainees.js';
import { ACTS } from '../acts.js';
import { closeSheet, dialog, h, openSheet, toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { btn, openInvite, openTransfer } from '../room-settings.js';
import { render } from '../shell.js';
import { esc } from '../../util.js';

/* 가족 구성원 (DESIGN-MULTI §6.5): 누가 훈련하는 분(최대 4명)이고 관리자인지 보고, 관리자는 훈련하는 분을 더하거나 빼고, 모르는 사람은 내보내요. */
const ms = () => FirebaseAdapter.members();
const joined = m => (m.joinedTs && m.joinedTs.toMillis ? m.joinedTs.toMillis() : Number(m.joinedTs) || 0);
const isAdminId = id => id === S.family.ownerMemberId || ((S.family.admins || []).includes(id) && (ms()[id] || {}).role === 'family');
function rows() {
  const all = Object.entries(ms()).filter(([, m]) => m && !m.leftTs), T = trainees(), o = S.family.ownerMemberId;
  const rank = id => (id === o ? -1 : T.includes(id) ? T.indexOf(id) : 10);
  return all.sort((a, b) => rank(a[0]) - rank(b[0]) || joined(a[1]) - joined(b[1]));
}
/* 역할이 'trainee' 인데 목록에 없음 (준비 중) / 목록에 있는데 역할이 'trainee' 가 아님 */
const pendingOf = (id, m) => m.role === 'trainee' && !isTraineeId(id);
const wrongRole = (id, m) => isTraineeId(id) && m.role !== 'trainee';
const refresh = async () => { try { await FirebaseAdapter.refreshMembers(); } catch (e) {} if (S.screen === 'members') render(true); };
const fail = e => toast(e && e.code === 'max-trainees' ? '훈련하는 분은 ' + MAX_TRAINEES + '명까지예요' : Store.explain(e, true));

SCREENS.members = {
  html() {
    if (Store.mode !== 'firebase') return '<div class="stack"><h1 class="t-headline" id="mem-h">가족 구성원</h1></div>';
    const admin = isAdmin(), me = FirebaseAdapter.mid;
    return '<div class="stack"><h1 class="t-headline" id="mem-h">가족 구성원</h1>' +
      '<ul class="mlist" id="mem-list">' + rows().map(([id, m], i) => {
        const badges = (isTraineeId(id) ? '<span class="pill tr">훈련하는 분 · ' + esc(traineeLabel(id)) + '</span>' : '') + (id === S.family.ownerMemberId ? '<span class="pill">방 주인</span>' : '') + (isAdminId(id) ? '<span class="pill ad">관리자</span>' : '') + (id === me ? '<span class="pill me">나</span>' : '');
        return '<li><button type="button" class="hub-item mrow" id="mem-' + i + '" data-act="mem-open" data-id="' + esc(id) + '"><span><strong>' + esc(m.name || '가족') + '</strong><span class="badges">' + badges + '</span>' +
          (admin && pendingOf(id, m) ? '<span class="sub pend" id="mem-pend-' + i + '">준비 중</span>' : '') +
          (admin && wrongRole(id, m) ? '<span class="sub warn" id="mem-warn-' + i + '">역할이 맞지 않아요</span>' : '') + '</span><span class="t-title-m" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul>' +
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
  const nm = String(m.name || '가족'), admin = isAdmin(), me = FirebaseAdapter.mid, isT = isTraineeId(id), owner = id === S.family.ownerMemberId;
  openSheet(nm, (body) => {
    const tags = [isT ? '훈련하는 분 · ' + traineeLabel(id) : (pendingOf(id, m) ? '준비 중' : ''), owner ? '방 주인' : '', isAdminId(id) ? '관리자' : (isT ? '' : '가족')].filter(Boolean);
    body.append(h('p', { class: 't-body muted', id: 'mem-desc', text: tags.join(' · ') }));
    if (!admin) { body.append(btn('닫기', 'text', closeSheet, 'mem-close')); return; }
    if (wrongRole(id, m)) body.append(btn('역할 고치기', 'filled', async () => { try { await setMemberRole(id, 'trainee'); closeSheet(); toast('고쳤어요.'); await refresh(); } catch (e) { fail(e); } }, 'mem-fix'));
    if (!isT && trainees().length < MAX_TRAINEES) body.append(btn('훈련하는 분으로 정하기', pendingOf(id, m) ? 'filled' : 'tonal', () => openLabel(id, nm, true), 'mem-assign'));
    if (isT) {
      body.append(btn('훈련하는 분 해제', 'tonal', () => dialog(nm + '님을 훈련하는 분에서 뺄까요?', '', [{ label: '취소', kind: 'text' }, { label: '해제', kind: 'filled', run: async () => { try { await removeTrainee(id); closeSheet(); toast('해제했어요.'); await refresh(); } catch (e) { fail(e); } } }]), 'mem-clear'));
      body.append(btn('호칭 바꾸기', 'tonal', () => openLabel(id, nm, false), 'mem-label'));
    }
    if (isOwnerNow() && !owner && m.role === 'family') {
      const adm = (S.family.admins || []).includes(id);
      body.append(btn(adm ? '관리자 해제' : '관리자로 정하기', 'tonal', () => dialog(adm ? nm + '님의 관리자 권한을 끌까요?' : nm + '님을 관리자로 정할까요?', '', [{ label: '취소', kind: 'text' }, { label: adm ? '해제' : '정하기', kind: 'filled', run: async () => { try { await (adm ? revokeAdmin(id) : grantAdmin(id)); closeSheet(); toast(adm ? '관리자를 해제했어요.' : '관리자로 정했어요.'); } catch (e) { fail(e); } } }]), adm ? 'mem-revoke' : 'mem-grant'));
    }
    if (id !== me) body.append(btn('새 기기 연결 코드 만들기', 'tonal', () => openTransfer(id, nm), 'mem-transfer'));
    if (id !== me && !owner) body.append(btn('가족방에서 내보내기', 'outlined', () => dialog(nm + '님을 내보낼까요?', '', [{ label: '취소', kind: 'text' }, { label: '내보내기', kind: 'filled', run: async () => {
      try { if (isTraineeId(id)) await removeTrainee(id); await removeMember(id); closeSheet(); await refresh(); setTimeout(() => dialog('가족 코드를 새로 만들까요?', '', [{ label: '나중에', kind: 'text' }, { label: '새로 만들기', kind: 'filled', run: () => openInvite() }]), 300); } catch (e) { fail(e); }
    } }]), 'mem-remove'));
    body.append(btn('닫기', 'text', closeSheet, 'mem-close'));
  });
}
/* 호칭 입력 시트: add=true 면 "훈련하는 분으로 정하기" (다른 훈련하는 분은 그대로예요) */
function openLabel(id, nm, add) {
  openSheet(add ? nm : '호칭 바꾸기', (body) => {
    const input = h('input', { class: 'input', id: 'label-input', type: 'text', maxlength: '12', 'aria-label': '호칭' }); input.value = add ? '' : traineeLabel(id);
    const save = async () => {
      const v = input.value.trim(); if (!v) { input.focus(); return; }
      try { if (add) { await addTrainee(id, v); toast(nm + '님을 훈련하는 분으로 정했어요.'); } else { await setTraineeLabel(id, v); toast('호칭을 바꿨어요.'); } closeSheet(); await refresh(); } catch (e) { fail(e); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.append(h('div', { class: 'field' }, h('label', { for: 'label-input', text: '호칭' }), input), h('div', { class: 'chips' }, LABEL_CHOICES.map((n, i) => h('button', { class: 'chip', type: 'button', id: 'label-chip-' + i, onclick: () => { input.value = n; } }, n))), btn(add ? '정하기' : '저장', 'filled', save, 'label-save'), btn('취소', 'text', closeSheet, 'label-cancel'));
  });
}
ACTS['mem-open'] = b => openMember(b.dataset.id);
