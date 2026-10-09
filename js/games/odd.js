import { reg } from './registry.js';
import { $, pick, rnd } from '../util.js';

/* ---------- 3. 다른 그림 찾기 ---------- */
const ODD_PAIRS = [
  [['🍎','🐶'],['🚗','🌳'],['⭐','🐟'],['🌻','🏠'],['☂️','🍌'],['🔔','🐱']],
  [['🍎','🍅'],['🐱','🐯'],['🌻','🌼'],['🐻','🐨'],['🍋','🍌'],['🌙','⭐']],
  [['😀','😃'],['🙂','😊'],['🐭','🐹'],['🍐','🍏'],['🐶','🐺'],['🥕','🌶️']]
];
reg({
  id: 'odd', name: '다른 그림 찾기', domain: 'attention', desc: '모양이 다른 그림 하나를 찾아요', rounds: 5,
  play(ctx) {
    const size = [3, 3, 4, 4, 5][ctx.level - 1], tier = [0, 1, 1, 2, 2][ctx.level - 1];
    let [a, b] = pick(ODD_PAIRS[tier], 1)[0]; if (Math.random() < 0.5) { const t = a; a = b; b = t; }
    const n = size * size, odd = rnd(0, n - 1);
    ctx.prompt('다른 그림 하나를 찾아 눌러 주세요.');
    ctx.box.innerHTML = '<div class="grid" style="--cols:' + size + '" id="oddgrid">' + Array.from({ length: n }, (_, i) =>
      '<button type="button" class="cell" id="cell-' + i + '" data-i="' + i + '" aria-label="그림 ' + (i + 1) + '번">' + (i === odd ? b : a) + '</button>').join('') + '</div>';
    ctx.box.addEventListener('click', e => {
      const c = e.target.closest('.cell'); if (!c || ctx.finished) return;
      const i = +c.dataset.i, ok = i === odd;
      $('#cell-' + odd, ctx.box).classList.add('right');
      if (!ok) c.classList.add('picked');
      ctx.box.querySelectorAll('.cell').forEach(x => { x.disabled = true; });
      ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '맞아요! 정확하게 찾으셨어요.' : '아쉬워요. 괜찮아요. 다른 그림은 초록색 테두리로 표시했어요.' });
    });
  }
});

