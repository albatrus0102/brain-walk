import { regTask } from './registry.js';
import { h, btnEl } from '../ui/dom.js';
import { say } from '../sound.js';

/* 동물 이름 1분 — 마이크를 쓰지 않아요. 가족이 들으며 +1 을 누르거나, 끝난 뒤 개수를 입력해요. */
regTask({
  id: 't_fluency', name: '동물 이름 대기', domain: 'orientation', desc: '1분 동안 동물 이름을 말해요', rounds: 1,
  play(ctx) {
    ctx.prompt('1분 동안 생각나는 동물 이름을 소리 내어 말해 주세요. 가족이 옆에서 들으며 한 마리마다 "+1"을 눌러 주세요. 같은 이름은 한 번만 세요.');
    let count = 0, left = 60, timer = null;
    const clock = h('p', { class: 't-display center', id: 'flu-clock', text: '1:00', 'aria-live': 'off' });
    const cnt = h('p', { class: 't-headline center', id: 'flu-count', text: '0마리', 'aria-live': 'polite' });
    const plus = h('button', { type: 'button', class: 'btn filled', id: 'flu-plus', disabled: '', style: 'min-height:120px;font-size:var(--md-sys-typescale-headline-small-size)' }, '+1 (한 마리 말했어요)');
    const minus = h('button', { type: 'button', class: 'btn text', id: 'flu-minus', disabled: '' }, '−1 (잘못 눌렀어요)');
    const upd = () => { cnt.textContent = count + '마리'; };
    plus.addEventListener('click', () => { count++; upd(); });
    minus.addEventListener('click', () => { count = Math.max(0, count - 1); upd(); });
    const stage = h('div', { class: 'stack' }, clock, cnt, plus, minus);
    const start = btnEl('시작 (1분)', 'filled', () => {
      start.remove(); plus.disabled = false; minus.disabled = false; say('시작하세요');
      timer = setInterval(() => { left--; clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); if (left <= 0) { clearInterval(timer); end(); } }, 1000);
    }, 'btn-flu-start');
    ctx.box.append(stage, h('div', { class: 'cta' }, start));
    function end() {
      plus.disabled = true; minus.disabled = true; say('그만하세요. 수고하셨어요.');
      ctx.prompt('1분이 끝났어요. 모두 몇 마리였나요? 맞지 않으면 바꿔 주세요.');
      const num = h('input', { class: 'input', id: 'flu-total', type: 'number', inputmode: 'numeric', min: '0', max: '99', value: String(count), 'aria-label': '동물 이름 개수', style: 'text-align:center;font-size:var(--md-sys-typescale-headline-small-size)' });
      const done = btnEl('이 숫자로 저장', 'filled', () => {
        if (ctx.finished) return; const n = Math.max(0, Math.min(99, Math.round(Number(num.value) || 0))), score = Math.min(100, Math.round(n / 20 * 100));
        ctx.finish({ correct: score, total: 100, ok: n >= 8, msg: '동물 이름 ' + n + '마리. 수고하셨어요.', metrics: { n } });
      }, 'btn-flu-save');
      stage.append(h('div', { class: 'field' }, h('label', { for: 'flu-total', text: '모두 몇 마리?' }), num), h('div', { class: 'cta' }, done));
    }
  }
});
