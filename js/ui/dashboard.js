import { alarmCfg } from '../alarm.js';
import { allSessions, chatAvail, dashTraineeId, getPlan, isAdmin, todayProgressDoc, todayS, traineeLabel } from '../data.js';
import { GAMES, catalog } from '../games/registry.js';
import { ic } from '../icons.js';
import { fmtClock } from '../logic.js';
import { deriveToday, presenceState, weekStrip } from '../program.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { progressBar } from './widgets.js';
import { WD, addDays, esc, fmtDur, parseYmd } from '../util.js';

/* ================= 가족 홈의 실시간 현황 (DESIGN.md §7) =================
 * 데이터는 data.js 가 구독 하나씩으로 S 에 넣어 둬요 (progress 14일, presence/훈련하는 분).
 * 여기서는 읽기만 해요. 스냅샷이 올 때마다 홈이 다시 그려지고, 30초마다 한 번 더 (n분 전 같은 말이 낡지 않게). */
const gname = id => (GAMES[id] && GAMES[id].name) || id;
const hhmm = ms => fmtClock(ms);
function dayLabel(ms, today) {
  const d = new Date(ms), ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return ds === today ? '오늘' : ds === addDays(today, -1) ? '어제' : (d.getMonth() + 1) + '/' + d.getDate();
}
/* 화면을 그리지 않고 상태만 계산 (시험에서도 써요) */
export function dashState(now) {
  const tid = dashTraineeId(), today = todayS(); if (!tid) return null;
  now = now || Date.now();
  const plan = getPlan(), cat = catalog();
  const t = deriveToday({ progress: todayProgressDoc(), plan, today, now, sessionsToday: allSessions().filter(s => s.date === today && (!s.userId || s.userId === tid || tid === 'local')), catalog: cat });
  const strip = weekStrip({ progressList: (S.progressList || []).filter(p => p.userId === tid), sessions: allSessions(), plan, today, catalog: cat });
  const pres = presenceState(S.presence[tid] && S.presence[tid].lastSeen, now);
  return { t, strip, pres, today, tid, now };
}
function presenceLine(pres, lastSeen, today) {
  if (pres.state === 'online') return '● 지금 앱을 보고 계세요';
  if (pres.state === 'recent') return pres.mins + '분 전에 앱을 보셨어요';
  if (pres.state === 'away') { const ms = typeof lastSeen === 'number' ? lastSeen : (lastSeen && lastSeen.toMillis ? lastSeen.toMillis() : 0); return dayLabel(ms, today) + ' ' + hhmm(ms) + '에 마지막으로 보셨어요'; }
  return '아직 접속 기록이 없어요';
}
export function dashboardHtml() {
  const st = dashState();
  if (!st) {
    return '<section class="card elevated dash" id="dash" aria-labelledby="dash-h"><h2 class="t-title" id="dash-h">훈련하는 분</h2><p class="t-body mt" id="dash-none">아직 훈련하는 분이 없어요.</p>' +
      (isAdmin() && Store.mode === 'firebase' ? '<div class="mt"><button class="btn filled" id="btn-dash-assign" type="button" data-act="nav" data-to="members">가족 구성원에서 정하기</button></div>' : '') + '</section>';
  }
  const { t, strip, pres, today, tid } = st, label = esc(traineeLabel()), N = t.N;
  const isCheck = t.kind === 'check';
  let status = '', sub = '';
  if (t.state === 'notStarted') {
    const cfg = alarmCfg(), now = new Date(), past = /^\d{2}:\d{2}$/.test(cfg.time || '') && (now.getHours() * 60 + now.getMinutes() >= +cfg.time.slice(0, 2) * 60 + +cfg.time.slice(3));
    status = '아직 시작 전이에요' + (past && (cfg.days || []).includes(now.getDay()) ? ' · 알람 ' + esc(cfg.time) + ' 지남' : '');
  } else if (t.state === 'inProgress') {
    status = (isCheck ? '두뇌 점검 중' : '훈련 중') + ' · ' + N + '개 중 ' + t.n + '개';
    sub = t.current ? '지금: ' + esc(gname(t.current)) + (t.currentSince ? ' (' + hhmm(t.currentSince) + '부터)' : '') : (t.legacy ? '옛 버전 앱이라 게임별 진행은 끝난 것만 보여요.' : '');
  } else if (t.state === 'paused') {
    status = '쉬는 중 · ' + N + '개 중 ' + t.n + '개'; sub = t.lastTs ? '마지막 움직임 ' + hhmm(t.lastTs) : '';
  } else if (t.state === 'done') {
    status = (isCheck ? '오늘 두뇌 점검 완료 ✓ ' : '오늘 완료 ✓ ') + (t.doneTs ? hhmm(t.doneTs) : '');
  } else status = '오늘은 쉬는 날이에요';
  const planned = (t.planned || []).slice(0, 13);
  const list = (t.state === 'notStarted' || t.state === 'rest') ? '' : '<ol class="glist" id="dash-games">' + planned.map((id, i) => {
    const r = t.results[i];
    if (r) return '<li class="g done" data-g="' + esc(id) + '"><span class="gn">' + ic('check') + '<span>' + esc(gname(id)) + '</span></span><span class="gs t-small">정답 ' + Math.round((Number(r.acc) || 0) * 100) + '% · ' + fmtDur(Math.round(Number(r.sec) || 0)) + (r.level != null && !isCheck ? ' · ' + r.level + '단계' : '') + '</span></li>';
    if (t.current === id && i === t.results.length && t.state === 'inProgress') return '<li class="g cur" data-g="' + esc(id) + '"><span class="gn"><i class="pulse" aria-hidden="true"></i><span>' + esc(gname(id)) + '</span></span><span class="gs t-small">하는 중…</span></li>';
    return '<li class="g pending" data-g="' + esc(id) + '"><span class="gn"><span>' + esc(gname(id)) + '</span></span><span class="gs t-small muted">대기</span></li>';
  }).join('') + '</ol>';
  const strip7 = '<ul class="wstrip" role="list" id="dash-week" aria-label="최근 7일">' + strip.map(d => {
    const w = WD[d.wd], d2 = parseYmd(d.date).getDate();
    const aria = d.state === 'done' ? w + '요일 완료' : d.state === 'partial' ? w + '요일 ' + d.n + '/' + d.N : d.state === 'rest' ? w + '요일 쉬는 날' : d.state === 'today-open' ? w + '요일 오늘, 아직 안 했어요' : w + '요일 안 함';
    return '<li class="wd ' + d.state + (d.isToday ? ' today' : '') + '" data-state="' + d.state + '" aria-label="' + aria + '"><span class="wl">' + w + '</span><span class="wc" aria-hidden="true">' + (d.state === 'done' ? ic('check') : d.state === 'rest' ? '–' : '') + '</span><span class="wn">' + (d.isToday ? '오늘' : d2) + '</span></li>';
  }).join('') + '</ul>';
  const showNudge = chatAvail() && t.state !== 'done' && t.state !== 'rest';
  return '<section class="card elevated dash" id="dash" aria-labelledby="dash-h" data-state="' + t.state + '">' +
    '<div class="dash-top"><h2 class="t-title" id="dash-h">' + label + '의 오늘</h2><span class="live ' + pres.state + '" id="dash-dot" role="img" aria-label="' + (pres.state === 'online' ? '지금 접속 중' : '접속 안 함') + '"></span></div>' +
    '<p class="t-title-m mt" id="dash-status">' + status + '</p>' + (sub ? '<p class="t-body muted" id="dash-sub">' + sub + '</p>' : '') +
    '<p class="t-small mt dash-pres ' + pres.state + '" id="dash-presence">' + presenceLine(pres, S.presence[tid] && S.presence[tid].lastSeen, today) + '</p>' +
    (t.state === 'rest' || t.state === 'notStarted' ? '' : '<div class="mt">' + progressBar(N ? t.n / N * 100 : 0, '오늘 진행') + '</div>') +
    list + '<div class="mt"><div class="t-label muted" id="dash-week-h">최근 7일</div>' + strip7 + '</div>' +
    '<div class="stack mt">' + (chatAvail() ? '<button class="btn filled" id="btn-fam-chat" type="button" data-act="nav" data-to="chat">응원 보내기</button>' : '') +
    (showNudge ? '<button class="btn tonal" id="btn-fam-nudge" type="button" data-act="nudgego">훈련 알림 보내기</button>' : '') +
    '<button class="btn text" id="btn-fam-report" type="button" data-act="nav" data-to="family">기록 자세히 보기</button></div></section>';
}
/* 가족 홈이 열려 있는 동안 30초마다 다시 그려요 (상대 시간이 낡지 않게). 홈을 떠나면 멈춰요. */
let tick = null;
export function startDashboardTicker(render) {
  if (tick) return;
  tick = setInterval(() => { if (S.screen === 'home') render(true); else stopDashboardTicker(); }, 30e3);
}
export function stopDashboardTicker() { if (tick) { clearInterval(tick); tick = null; } }
