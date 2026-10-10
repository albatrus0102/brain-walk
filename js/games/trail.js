import { reg } from './registry.js';
import { beep } from '../sound.js';
import { $, pick } from '../util.js';

/* ---------- 4. 숫자 순서대로 누르기 ---------- */
const KO_LET = ['가','나','다','라','마','바','사'];
reg({
  id: 'trail', name: '숫자 순서대로 누르기', domain: 'attention', desc: '1부터 차례대로 눌러요', rounds: 3,
  play(ctx) {
    const lv = ctx.level, N = [5, 7, 10, 12, 14][lv - 1];
    let seq = [];
    if (lv === 5) { for (let i = 1; i <= 7; i++) { seq.push(String(i)); seq.push(KO_LET[i - 1]); } }
    else for (let i = 1; i <= N; i++) seq.push(String(i));
    const cols = N <= 9 ? 3 : 4, rows = Math.ceil(N * 1.3 / cols), cells = cols * rows;
    const posn = pick(Array.from({ length: cells }, (_, i) => i), N), map = {};
    seq.forEach((t, i) => { map[posn[i]] = { t, i }; });
    ctx.prompt(lv === 5 ? '숫자와 글자를 번갈아 눌러 주세요. 1, 가, 2, 나, 3, 다 … 순서예요.' : '1부터 ' + N + '까지 차례대로 눌러 주세요.');
    ctx.box.innerHTML = '<div class="stack"><div class="nextbig" id="nexttarget" aria-live="polite">다음: ' + seq[0] + '</div><div class="grid" style="--cols:' + cols + '" id="trailgrid">' +
      Array.from({ length: cells }, (_, p) => map[p] ? '<button type="button" class="cell num" id="tile-' + p + '" data-i="' + map[p].i + '">' + map[p].t + '</button>' : '<span class="gap"></span>').join('') + '</div></div>';
    let next = 0, mistakes = 0;
    ctx.box.addEventListener('click', e => {
      const b = e.target.closest('.cell'); if (!b || ctx.finished) return;
      const i = +b.dataset.i;
      if (i < next) return;
      if (i === next) {
        b.classList.add('done'); b.disabled = true; next++; beep('ok');
        if (next === seq.length) { $('#nexttarget', ctx.box).textContent = '모두 눌렀어요!'; ctx.finish({ correct: N, total: N + mistakes, ok: true, msg: '끝까지 해내셨어요! ' + (mistakes ? '잘못 누른 횟수는 ' + mistakes + '번이에요. 괜찮아요.' : '한 번도 틀리지 않으셨어요.') }); }
        else $('#nexttarget', ctx.box).textContent = '다음: ' + seq[next];
      } else {
        mistakes++; beep('soft'); b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400);
        // 안내는 화면 아래 알림 대신 '다음' 글자 자리에 보여 줘요 (알림이 숫자 칸을 가렸어요)
        $('#nexttarget', ctx.box).textContent = '아직이에요. 천천히 ‘' + seq[next] + '’을(를) 찾아보세요';
      }
    });
  }
});

