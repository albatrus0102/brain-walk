import { regTask } from './registry.js';
import { h, btnEl } from '../ui/dom.js';
import { lin } from './task-util.js';
import { rnd } from '../util.js';

/* 점 잇기 — 1→2→3… (A형), 1→가→2→나… (B형). 시간을 재요. 화면 배치와 이름은 자체 구성이에요. */
function layout(n) {   // 겹치지 않게 흩뿌리기 (단위 %)
  const pts = []; let guard = 0;
  while (pts.length < n && guard++ < 4000) {
    const p = { x: rnd(10, 90), y: rnd(8, 92) };
    if (pts.every(q => Math.hypot((q.x - p.x) * 3.2, (q.y - p.y) * 3.8) > 78)) pts.push(p);
  }
  while (pts.length < n) pts.push({ x: 10 + pts.length * 8, y: 10 + pts.length * 8 });
  return pts;
}
function trails(ctx, kind) {
  const seq = kind === 'A' ? [1, 2, 3, 4, 5, 6, 7, 8].map(String) : ['1', '가', '2', '나', '3', '다', '4', '라', '5', '마'].slice(0, 8);
  const pos = layout(seq.length), order = seq.slice(), shown = order.map((t, i) => ({ t, p: pos[i] }));
  let next = 0, errors = 0, t0 = 0;
  ctx.prompt(kind === 'A' ? '1부터 차례대로 숫자를 눌러 이어 주세요. 되도록 빨리, 하지만 천천히 하셔도 괜찮아요.' : '숫자와 글자를 번갈아 눌러 이어 주세요. 1 → 가 → 2 → 나 → 3 → 다 순서예요.');
  const field = h('div', { class: 'card outlined', id: 'trail-field', style: 'position:relative;height:380px;padding:0' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;color:var(--md-sys-color-primary)');
  field.append(svg);
  const status = h('p', { class: 't-body center', id: 'trail-status', 'aria-live': 'polite', text: '시작을 누르면 시간이 재져요.' });
  const startBtn = btnEl('시작', 'filled', () => {
    startBtn.remove(); t0 = Date.now(); status.textContent = '지금 ' + seq[0] + ' 을(를) 눌러 주세요.';
    shown.forEach((d, i) => {
      const b = h('button', { type: 'button', class: 'btn tonal', id: 'dot-' + i, 'data-t': d.t, style: 'position:absolute;left:calc(' + d.p.x + '% - 30px);top:calc(' + d.p.y + '% - 30px);width:60px;height:60px;min-height:60px;padding:0;border-radius:var(--md-sys-shape-corner-full);font-size:var(--md-sys-typescale-title-large-size);font-weight:700' }, d.t);
      b.addEventListener('click', () => {
        if (ctx.finished) return;
        if (d.t !== seq[next]) { errors++; b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); status.textContent = '아니에요. ' + seq[next] + ' 을(를) 찾아 눌러 주세요.'; return; }
        b.classList.remove('tonal'); b.classList.add('filled'); b.disabled = true;
        if (next > 0) { const a = shown[next - 1].p, ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', d.p.x); ln.setAttribute('y2', d.p.y); ln.setAttribute('stroke', 'currentColor'); ln.setAttribute('stroke-width', '1.2'); svg.append(ln); }
        next++;
        if (next >= seq.length) {
          const sec = Math.round((Date.now() - t0) / 100) / 10;
          const score = Math.max(0, (kind === 'A' ? lin(sec, 15, 90) : lin(sec, 30, 180)) - errors * 5);
          ctx.finish({ correct: score, total: 100, ok: score >= 50, msg: '다 이었어요. ' + sec + '초 걸렸어요' + (errors ? ' (잘못 누른 것 ' + errors + '번)' : '') + '.', metrics: { sec, err: errors } });
        } else status.textContent = '다음은 ' + seq[next] + ' 이에요.';
      });
      field.append(b);
    });
  }, 'btn-trail-start');
  ctx.box.append(h('div', { class: 'stack' }, status, field, h('div', { class: 'cta' }, startBtn)));
}
regTask({ id: 't_trails_a', name: '점 잇기 (숫자)', domain: 'speed', desc: '숫자를 1부터 차례로 이어요', rounds: 1, play: ctx => trails(ctx, 'A') });
regTask({ id: 't_trails_b', name: '점 잇기 (숫자와 글자)', domain: 'executive', desc: '숫자와 글자를 번갈아 이어요', rounds: 1, play: ctx => trails(ctx, 'B') });
