import { regTask } from './registry.js';
import { h } from '../ui/dom.js';
import { lin, median } from './task-util.js';
import { rnd } from '../util.js';

/* 반응 속도 — 신호가 바뀌면 화면을 눌러요. 5번의 중앙값(ms). 색이 아니라 글자로도 알려 줘요. */
regTask({
  id: 't_reaction', name: '반응 속도', domain: 'speed', desc: '신호가 바뀌면 바로 눌러요', rounds: 1,
  play(ctx) {
    const times = []; let early = 0, timer = null, goAt = 0, waiting = false;
    ctx.prompt('큰 칸이 "기다려요"에서 "지금!"으로 바뀌면 바로 눌러 주세요. 5번 해요. 먼저 누르면 다시 해요.');
    const pad = h('button', { type: 'button', class: 'btn tonal', id: 'react-pad', style: 'width:100%;min-height:240px;font-size:var(--md-sys-typescale-headline-large-size);font-weight:700' }, '시작하려면 누르세요');
    const info = h('p', { class: 't-body center', id: 'react-info', 'aria-live': 'polite', text: '0 / 5' });
    function arm() {
      waiting = true; pad.className = 'btn tonal'; pad.textContent = '기다려요…'; goAt = 0;
      timer = setTimeout(() => { goAt = performance.now(); pad.className = 'btn filled'; pad.textContent = '지금!'; }, rnd(1500, 3800));
    }
    pad.addEventListener('pointerdown', () => {
      if (ctx.finished) return;
      if (!waiting) { arm(); return; }
      if (!goAt) { clearTimeout(timer); early++; info.textContent = '너무 일찍 눌렀어요. 다시 해요. (' + times.length + ' / 5)'; arm(); return; }
      const ms = Math.round(performance.now() - goAt); times.push(ms); waiting = false; info.textContent = times.length + ' / 5 · ' + ms + '밀리초';
      if (times.length >= 5) {
        const med = median(times), score = Math.max(0, lin(med, 300, 1000) - early * 5);
        pad.disabled = true; ctx.finish({ correct: score, total: 100, ok: score >= 50, msg: '가운데 값은 ' + med + '밀리초였어요.', metrics: { ms: Math.round(med), early } });
      } else { pad.className = 'btn tonal'; pad.textContent = '다시 누르면 다음 차례'; }
    });
    ctx.box.append(h('div', { class: 'stack' }, info, pad));
  }
});
