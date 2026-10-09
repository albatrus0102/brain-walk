import { regTask } from './registry.js';
import { h, btnEl } from '../ui/dom.js';
import { say } from '../sound.js';
import { S } from '../state.js';
import { pick, shuffle } from '../util.js';

/* 낱말 10개 기억하기 — 자체 낱말 목록(공개 검사 목록을 쓰지 않음). 3개 판을 달마다 돌려 써요.
 * 즉시 회상과 점검 끝의 지연 회상 모두 "기억나는 낱말 고르기"(글자를 칠 필요 없음)로 해요. */
export const WORD_SETS = [
  ['우산', '고구마', '기차', '달력', '나비', '냄비', '안경', '구름', '연필', '창문'],
  ['시계', '감자', '자전거', '거울', '참새', '주전자', '모자', '무지개', '공책', '계단'],
  ['열쇠', '배추', '비행기', '수건', '토끼', '접시', '장갑', '번개', '가방', '지붕']
];
const FILLERS = ['의자', '호수', '사탕', '신문', '개구리', '컵', '양말', '별', '책상', '다리', '숟가락', '바위', '풍선', '장미', '라디오', '칫솔', '단추', '우체통', '사다리', '호박'];
const setIndex = () => { const d = new Date(); return (d.getFullYear() * 12 + d.getMonth()) % WORD_SETS.length; };

function recallGrid(ctx, words, onDone) {
  const choices = shuffle(words.concat(pick(FILLERS, 10))), chosen = new Set();
  const grid = h('div', { class: 'chips', id: 'recall-grid', role: 'group', 'aria-label': '기억나는 낱말' });
  choices.forEach((w, i) => grid.append(h('button', { type: 'button', class: 'chip', id: 'rw-' + i, 'aria-pressed': 'false', onclick: ev => {
    const b = ev.currentTarget; if (chosen.has(w)) { chosen.delete(w); b.setAttribute('aria-pressed', 'false'); } else { chosen.add(w); b.setAttribute('aria-pressed', 'true'); }
    cnt.textContent = chosen.size + '개 골랐어요';
  } }, w)));
  const cnt = h('p', { class: 't-body center', id: 'recall-count', text: '0개 골랐어요' });
  const done = btnEl('다 골랐어요', 'filled', () => {
    if (ctx.finished) return;
    const hits = words.filter(w => chosen.has(w)).length, fa = chosen.size - hits;
    onDone({ hits, fa, score: Math.max(0, Math.round((hits - fa) / words.length * 100)) });
  }, 'btn-recall-done');
  ctx.box.append(h('div', { class: 'stack' }, grid, cnt, h('div', { class: 'cta' }, done)));
}

regTask({
  id: 't_words', name: '낱말 기억하기', domain: 'memory', desc: '낱말 10개를 보고 기억해요', rounds: 1,
  play(ctx) {
    const words = WORD_SETS[setIndex()];
    S.assess.memo = { words, immediate: null };
    ctx.prompt('낱말 10개가 하나씩 나와요. 잘 보고 기억해 두세요. 조금 뒤에 다시 물어볼게요.');
    const stage = h('div', { class: 'card elevated center', style: 'min-height:200px;display:flex;align-items:center;justify-content:center' }, h('p', { class: 't-display', id: 'word-now', text: '' }));
    const start = btnEl('준비됐어요', 'filled', () => {
      start.remove(); let i = 0; const el = stage.querySelector('#word-now');
      const next = () => {
        if (ctx.finished) return;
        if (i >= words.length) { el.textContent = ''; ask(); return; }
        el.textContent = words[i]; say(words[i]); i++; setTimeout(next, 2200);
      };
      next();
    }, 'btn-words-start');
    ctx.box.append(h('div', { class: 'stack', id: 'words-box' }, stage, h('div', { class: 'cta' }, start)));
    function ask() {
      ctx.box.textContent = ''; ctx.prompt('방금 본 낱말 중 기억나는 것을 모두 눌러 주세요. 모르겠으면 안 눌러도 괜찮아요.');
      recallGrid(ctx, words, r => {
        S.assess.memo.immediate = r;
        ctx.finish({ correct: r.score, total: 100, ok: r.score >= 50, msg: '낱말을 ' + r.hits + '개 골랐어요. 끝나기 전에 한 번 더 물어볼게요.', metrics: { imm: r.hits, immFa: r.fa } });
      });
    }
  }
});

regTask({
  id: 't_delayed', name: '아까 낱말 다시 기억하기', domain: 'memory', desc: '처음에 본 낱말 10개를 떠올려요', rounds: 1,
  play(ctx) {
    const memo = S.assess && S.assess.memo;
    if (!memo) { ctx.finish({ correct: 0, total: 100, ok: false, msg: '앞에서 본 낱말이 없어서 건너뛰어요.', metrics: { skipped: 1 } }); return; }
    ctx.prompt('처음에 본 낱말 10개를 기억하시나요? 기억나는 것을 모두 눌러 주세요.');
    recallGrid(ctx, memo.words, r => ctx.finish({ correct: r.score, total: 100, ok: r.score >= 50, msg: '낱말을 ' + r.hits + '개 골랐어요. 수고하셨어요.', metrics: { del: r.hits, delFa: r.fa } }));
  }
});
