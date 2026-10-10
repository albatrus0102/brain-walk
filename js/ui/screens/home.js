import { alarmTick } from '../../alarm.js';
import { allCheckins, allSessions, chatAvail, courseStatus, ensureProfiles, isTrainee, nameOf, streakOf, todayS, traineeLabel } from '../../data.js';
import { DOM, GAMES } from '../../games/registry.js';
import { ic } from '../../icons.js';
import { nextCheckInfo, programInfo } from '../../logic.js';
import { sendMessage } from '../../messages.js';
import { mdLabel, tipHtml } from '../../records.js';
import { COURSE_N } from '../../session.js';
import { say } from '../../sound.js';
import { S } from '../../state.js';
import { btnEl, h, svgIcon, toast } from '../dom.js';
import { cistBannerHtml } from './clinical.js';
import { installSlot } from '../install.js';
import { pushPromptCard } from '../room-settings.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { progressBar, slotText, statusChip } from '../widgets.js';
import { $, LS, WD, ymd } from '../../util.js';

SCREENS.home = {
  html() {
    const now = new Date(), list = allSessions(), st = streakOf(list, now), hr = now.getHours(), today = ymd(now);
    const greet = hr < 12 ? '좋은 아침이에요' : hr < 18 ? '편안한 오후예요' : '편안한 저녁이에요';
    // 인사말 + 날짜는 카드가 아니라 가벼운 머리글: 화면에서 가장 눈에 띄는 것은 아래 '오늘의 훈련' 카드 하나예요.
    const hero = '<header class="hero" aria-labelledby="hello"><p class="greet">' + greet + '</p><h1 class="date" id="hello">' + now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일<br>' + WD[now.getDay()] + '요일</h1>' +
      (isTrainee() ? (st > 0 ? '<p class="streak">' + ic('leaf') + '연속 ' + st + '일째 훈련 중이에요</p>' : '<p class="t-body muted">오늘도 천천히 두뇌 산책을 시작해 볼까요?</p>') : '<p class="t-body muted" id="fam-hello"><span data-slot="tlabel"></span>의 두뇌 산책을 함께 응원해요.</p>') + '</header>';
    if (!isTrainee()) {
      return '<div class="stack"><div id="home-banner"></div>' + hero +
        '<section class="card elevated" aria-labelledby="ft-h"><h2 class="t-title" id="ft-h"><span data-slot="tlabel"></span>의 오늘</h2><div class="mt" id="fam-status-slot"></div>' +
        '<div class="stack mt"><button class="btn filled" id="btn-fam-report" type="button" data-act="nav" data-to="family">기록 보기</button>' +
        '<button class="btn tonal" id="btn-fam-chat" type="button" data-act="nav" data-to="chat">대화방 열기</button>' +
        '<button class="btn outlined" id="btn-fam-nudge" type="button" data-act="nudgego">훈련 알림 보내기</button></div></section>' +
        '<button class="btn outlined" id="btn-pick" type="button" data-act="nav" data-to="pick">나도 훈련해 보기</button>' +
        '</div>';
    }
    const saved = LS.get('bw.course', null), doneN = (saved && saved.date === today) ? saved.results.length : 0, cs = courseStatus(), cis = allCheckins();
    const resume = doneN > 0 && doneN < COURSE_N, shown = cs.done ? COURSE_N : Math.max(doneN, 0);
    // 훈련하는 분 홈: 다음 할 일은 하나(큰 버튼). 그 아래에는 응원과 생활 체크만. 나머지(프로그램, 월간 점검, 설문)는 '훈련' 탭에 있어요.
    const label = cs.done ? '오늘 완료 ✓  한 번 더 하기' : resume ? '이어서 하기 (' + doneN + '/' + COURSE_N + ')' : '오늘의 훈련 시작';
    // 알람이 울렸을 때는 따로 배너를 띄우지 않고, 이 카드가 "훈련할 시간이에요"로 바뀌어요. 큰 버튼은 늘 하나.
    const due = !!S.alarmDue && !cs.done;
    const count = cs.done ? '오늘 훈련을 다 마쳤어요. 더 하고 싶으면 한 번 더 해도 좋아요.' : '오늘 ' + shown + '/' + COURSE_N + ' 마쳤어요 · 약 15분';
    const todayCard = '<section class="card ' + (due ? 'today due' : 'elevated today') + '" id="today-card" aria-labelledby="today-h"' + (due ? ' role="alert"' : '') + '>' +
      (due ? '<h2 class="due-title" id="today-h">' + ic('alarm') + '훈련할 시간이에요!</h2><p class="t-body">천천히 하셔도 괜찮아요.</p>' : '<h2 class="t-title" id="today-h">오늘의 훈련</h2>') +
      '<button class="fab-ext' + (cs.done ? ' done' : '') + '" id="btn-start-course" type="button" data-act="course">' + ic('play') + '<span>' + label + '</span></button>' +
      '<div>' + progressBar(shown / COURSE_N * 100, '오늘의 훈련 진행') + '<p class="t-small mt" id="course-count">' + count + '</p></div>' +
      (due ? '<button class="btn text snooze" id="banner-snooze" type="button">30분 뒤에 다시 알려 주세요</button>' : '') + '</section>';
    return '<div class="stack"><div id="home-banner"></div>' + hero + todayCard +
      '<div id="cheer-slot"></div>' +
      (cis[today] ? '' : '<section class="card outlined" aria-labelledby="ci-h"><h2 class="t-title" id="ci-h">오늘의 생활 체크</h2><p class="t-body mt">기분, 잠, 운동을 30초 만에 적어요.</p><div class="mt"><button class="btn tonal" id="btn-checkin" type="button" data-act="nav" data-to="checkin">생활 체크 하기</button></div></section>') + '</div>';
  },
  bind(el) {
    slotText(el, 'tlabel', traineeLabel());
    const bn = $('#home-banner', el);
    bn.append(installSlot('home'));
    const pc = pushPromptCard(); if (pc) bn.append(pc);
    if (!isTrainee()) bn.insertAdjacentHTML('beforeend', cistBannerHtml());
    const sn = $('#banner-snooze', el);
    if (sn) sn.onclick = () => { LS.set('bw.snooze', Date.now() + 30 * 60000); alarmTick(); render(true); toast('30분 뒤에 다시 알려 드릴게요.'); };
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
