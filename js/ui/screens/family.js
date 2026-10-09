import { allAssessments, allCheckins, allSessions, chatAvail, dateSet, getLevel, isTrainee, streakOf } from '../../data.js';
import { DOMAINS, GAMES, GAME_ORDER } from '../../games/registry.js';
import { P, ic } from '../../icons.js';
import { programInfo, weeklyTrend } from '../../logic.js';
import { nudgePanel } from '../../nudge.js';
import { FACES, currentFlags, currentSummary, mdLabel } from '../../records.js';
import { S } from '../../state.js';
import { Store } from '../../store/store.js';
import { clinicalReportHtml } from './clinical.js';
import { taskReportHtml } from './tasks-report.js';
import { surveyReportHtml } from './surveys.js';
import { recordsOf } from '../../surveys/engine.js';
import { SCREENS } from '../registry.js';
import { arrowHtml } from './assess.js';
import { levelDots, progressBar, statusChip } from '../widgets.js';
import { $, WD, addDays, daysBetween, esc, fmtDur, mean, parseYmd, ymd } from '../../util.js';

const WEEK_LABELS = ['3주 전', '2주 전', '지난주', '이번 주'];
SCREENS.family = {
  html() {
    const now = new Date(), today = ymd(now), all = allSessions(), ds = dateSet(all), st = streakOf(all, now), asm = allAssessments(), cis = allCheckins(), fl = currentFlags();
    const off = (now.getDay() + 6) % 7, days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - off + i)), names = ['월', '화', '수', '목', '금', '토', '일'];
    const start14 = addDays(today, -13), rec14 = all.filter(s => s.date >= start14), weekDone = days.filter(d => ds.has(ymd(d))).length, empty = all.length === 0;
    const pi = programInfo(S.program.startDate, today, ds);
    const last = all[0], lastTxt = !last ? '기록 없음' : last.date === today ? '오늘' : daysBetween(last.date, today) + '일 전';
    const avgDur = all.length ? fmtDur(Math.round(mean(all.map(s => Number(s.durationSec) || 0)))) : '-';
    let o = '<div class="stack"><h1 class="t-headline" id="fam-h">가족이 보는 기록</h1><div id="fam-status"></div>';
    if (fl.consult.flag) o += '<section class="card tertiary" id="flag-consult" role="status"><p class="t-title-m">최근 점수가 낮아지고 있어요. 치매안심센터(1899-9988)나 병원 상담을 권해요.</p><p class="t-small mt">이 안내는 진단이 아니라, 점수 변화를 보고 드리는 참고용이에요. 너무 걱정하지 말고 편하게 상담받아 보세요.</p></section>';
    if (fl.mood) o += '<section class="card tertiary" id="flag-mood" role="status"><p class="t-title-m">최근 일주일 중 5일 이상 기분이 좋지 않다고 하셨어요.</p><p class="t-small mt">마음 상태에 조금 더 관심을 가져 주세요. 필요하면 가까운 정신건강복지센터나 병원에서 우울 상담을 받아 보시길 권해요. 진단이 아니에요.</p></section>';
    // PHQ-9 9번(죽음·자해 생각)에 0보다 큰 답이 가장 최근 기록에 있으면, 답한 사람만이 아니라 가족에게도 바로 알려요.
    const phq = isTrainee() ? null : recordsOf('phq9')[0];
    if (phq && Array.isArray(phq.answers) && Number(phq.answers[8]) > 0) o += '<section class="card tertiary" id="flag-phq9" role="status"><p class="t-title-m">' + mdLabel(phq.date) + ' 마음 상태 설문(PHQ-9)의 9번 문항(죽음이나 자해에 대한 생각)에 \'며칠 이상\'으로 답하셨어요.</p><p class="t-body mt">오늘 꼭 안부를 묻고 이야기를 들어 주세요. 자살예방상담전화 <b>109</b>(24시간), 정신건강위기상담 <b>1577-0199</b>, 위급하면 <b>119</b>. 진단이 아니에요.</p></section>';
    // 요약이 맨 먼저: 지난 7일을 글로 정리한 카드. 자세한 숫자는 그 아래에 있어요.
    o += '<section class="card primary" aria-labelledby="ws-h"><h2 class="t-title" id="ws-h">이번 주 요약</h2><p class="t-body mt" id="wk-text" style="white-space:pre-wrap"></p>' +
      (chatAvail() ? '<div class="stack mt"><button class="btn filled" id="btn-share-summary" type="button" data-act="sharesummary">이번 주 요약 공유하기</button><button class="btn tonal" id="btn-fam-chat2" type="button" data-act="nav" data-to="chat">대화방 열기</button></div>' : '<p class="t-small mt">가족 대화는 가족방을 만들거나 가족 코드로 들어가면 쓸 수 있어요.</p>') + '</section>';
    if (empty) o += '<section class="card outlined empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + P.leaf + '"/></svg><p class="t-title">아직 기록이 없어요</p><p class="t-body muted">첫 훈련을 마치시면 이곳에 훈련한 날과 정답률이 차곡차곡 쌓여요.</p></section>';
    o += '<section class="card elevated" id="nudge-card" aria-labelledby="nd-h" hidden><h2 class="t-title" id="nd-h">훈련 알림 보내기</h2><div class="mt" id="nudge-slot"></div></section>';
    o += '<section class="card elevated" aria-labelledby="wk-h"><h2 class="t-title" id="wk-h">이번 주 훈련한 날 <span class="muted t-body">(' + weekDone + '/7일 · ' + Math.round(weekDone / 7 * 100) + '%)</span></h2><div class="week mt" role="list">' +
      days.map((d, i) => { const k = ymd(d), on = ds.has(k), fut = k > today;
        return '<div class="day" role="listitem" aria-label="' + names[i] + '요일 ' + (on ? '훈련함' : fut ? '아직 오지 않음' : '훈련 안 함') + '"><span>' + names[i] + '</span><span class="dot ' + (on ? 'on ' : '') + (k === today ? 'today ' : '') + (fut ? 'future' : '') + '">' + (on ? ic('check') : '') + '</span><span class="t-small">' + d.getDate() + '</span></div>'; }).join('') + '</div></section>';
    o += '<div class="stat"><div><span class="t-label">연속 훈련</span><b>' + st + '일</b></div><div><span class="t-label">전체 훈련</span><b>' + all.length + '회</b></div><div><span class="t-label">평균 훈련 시간</span><b>' + avgDur + '</b></div><div><span class="t-label">마지막 훈련</span><b>' + lastTxt + '</b></div></div>';
    o += '<section class="card filled" aria-labelledby="pg-h"><h2 class="t-title" id="pg-h">12주 프로그램 · 12주 중 ' + pi.week + '주차</h2><div class="mt">' + progressBar(pi.overall * 100, '12주 프로그램 진행') + '</div><p class="t-body mt">이번 주 ' + pi.weekDays + '/' + pi.goal + '일 (목표 주 5일)</p>' + (pi.done ? '<p class="t-title-m mt">12주 완주 배지를 받으셨어요!</p>' : '') + '</section>';
    o += '<section class="card outlined" aria-labelledby="dom-h"><h2 class="t-title" id="dom-h">영역별 평균 정답률 <span class="muted t-body">(최근 14일)</span></h2><div class="stack mt">' +
      DOMAINS.map(d => { const rs = rec14.filter(s => s.domain === d.id), avg = rs.length ? Math.round(mean(rs.map(s => (Number(s.accuracy) || 0))) * 100) : null;
        return '<div class="bar-row"><div class="bar-top"><span>' + d.name + '</span><span>' + (avg == null ? '기록 없음' : avg + '%') + '</span></div><div class="bar' + (avg == null ? ' none' : '') + '" role="img" aria-label="' + d.name + ' ' + (avg == null ? '기록 없음' : avg + '퍼센트') + '"><span style="width:' + (avg || 0) + '%"></span></div></div>'; }).join('') + '</div></section>';
    o += '<section class="card outlined" aria-labelledby="tr-h"><h2 class="t-title" id="tr-h">4주간 정답률 흐름</h2><p class="t-small muted">주마다 평균 정답률(%)이에요. 오른쪽이 이번 주예요.</p><div class="stack mt">' +
      DOMAINS.map(d => { const tr = weeklyTrend(all, d.id, today);
        return '<div><div class="bar-top"><span>' + d.name + '</span></div><div class="spark" role="img" aria-label="' + d.name + ' 주별 정답률 ' + tr.map(x => x.avg == null ? '기록 없음' : Math.round(x.avg) + '퍼센트').join(', ') + '">' +
          tr.map((x, k) => '<div class="col">' + (x.avg == null ? '<span aria-hidden="true">-</span><i class="none"></i>' : '<span>' + Math.round(x.avg) + '</span><i style="height:' + Math.max(4, Math.round(x.avg * 0.6)) + 'px"></i>') + '<span class="wk" aria-hidden="true">' + WEEK_LABELS[k] + '</span></div>').join('') + '</div></div>'; }).join('') + '</div></section>';
    o += '<section class="card elevated" aria-labelledby="as-hh"><h2 class="t-title" id="as-hh">두뇌 건강 점검 기록</h2>' + (asm.length ? '<ul class="slist">' + asm.slice(0, 8).map((a, i) => '<li><span class="t-small muted">' + mdLabel(a.date) + '</span><span class="t-title-m">총점 ' + a.total + '점' + (asm[i + 1] ? ' ' + arrowHtml(a.total - asm[i + 1].total) : '') + '</span></li>').join('') + '</ul>' : '<p class="t-body muted mt">아직 점검 기록이 없어요.</p>') + '</section>';
    o += '<section class="card elevated" aria-labelledby="rec-h"><h2 class="t-title" id="rec-h">최근 훈련 <span class="muted t-body">(최근 10개)</span></h2>' + (empty ? '<p class="t-body muted mt">아직 없어요.</p>' :
      '<ul class="slist">' + all.slice(0, 10).map(s => { const d = parseYmd(s.date); return '<li><span class="t-small muted">' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')</span><span class="t-title-m">' + esc(s.gameName || (GAMES[s.gameId] && GAMES[s.gameId].name) || s.gameId) + ' · ' + esc(s.level) + '단계</span><span class="t-body">정답 ' + esc(s.correct) + '/' + esc(s.total) + ' · ' + fmtDur(Number(s.durationSec) || 0) + '</span>' +
        (chatAvail() ? '<span><button class="btn text fit" type="button" id="talk-' + esc(s.id) + '" data-act="talk" data-id="' + esc(s.id) + '">이 기록에 대해 이야기하기</button></span>' : '') + '</li>'; }).join('') + '</ul>') + '</section>';
    // 생활 체크 추세
    const l7 = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i))), c7 = l7.map(d => cis[d]), c14 = Array.from({ length: 14 }, (_, i) => cis[addDays(today, -i)]).filter(Boolean);
    const sl = c14.map(c => Number(c.sleepHours)).filter(x => x > 0), cnt = k => c7.filter(c => c && c[k]).length;
    o += '<section class="card outlined" aria-labelledby="lf-h"><h2 class="t-title" id="lf-h">생활 체크 흐름</h2><p class="t-small muted">최근 7일 기분</p><div class="week mt" role="list">' +
      l7.map((d, i) => '<div class="day" role="listitem" aria-label="' + mdLabel(d) + ' 기분 ' + (c7[i] && FACES[c7[i].mood] ? FACES[c7[i].mood][1] : '기록 없음') + '"><span style="font-size:calc(30px * var(--text-scale))" aria-hidden="true">' + (c7[i] && FACES[c7[i].mood] ? FACES[c7[i].mood][0] : '–') + '</span><span class="t-small">' + WD[parseYmd(d).getDay()] + '</span></div>').join('') + '</div>' +
      '<div class="stat mt"><div><span class="t-label">평균 수면(14일)</span><b>' + (sl.length ? (Math.round(mean(sl) * 10) / 10) + '시간' : '-') + '</b></div><div><span class="t-label">걷기·운동(7일)</span><b>' + cnt('exercise') + '/7일</b></div><div><span class="t-label">사람 만남(7일)</span><b>' + cnt('social') + '/7일</b></div></div>' +
      (cis[today] ? '<div class="mt"><button class="btn text fit" id="talk-check" type="button" data-act="talkcheck"' + (chatAvail() ? '' : ' hidden') + '>오늘 생활 체크에 대해 이야기하기</button></div>' : '') + '</section>';
    o += sleepReportHtml();
    if (!isTrainee()) o += taskReportHtml() + surveyReportHtml() + clinicalReportHtml(false);
    o += '<section class="card outlined" aria-labelledby="lv-h"><h2 class="t-title" id="lv-h">훈련별 현재 단계</h2><div class="mt">' + GAME_ORDER.map(id => '<div class="lvrow"><span>' + esc(GAMES[id].name) + '</span><span class="t-body">' + getLevel(id) + '단계 ' + levelDots(getLevel(id)) + '</span></div>').join('') + '</div></section>';
    o += '<section class="card tertiary" id="report-disclaimer"><p class="t-body">이 리포트는 <b>진단이 아니에요.</b> 의료기기가 아니며 훈련 기록을 보기 쉽게 정리한 것뿐이에요. 점수가 계속 낮아지면 치매안심센터(국번 없이 1899-9988)나 병원에서 상담받으세요.</p></section>';
    o += '<p class="sync-note t-small" id="family-note-static">' + (Store.shared && !S.dbError ? '이 기록은 같은 가족방에 들어온 가족만 볼 수 있어요.' : '지금은 이 기기에 저장된 기록만 보여요. (체험 모드)') + '</p><p class="sync-note" id="sync-note"></p></div>';
    return o;
  },
  bind(el) {
    $('#fam-status', el).append(statusChip());
    const wk = $('#wk-text', el); if (wk) wk.textContent = currentSummary().text;
    if (!isTrainee() && chatAvail()) { $('#nudge-card', el).hidden = false; $('#nudge-slot', el).append(nudgePanel('fam-nudge')); }
  }
};

/* 잠 기록: 최근 7일 (잠든 시각 → 일어난 시각, 깬 횟수) */
function sleepReportHtml() {
  const rows = (S.sleeplogs || []).filter(x => x && x.date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
  if (!rows.length) return '';
  return '<section class="card outlined" id="sleep-report" aria-labelledby="slp-h"><h2 class="t-title" id="slp-h">잠 기록</h2><ul class="slist">' + rows.map(r => { const d = parseYmd(r.date); return '<li><span class="t-small muted">' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')</span><span class="t-title-m">' + esc(r.bed) + ' → ' + esc(r.wake) + '</span><span class="t-body">' + (r.wakings ? '밤에 ' + esc(r.wakings) + '번 깼어요' : '깨지 않고 잤어요') + '</span></li>'; }).join('') + '</ul></section>';
}
