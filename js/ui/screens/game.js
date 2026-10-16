import { flushItemLog, canLog, pushEntry } from '../../ai/itemlog.js';
import { codeItemId, codeRole } from '../../ai/itemlog-doc.js';
import { markSeen, measureFirstPos, measureNext, bumpMeasureDay, draw as bankDraw } from '../../ai/bank.js';
import { tryBank, hostable } from '../../games/items.js';
import { DOM } from '../../games/registry.js';
import { ic } from '../../icons.js';
import { courseLen, praise } from '../../session.js';
import { getPlan, isTrainee } from '../../data.js';
import { beep, canSpeakKo, say, synth } from '../../sound.js';
import { chromeIntentUrl, inAppInfo, kakaoExternalUrl } from '../install.js';
import { Platform } from '../../platform.js';
import { S } from '../../state.js';
import { h } from '../dom.js';
import { SCREENS } from '../registry.js';
import { progressBar } from '../widgets.js';
import { $, esc } from '../../util.js';

/* 답한 뒤: 안내 글(#fb-card)이 위의 앱 바와 아래에 고정된 "다음 문제" 버튼 사이에 보이게 스크롤해요.
 * 문제 글까지 한 화면에 들어가면 문제 글이 앱 바 바로 아래에 오게 하고, 안 들어가면 안내 글을 버튼 바로 위에 둬요.
 * (예전에는 scrollIntoView 'nearest' 가 안내 글을 화면 맨 아래, 즉 고정 버튼 밑에 두어서 문제도 안내도 안 보였어요.) */
function revealFeedback(el) {
  const fb = $('#fb-card', el), q = $('.prompt', el), cta = $('#game-cta', el), bar = document.querySelector('.appbar');
  if (!fb) return;
  const top = (bar ? bar.getBoundingClientRect().bottom : 0) + 8;
  const ctaH = cta && getComputedStyle(cta).position === 'sticky' ? cta.offsetHeight + (parseFloat(getComputedStyle(cta).bottom) || 0) : 0;
  const bottom = window.innerHeight - ctaH - 8;
  const f = fb.getBoundingClientRect(), qt = q ? q.getBoundingClientRect().top : f.top;
  let dy = 0;
  if (f.bottom - qt <= bottom - top) dy = qt - top;          // 문제 글 ~ 안내 글이 한 화면에 들어가요
  else if (f.bottom > bottom) dy = f.bottom - bottom;         // 안내 글을 버튼 바로 위로
  else if (f.top < top) dy = f.top - top;
  if (Math.abs(dy) > 1) window.scrollBy(0, dy);
}
/* 음성이 없는 브라우저(카톡 등 앱 안 브라우저): 소리가 나오는 브라우저로 여는 버튼 */
function noSpeechBtn() {
  const info = inAppInfo(), url = info ? (info.kakao ? kakaoExternalUrl() : Platform.platformName() === 'android' ? chromeIntentUrl() : '') : '';
  return url ? '<a class="btn tonal" id="btn-replay" href="' + url + '" rel="noopener">' + ic('vol') + '크롬으로 열기</a>' : '<button class="btn tonal" id="btn-replay" type="button" disabled>' + ic('vol') + '소리 안내 불가</button>';
}
SCREENS.game = {
  html() {
    const s = S.sess, g = s.g, pr = Math.round(s.idx / s.rounds * 100);
    return '<div class="stack"><div>' +
      (s.flow && S.course ? '<div class="prog-label"><span>오늘의 훈련 ' + Math.min(S.course.results.length + 1, courseLen()) + '/' + courseLen() + '</span><span>' + esc(DOM[g.domain].name) + '</span></div>' + progressBar(S.course.results.length / courseLen() * 100, '오늘의 훈련 진행') + '<div style="height:12px"></div>' : '') +
      '<div class="prog-label"><span>문제 ' + (s.idx + 1) + ' / ' + s.rounds + '</span><span>' + (s.assess ? '점검' : (isTrainee() && !getPlan().showScore) ? '' : s.level + '단계') + '</span></div>' + progressBar(pr, '문제 진행') + '</div>' +
      '<h1 class="t-title' + (s.flow || s.assess ? '' : ' sr') + '" id="g-title">' + esc(g.name) + '</h1>' +
      '<section class="card elevated prompt" aria-label="안내"><p class="prompt-text" id="prompt"></p>' +
      '<div class="row">' + (synth ? '<button class="btn tonal" id="btn-replay" type="button" data-act="replay">' + ic('vol') + '다시 듣기</button>' : noSpeechBtn()) + '</div></section>' +
      '<div id="box"></div><div id="fb" aria-live="polite"></div>' +
      '<div class="cta quiet" id="game-cta"><button class="btn filled" id="btn-next" type="button" data-act="next" hidden>다음 문제</button><button class="btn text" id="btn-quit" type="button" data-act="quit">그만하기</button></div></div>';
  },
  bind(el) {
    const s = S.sess, g = s.g, box = $('#box', el), rt0 = Date.now();
    let spoken = '', ptok = 0, t0 = null, tstart = 'display', fbT = null;
    s.cur = null; s.intr = false;
    const ctx = {
      level: s.level, round: s.idx, box, mem: s.mem, finished: false, logged: false, sess: s, game: g,
      /* 안내 글을 보이고 읽어 줘요. 걸린 시간(rt)은 읽기가 끝난 때부터 재요 (소리가 꺼져 있거나 목소리가 없으면 글이 보인 때부터). */
      prompt(text, speech) {
        $('#prompt', el).textContent = text; spoken = speech || text;
        const tok = ++ptok; t0 = null; clearTimeout(fbT);
        const begin = how => { if (tok !== ptok || t0 != null) return; t0 = Date.now(); tstart = how; };
        if (canSpeakKo() && say(spoken, false, null, () => begin('speech_end'))) fbT = setTimeout(() => begin('speech_end'), 25000);
        else { say(spoken); begin('display'); }
      },
      replay() { say(spoken, true); },
      rt() { return { ms: t0 == null ? 0 : Date.now() - t0, start: tstart }; },
      /* 은행 문항 꺼내기 (점검 중에는 쓰지 않아요). 없으면 null → 게임은 코드 문항으로 가요 */
      draw(cd, formats) {
        if (s.assess) return null;
        const it = bankDraw(cd, s.level, formats, s.mem.usedIds);
        if (!it) return null;
        (s.mem.usedIds = s.mem.usedIds || []).push(it.id); markSeen(it.id);
        return it;
      },
      bankItem(it) { s.cur = { id: it.id, role: it.role === 'reference' || it.role === 'anchor' ? it.role : 'training', fmt: it.format, cd: it.cdomain, lv: it.level }; },
      /* 문항 기록 한 줄 (item 이 null 이면 코드가 만든 문항 'proc') */
      logItem(item, o) {
        const r = ctx.rt(), base = item ? { id: item.id, role: item.role === 'reference' || item.role === 'anchor' ? item.role : 'training', fmt: item.format, cd: item.cdomain, lv: item.level }
          : { id: codeItemId(g.id, s.level, s.idx), role: codeRole(g.id), fmt: g.id, cd: g.cd || '', lv: s.level };
        pushEntry(s, Object.assign(base, { rt: r.ms, rtStart: r.start, intr: s.intr, pos: s.idx }, o));
        s.intr = false; ctx.logged = true;
      },
      finish(r) {
        if (ctx.finished) return; ctx.finished = true;
        if (!r.neutral) { s.correct += r.correct; s.total += r.total; }
        if (r.metrics) s.taskMetrics = r.metrics; s.roundSec.push(Math.round((Date.now() - rt0) / 100) / 10);
        if (!ctx.logged && !s.assess) ctx.logItem(null, { score: r.total ? r.correct / r.total : (r.ok ? 1 : 0), ok: !!r.ok, err: [], pick: ctx.pickIdx || [] });
        beep(r.ok || r.neutral ? 'ok' : 'soft');
        const msg = (r.ok && !r.neutral ? praise() + ' ' : '') + r.msg;
        // 안내 글에는 은행(AI)의 해설·보기 글이 들어갈 수 있어요: 글자로만 넣어요 (innerHTML 금지)
        const fbBox = $('#fb', el); fbBox.textContent = ''; fbBox.append(h('div', { class: 'fb ' + (r.ok || r.neutral ? 'good' : 'soft'), id: 'fb-card', text: msg }));
        say(msg);
        const nb = $('#btn-next', el); nb.hidden = false; $('#game-cta', el).classList.remove('quiet');
        nb.textContent = s.idx + 1 < s.rounds ? '다음 문제' : (s.assess ? '이 영역 마치기' : s.delayed ? '마치기' : '결과 보기');
        // 안내 글이 먼저 보이게 하고(버튼은 아래에 고정되어 있어요), 초점은 다음 버튼으로
        setTimeout(() => { try { revealFeedback(el); nb.focus({ preventScroll: true }); } catch (e) {} }, 60);
      },
      mc(o) {
        const wrap = h('div', { class: 'stack' });
        wrap.insertAdjacentHTML('beforeend', (o.pre || '') + '<div class="choices" role="group" aria-label="보기">' + o.choices.map((c, i) => '<button type="button" class="choice" id="choice-' + i + '" data-i="' + i + '" data-v="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>');
        box.appendChild(wrap);
        if (o.speakChoices) { spoken = spoken + ' 보기는 ' + o.choices.join(', ') + ' 입니다.'; say(spoken); }
        wrap.addEventListener('click', e => {
          const b = e.target.closest('.choice'); if (!b || ctx.finished) return;
          const ok = b.dataset.v === o.answer;
          ctx.pickIdx = [Number(b.dataset.i)];
          wrap.querySelectorAll('.choice').forEach(x => {
            x.disabled = true;
            if (x.dataset.v === o.answer) { x.classList.add('right'); x.dataset.tag = ok ? '정답입니다' : '정답'; }
            else if (x === b) { x.classList.add('picked'); x.dataset.tag = '선택하신 답'; }
            else x.classList.add('dim');
          });
          ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? o.right : o.wrong });
        });
      }
    };
    S.ctx = ctx;
    // 게임 밖으로 나가면(그만하기 등) 하던 판을 "중간에 그만둠"으로 기록해요. 다음 문제로 넘어갈 때(같은 게임 화면)는 해당 없어요.
    S.onLeave = () => { if (S.screen === 'game' && S.sess === s) return; if (!s.logged) flushItemLog(s, true); };
    if (!hostMeasure(ctx, s, g)) g.play(ctx);
  }
};

/* 이번 주 기준·앵커 문항을 게임 앞쪽(첫 문제 다음)에 끼워 넣어요. 같은 영역 게임만, 훈련하는 분 기기에서만, 하루 분량까지만. */
function hostMeasure(ctx, s, g) {
  if (s.assess || s.delayed || !canLog()) return false;
  const cds = g.hostCds || [], first = measureFirstPos();
  if (!cds.length || s.rounds < 3) return false;
  const slots = s.rounds >= 5 ? [first, first + 1] : [first];
  if (!slots.includes(s.idx)) return false;
  const it = measureNext(cds, s.mem.usedIds);
  if (!it || !hostable(it)) return false;
  (s.mem.usedIds = s.mem.usedIds || []).push(it.id); markSeen(it.id); bumpMeasureDay();
  if (tryBank(ctx, it)) return true;
  return false;
}
