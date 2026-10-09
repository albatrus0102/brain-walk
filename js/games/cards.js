import { reg } from './registry.js';
import { beep } from '../sound.js';
import { $, pick, shuffle } from '../util.js';

/* ---------- 1. 카드 짝 맞추기 ---------- */
const CARD_ITEMS = [['🍎','사과'],['🍌','바나나'],['🍇','포도'],['🍓','딸기'],['🍊','귤'],['🍉','수박'],['🍑','복숭아'],['🍐','배'],
  ['🐶','강아지'],['🐱','고양이'],['🐰','토끼'],['🐻','곰'],['🐼','판다'],['🐸','개구리'],['🐥','병아리'],['🐢','거북이'],['🌸','벚꽃'],['🌻','해바라기'],['🚗','자동차'],['⭐','별']];
reg({
  id: 'cards', name: '카드 짝 맞추기', domain: 'memory', desc: '같은 그림 카드 두 장을 찾아요', rounds: 2,
  play(ctx) {
    const pairs = [3, 4, 6, 8, 10][ctx.level - 1], cols = pairs <= 3 ? 3 : 4;
    const items = pick(CARD_ITEMS, pairs);
    const cards = shuffle(items.concat(items).map((it, i) => ({ e: it[0], n: it[1], k: i })));
    let open = [], matched = 0, misses = 0, lock = false, done = false;
    ctx.prompt('같은 그림 카드 두 장을 찾아 눌러 주세요. 천천히 하셔도 괜찮아요.');
    ctx.box.innerHTML = '<div class="stack"><div class="status" id="status" aria-live="polite">카드를 눌러 보세요.</div><div class="grid" style="--cols:' + cols + '" id="board">' +
      cards.map((c, i) => '<button type="button" class="cell mcard" id="card-' + i + '" data-i="' + i + '" aria-label="카드 ' + (i + 1) + '번, 뒤집히지 않았어요"><span class="em">?</span></button>').join('') + '</div></div>';
    const st = $('#status', ctx.box);
    const faceUp = (i, cls) => { const b = $('#card-' + i, ctx.box); b.className = 'cell mcard ' + cls; b.innerHTML = '<span class="em">' + cards[i].e + '</span><span class="nm">' + cards[i].n + '</span>'; b.setAttribute('aria-label', cards[i].n + ' 카드'); };
    const faceDown = i => { const b = $('#card-' + i, ctx.box); b.className = 'cell mcard'; b.innerHTML = '<span class="em">?</span>'; b.setAttribute('aria-label', '카드 ' + (i + 1) + '번, 뒤집히지 않았어요'); };
    ctx.box.addEventListener('click', e => {
      const b = e.target.closest('.mcard'); if (!b || lock || done || ctx.finished) return;
      const i = +b.dataset.i; if (open.includes(i) || b.classList.contains('ok')) return;
      faceUp(i, 'up'); open.push(i);
      if (open.length === 2) {
        const [a, c] = open;
        if (cards[a].e === cards[c].e) {
          faceUp(a, 'ok'); faceUp(c, 'ok'); matched++; open = []; beep('ok'); st.textContent = '짝이 맞았어요! 잘하셨어요.';
          if (matched === pairs) {
            done = true;
            ctx.finish({ correct: pairs, total: pairs + misses, ok: true, msg: '모두 찾으셨어요! ' + (misses ? '다시 고른 횟수는 ' + misses + '번이에요. 괜찮아요.' : '한 번도 틀리지 않으셨어요.') });
          }
        } else {
          misses++; lock = true; beep('soft'); st.textContent = '아쉬워요. 어디에 있었는지 기억해 보세요.';
          setTimeout(() => { faceDown(a); faceDown(c); open = []; lock = false; }, 1400);
        }
      }
    });
  }
});
