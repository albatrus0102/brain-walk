import { alarmTick } from '../../alarm.js';
import { allAssessments, allCheckins, allSessions, chatAvail, courseStatus, dateSet, ensureProfiles, isTrainee, nameOf, streakOf, todayS, traineeLabel } from '../../data.js';
import { DOM, GAMES } from '../../games/registry.js';
import { ic } from '../../icons.js';
import { nextCheckInfo, programInfo } from '../../logic.js';
import { sendMessage } from '../../messages.js';
import { mdLabel, tipHtml } from '../../records.js';
import { COURSE_N, courseGames, startCourse } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { btnEl, h, svgIcon, toast } from '../dom.js';
import { cistBannerHtml } from './clinical.js';
import { pushPromptCard } from '../room-settings.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { prefsCard, progressBar, slotText, statusChip } from '../widgets.js';
import { $, LS, WD, esc, ymd } from '../../util.js';

SCREENS.home = {
  html() {
    const now = new Date(), list = allSessions(), st = streakOf(list, now), hr = now.getHours(), today = ymd(now);
    const greet = hr < 12 ? '좋은 아침이에요' : hr < 18 ? '편안한 오후예요' : '편안한 저녁이에요';
    const hero = '<section class="card primary" aria-labelledby="hello"><p class="t-label">' + greet + '</p><h1 class="t-display" id="hello">' + now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일<br>' + WD[now.getDay()] + '요일</h1>' +
      (isTrainee() ? (st > 0 ? '<p class="t-title-m mt">연속 ' + st + '일째 훈련 중이에요</p>' : '<p class="t-body mt">오늘도 천천히 두뇌 산책을 시작해 볼까요?</p>') : '<p class="t-body mt" id="fam-hello"><span data-slot="tlabel"></span>의 두뇌 산책을 함께 응원해요.</p>') + '</section>';
    if (!isTrainee()) {
      return '<div class="stack"><div id="home-banner"></div>' + hero +
        '<section class="card elevated" aria-labelledby="ft-h"><h2 class="t-title" id="ft-h"><span data-slot="tlabel"></span>의 오늘</h2><div class="mt" id="fam-status-slot"></div>' +
        '<div class="stack mt"><button class="btn filled" id="btn-fam-report" type="button" data-act="nav" data-to="family">가족이 보는 기록</button>' +
        '<button class="btn tonal" id="btn-fam-chat" type="button" data-act="nav" data-to="chat">대화방 열기</button>' +
        '<button class="btn outlined" id="btn-fam-nudge" type="button" data-act="nudgego">훈련 알림 보내기</button></div></section>' +
        '<button class="btn outlined" id="btn-pick" type="button" data-act="nav" data-to="pick">나도 훈련해 보기</button>' +
        '<button class="btn tonal" id="btn-open-settings" type="button" data-act="nav" data-to="settings">알람·사용 방식 설정</button>' + prefsCard() + '</div>';
    }
    const cg = courseGames(now), saved = LS.get('bw.course', null), doneN = (saved && saved.date === today) ? saved.results.length : 0, cs = courseStatus();
    const resume = doneN > 0 && doneN < COURSE_N, shown = cs.done ? COURSE_N : Math.max(doneN, 0);
    const pi = programInfo(S.program.startDate, today, dateSet(list)), lastA = allAssessments()[0], nc = nextCheckInfo(lastA && lastA.date, today), cis = allCheckins();
    const ncText = nc.state === 'none' ? ['아직 두뇌 건강 점검을 하지 않았어요', '처음 상태를 기록해 두면 변화를 비교할 수 있어요. (약 15분, 나눠서 해도 돼요)', '점검 시작하기']
      : nc.state === 'due' ? ['다시 점검할 때예요', '마지막 점검이 ' + nc.days + '일 전이에요. 한 달에 한 번 같은 문제로 비교해요.', '점검 시작하기']
      : ['다음 점검은 ' + nc.remain + '일 뒤예요', '마지막 점검: ' + mdLabel(lastA.date) + ' (총점 ' + lastA.total + ')', '점검 결과 보기'];
    return '<div class="stack"><div id="home-banner"></div>' + hero + '<div id="cheer-slot"></div>' +
      '<section class="card elevated" aria-labelledby="course-h"><h2 class="t-title" id="course-h">오늘의 훈련 · 약 15분</h2>' +
      '<div class="mt">' + progressBar(shown / COURSE_N * 100, '오늘의 훈련 진행') + '<p class="t-small muted mt">오늘 ' + shown + '/' + COURSE_N + ' 마쳤어요</p></div>' +
      '<ul class="course-list mt t-body">' + cg.map((id, i) => '<li><span>' + (i + 1) + '. ' + esc(DOM[GAMES[id].domain].name) + '</span><span class="muted">' + esc(GAMES[id].name) + '</span></li>').join('') + '</ul>' +
      (cs.done ? '<p class="t-body mt"><b>오늘 훈련을 모두 마치셨어요.</b> 한 번 더 해도 좋아요.</p>' : resume ? '<p class="t-body mt">오늘 ' + doneN + '/' + COURSE_N + ' 마치셨어요. 이어서 해 볼까요?</p>' : '') +
      '<div class="mt"><button class="fab-ext" id="btn-start-course" type="button" data-act="course">' + ic('play') + '<span>' + (resume ? '오늘의 훈련 이어서 하기' : '오늘의 훈련 시작') + '</span></button></div></section>' +
      '<section class="card filled" aria-labelledby="prog-h"><h2 class="t-title" id="prog-h">12주 프로그램 · 12주 중 ' + pi.week + '주차</h2><div class="mt">' + progressBar(pi.overall * 100, '12주 프로그램 진행') + '</div>' +
      '<p class="t-body mt">이번 주 ' + pi.weekDays + '/' + pi.goal + '일 훈련 (목표 주 5일)</p>' + progressBar(Math.min(100, pi.weekDays / pi.goal * 100), '이번 주 목표') +
      (pi.done ? '<p class="t-title-m mt">12주 프로그램을 끝까지 해내셨어요! 완주 배지를 드려요.</p>' : '') + '</section>' +
      '<section class="card outlined" aria-labelledby="ci-h"><h2 class="t-title" id="ci-h">오늘의 생활 체크</h2>' +
      (cis[today] ? '<p class="t-body mt">오늘 생활 체크를 마치셨어요. 잘하셨어요!</p>' : '<p class="t-body mt">기분, 잠, 운동을 30초 만에 적어요.</p><div class="mt"><button class="btn tonal" id="btn-checkin" type="button" data-act="nav" data-to="checkin">생활 체크 하기</button></div>') +
      '<div class="mt">' + tipHtml() + '</div></section>' +
      '<section class="card tertiary" aria-labelledby="nc-h"><h2 class="t-title" id="nc-h">' + ncText[0] + '</h2><p class="t-body mt">' + ncText[1] + '</p><div class="mt"><button class="btn filled" id="btn-nextcheck" type="button" data-act="nav" data-to="assess">' + ncText[2] + '</button></div></section>' +
      '<div class="row"><button class="btn tonal" id="btn-pick" type="button" data-act="nav" data-to="pick">골라서 하기</button><button class="btn outlined" id="btn-family" type="button" data-act="nav" data-to="family">가족이 보는 기록</button></div>' +
      '<button class="btn text" id="btn-open-settings" type="button" data-act="nav" data-to="settings">알람·사용 방식 설정</button>' + prefsCard() + '</div>';
  },
  bind(el) {
    slotText(el, 'tlabel', traineeLabel());
    const bn = $('#home-banner', el);
    const pc = pushPromptCard(); if (pc) bn.append(pc);
    if (!isTrainee()) bn.insertAdjacentHTML('beforeend', cistBannerHtml());
    if (S.alarmDue) {
      bn.append(h('div', { class: 'banner', role: 'alert', id: 'alarm-banner' }, h('div', { class: 't-title' }, svgIcon('alarm'), '훈련할 시간이에요!'), h('div', { class: 't-body', text: '오늘의 두뇌 산책을 시작해 볼까요? 천천히 하셔도 괜찮아요.' }),
        h('div', { class: 'row' }, btnEl('오늘의 훈련 시작', 'filled', () => startCourse(), 'banner-start'), btnEl('30분 뒤에', 'text', () => { LS.set('bw.snooze', Date.now() + 30 * 60000); alarmTick(); render(true); toast('30분 뒤에 다시 알려 드릴게요.'); }, 'banner-snooze'))));
    }
    if (S.remDue) {
      bn.append(h('div', { class: 'banner', role: 'status', id: 'reminder-banner' }, h('div', { class: 't-title' }, svgIcon('alarm'), traineeLabel() + '이(가) 아직 훈련 전이에요'),
        h('div', { class: 'row' }, btnEl('알림 보내기', 'filled', () => { go('family'); setTimeout(() => { const n = $('#nudge-slot'); if (n) n.scrollIntoView({ block: 'center' }); }, 50); }, 'rem-send'), btnEl('닫기', 'text', () => { LS.set('bw.remDismiss', todayS()); alarmTick(); render(true); }, 'rem-close'))));
    }
    const fs = $('#fam-status-slot', el); if (fs) fs.append(statusChip());
    const cheer = $('#cheer-slot', el);
    if (cheer && chatAvail()) {
      const msgs = S.messages.filter(m => m.authorId !== S.myId && !m.deleted && m.kind === 'text' && m.text).slice(-3).reverse();
      ensureProfiles(msgs.map(m => m.authorId));
      const box = h('section', { class: 'card primary cheer', 'aria-labelledby': 'cheer-h', id: 'cheer-card' }, h('h2', { class: 't-title', id: 'cheer-h', text: '가족 응원' }));
      if (!msgs.length) box.append(h('p', { class: 't-body', text: '아직 새 응원 메시지가 없어요. 가족이 글을 남기면 여기에 보여요.' }));
      msgs.forEach((m, i) => box.append(h('div', { class: 'cheer-item', id: 'cheer-' + i }, h('b', { text: nameOf(m.authorId) }), h('span', { class: 't-body', text: m.text }))));
      if (msgs.length) {
        box.append(btnEl('소리로 듣기', 'filled', () => say(msgs.map(m => nameOf(m.authorId) + '님이 말씀하셨어요. ' + m.text).join(' '), true), 'cheer-tts', 'vol'));
        box.append(h('div', { class: 'quick', 'aria-label': '한 번에 답장하기' }, QUICK_REPLIES.map((t, i) => h('button', { class: 'chip', type: 'button', id: 'cheer-reply-' + i, onclick: () => { sendMessage({ kind: 'text', text: t, replyTo: msgs[0].id }).then(ok => { if (ok) toast('답장을 보냈어요.'); }); } }, t))));
      }
      box.append(btnEl('대화방 열기', 'tonal', () => go('chat'), 'cheer-open'));
      cheer.append(box);
    }
  }
};
export const QUICK_REPLIES = ['고마워요 ❤️', '오늘도 했어요!', '보고 싶어요'];
