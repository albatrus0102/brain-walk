import { allAssessments, allCheckins, allSessions, todayS } from './data.js';
import { consultFlag, moodFlag, weeklySummary } from './logic.js';
import { sendMessage } from './messages.js';
import { S } from './state.js';
import { toast } from './ui/dom.js';
import { go } from './ui/shell.js';
import { dayNum, parseYmd } from './util.js';

/* ================= 기록 카드 / 요약 ================= */
export const mdLabel = date => { const d = parseYmd(date); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; };
export const FACES = [null, ['😢', '많이 힘들어요'], ['🙁', '조금 힘들어요'], ['😐', '보통이에요'], ['🙂', '좋아요'], ['😄', '아주 좋아요']];
export const recordOfSession = s => ({ type: 'session', ref: s.id, title: (s.gameName || s.gameId) + ' · ' + s.level + '단계 · ' + mdLabel(s.date), score: Math.round((Number(s.accuracy) || 0) * 100) });
export const recordOfAssess = a => ({ type: 'assessment', ref: String(a.ts), title: '두뇌 건강 점검 · ' + mdLabel(a.date), score: Number(a.total) });
export const recordOfCheck = c => ({ type: 'check', ref: c.date, title: '생활 체크 · ' + mdLabel(c.date) + ' · 기분 ' + (FACES[c.mood] ? FACES[c.mood][1] : '-') + ' · 수면 ' + (c.sleepHours || '-') + '시간', score: null });
export function currentFlags() {
  const today = todayS(), ss = allSessions(), as = allAssessments();
  return { consult: consultFlag(as, ss, today), mood: moodFlag(allCheckins(), today) };
}
export function currentSummary() { return weeklySummary(allSessions(), allCheckins(), currentFlags().consult, todayS()); }
export async function shareSummary() {
  const sm = currentSummary();
  if (await sendMessage({ kind: 'summary', text: sm.text, record: { type: 'week', ref: todayS(), title: '이번 주 요약', score: sm.avg } })) toast('이번 주 요약을 대화방에 공유했어요.');
}
export function talkAbout(rec) { S.attach = rec; go('chat'); }
const TIPS = [
  ['즐기기', '일주일에 3번 이상 걷기'], ['즐기기', '생선과 채소를 골고루 먹기'], ['즐기기', '부지런히 읽고 쓰기'],
  ['참기', '술은 적게 마시기'], ['참기', '담배는 끊기'], ['참기', '머리를 다치지 않게 조심하기'],
  ['챙기기', '정기적으로 건강검진 받기'], ['챙기기', '가족·친구와 자주 이야기 나누기'], ['챙기기', '매년 치매 조기검진 받기']
];
const todayTip = () => TIPS[dayNum(new Date()) % TIPS.length];
export const tipHtml = () => { const t = todayTip(); return '<div class="tip"><span class="tag">3·3·3 ' + t[0] + '</span><span class="t-body">' + t[1] + '</span></div>'; };
