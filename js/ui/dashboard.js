import { AD, aiAccess, ensureAdminSubs } from '../ai/admin-data.js';
import { KIND_NAMES, lightOf, topLight } from '../ai/labels.js';
import { alarmCfg } from '../alarm.js';
import { allSessions, chatAvail, dashTraineeId, ensureProfiles, getPlan, isAdmin, nameOf, streakNow, todayProgressDoc, todayS, traineeLabel } from '../data.js';
import { GAMES, catalog } from '../games/registry.js';
import { ic } from '../icons.js';
import { fmtClock } from '../logic.js';
import { unreadCount } from '../messages.js';
import { deriveToday, presenceState, weekStrip } from '../program.js';
import { S } from '../state.js';
import { Store } from '../store/store.js';
import { progressBar, tileHtml } from './widgets.js';
import { WD, addDays, esc, fmtDur, parseYmd } from '../util.js';

/* ================= 가족 홈 = 대시보드 (DESIGN.md §7, M3 compact) =================
 * 위: 요약 타일 넷(오늘 상태 · 마지막 접속 · 연속 훈련 · AI 신호), 아래: 오늘의 훈련 · 최근 7일 · 최근 대화 카드와 빠른 동작 칩.
 * 데이터는 data.js 가 구독 하나씩으로 S 에 넣어 둬요 (progress 14일, presence/훈련하는 분). 여기서는 읽기만 해요.
 * 스냅샷이 올 때마다 홈이 다시 그려지고, 30초마다 한 번 더 (n분 전 같은 말이 낡지 않게). 카드마다 자세한 화면으로 이어져요. */
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
const mdw = s => { const d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + ' (' + WD[d.getDay()] + ')'; };
/* 카드 머리: 제목 + 값 + › (누르면 자세한 화면) */
const head = (id, title, value, to) => '<button type="button" class="dhead" id="' + id + '" data-act="nav" data-to="' + to + '"><h2>' + title + '</h2><span class="dv">' + (value || '') + ic('chevron') + '</span></button>';

function aiTile() {
  if (aiAccess() !== 'ok') return '';
  ensureAdminSubs();
  const r = AD.reports[0], l = lightOf(r ? topLight(r) : 'gray');
  return tileHtml({ id: 'tile-ai', icon: 'sparkle', label: 'AI 신호', to: 'aiReports', value: '<span class="lpill ' + l.cls + '"><span class="lg" aria-hidden="true">' + l.glyph + '</span>' + l.word + '</span>', sub: r ? esc(mdw(r.date) + ' ' + (KIND_NAMES[r.kind] || '리포트')) : '아직 리포트가 없어요' });
}
export function dashboardHtml() {
  const st = dashState();
  if (!st) {
    return '<section class="dcard" id="dash" aria-labelledby="dash-h"><h2 class="t-title" id="dash-h">훈련하는 분</h2><p class="t-body" id="dash-none">아직 훈련하는 분이 없어요.</p>' +
      (isAdmin() && Store.mode === 'firebase' ? '<div><button class="btn filled" id="btn-dash-assign" type="button" data-act="nav" data-to="members">가족 구성원에서 정하기</button></div>' : '') + '</section>';
  }
  const { t, strip, pres, today, tid } = st, label = esc(traineeLabel()), N = t.N;
  const isCheck = t.kind === 'check';
  let status = '', sub = '', cls = '';
  if (t.state === 'notStarted') {
    const cfg = alarmCfg(), now = new Date(), past = /^\d{2}:\d{2}$/.test(cfg.time || '') && (now.getHours() * 60 + now.getMinutes() >= +cfg.time.slice(0, 2) * 60 + +cfg.time.slice(3));
    status = '아직 시작 전이에요' + (past && (cfg.days || []).includes(now.getDay()) ? ' · 알람 ' + esc(cfg.time) + ' 지남' : '');
    if (past && (cfg.days || []).includes(now.getDay())) cls = 'warm';
  } else if (t.state === 'inProgress') {
    status = (isCheck ? '두뇌 점검 중' : '훈련 중') + ' · ' + N + '개 중 ' + t.n + '개';
    sub = t.current ? '지금: ' + esc(gname(t.current)) + (t.currentSince ? ' (' + hhmm(t.currentSince) + '부터)' : '') : '';
  } else if (t.state === 'paused') {
    status = '쉬는 중 · ' + N + '개 중 ' + t.n + '개'; sub = t.lastTs ? '마지막 움직임 ' + hhmm(t.lastTs) : '';
  } else if (t.state === 'done') {
    status = (isCheck ? '오늘 두뇌 점검 완료 ✓ ' : '오늘 완료 ✓ ') + (t.doneTs ? hhmm(t.doneTs) : ''); cls = 'accent';
  } else status = '오늘은 쉬는 날이에요';
  const planned = (t.planned || []).slice(0, 13);
  const weekDone = strip.filter(d => d.state === 'done').length, streak = streakNow(new Date());
  const lastSeen = S.presence[tid] && S.presence[tid].lastSeen;
  // 요약 타일
  const tiles = '<div class="tiles" id="dash-tiles">' +
    tileHtml({ id: 'tile-today', icon: t.state === 'done' ? 'check' : 'play', label: '오늘', to: 'family', cls, value: status, valueId: 'dash-status', sub: sub || null, subId: sub ? 'dash-sub' : null }) +
    tileHtml({ id: 'tile-seen', icon: 'eye', label: '마지막 접속', to: 'family', value: presenceLine(pres, lastSeen, today), valueId: 'dash-presence', cls: 'pres ' + pres.state, extra: '<span class="live ' + pres.state + '" id="dash-dot" role="img" aria-label="' + (pres.state === 'online' ? '지금 접속 중' : '접속 안 함') + '"></span>' }) +
    tileHtml({ id: 'tile-streak', icon: 'flame', label: '연속 훈련', to: 'family', num: true, value: streak + '<small>일</small>', sub: '이번 주 ' + weekDone + '/7일' }) +
    (aiTile() || tileHtml({ id: 'tile-week', icon: 'calendar', label: '이번 주', to: 'family', num: true, value: weekDone + '<small>/7일</small>', sub: '훈련한 날' })) + '</div>';
  // 오늘의 훈련 카드
  const list = '<ol class="glist" id="dash-games">' + planned.map((id, i) => {
    const r = t.results[i];
    if (r) return '<li class="g done" data-g="' + esc(id) + '"><span class="gn">' + ic('check') + '<span>' + esc(gname(id)) + '</span></span><span class="gs t-small">정답 ' + Math.round((Number(r.acc) || 0) * 100) + '% · ' + fmtDur(Math.round(Number(r.sec) || 0)) + (r.level != null && !isCheck ? ' · ' + r.level + '단계' : '') + '</span></li>';
    if (t.current === id && i === t.results.length && t.state === 'inProgress') return '<li class="g cur" data-g="' + esc(id) + '"><span class="gn"><i class="pulse" aria-hidden="true"></i><span>' + esc(gname(id)) + '</span></span><span class="gs t-small">하는 중…</span></li>';
    return '<li class="g pending" data-g="' + esc(id) + '"><span class="gn"><i class="ph" aria-hidden="true"></i><span>' + esc(gname(id)) + '</span></span><span class="gs t-small muted">' + (t.state === 'rest' ? '' : '대기') + '</span></li>';
  }).join('') + '</ol>';
  const course = '<section class="dcard" id="dash-course" aria-labelledby="dash-course-h">' + head('dash-course-h', (isCheck ? '오늘의 점검' : '오늘의 훈련'), t.state === 'rest' ? '쉬는 날' : t.n + '/' + N, 'family') +
    (t.state === 'rest' ? '' : progressBar(N ? t.n / N * 100 : 0, '오늘 진행')) + list + '</section>';
  // 최근 7일
  const strip7 = '<ul class="wstrip" role="list" id="dash-week" aria-label="최근 7일">' + strip.map(d => {
    const w = WD[d.wd], d2 = parseYmd(d.date).getDate();
    const aria = d.state === 'done' ? w + '요일 완료' : d.state === 'partial' ? w + '요일 ' + d.n + '/' + d.N : d.state === 'rest' ? w + '요일 쉬는 날' : d.state === 'today-open' ? w + '요일 오늘, 아직 안 했어요' : w + '요일 안 함';
    return '<li class="wd ' + d.state + (d.isToday ? ' today' : '') + '" data-state="' + d.state + '" aria-label="' + aria + '"><span class="wl">' + w + '</span><span class="wc" aria-hidden="true">' + (d.state === 'done' ? ic('check') : d.state === 'rest' ? '–' : '') + '</span><span class="wn">' + (d.isToday ? '오늘' : d2) + '</span></li>';
  }).join('') + '</ul>';
  const week = '<section class="dcard" id="dash-weekcard" aria-labelledby="dash-week-h">' + head('dash-week-h', '최근 7일', weekDone + '/7', 'family') + strip7 + '</section>';
  // 최근 대화
  let chat = '';
  if (chatAvail()) {
    const m = S.messages.filter(x => !x.deleted && (x.kind === 'text' || x.kind === 'nudge') && x.text).slice(-1)[0], un = unreadCount();
    if (m) ensureProfiles([m.authorId]);
    chat = '<section class="dcard" id="dash-chatcard" aria-labelledby="dash-chat-h">' + head('dash-chat-h', '대화' + (un > 0 ? ' <span class="ubadge" aria-label="안 읽은 메시지 ' + un + '개">' + (un > 99 ? '99+' : un) + '</span>' : ''), '', 'chat') +
      (m ? '<div class="chat-prev"><span class="avatar" aria-hidden="true">' + esc(Array.from(nameOf(m.authorId))[0] || '가') + '</span><p class="ctext"><b>' + esc(nameOf(m.authorId)) + '</b>' + esc(m.text) + '</p></div>' : '<div class="chat-prev"><p class="ctext none">아직 대화가 없어요</p></div>') + '</section>';
  }
  // 빠른 동작 (M3 assist chips)
  const showNudge = chatAvail() && t.state !== 'done' && t.state !== 'rest';
  const chips = '<div class="assist" id="dash-actions">' +
    (showNudge ? '<button class="chip" id="btn-fam-nudge" type="button" data-act="nudgego">' + ic('bell') + label + '께 훈련 알림</button>' : '') +
    (chatAvail() ? '<button class="chip" id="btn-dash-share" type="button" data-act="sharesummary">' + ic('share') + '이번 주 요약 공유</button><button class="chip" id="btn-fam-chat" type="button" data-act="nav" data-to="chat">' + ic('chat') + '응원 보내기</button>' : '') +
    '<button class="chip" id="btn-pick" type="button" data-act="nav" data-to="pick">' + ic('play') + '나도 훈련해 보기</button></div>';
  return '<div class="stack dash" id="dash" data-state="' + t.state + '">' + tiles + course + week + chat + chips + '</div>';
}
/* 가족 홈이 열려 있는 동안 30초마다 다시 그려요 (상대 시간이 낡지 않게). 홈을 떠나면 멈춰요. */
let tick = null;
export function startDashboardTicker(render) {
  if (tick) return;
  tick = setInterval(() => { if (S.screen === 'home') render(true); else stopDashboardTicker(); }, 30e3);
}
export function stopDashboardTicker() { if (tick) { clearInterval(tick); tick = null; } }
