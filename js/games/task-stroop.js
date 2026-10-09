import { regTask } from './registry.js';
import { h } from '../ui/dom.js';
import { clamp } from './task-util.js';
import { shuffle } from '../util.js';

/* 색-글자 간섭 — 글자가 아니라 "글자의 색"을 골라요. 큰 색 버튼 4개.
 * 아래 색은 과제 자극(의미가 있는 색)이라 디자인 토큰이 아니라 고정값이에요. */
const COLORS = [
  { n: '빨강', c: '#C62828', fg: '#FFFFFF' },
  { n: '파랑', c: '#1565C0', fg: '#FFFFFF' },
  { n: '노랑', c: '#F9C80E', fg: '#1A1A1A' },
  { n: '초록', c: '#2E7D32', fg: '#FFFFFF' }
];
regTask({
  id: 't_stroop', name: '색 고르기', domain: 'attention', desc: '글자의 색을 골라요', rounds: 1,
  play(ctx) {
    const trials = []; // 연습 2 + 본 과제 10 (7 다른 색 + 3 같은 색)
    const mk = (word, ink, practice) => ({ word, ink, practice });
    const pr = shuffle([0, 1, 2, 3]);
    trials.push(mk(pr[0], (pr[0] + 1) % 4, true), mk(pr[1], pr[1], true));
    const main = [];
    for (let i = 0; i < 7; i++) { const w = i % 4; main.push(mk(w, (w + 1 + (i % 3)) % 4, false)); }
    for (let i = 0; i < 3; i++) main.push(mk(i, i, false));
    shuffle(main).forEach(t => trials.push(t));
    let i = 0, t0 = 0; const rec = [];
    ctx.prompt('가운데 낱말이 어떤 "색"으로 쓰여 있는지 보고, 같은 색 버튼을 눌러 주세요. 낱말의 뜻이 아니라 글자 색이에요. 처음 2번은 연습이에요.');
    const word = h('p', { class: 't-display center', id: 'stroop-word', style: 'min-height:110px' });
    const status = h('p', { class: 't-small center muted', id: 'stroop-status', 'aria-live': 'polite' });
    const btns = h('div', { class: 'grid', style: '--cols:2', id: 'stroop-btns' }, COLORS.map((c, k) => h('button', { type: 'button', class: 'cell', id: 'sc-' + k, 'data-k': k, style: 'min-height:96px;font-size:var(--md-sys-typescale-title-large-size);font-weight:700;background:' + c.c + ';color:' + c.fg + ';border:3px solid var(--md-sys-color-outline)' }, c.n)));
    function show() {
      const t = trials[i]; word.textContent = COLORS[t.word].n; word.style.color = COLORS[t.ink].c;
      status.textContent = t.practice ? '연습 ' + (i + 1) + ' / 2' : '문제 ' + (i - 1) + ' / 10'; t0 = performance.now();
    }
    btns.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || ctx.finished) return;
      const t = trials[i], ok = Number(b.dataset.k) === t.ink, ms = Math.round(performance.now() - t0);
      if (!t.practice) rec.push({ ok, ms, inc: t.word !== t.ink });
      i++;
      if (i >= trials.length) {
        const acc = rec.filter(r => r.ok).length / rec.length, avg = a => a.length ? Math.round(a.reduce((x, y) => x + y.ms, 0) / a.length) : 0;
        const mean = avg(rec), speed = clamp((3500 - mean) / (3500 - 1200), 0, 1), score = Math.round(acc * 100 * (0.6 + 0.4 * speed));
        word.textContent = ''; btns.querySelectorAll('button').forEach(x => { x.disabled = true; });
        ctx.finish({ correct: score, total: 100, ok: acc >= 0.7, msg: '10개 중 ' + rec.filter(r => r.ok).length + '개 맞췄어요.', metrics: { acc: Math.round(acc * 100), ms: mean, incMs: avg(rec.filter(r => r.inc)), conMs: avg(rec.filter(r => !r.inc)) } });
      } else show();
    });
    ctx.box.append(h('div', { class: 'stack' }, status, h('div', { class: 'card elevated center' }, word), btns));
    show();
  }
});
