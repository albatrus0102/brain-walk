import { DOM } from '../../games/registry.js';
import { ic } from '../../icons.js';
import { COURSE_N, praise } from '../../session.js';
import { beep, say, synth } from '../../sound.js';
import { S } from '../../state.js';
import { h } from '../dom.js';
import { SCREENS } from '../registry.js';
import { progressBar } from '../widgets.js';
import { $, esc } from '../../util.js';

SCREENS.game = {
  html() {
    const s = S.sess, g = s.g, pr = Math.round(s.idx / s.rounds * 100);
    return '<div class="stack"><div>' +
      (s.inCourse ? '<div class="prog-label"><span>오늘의 훈련 ' + (S.course.results.length + 1) + '/' + COURSE_N + '</span><span>' + esc(DOM[g.domain].name) + '</span></div>' + progressBar(S.course.results.length / COURSE_N * 100, '오늘의 훈련 진행') + '<div style="height:12px"></div>' : '') +
      '<div class="prog-label"><span>문제 ' + (s.idx + 1) + ' / ' + s.rounds + '</span><span>' + (s.assess ? '점검' : s.level + '단계') + '</span></div>' + progressBar(pr, '문제 진행') + '</div>' +
      '<h1 class="t-title' + (s.inCourse || s.assess ? '' : ' sr') + '" id="g-title">' + esc(g.name) + '</h1>' +
      '<section class="card elevated prompt" aria-label="안내"><p class="prompt-text" id="prompt"></p>' +
      '<div class="row"><button class="btn tonal" id="btn-replay" type="button" data-act="replay"' + (synth ? '' : ' disabled') + '>' + ic('vol') + (synth ? '다시 듣기' : '소리 안내 불가') + '</button></div></section>' +
      '<div id="box"></div><div id="fb" aria-live="polite"></div>' +
      '<div class="cta quiet" id="game-cta"><button class="btn filled" id="btn-next" type="button" data-act="next" hidden>다음 문제</button><button class="btn text" id="btn-quit" type="button" data-act="quit">그만하기</button></div></div>';
  },
  bind(el) {
    const s = S.sess, g = s.g, box = $('#box', el), rt0 = Date.now();
    let spoken = '';
    const ctx = {
      level: s.level, round: s.idx, box, mem: s.mem, finished: false,
      prompt(text, speech) { $('#prompt', el).textContent = text; spoken = speech || text; say(spoken); },
      replay() { say(spoken, true); },
      finish(r) {
        if (ctx.finished) return; ctx.finished = true;
        s.correct += r.correct; s.total += r.total; if (r.metrics) s.taskMetrics = r.metrics; s.roundSec.push(Math.round((Date.now() - rt0) / 100) / 10);
        beep(r.ok ? 'ok' : 'soft');
        const msg = (r.ok ? praise() + ' ' : '') + r.msg;
        $('#fb', el).innerHTML = '<div class="fb ' + (r.ok ? 'good' : 'soft') + '" id="fb-card">' + esc(msg) + '</div>';
        say(msg);
        const nb = $('#btn-next', el); nb.hidden = false; $('#game-cta', el).classList.remove('quiet');
        nb.textContent = s.idx + 1 < s.rounds ? '다음 문제' : (s.assess ? '이 영역 마치기' : '결과 보기');
        // 안내 글이 먼저 보이게 하고(버튼은 아래에 고정되어 있어요), 초점은 다음 버튼으로
        setTimeout(() => { try { $('#fb-card', el).scrollIntoView({ block: 'nearest', behavior: 'auto' }); nb.focus({ preventScroll: true }); } catch (e) {} }, 60);
      },
      mc(o) {
        const wrap = h('div', { class: 'stack' });
        wrap.insertAdjacentHTML('beforeend', (o.pre || '') + '<div class="choices" role="group" aria-label="보기">' + o.choices.map((c, i) => '<button type="button" class="choice" id="choice-' + i + '" data-v="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>');
        box.appendChild(wrap);
        if (o.speakChoices) { spoken = spoken + ' 보기는 ' + o.choices.join(', ') + ' 입니다.'; say(spoken); }
        wrap.addEventListener('click', e => {
          const b = e.target.closest('.choice'); if (!b || ctx.finished) return;
          const ok = b.dataset.v === o.answer;
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
    g.play(ctx);
  }
};
