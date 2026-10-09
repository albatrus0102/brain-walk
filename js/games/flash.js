import { reg } from './registry.js';
import { btnEl, h } from '../ui/dom.js';
import { rnd } from '../util.js';

/* ---------- 9. 번쩍 찾기 (처리속도, 더블 디시전 방식) ---------- */
reg({
  id: 'flash', name: '번쩍 찾기', domain: 'speed', desc: '잠깐 보이는 그림과 별을 찾아요', rounds: 5,
  play(ctx) {
    const ms = [500, 420, 330, 240, 150][ctx.level - 1];
    const objs = [['🚗', '자동차'], ['🚚', '트럭']], ci = rnd(0, 1), POS = [0, 1, 2, 3, 5, 6, 7, 8], star = POS[rnd(0, 7)];
    ctx.prompt('가운데 그림과 별이 아주 잠깐 나타나요. 준비되면 버튼을 눌러 주세요. 천천히 하셔도 괜찮아요.');
    const grid = h('div', { class: 'grid flashgrid', style: '--cols:3', id: 'fgrid', 'aria-hidden': 'true' });
    const cells = Array.from({ length: 9 }, (_, i) => { const c = h('div', { class: 'cell', id: 'fcell-' + i }); grid.append(c); return c; });
    const step = h('div', { id: 'fstep', class: 'stack' });
    ctx.box.append(h('div', { class: 'stack' }, grid, step));
    let centerOk = false;
    step.append(btnEl('준비됐어요', 'filled', () => {
      if (ctx.finished) return; step.textContent = '';
      cells[4].textContent = '＋';
      setTimeout(() => {
        cells[4].textContent = objs[ci][0]; cells[star].textContent = '⭐';
        setTimeout(() => { cells[4].textContent = ''; cells[star].textContent = ''; askCenter(); }, ms);
      }, 700);
    }, 'btn-ready'));
    function askCenter() {
      ctx.prompt('가운데에 나온 그림은 무엇이었나요?');
      objs.forEach((o, i) => step.append(h('button', { type: 'button', class: 'choice', id: 'fc-' + i, onclick: () => { centerOk = i === ci; askPos(); } }, o[0] + ' ' + o[1])));
    }
    function askPos() {
      step.textContent = ''; ctx.prompt('별은 어디에 있었나요? 그 자리를 눌러 주세요.');
      grid.removeAttribute('aria-hidden'); grid.textContent = '';
      for (let i = 0; i < 9; i++) {
        const b = h('button', { type: 'button', class: 'cell sel', id: 'fpos-' + i, 'aria-label': (i + 1) + '번째 칸', disabled: i === 4 ? '' : null });
        if (i !== 4) b.addEventListener('click', () => {
          if (ctx.finished) return;
          const posOk = i === star;
          grid.querySelectorAll('.cell').forEach(x => { x.disabled = true; });
          grid.children[star].textContent = '⭐'; grid.children[star].classList.add('right'); if (!posOk) b.classList.add('picked');
          const parts = [centerOk ? '가운데 그림은 맞췄어요.' : '가운데 그림은 ' + objs[ci][1] + '였어요.', posOk ? '별 위치도 맞췄어요.' : '별은 초록색 칸에 있었어요.'];
          ctx.finish({ correct: (centerOk ? 1 : 0) + (posOk ? 1 : 0), total: 2, ok: centerOk && posOk, msg: parts.join(' ') + (centerOk && posOk ? '' : ' 아주 빨리 지나가서 누구나 어려워요. 괜찮아요.') });
        });
        grid.append(b);
      }
    }
  }
});

