import { regTask } from './registry.js';
import { h, btnEl } from '../ui/dom.js';
import { say } from '../sound.js';
import { rnd } from '../util.js';

/* 숫자 기억 — 앞으로(들은 순서대로) / 거꾸로. 숫자는 매번 무작위로 만들어요(공개 검사 문항을 쓰지 않아요). */
const rndDigits = n => { const o = []; while (o.length < n) { const d = rnd(0, 9); if (o[o.length - 1] !== d) o.push(d); } return o; };

regTask({
  id: 't_digits', name: '숫자 기억하기', domain: 'attention', desc: '숫자를 듣고 따라 눌러요', rounds: 1,
  play(ctx) {
    const best = { fwd: 2, bwd: 1 }, state = { dir: 'fwd', len: 3, attempt: 0 };
    const stage = h('div', { class: 'stack' });
    ctx.box.append(stage);
    function intro() {
      stage.textContent = '';
      const back = state.dir === 'bwd';
      ctx.prompt(back ? '이번에는 숫자를 거꾸로 눌러 주세요. 예를 들어 1, 2, 3 이 나왔다면 3, 2, 1 이에요.' : '숫자가 하나씩 나와요. 잘 보고, 나온 순서대로 눌러 주세요.');
      stage.append(h('div', { class: 'cta' }, btnEl('준비됐어요', 'filled', () => show(), 'btn-digits-go')));
    }
    function show() {
      const seq = rndDigits(state.len); state.cur = seq; stage.textContent = '';
      const big = h('p', { class: 't-display center', id: 'digit-now', style: 'min-height:120px' }); stage.append(h('div', { class: 'card elevated center' }, big));
      let i = 0; const step = () => { if (ctx.finished) return; if (i >= seq.length) { big.textContent = ''; ask(); return; } big.textContent = seq[i]; say(String(seq[i])); i++; setTimeout(() => { big.textContent = ''; setTimeout(step, 250); }, 900); };
      setTimeout(step, 400);
    }
    function ask() {
      stage.textContent = ''; const back = state.dir === 'bwd', typed = [];
      ctx.prompt(back ? '숫자를 거꾸로 눌러 주세요.' : '나온 순서대로 눌러 주세요.');
      const disp = h('p', { class: 't-display center', id: 'digit-typed', 'aria-live': 'polite', style: 'min-height:80px;letter-spacing:.2em' });
      const pad = h('div', { class: 'grid', style: '--cols:3', id: 'digit-pad' });
      [1, 2, 3, 4, 5, 6, 7, 8, 9, '지움', 0, '확인'].forEach(k => {
        const b = h('button', { type: 'button', class: 'cell sel', id: 'dp-' + k, style: 'min-height:72px;font-size:var(--md-sys-typescale-title-large-size);font-weight:700' }, String(k));
        b.addEventListener('click', () => {
          if (k === '지움') typed.pop(); else if (k === '확인') return submit(); else if (typed.length < state.len + 1) typed.push(k);
          disp.textContent = typed.join(' ');
        });
        pad.append(b);
      });
      const submit = () => {
        if (ctx.finished) return;
        const want = back ? state.cur.slice().reverse() : state.cur, ok = typed.length === want.length && typed.every((d, j) => d === want[j]);
        const cap = state.dir === 'fwd' ? 9 : 8;
        if (ok) { best[state.dir] = Math.max(best[state.dir], state.len); state.len++; state.attempt = 0; if (state.len > cap) return nextPhase(); }
        else { state.attempt++; if (state.attempt >= 2) return nextPhase(); }   // 같은 길이에서 두 번 틀리면 끝
        show();
      };
      stage.append(disp, pad);
    }
    function nextPhase() {
      if (state.dir === 'fwd') { state.dir = 'bwd'; state.len = 2; state.attempt = 0; intro(); return; }
      const score = Math.min(100, Math.round(Math.max(0, Math.min(1, (best.fwd - 2) / 6)) * 50 + Math.max(0, Math.min(1, (best.bwd - 1) / 5)) * 50));
      stage.textContent = '';
      ctx.finish({ correct: score, total: 100, ok: score >= 50, msg: '앞으로 ' + best.fwd + '개, 거꾸로 ' + best.bwd + '개까지 따라 했어요.', metrics: { fwd: best.fwd, bwd: best.bwd } });
    }
    intro();
  }
});
