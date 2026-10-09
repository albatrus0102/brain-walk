import { reg } from './registry.js';
import { toast } from '../ui/dom.js';
import { $, esc, pick, shuffle } from '../util.js';

/* ---------- 2. 단어 기억하기 ---------- */
const WORDS = ['사과','의자','우산','시계','거울','모자','신발','가방','안경','열쇠','전화기','책','연필','컵','숟가락','접시','냄비','이불','베개','수건','비누','칫솔','달력','꽃병','나무','구름','강아지','고양이','바나나','포도','수박','감자','당근','두부','계란','우유','버스','자전거','기차','비행기','학교','병원','시장','공원','바다','산','별','달','해','라디오'];
reg({
  id: 'words', name: '단어 기억하기', domain: 'memory', desc: '보여 드린 단어를 기억해요', rounds: 3,
  play(ctx) {
    const N = [3, 4, 5, 6, 7][ctx.level - 1];
    const shown = pick(WORDS, N);
    const rest = shuffle(WORDS.filter(w => !shown.includes(w)));
    const total = Math.min(12, N * 2);
    const grid = shuffle(shown.concat(rest.slice(0, total - N)));
    ctx.prompt(N + '가지 단어를 기억해 주세요. 준비되면 아래 버튼을 눌러 주세요.', N + '가지 단어를 기억해 주세요. ' + shown.join(', ') + '.');
    ctx.box.innerHTML = '<div class="stack"><div class="chips" id="shown">' + shown.map((w, i) => '<span class="chip show" id="word-' + i + '">' + esc(w) + '</span>').join('') + '</div>' +
      '<button class="btn filled" id="btn-memorized" type="button">다 외웠어요</button></div>';
    $('#btn-memorized', ctx.box).onclick = () => {
      if (ctx.finished) return;
      const sel = new Set(); let checked = false;
      ctx.prompt('방금 본 단어 ' + N + '개를 모두 골라 주세요.', '방금 본 단어 ' + N + '개를 모두 골라 주세요.');
      ctx.box.innerHTML = '<div class="stack"><div class="t-label muted" id="cnt" aria-live="polite">선택한 단어: 0 / ' + N + '</div><div class="chips" id="pool">' +
        grid.map((w, i) => '<button type="button" class="chip" id="pick-' + i + '" aria-pressed="false" data-w="' + esc(w) + '">' + esc(w) + '</button>').join('') +
        '</div><button class="btn filled" id="btn-check" type="button" disabled>확인하기</button></div>';
      const upd = () => { $('#cnt', ctx.box).textContent = '선택한 단어: ' + sel.size + ' / ' + N; $('#btn-check', ctx.box).disabled = sel.size !== N; };
      $('#pool', ctx.box).addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b || checked) return;
        const w = b.dataset.w;
        if (sel.has(w)) { sel.delete(w); b.setAttribute('aria-pressed', 'false'); }
        else { if (sel.size >= N) { toast('이미 ' + N + '개를 골랐어요. 하나를 다시 눌러 빼 보세요.'); return; } sel.add(w); b.setAttribute('aria-pressed', 'true'); }
        upd();
      });
      $('#btn-check', ctx.box).onclick = () => {
        if (checked || sel.size !== N) return; checked = true;
        let hits = 0;
        ctx.box.querySelectorAll('#pool .chip').forEach(b => {
          const w = b.dataset.w, isShown = shown.includes(w), isSel = sel.has(w);
          b.disabled = true; b.setAttribute('aria-pressed', 'false');
          if (isShown && isSel) { hits++; b.classList.add('right'); b.insertAdjacentHTML('beforeend', '<span class="sr"> 맞아요</span>'); }
          else if (isShown) { b.classList.add('missed'); b.insertAdjacentHTML('beforeend', ' (정답)'); }
          else if (isSel) { b.classList.add('wrongpick'); b.insertAdjacentHTML('beforeend', ' (보지 않은 단어)'); }
        });
        $('#btn-check', ctx.box).hidden = true;
        const ok = hits === N;
        ctx.finish({ correct: hits, total: N, ok, msg: ok ? '모두 기억하셨어요! 정말 잘하셨어요.' : N + '개 중 ' + hits + '개를 기억하셨어요. 괜찮아요. 점선으로 표시한 단어가 보여 드린 단어예요: ' + shown.join(', ') });
      };
      upd();
    };
  }
});

