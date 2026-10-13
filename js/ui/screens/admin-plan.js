import { allAssessments, isAdmin, todayProgressDoc, todayS, traineeLabel, writeErrMsg } from '../../data.js';
import { DOM, GAMES, catalog } from '../../games/registry.js';
import { buildIcs } from '../../logic.js';
import { Platform } from '../../platform.js';
import { buildCourse, estimateMinutes, normalizePlan, planProblems } from '../../program.js';
import { S } from '../../state.js';
import { savePlan } from '../../store/membership.js';
import { ACTS } from '../acts.js';
import { dialog, toast } from '../dom.js';
import { MON_FIRST, autoNextText, checkText, daysText, levelText } from '../plan-text.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { adminOnlyNote, segHtml, switchRow, xpCard } from '../widgets.js';
import { $, WD, addDays, clampLv, esc, parseYmd } from '../../util.js';

/* 훈련 계획 (DESIGN.md §6.3): 분량·요일과 알람·게임과 순서·난이도·점검과 생활 체크. 다섯 칸의 펼치는 카드.
 * 고친 내용은 S.planDraft 에만 있다가 '저장'을 누르면 한 번에(계획+알람) 저장돼요. */
const DAYS = MON_FIRST.map(d => [d, WD[d]]);
const TARGETS = [[10, '10분'], [15, '15분'], [20, '20분'], [30, '30분']];
const CHECKS = [[0, '끔'], [2, '2주마다'], [4, '4주마다'], [8, '8주마다']];
const AUTOS = [[0, '끔'], [5, '5초'], [10, '10초'], [15, '15초']];
const timeOf = () => (S.alarm && /^\d{2}:\d{2}$/.test(S.alarm.time || '') && S.alarm.time) || '10:00';
function initDraft() {
  const d = Object.assign(normalizePlan(S.planRaw || { weekdays: S.alarm && S.alarm.days }, catalog()), { alarmTime: timeOf() });
  S.planDraft = d; S.planBase = JSON.stringify(d); return d;
}
const draft = () => S.planDraft || initDraft();
export const planDirty = () => !!S.planDraft && JSON.stringify(S.planDraft) !== S.planBase;
const names = ids => ids.map(id => GAMES[id].name);
const selectHtml = (id, label, opts, cur, ro, extra) => '<div class="field"><label for="' + id + '">' + label + '</label><select class="input" id="' + id + '"' + (ro ? ' disabled' : '') + (extra || '') + '>' +
  opts.map(o => '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>';
function nextCheckText(d) {
  if (!d.checkEveryWeeks) return '월간 점검을 하지 않아요.';
  const last = allAssessments()[0];
  if (!last) return '다음 점검: 첫 훈련 다음 날';
  const nx = parseYmd(addDays(last.date, d.checkEveryWeeks * 7));
  return '다음 점검: ' + (nx.getMonth() + 1) + '월 ' + nx.getDate() + '일쯤';
}

SCREENS.adminPlan = {
  html() {
    const d = draft(), ro = !isAdmin(), cat = catalog(), today = todayS();
    const probs = planProblems(d, cat), onN = cat.filter(g => d.games[g.id].on).length;
    const list = names(buildCourse(d, today, cat)), tmr = names(buildCourse(d, addDays(today, 1), cat)), N = list.length, M = estimateMinutes(d, today, cat);
    const prog = todayProgressDoc(), started = !!(prog && prog.status === 'started');
    const dis = ro ? ' disabled' : '';
    const summary = '<section class="card primary" id="plan-top" aria-label="요약"><p class="t-title" id="plan-sum">하루 ' + N + '개 · 약 ' + M + '분 · ' + daysText(d.weekdays) + '</p><p class="t-body mt" id="plan-today">오늘: ' + esc(list.join(' → ')) + '</p></section>';
    // 1 하루 분량
    const c1 = '<div class="stepline"><span class="t-title-m" id="gpd-l">하루 게임 수</span><div class="stepper" role="group" aria-labelledby="gpd-l">' +
        '<button type="button" class="step" id="gpd-minus" data-act="pl-gpd" data-d="-1" aria-label="게임 수 하나 줄이기"' + (ro || d.gamesPerDay <= 1 ? ' disabled' : '') + '>−</button><output class="stepval" id="plan-gpd" aria-live="polite">' + d.gamesPerDay + '</output>' +
        '<button type="button" class="step" id="gpd-plus" data-act="pl-gpd" data-d="1" aria-label="게임 수 하나 늘리기"' + (ro || d.gamesPerDay >= 9 ? ' disabled' : '') + '>＋</button></div></div>' +
      (d.gamesPerDay > onN && onN ? '' : '') +
      '<details class="field-opt" id="plan-more" data-xp="plan-more"' + (S.xpOpen['plan-more'] ? ' open' : '') + '><summary id="plan-more-sum">자세히</summary><div class="stack mt">' +
        selectHtml('plan-rounds', '게임당 문제 수', [['', '기본 (게임마다 달라요)']].concat([3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, n + '개'])), d.roundsPerGame == null ? '' : d.roundsPerGame, ro) +
        '' +
        '<div>' + segHtml('목표 시간', 'tgt-l', TARGETS.concat(TARGETS.some(t => t[0] === d.targetMin) ? [] : [[d.targetMin, d.targetMin + '분']]), d.targetMin, 'pl-target', 'plan-target', ro) + '</div>' +
        '<div>' + segHtml('게임 사이 자동 넘김', 'auto-l', AUTOS, d.autoNextSec, 'pl-auto', 'plan-auto', ro) + '</div>' +
      '</div></details>' +
      '<p class="t-body" id="plan-est">예상 시간: 약 ' + M + '분</p>' + (M > d.targetMin + 5 ? '' : '');
    // 2 요일과 알람
    const c2 = '<div><div class="t-title-m" id="days-label">훈련 요일</div><div class="days mt" role="group" aria-labelledby="days-label">' + DAYS.map(o => '<button type="button" class="chip" id="plan-day-' + o[0] + '" aria-pressed="' + d.weekdays.includes(o[0]) + '" data-act="pl-day" data-d="' + o[0] + '"' + dis + '>' + o[1] + '</button>').join('') + '</div></div>' +
      '<div class="field"><label for="plan-alarm-time">알람 시간</label><input class="input" type="time" id="plan-alarm-time" value="' + esc(d.alarmTime) + '"' + dis + '></div>' +
      (Platform.canSaveFile() ? '<button class="btn outlined" id="btn-ics" type="button" data-act="pl-ics"' + dis + '>휴대폰 캘린더에 등록하기</button>' : '') +
      (S.icsText ? '<div class="field"><label for="ics-text">파일이 저장되지 않으면 아래 내용을 복사해 \'brainwalk-alarm.ics\' 파일로 저장해 쓰세요.</label><textarea class="input copybox" id="ics-text" readonly rows="6"></textarea><button class="btn tonal mt" id="btn-ics-copy" type="button" data-act="pl-icscopy">내용 복사하기</button></div>' : '');
    // 3 게임 고르기와 순서
    const order = d.order === 'fixed' ? d.fixedOrder : cat.map(g => g.id);
    const opt = (v, t, sub) => '<button type="button" class="gamebtn" role="radio" id="plan-order-' + v + '" aria-checked="' + (d.order === v) + '" data-act="pl-order" data-v="' + v + '"' + dis + '><span><strong>' + t + '</strong><span class="t-small muted">' + sub + '</span></span><span class="t-title-m" aria-hidden="true">' + (d.order === v ? '✓' : '') + '</span></button>';
    const c3 = '<div class="pick-list" role="radiogroup" aria-label="게임 순서 방식">' + opt('rotate', '날마다 바꾸기 (추천)', '다섯 영역을 골고루, 날마다 다른 게임으로 해요.') + opt('fixed', '정한 순서대로', '매일 같은 순서로 해요.') + '</div>' +
      '<ul class="grows" id="plan-games">' + order.map((id, i) => {
        const g = GAMES[id], on = d.games[id].on;
        return '<li class="grow" data-g="' + id + '"><span class="gnm"><strong>' + esc(g.name) + '</strong><span class="pill">' + esc(DOM[g.domain].name) + '</span>' + (g.bank ? '<span class="pill aipill">AI 문제</span>' : '') + '</span><span class="gctl">' +
          (d.order === 'fixed' ? '<button type="button" class="step sm" id="plan-up-' + id + '" data-act="pl-move" data-id="' + id + '" data-d="-1" aria-label="' + esc(g.name) + ' 위로"' + (ro || i === 0 ? ' disabled' : '') + '>▲</button><button type="button" class="step sm" id="plan-down-' + id + '" data-act="pl-move" data-id="' + id + '" data-d="1" aria-label="' + esc(g.name) + ' 아래로"' + (ro || i === order.length - 1 ? ' disabled' : '') + '>▼</button>' : '') +
          '<button class="switch" id="plan-on-' + id + '" type="button" role="switch" aria-checked="' + on + '" aria-label="' + esc(g.name) + ' 켜기" data-act="pl-gon" data-id="' + id + '"' + dis + '></button></span></li>';
      }).join('') + '</ul><p class="t-body" id="plan-today2">오늘: ' + esc(list.join(' → ')) + '</p><p class="t-body muted" id="plan-tmr">내일: ' + esc(tmr.join(' → ')) + '</p>';
    // 4 난이도
    const nFixed = cat.filter(g => d.games[g.id].mode === 'fixed').length;
    const c4 = '' +
      '<details class="field-opt" id="plan-lv" data-xp="plan-lv"' + (S.xpOpen['plan-lv'] ? ' open' : '') + '><summary id="plan-lv-sum">게임마다 정하기</summary><div class="stack mt">' + cat.map(g => {
        const id = g.id, x = d.games[id], now = clampLv(S.levels[id] || 1), levels = [1, 2, 3, 4, 5];
        return '<div class="lvset card outlined" data-g="' + id + '"><div class="rowline"><strong>' + esc(GAMES[id].name) + '</strong><span class="t-small muted">지금 ' + now + '단계</span></div>' +
          '<div class="seg mt" role="radiogroup" aria-label="' + esc(GAMES[id].name) + ' 단계 방식">' + [['auto', '자동'], ['fixed', '고정']].map(o => '<button type="button" id="plan-mode-' + id + '-' + o[0] + '" role="radio" aria-checked="' + (x.mode === o[0]) + '" data-act="pl-gmode" data-id="' + id + '" data-v="' + o[0] + '"' + dis + '>' + o[1] + '</button>').join('') + '</div>' +
          (x.mode === 'auto'
            ? '<div class="row mt">' + selectHtml('plan-min-' + id, '가장 쉬움', levels.map(n => [n, n + '단계']), x.min, ro, ' data-pl="min" data-id="' + id + '"') + selectHtml('plan-max-' + id, '가장 어려움', levels.map(n => [n, n + '단계']), x.max, ro, ' data-pl="max" data-id="' + id + '"') + '</div>'
            : '<div class="seg mt" role="radiogroup" aria-label="' + esc(GAMES[id].name) + ' 고정 단계">' + levels.map(n => '<button type="button" id="plan-lvl-' + id + '-' + n + '" role="radio" aria-checked="' + (x.level === n) + '" data-act="pl-glevel" data-id="' + id + '" data-v="' + n + '"' + dis + '>' + n + '</button>').join('') + '</div>') + '</div>';
      }).join('') + '</div></details>' +
      '<button class="btn outlined" id="plan-allauto" type="button" data-act="pl-allauto"' + (ro || !nFixed ? ' disabled' : '') + '>모두 자동으로 되돌리기</button>';
    // 5 점검과 생활 체크
    const c5 = '<div>' + segHtml('월간 두뇌 점검', 'chk-l', CHECKS, d.checkEveryWeeks, 'pl-check', 'plan-check', ro) + '<p class="t-body mt" id="plan-nextcheck">' + nextCheckText(d) + '</p></div>' +
      switchRow('plan-checkin', '생활 체크 (기분·잠)', '훈련을 마친 뒤 30초 동안 물어봐요.', d.checkin, 'pl-checkin', ro) +
      switchRow('plan-score', '점수 보여 주기', '끄면 점수 없이 ‘잘하셨어요’ 같은 칭찬만 보여요.', d.showScore, 'pl-score', ro);
    return '<div class="stack"><h1 class="t-headline" id="plan-h">훈련 계획</h1>' + adminOnlyNote() + summary +
      xpCard('p1', '하루 분량', N + '개 · 약 ' + M + '분', c1, true) + xpCard('p2', '훈련 요일과 알람', daysText(d.weekdays) + ' · ' + hm(d.alarmTime), c2) +
      xpCard('p3', '게임 고르기와 순서', onN + '개 게임 · ' + (d.order === 'fixed' ? '정한 순서' : '날마다 바꾸기'), c3) + xpCard('p4', '난이도', levelText(d), c4) +
      xpCard('p5', '점검과 생활 체크', '점검 ' + checkText(d) + ' · 생활 체크 ' + (d.checkin ? '켬' : '끔') + ' · 자동 넘김 ' + autoNextText(d.autoNextSec), c5) +
      (probs.length ? '<ul class="problems" id="plan-problems" role="alert">' + probs.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') +
      (ro ? '' : '<div class="cta">' + (started ? '' : '') + '<button class="btn filled" id="plan-save" type="button" data-act="pl-save"' + (probs.length || !planDirty() ? ' disabled' : '') + '>저장</button><button class="btn text" id="plan-revert" type="button" data-act="pl-revert">되돌리기</button></div>') + '</div>';
  },
  bind(el) { const t = $('#ics-text', el); if (t) t.value = S.icsText; }
};
function hm(t) { const p = String(t).split(':').map(Number), h = p[0]; return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + String(p[1]).padStart(2, '0'); }
const keep = id => { const b = document.getElementById(id); if (b) b.focus(); };
/* 값을 고치고 다시 그린 뒤, 누르던 버튼에 초점을 돌려줘요 */
function edit(fn, focusId) { if (!isAdmin()) return; fn(draft()); render(true); if (focusId) keep(focusId); }
ACTS['pl-gpd'] = b => edit(d => { d.gamesPerDay = Math.max(1, Math.min(9, d.gamesPerDay + Number(b.dataset.d))); }, b.id);
ACTS['pl-day'] = b => edit(d => { const n = Number(b.dataset.d), i = d.weekdays.indexOf(n); if (i >= 0) d.weekdays.splice(i, 1); else { d.weekdays.push(n); d.weekdays.sort((x, y) => x - y); } }, b.id);
ACTS['pl-order'] = b => edit(d => { d.order = b.dataset.v; }, b.id);
ACTS['pl-gon'] = b => edit(d => { d.games[b.dataset.id].on = !d.games[b.dataset.id].on; }, b.id);
ACTS['pl-move'] = b => edit(d => { const a = d.fixedOrder, i = a.indexOf(b.dataset.id), j = i + Number(b.dataset.d); if (i >= 0 && j >= 0 && j < a.length) { const t = a[i]; a[i] = a[j]; a[j] = t; } }, b.id);
ACTS['pl-gmode'] = b => edit(d => { d.games[b.dataset.id].mode = b.dataset.v; }, b.id);
ACTS['pl-glevel'] = b => edit(d => { d.games[b.dataset.id].level = Number(b.dataset.v); }, b.id);
ACTS['pl-allauto'] = b => edit(d => { Object.keys(d.games).forEach(id => { d.games[id].mode = 'auto'; }); }, b.id);
ACTS['pl-target'] = b => edit(d => { d.targetMin = Number(b.dataset.v); }, b.id);
ACTS['pl-check'] = b => edit(d => { d.checkEveryWeeks = Number(b.dataset.v); }, b.id);
ACTS['pl-auto'] = b => edit(d => { d.autoNextSec = Number(b.dataset.v); }, b.id);
ACTS['pl-checkin'] = b => edit(d => { d.checkin = !d.checkin; }, b.id);
ACTS['pl-score'] = b => edit(d => { d.showScore = !d.showScore; }, b.id);
ACTS['pl-revert'] = () => { S.planDraft = null; render(true); };
ACTS['pl-ics'] = () => {
  const d = draft(), ics = buildIcs({ time: d.alarmTime, days: d.weekdays }, Date.now(), '');
  if (!ics) { toast('시간과 요일을 하나 이상 골라 주세요.'); return; }
  Platform.saveFile('brainwalk-alarm.ics', new Blob([ics], { type: 'text/calendar' })).catch(() => { S.icsText = ics; render(true); toast('파일을 저장하지 못했어요'); });
};
ACTS['pl-icscopy'] = () => { const t = $('#ics-text'); Platform.copy(S.icsText, t).then(ok => { if (!ok) toast('복사하지 못했어요'); }); };
ACTS['pl-save'] = async () => {
  if (!isAdmin()) return;
  const d = draft(), prog = todayProgressDoc(), started = !!(prog && prog.status === 'started');
  if (planProblems(d, catalog()).length) return;
  try {
    await savePlan(d, catalog(), S.myId || 'local', d.alarmTime);
    S.planBase = JSON.stringify(d);
    render(true);
  } catch (e) { toast(writeErrMsg(e, true)); }
};
/* 뒤로 가기: 저장하지 않은 계획이 있으면 한 번 물어봐요 */
ACTS.adminback = () => {
  if (S.screen === 'adminPlan' && planDirty()) { dialog('저장하지 않고 나갈까요?', '고친 내용이 사라져요.', [{ label: '계속 고치기', kind: 'filled' }, { label: '나가기', kind: 'text', run: () => { S.planDraft = null; go('settings'); } }]); return; }
  S.planDraft = null; S.dispDraft = null; go('settings');
};
document.addEventListener('change', e => {
  if (S.screen !== 'adminPlan' || !isAdmin()) return;
  const t = e.target, d = draft();
  if (t.id === 'plan-rounds') d.roundsPerGame = t.value === '' ? null : Number(t.value);
  else if (t.id === 'plan-alarm-time') { if (!/^\d{2}:\d{2}$/.test(t.value)) return; d.alarmTime = t.value; }
  else if (t.dataset && (t.dataset.pl === 'min' || t.dataset.pl === 'max')) {
    const x = d.games[t.dataset.id]; x[t.dataset.pl] = Number(t.value);
    if (x.min > x.max) { if (t.dataset.pl === 'min') x.max = x.min; else x.min = x.max; }
  } else return;
  render(true); keep(t.id);
});
