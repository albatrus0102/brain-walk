import { DKEYS, addDays, daysBetween, mean, pad2, ymd } from './util.js';

/* 난이도: 정답률 80% 이상 올림, 50% 미만 내림. 같은 게임에서 2번 연속 50% 미만이면 격려 메시지(down2) */
export function nextLevel(old, acc, prevAcc) {
  let level = old, kind = 'same';
  if (acc >= 0.8) { if (old < 5) { level = old + 1; kind = 'up'; } else kind = 'max'; }
  else if (acc < 0.5) { if (old > 1) { level = old - 1; kind = (prevAcc != null && prevAcc < 0.5) ? 'down2' : 'down'; } else kind = 'min'; }
  return { level: Math.max(1, Math.min(5, level)), kind };
}
export function assessTotal(scores) { return Math.round(mean(DKEYS.map(k => Number(scores[k]) || 0))); }
export function changeWord(delta) {
  if (delta >= 5) return { arrow: '▲', word: '좋아졌어요', dir: 'up' };
  if (delta <= -5) return { arrow: '▼', word: '조금 낮아졌어요', dir: 'down' };
  return { arrow: '＝', word: '비슷해요', dir: 'same' };
}
function windowAvg(sessions, domain, from, to) {
  const xs = sessions.filter(s => s.domain === domain && s.date >= from && s.date <= to).map(s => (Number(s.accuracy) || 0) * 100);
  return { avg: mean(xs), n: xs.length };
}
/* 상담 권고: (1) 점검 총점이 연속 두 번 각각 10% 이상(상대) 하락, (2) 어느 영역의 최근 2주 평균이 그 이전 2주보다 15점 이상 하락 (각 구간 2회 이상 훈련 시) */
export function consultFlag(assessDesc, sessions, today) {
  const reasons = [];
  if (assessDesc.length >= 3) {
    const t = assessDesc.slice(0, 3).map(a => Number(a.total));
    if (t[1] > 0 && t[2] > 0 && (t[0] - t[1]) / t[1] <= -0.10 && (t[1] - t[2]) / t[2] <= -0.10) reasons.push('check');
  }
  const cur = [addDays(today, -13), today], prev = [addDays(today, -27), addDays(today, -14)];
  DKEYS.forEach(k => {
    const a = windowAvg(sessions, k, cur[0], cur[1]), b = windowAvg(sessions, k, prev[0], prev[1]);
    if (a.n >= 2 && b.n >= 2 && a.avg - b.avg <= -15) reasons.push(k);
  });
  return { flag: reasons.length > 0, reasons };
}
/* 기분 점수가 2 이하인 날이 최근 7일 중 5일 이상 */
export function moodFlag(checkinMap, today) {
  let n = 0;
  for (let i = 0; i < 7; i++) { const c = checkinMap[addDays(today, -i)]; if (c && Number(c.mood) <= 2) n++; }
  return n >= 5;
}
export function weeklyTrend(sessions, domain, today) {
  const out = [];
  for (let k = 3; k >= 0; k--) { const end = addDays(today, -7 * k), start = addDays(end, -6); out.push(windowAvg(sessions, domain, start, end)); }
  return out;
}
export function programInfo(start, today, dateSetObj) {
  const ds = Math.max(0, daysBetween(start, today)), week = Math.min(12, Math.floor(ds / 7) + 1);
  const ws = addDays(start, (week - 1) * 7); let n = 0;
  for (let i = 0; i < 7; i++) if (dateSetObj.has(addDays(ws, i))) n++;
  return { week, daysSince: ds, weekDays: n, goal: 5, done: ds >= 84, overall: Math.min(1, ds / 84) };
}
export function nextCheckInfo(lastDate, today) {
  if (!lastDate) return { state: 'none' };
  const days = daysBetween(lastDate, today);
  return days >= 28 ? { state: 'due', days } : { state: 'wait', days, remain: 28 - days };
}

/* ---- 주간 요약 (가족 공유용 문장) ---- */
export function weeklySummary(sessions, checkinMap, flag, today) {
  const cur = [addDays(today, -6), today], prev = [addDays(today, -13), addDays(today, -7)];
  const inW = (s, w) => s.date >= w[0] && s.date <= w[1];
  const a = sessions.filter(s => inW(s, cur)), b = sessions.filter(s => inW(s, prev));
  const days = new Set(a.map(s => s.date)).size;
  const avgA = mean(a.map(s => (Number(s.accuracy) || 0) * 100)), avgB = mean(b.map(s => (Number(s.accuracy) || 0) * 100));
  const delta = (avgA != null && avgB != null) ? Math.round(avgA - avgB) : null;
  const lines = ['지난 7일 요약', '- 훈련한 날: ' + days + '/7일'];
  if (a.length) lines.push('- 평균 정답률: ' + Math.round(avgA) + '%' + (delta != null ? ' (그 전 주보다 ' + (delta >= 0 ? '+' : '') + delta + '점)' : ''));
  else lines.push('- 지난 7일 동안 훈련 기록이 아직 없어요');
  const cis = []; for (let i = 0; i < 7; i++) { const c = checkinMap[addDays(today, -i)]; if (c) cis.push(c); }
  if (cis.length) {
    const sl = cis.map(c => Number(c.sleepHours)).filter(x => x > 0), ex = cis.filter(c => c.exercise).length, so = cis.filter(c => c.social).length, mo = cis.map(c => Number(c.mood)).filter(x => x > 0);
    lines.push('- 생활 체크 ' + cis.length + '일: ' + (sl.length ? '평균 수면 ' + (Math.round(mean(sl) * 10) / 10) + '시간, ' : '') + '걷기·운동 ' + ex + '일, 사람 만남 ' + so + '일' + (mo.length ? ', 기분 평균 ' + (Math.round(mean(mo) * 10) / 10) + '/5' : ''));
  }
  if (flag && flag.flag) lines.push('- 최근 점수가 낮아지고 있어요. 치매안심센터(1899-9988)나 병원 상담을 권해요. (진단이 아니에요)');
  return { text: lines.join('\n'), days, avg: avgA == null ? null : Math.round(avgA), delta };
}
/* ---- 알림(넛지) 제한: 보낸 사람당 2시간에 1번 ---- */
const NUDGE_COOLDOWN = 2 * 3600 * 1000;
export function nudgeCooldown(messages, myId, nowTs) {
  let last = 0;
  messages.forEach(m => { if (m && m.kind === 'nudge' && !m.deleted && m.authorId === myId && m.ts > last) last = m.ts; });
  const wait = last ? Math.max(0, last + NUDGE_COOLDOWN - nowTs) : 0;
  return { ok: wait === 0, waitMs: wait, last };
}
export function fmtWait(ms) { const m = Math.ceil(ms / 60000); return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60 ? (m % 60) + '분' : '') : m + '분'; }
export function nudgesToday(messages, today) { return messages.filter(m => m && m.kind === 'nudge' && !m.deleted && ymd(new Date(m.ts)) === today); }
export function unackedNudges(messages, myId, today) { return nudgesToday(messages, today).filter(m => m.authorId !== myId && !(m.acks && m.acks[myId])); }
export function fmtClock(ts) { const d = new Date(ts), h = d.getHours(); return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + pad2(d.getMinutes()); }
/* ---- 알람 표시 조건 ---- */
export function alarmShouldShow(cfg, now, courseDone, snoozeUntil) {
  if (!cfg || !/^\d{2}:\d{2}$/.test(cfg.time || '') || !Array.isArray(cfg.days)) return false;
  if (!cfg.days.includes(now.getDay())) return false;
  const p = cfg.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < p[0] * 60 + p[1]) return false;
  if (courseDone) return false;
  if (snoozeUntil && now.getTime() < snoozeUntil) return false;
  return true;
}
/* ---- ICS (iCalendar) 생성 ---- */
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function seoulParts(ts) { const d = new Date(ts + 9 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds() }; }
function icsStamp(ts) { const p = seoulParts(ts - 9 * 3600e3); return p.y + pad2(p.m) + pad2(p.d) + 'T' + pad2(p.hh) + pad2(p.mm) + pad2(p.ss) + 'Z'; }
function foldLine(line) {
  const enc = new TextEncoder(); let out = '', cur = 0, limit = 75;
  for (const ch of line) { const n = enc.encode(ch).length; if (cur + n > limit) { out += '\r\n '; cur = 1; limit = 75; } out += ch; cur += n; }
  return out;
}
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
export function buildIcs(cfg, nowTs, desc) {
  const days = Array.from(new Set((cfg.days || []).map(Number).filter(d => d >= 0 && d <= 6))).sort((a, b) => a - b);
  if (!days.length || !/^\d{2}:\d{2}$/.test(cfg.time || '')) return null;
  const tp = cfg.time.split(':').map(Number), now = seoulParts(nowTs), nowMin = now.hh * 60 + now.mm;
  let start = null;
  for (let i = 0; i < 8 && !start; i++) {
    const dt = new Date(Date.UTC(now.y, now.m - 1, now.d + i));
    if (days.includes(dt.getUTCDay()) && (i > 0 || nowMin < tp[0] * 60 + tp[1])) start = dt;
  }
  const ds = d => d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
  const endMin = tp[0] * 60 + tp[1] + 30, eH = Math.floor(endMin / 60) % 24, eM = endMin % 60;
  const endDate = new Date(start.getTime() + (endMin >= 1440 ? 864e5 : 0));
  const rrule = days.length === 7 ? 'FREQ=DAILY' : 'FREQ=WEEKLY;BYDAY=' + days.map(d => ICS_DAYS[d]).join(',');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brain Walk//KO//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:brainwalk-' + cfg.time.replace(':', '') + '-' + days.join('') + '@brainwalk.local',
    'DTSTAMP:' + icsStamp(nowTs),
    'DTSTART;TZID=Asia/Seoul:' + ds(start) + 'T' + pad2(tp[0]) + pad2(tp[1]) + '00',
    'DTEND;TZID=Asia/Seoul:' + ds(endDate) + 'T' + pad2(eH) + pad2(eM) + '00',
    'RRULE:' + rrule,
    'SUMMARY:' + icsEscape('두뇌 훈련 시간이에요'),
    'DESCRIPTION:' + icsEscape(desc || '오늘의 두뇌 산책 훈련을 시작해 보세요.'),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape('두뇌 훈련 시간이에요'), 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
