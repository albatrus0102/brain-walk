import { reg } from './registry.js';
import { h } from '../ui/dom.js';
import { $, pick, rnd } from '../util.js';

/* ---------- 3. 다른 그림 찾기 ---------- */
const ODD_PAIRS = [
  [['🍎','🐶'],['🚗','🌳'],['⭐','🐟'],['🌻','🏠'],['☂️','🍌'],['🔔','🐱']],
  [['🍎','🍅'],['🐱','🐯'],['🌻','🌼'],['🐻','🐨'],['🍋','🍌'],['🌙','⭐']],
  [['😀','😃'],['🙂','😊'],['🐭','🐹'],['🍐','🍏'],['🐶','🐺'],['🥕','🌶️']]
];
reg({
  id: 'odd', name: '다른 그림 찾기', domain: 'attention', desc: '모양이 다른 그림 하나를 찾아요', rounds: 5, cd: 'attention', hostCds: ['attention', 'visuospatial'],
  play(ctx) {
    const size = [3, 3, 4, 4, 5][ctx.level - 1], tier = [0, 1, 1, 2, 2][ctx.level - 1];
    // 은행의 이모지 묶음(emoji_set)이 있으면 그 짝 중 하나를, 없으면 코드가 고른 짝을
    let bi = ctx.draw('attention', ['emoji_set']), prs = null;
    if (bi && bi.body && Array.isArray(bi.body.pairs)) prs = bi.body.pairs.filter(p => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0] !== p[1]);
    if (prs && prs.length) ctx.bankItem(bi); else { bi = null; prs = null; }
    let [a, b] = pick(prs || ODD_PAIRS[tier], 1)[0]; if (Math.random() < 0.5) { const t = a; a = b; b = t; }
    const n = size * size, odd = rnd(0, n - 1);
    ctx.prompt('다른 그림 하나를 찾아 눌러 주세요.');
    // 그림(이모지)은 은행(AI)에서 올 수 있어요: 글자로만 넣어요 (innerHTML 금지)
    ctx.box.textContent = '';
    ctx.box.append(h('div', { class: 'grid', style: '--cols:' + size, id: 'oddgrid' }, Array.from({ length: n }, (_, i) =>
      h('button', { type: 'button', class: 'cell', id: 'cell-' + i, 'data-i': String(i), 'aria-label': '그림 ' + (i + 1) + '번', text: i === odd ? b : a }))));
    ctx.box.addEventListener('click', e => {
      const c = e.target.closest('.cell'); if (!c || ctx.finished) return;
      const i = +c.dataset.i, ok = i === odd;
      ctx.pickIdx = [i];
      if (bi) ctx.logItem(bi, { score: ok ? 1 : 0, ok, err: [], pick: [i] });
      $('#cell-' + odd, ctx.box).classList.add('right');
      if (!ok) c.classList.add('picked');
      ctx.box.querySelectorAll('.cell').forEach(x => { x.disabled = true; });
      ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '맞아요! 정확하게 찾으셨어요.' : '아쉬워요. 괜찮아요. 다른 그림은 초록색 테두리로 표시했어요.' });
    });
  }
});

