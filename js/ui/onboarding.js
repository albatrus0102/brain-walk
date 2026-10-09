import { Platform } from '../platform.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { FirebaseAdapter } from '../store/firebase-adapter.js';
import { createFamily, inviteLink, inviteText, joinFamily, normalizeCode, previewJoinCode, redeemTransfer, setTrainee } from '../store/membership.js';
import { enterApp, startFlow, startLocalDemo } from '../boot.js';
import { LS } from '../util.js';
import { dialog, h, toast } from './dom.js';
import { SCREENS } from './registry.js';
import { go } from './shell.js';

/* 설정 안내 / 가입(만들기·들어가기·기기 옮기기) 화면.
 * 모든 화면은 #ob-root 안에 DOM 으로 그려요. 입력 상태는 S.ob 에 둬요. */
const NAMES = ['아버지', '어머니', '큰아들', '큰딸', '나'];
const KAKAO_BTN = '카톡으로 초대 보내기';

const root = () => document.getElementById('ob-root');
const ob = () => (S.ob = S.ob || {});
const card = (cls, ...kids) => h('section', { class: 'card ' + cls }, ...kids);
const big = (label, cls, onclick, id) => h('button', { class: 'btn ' + cls, type: 'button', id, onclick }, label);
const errP = () => h('p', { class: 'fb soft', role: 'alert', id: 'ob-err', hidden: true });
const showErr = (msg) => { const e = document.getElementById('ob-err'); if (e) { e.textContent = msg; e.hidden = !msg; } };

const disclaimerCard = () => card('tertiary', h('p', { class: 't-body', text: '이 앱은 두뇌 활동을 돕는 생활 도구이며 의료기기가 아니에요. 진단·치료를 대신하지 않아요. 걱정되는 변화가 있으면 치매안심센터(1899-9988)나 병원과 상담하세요.' }));
const privacyCard = () => card('outlined', h('h2', { class: 't-title-m', text: '저장되는 정보' }),
  h('p', { class: 't-small muted mt', text: '이름, 훈련·점검 기록, 생활 체크, 대화가 저장돼요. 같은 가족방에 들어온 가족만 볼 수 있고, 설정에서 언제든 삭제할 수 있어요. 데이터는 Google Firebase(서울 리전)에 저장되며, 알림과 로그인에 쓰이는 Google 서비스는 해외에서 처리될 수 있어요.' }));

function iosCard(code) {
  if (!(Platform.isIOS() && !Platform.isStandalone())) return null;
  return card('filled', h('h2', { class: 't-title-m', text: '아이폰이라면 먼저 홈 화면에 추가해요' }),
    h('p', { class: 't-body mt', text: '공유 → 홈 화면에 추가 후 알림을 켤 수 있어요. 홈 화면의 앱은 사파리와 저장 공간이 따로라서, 홈 화면 앱을 연 뒤에 가입하면 한 번에 끝나요.' }),
    code ? h('p', { class: 't-body mt', text: '홈 화면 앱을 연 뒤 이 코드를 입력해 주세요:' }) : null,
    code ? h('p', { class: 't-display center', id: 'ob-ios-code', text: code }) : null);
}

/* ---------- 설정이 비어 있을 때 ---------- */
SCREENS.setup = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    root().append(
      h('h1', { class: 't-headline', id: 'setup-h', text: '관리자 설정이 필요해요' }),
      card('outlined', h('p', { class: 't-body', text: '가족과 함께 쓰려면 먼저 Firebase 연결 정보(firebase-config.js)를 채워야 해요. 이 앱을 설치한 분(관리자)이 한 번만 설정하면 돼요.' }),
        h('p', { class: 't-body mt', text: '자세한 순서는 저장소의 README.md 를 따라 주세요. (Firebase 프로젝트 만들기 → 설정값 붙여넣기 → GitHub Pages 켜기)' })),
      card('primary', h('h2', { class: 't-title', text: '먼저 둘러보고 싶으세요?' }), h('p', { class: 't-body mt', text: '체험 모드에서는 모든 훈련을 써 볼 수 있어요. 기록은 이 기기에만 저장되고, 가족 대화와 알림은 쓸 수 없어요.' }),
        h('div', { class: 'mt' }, big('체험 모드 (이 기기에만 저장)', 'filled', () => startLocalDemo(), 'btn-demo'))),
      disclaimerCard());
  }
};

/* ---------- 연결 실패 ---------- */
SCREENS['ob-error'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    root().append(h('h1', { class: 't-headline', id: 'err-h', text: '연결하지 못했어요' }),
      card('outlined', h('p', { class: 't-body', text: '인터넷 연결을 확인하고 다시 시도해 주세요. 계속 안 되면 관리자에게 Firebase 설정(README 의 문제 해결)을 확인해 달라고 해 주세요.' })),
      big('다시 시도', 'filled', async () => { const r = await Store.retry(); await afterInit(r); }, 'btn-retry'),
      big('체험 모드 (이 기기에만 저장)', 'tonal', () => startLocalDemo(false), 'btn-demo'));
  }
};

/* init 결과에 따라 다음 화면으로 */
export async function afterInit(result) {
  if (result === 'ready') return enterApp();
  if (result === 'onboarding') {
    const q = new URLSearchParams(location.search), j = q.get('join'), t = q.get('transfer');
    if (t) { ob().tcode = normalizeCode(t).code; return go('ob-transfer'); }
    if (j) { ob().code = normalizeCode(j).code; ob().fromLink = true; return go('ob-join'); }
    return go('ob-start');
  }
  return go(result === 'setup' ? 'setup' : 'ob-error');
}

/* ---------- 1. 처음 화면 ---------- */
SCREENS['ob-start'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    root().append(
      h('h1', { class: 't-headline', id: 'ob-start-h', text: '오늘의 두뇌 산책에 오신 걸 환영해요' }),
      h('p', { class: 't-body muted', text: '가족이 함께 응원하는 두뇌 훈련 앱이에요. 먼저 가족방을 만들거나, 받은 코드로 들어가 주세요.' }),
      iosCard(null),
      big('새 가족 만들기', 'filled', () => { ob().flow = 'create'; go('ob-name'); }, 'btn-create'),
      big('가족 코드로 들어가기', 'tonal', () => { ob().code = ''; go('ob-join'); }, 'btn-join'),
      h('button', { class: 'btn text', type: 'button', id: 'btn-have-transfer', onclick: () => { ob().tcode = ''; go('ob-transfer'); } }, '기기 옮기기 코드가 있어요'),
      privacyCard(), disclaimerCard());
  }
};

/* ---------- 2a. 가족 코드 입력 ---------- */
SCREENS['ob-join'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    const o = ob(), input = h('input', { class: 'input', id: 'join-code', type: 'text', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: '14', 'aria-label': '가족 코드 6자리', placeholder: 'ABC234' });
    input.value = o.code || '';
    const next = async () => {
      const n = normalizeCode(input.value);
      if (n.bad) { showErr('0(영)·O, 1·I는 코드에 쓰지 않아요. 다시 확인해 주세요.'); return; }
      if (!n.valid) { showErr('코드는 6글자예요. 가족에게 받은 코드를 확인해 주세요.'); return; }
      btn.disabled = true; showErr('');
      try { await previewJoinCode(n.code); o.code = n.code; o.flow = 'join'; go('ob-name'); }
      catch (e) { showErr('코드가 맞지 않거나 기간이 지났어요. 가족에게 새 코드를 부탁해 보세요.'); btn.disabled = false; }
    };
    const btn = big('다음', 'filled', next, 'btn-join-next');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') next(); });
    root().append(
      h('h1', { class: 't-headline', id: 'join-h', text: '가족 코드를 입력해 주세요' }),
      o.fromLink ? card('primary', h('p', { class: 't-body', text: '초대 링크로 오셨네요. 코드가 미리 입력되어 있어요.' })) : null,
      iosCard(o.code || null),
      h('div', { class: 'field' }, h('label', { for: 'join-code', text: '가족 코드 (6글자)' }), input),
      errP(), btn,
      h('button', { class: 'btn text', type: 'button', id: 'btn-join-back', onclick: () => go('ob-start') }, '처음으로'));
    input.focus();
  }
};

/* ---------- 2b. 기기 옮기기 코드 입력 ---------- */
SCREENS['ob-transfer'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    const o = ob(), input = h('input', { class: 'input', id: 'transfer-code', type: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: '14', 'aria-label': '기기 옮기기 코드 6자리' });
    input.value = o.tcode || '';
    const go1 = async () => {
      const n = normalizeCode(input.value);
      if (!n.valid) { showErr(n.bad ? '0(영)·O, 1·I는 코드에 쓰지 않아요.' : '코드는 6글자예요.'); return; }
      btn.disabled = true; showErr('');
      try { await redeemTransfer(n.code); Store.becomeMember(); toast('이 기기를 연결했어요.'); await enterApp(); }
      catch (e) { showErr('코드가 맞지 않거나 기간이 지났어요. 이전 기기에서 새 코드를 만들어 주세요.'); btn.disabled = false; }
    };
    const btn = big('이 기기로 옮기기', 'filled', go1, 'btn-transfer-go');
    root().append(h('h1', { class: 't-headline', id: 'tr-h', text: '기기 옮기기 코드를 입력해 주세요' }),
      h('p', { class: 't-body muted', text: '이전 기기의 설정에서 "다른 기기로 옮기기"를 누르면 코드가 나와요. 코드는 잠깐만 쓸 수 있고 한 번만 쓸 수 있어요.' }),
      h('div', { class: 'field' }, h('label', { for: 'transfer-code', text: '옮기기 코드 (6글자)' }), input), errP(), btn,
      h('button', { class: 'btn text', type: 'button', onclick: () => go('ob-start') }, '처음으로'));
    input.focus();
  }
};

/* ---------- 3. 이름 ---------- */
SCREENS['ob-name'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    const o = ob(), input = h('input', { class: 'input', id: 'ob-name-input', type: 'text', maxlength: '20', autocomplete: 'off', 'aria-label': '이름', placeholder: '예: 아버지, 큰아들' });
    input.value = o.name || '';
    const next = () => { const v = input.value.trim(); if (!v) { showErr('이름을 적어 주세요.'); return; } o.name = v.slice(0, 20); go('ob-role'); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') next(); });
    root().append(h('h1', { class: 't-headline', id: 'ob-name-h', text: '이름을 알려 주세요' }),
      h('p', { class: 't-body muted', text: '가족방에서 보이는 이름이에요. (최대 20글자)' }),
      h('div', { class: 'field' }, h('label', { for: 'ob-name-input', text: '내 이름' }), input),
      h('div', { class: 'chips', 'aria-label': '이름 예시' }, NAMES.map((n, i) => h('button', { class: 'chip', type: 'button', id: 'name-chip-' + i, onclick: () => { input.value = n; input.focus(); } }, n))),
      errP(), big('다음', 'filled', next, 'btn-name-next'),
      h('button', { class: 'btn text', type: 'button', onclick: () => go(o.flow === 'join' ? 'ob-join' : 'ob-start') }, '이전'));
    input.focus();
  }
};

/* ---------- 4. 역할 → 만들기/들어가기 실행 ---------- */
SCREENS['ob-role'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    const o = ob();
    const pick = async role => {
      o.role = role; showErr(''); document.querySelectorAll('#ob-root button').forEach(b => { b.disabled = true; });
      try {
        if (o.flow === 'join') {
          const r = await joinFamily({ code: o.code, name: o.name, role });
          Store.becomeMember(); S.roleLocal = role; LS.set('bw.role', role); LS.set('bw.roleAsked', true);
          if (r.needsConfirm) {
            dialog('이미 훈련하는 분이 있어요', '이 가족방에는 훈련하는 분이 등록되어 있어요. 내가 훈련하는 분으로 바꿀까요?', [
              { label: '바꾸기', kind: 'filled', run: async () => { try { await setTrainee(); } catch (e) {} } },
              { label: '가족으로 쓸게요', kind: 'text', run: async () => { try { await FirebaseAdapter.updateDoc('members/' + FirebaseAdapter.mid, { role: 'family' }); } catch (e) {} S.roleLocal = 'family'; LS.set('bw.role', 'family'); } }
            ], () => enterApp());
          } else await enterApp();
        } else {
          const r = await createFamily({ name: o.name, role });
          Store.becomeMember(); S.roleLocal = role; LS.set('bw.role', role); LS.set('bw.roleAsked', true); o.invite = { code: r.code }; await enterApp({ stayOn: 'ob-invite' });
        }
      } catch (e) {
        document.querySelectorAll('#ob-root button').forEach(b => { b.disabled = false; });
        showErr(e && e.code === 'bad-code' ? '코드가 맞지 않거나 기간이 지났어요.' : '만들지 못했어요. 인터넷 연결을 확인하고 다시 해 보세요.');
      }
    };
    const choice = (id, title, desc, role) => h('button', { class: 'gamebtn', type: 'button', id, onclick: () => pick(role) }, h('span', {}, h('strong', { text: title }), h('span', { class: 't-small muted', text: desc })));
    root().append(h('h1', { class: 't-headline', id: 'ob-role-h', text: o.name + '님은 어떻게 쓰세요?' }),
      h('p', { class: 't-body muted', text: '나중에 설정에서 바꿀 수 있어요.' }),
      h('div', { class: 'pick-list' },
        choice('role-trainee', '훈련하는 분', '매일 두뇌 훈련을 하는 분이에요', 'trainee'),
        choice('role-family', '가족', '훈련하는 분의 기록을 보고 응원해요', 'family')),
      errP(), h('button', { class: 'btn text', type: 'button', onclick: () => go('ob-name') }, '이전'));
  }
};

/* ---------- 5. 초대 (만들기 직후, 설정에서도 재사용) ---------- */
export function inviteBlock(code, opts) {
  opts = opts || {};
  const link = inviteLink(code), label = (S.trainee && S.trainee.displayLabel) || '아버지';
  const linkBox = h('input', { class: 'input', id: (opts.prefix || 'inv') + '-link', readonly: '', value: link, 'aria-label': '초대 링크' });
  const textBox = h('textarea', { class: 'input copybox', id: (opts.prefix || 'inv') + '-textbox', readonly: '', hidden: '', rows: '4', 'aria-label': '복사할 초대 문구' });
  const copy = async (text, el, okMsg, id) => { const ok = await Platform.copy(text, el); toast(ok ? okMsg : '길게 눌러 직접 복사해 주세요.'); };
  const codeBtn = h('button', { class: 'btn tonal', type: 'button', id: (opts.prefix || 'inv') + '-copy-code', onclick: () => copy(code, textBox, '코드를 복사했어요.') }, '코드 복사');
  codeBtn.onclick = () => { textBox.value = code; copy(code, textBox, '코드를 복사했어요.'); };
  const linkBtn = h('button', { class: 'btn tonal', type: 'button', id: (opts.prefix || 'inv') + '-copy-link', onclick: () => copy(link, linkBox, '링크를 복사했어요.') }, '링크 복사');
  const kakao = h('button', { class: 'btn filled', type: 'button', id: (opts.prefix || 'inv') + '-kakao', onclick: () => { const t = inviteText(code, label); textBox.value = t; copy(t, textBox, '초대 문구를 복사했어요. 카톡에 붙여넣어 보내세요.'); } }, KAKAO_BTN);
  const kids = [h('p', { class: 't-label', text: '가족 코드' }), h('p', { class: 't-display center', id: (opts.prefix || 'inv') + '-code', text: code, style: 'letter-spacing:.2em;user-select:all' }), codeBtn,
    h('div', { class: 'field' }, h('label', { for: (opts.prefix || 'inv') + '-link', text: '초대 링크' }), linkBox), linkBtn, kakao];
  if (navigator.share) kids.push(h('button', { class: 'btn outlined', type: 'button', id: (opts.prefix || 'inv') + '-share', onclick: () => navigator.share({ title: '오늘의 두뇌 산책', text: inviteText(code, label) }).catch(() => {}) }, '다른 앱으로 공유'));
  kids.push(textBox);
  return h('div', { class: 'stack' }, kids);
}
SCREENS['ob-invite'] = {
  html() { return '<div class="stack" id="ob-root"></div>'; },
  bind() {
    const code = (ob().invite || {}).code;
    root().append(h('h1', { class: 't-headline', id: 'inv-h', text: '가족방을 만들었어요!' }),
      h('p', { class: 't-body muted', text: '아래 코드나 링크를 가족에게 보내 주세요. 코드는 7일 동안 쓸 수 있고, 설정에서 다시 보거나 새로 만들 수 있어요.' }),
      card('primary', inviteBlock(code, { prefix: 'inv' })),
      big('시작하기', 'filled', () => { LS.set('bw.roleAsked', true); go('home'); startFlow(); }, 'btn-inv-done'));
  }
};
