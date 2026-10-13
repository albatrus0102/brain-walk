import { nameOf, traineeLabel, writeErrMsg } from '../../data.js';
import { sendMessage } from '../../messages.js';
import { CLINICAL_TESTS, CT, RESULTS, byTest, records, scoreText, shortName, testName } from '../../clinical/tests.js';
import { S } from '../../state.js';
import { Store } from '../../store/store.js';
import { $, esc, ymd } from '../../util.js';
import { dialog, toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { barsHtml, mdShort } from '../widgets.js';
import { go, render } from '../shell.js';

/* 병원 검사 기록 (가족 전용) */
const today = () => ymd(new Date());

/* ---- 기록 목록 ---- */
function histBars(rs) {
  const h = rs.filter(r => r.score != null && r.max).slice(0, 6).reverse(); if (h.length < 2) return '';
  return barsHtml(h.map(r => ({ t: mdShort(r.date), v: r.score / r.max * 100, s: String(r.score) })), '점수 변화');
}
export function clinicalReportHtml(withActions) {
  const groups = byTest(), keys = Object.keys(groups);
  let o = '<section class="card outlined" id="clinical-report" aria-labelledby="cl-h"><h2 class="t-title" id="cl-h">병원 검사 기록</h2>';
  if (!keys.length) o += '<p class="t-body muted mt">아직 기록이 없어요</p>';
  else {
    o += '<div class="rows mt">';
    keys.forEach(k => {
      const rs = groups[k], l = rs[0], p = rs[1];
      const d = p && l.score != null && p.score != null && l.max === p.max ? Math.round((l.score - p.score) * 100) / 100 : null;
      o += '<div id="cl-' + esc(k.replace(/[^a-z_]/g, '')) + '"><div class="rowline"><b>' + esc(testName(l)) + '</b><span class="t-small muted">' + l.date + '</span></div>' +
        '<p class="t-title">' + esc(scoreText(l)) + '</p>' +
        (l.result ? '<p><span class="refband">' + esc(l.result) + '</span></p>' : '') +
        (d != null ? '<p class="t-small">' + (d === 0 ? '지난번과 같아요' : '지난번(' + p.date.slice(5).replace('-', '/') + ')보다 ' + Math.abs(d) + '점 ' + (d > 0 ? '높아요' : '낮아요')) + '</p>' : '') +
        histBars(rs) +
        '<p class="t-small muted">' + (l.place ? esc(l.place) + ' · ' : '') + esc(nameOf(l.recordedBy)) + ' 기록</p>' + (l.memo ? '<p class="t-small" style="white-space:pre-wrap">' + esc(l.memo) + '</p>' : '') +
        (withActions ? '<div class="row"><button class="btn text fit" type="button" data-act="clshare" data-id="' + esc(l.id) + '" id="clshare-' + esc(l.id) + '">채팅에 공유</button><button class="btn text fit" type="button" data-act="cldel" data-id="' + esc(l.id) + '" id="cldel-' + esc(l.id) + '">삭제</button></div>' : '') + '</div>';
    });
    o += '</div>';
  }
  o += '<div class="mt"><button class="btn tonal" id="btn-clinical-add" type="button" data-act="clform" data-t="">검사 결과 기록하기</button></div></section>';
  return o;
}

SCREENS.clinical = {
  html() {
    return '<div class="stack"><h1 class="t-headline" id="clin-h">병원 검사 기록</h1>' +
      clinicalReportHtml(true) + '</div>';
  }
};

/* ---- 기록 폼: 꼭 필요한 것만 먼저, 나머지는 "더 입력하기" ---- */
SCREENS.clinicalForm = {
  html() {
    const c = S.cl;
    const opt = CLINICAL_TESTS.map(x => '<option value="' + x.id + '"' + (x.id === c.test ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    return '<div class="stack"><h1 class="t-headline" id="clf-h">검사 결과 기록하기</h1>' +
      '<div class="field"><label for="cl-test">어떤 검사였나요?</label><select class="input" id="cl-test">' + opt + '</select></div>' +
      (c.test === 'other' ? '<div class="field"><label for="cl-label">검사 이름</label><input class="input" id="cl-label" type="text" maxlength="30" value="' + esc(c.label || '') + '"></div>' : '') +
      '<div class="field"><label for="cl-date">검사 받은 날</label><input class="input" id="cl-date" type="date" max="' + today() + '" value="' + esc(c.date) + '"></div>' +
      '<div class="row"><div class="field" style="flex:1"><label for="cl-score">점수</label><input class="input" id="cl-score" type="number" inputmode="decimal" min="0" step="any" value="' + esc(c.score) + '"></div>' +
      '<div class="field" style="flex:1"><label for="cl-max">만점</label><input class="input" id="cl-max" type="number" inputmode="decimal" min="0" step="any" value="' + esc(c.max) + '"></div></div>' +
      '<details class="field-opt card outlined" id="cl-more"' + (c.open ? ' open' : '') + '><summary id="cl-more-sum">더 입력하기 (기관 · 결과 · 메모)</summary><div class="stack mt">' +
      '<div class="field"><label for="cl-place">기관 이름</label><input class="input" id="cl-place" type="text" maxlength="40" value="' + esc(c.place || '') + '"></div>' +
      '<div><div class="t-title-m" id="cl-res-l">결과 요약</div><div class="chips mt" role="group" aria-labelledby="cl-res-l">' + RESULTS.map((r, i) => '<button type="button" class="chip" id="cl-res-' + i + '" aria-pressed="' + (c.result === r) + '" data-act="clres" data-v="' + r + '">' + r + '</button>').join('') + '</div></div>' +
      '<div class="field"><label for="cl-memo">메모 (500자까지)</label><textarea class="input" id="cl-memo" rows="3" maxlength="500">' + esc(c.memo || '') + '</textarea></div></div></details>' +
      '<p class="t-small muted">기록한 사람: ' + esc(nameOf(S.myId)) + '</p>' +
      '<div class="cta"><button class="btn filled" id="btn-cl-save" type="button" data-act="clsave">저장하기</button><button class="btn text" id="btn-cl-cancel" type="button" data-act="clcancel">그만두기</button></div></div>';
  }
};

export function openClinicalForm(testId) {
  const t = CT[testId] || CT.cist;
  S.cl = { test: testId || 'cist', label: '', date: today(), score: '', max: t.max == null ? '' : String(t.max), maxEdited: false, place: '', result: null, memo: '', open: false };
  go('clinicalForm');
}
export function clinicalInput(el) {
  const c = S.cl; if (!c) return false;
  const id = el.id;
  if (id === 'cl-test') { c.test = el.value; if (!c.maxEdited) { const t = CT[c.test]; c.max = t && t.max != null ? String(t.max) : ''; } render(true); const n = $('#cl-test'); if (n) n.focus(); return true; }
  if (id === 'cl-label') c.label = el.value; else if (id === 'cl-date') c.date = el.value; else if (id === 'cl-score') c.score = el.value;
  else if (id === 'cl-max') { c.max = el.value; c.maxEdited = true; } else if (id === 'cl-place') c.place = el.value; else if (id === 'cl-memo') c.memo = el.value; else return false;
  return true;
}
export async function saveClinical() {
  const c = S.cl, num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '') || c.date > today()) { toast('검사 받은 날을 확인해 주세요.'); return; }
  const score = num(c.score), max = num(c.max);
  if (score != null && score < 0) { toast('점수는 0 이상이어야 해요.'); return; }
  if (max != null && max <= 0) { toast('만점은 0보다 커야 해요.'); return; }
  if (score != null && max != null && score > max) { toast('점수가 만점보다 클 수 없어요.'); return; }
  if (c.test === 'other' && !(c.label || '').trim()) { c.open = false; toast('검사 이름을 적어 주세요.'); return; }
  const doc = { test: c.test, date: c.date, recordedBy: S.myId || 'local', ts: Date.now() };
  if (score != null) doc.score = score; if (max != null) doc.max = max;
  if (c.test === 'other') doc.testLabel = c.label.trim().slice(0, 30);
  if ((c.place || '').trim()) doc.place = c.place.trim().slice(0, 40);
  if (c.result) doc.result = c.result;
  if ((c.memo || '').trim()) doc.memo = c.memo.trim().slice(0, 500);
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  try { await Store.setDoc('clinicalTests/' + id, doc); S.cl = null; go('clinical'); }
  catch (e) { toast(writeErrMsg(e)); }
}
export function shareClinical(id) {
  const r = records().find(x => x.id === id); if (!r) return;
  dialog(traineeLabel() + '도 대화방을 보세요. 공유할까요?', shortName(r) + ' · ' + scoreText(r) + ' (' + r.date + ') 기록 카드를 가족 대화방에 올려요.', [
    { label: '취소', kind: 'text' },
    { label: '공유하기', kind: 'filled', run: async () => { const ok = await sendMessage({ kind: 'record', text: '', record: { type: 'clinical', ref: r.id, title: '병원 검사 기록 · ' + shortName(r) + ' ' + scoreText(r) + ' · ' + r.date.slice(5).replace('-', '월 ') + '일' + (r.result ? ' · ' + r.result : ''), score: null } }); toast(ok ? '대화방에 공유했어요.' : '공유하려면 가족방에 들어와 있어야 해요.'); } }]);
}
export function deleteClinical(id) {
  dialog('이 기록을 삭제할까요?', '삭제하면 되돌릴 수 없어요.', [{ label: '취소', kind: 'text' }, { label: '삭제', kind: 'filled', run: async () => { try { await Store.deleteDoc('clinicalTests/' + id); toast('삭제했어요.'); } catch (e) { toast(writeErrMsg(e)); } } }]);
}
