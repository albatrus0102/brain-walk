import { beep } from '../sound.js';
import { S } from '../state.js';
import { h, toast } from '../ui/dom.js';
import { shuffle, won } from '../util.js';

/* ================= 은행 문항을 화면에 그리기 (CLIENT-CONTRACT §2.3) =================
 * 모든 글(문제·보기·이야기·설명)은 AI 가 만든 "자료"예요. 그래서 항상 DOM 의 textContent 로만 넣어요 (innerHTML 금지).
 * 보기는 이미 최종 순서로 와요: 다시 섞지 않아요 (기록의 pick 은 이 순서의 번호). ok/err 는 채점·기록용이고 화면에는 보이지 않아요.
 * 기준·앵커 문항(noFeedback)은 맞았는지 알려 주지 않고 "잘하셨어요, 다음 문제로 가요."만 말해요. */
export const NEUTRAL_MSG = '잘하셨어요, 다음 문제로 가요.';
export const PLACE_NAMES = { '🏠': '집', '🏥': '병원', '🏪': '가게', '📮': '우체통', '⛪': '교회', '🏫': '학교', '🌳': '나무', '🚏': '정류장', '🏦': '은행', '🍞': '빵집' };
const roleOf = it => (it.role === 'reference' || it.role === 'anchor' ? it.role : 'training');
const isMeasure = it => !!it.noFeedback || it.role === 'reference' || it.role === 'anchor';
const str = v => (v == null ? '' : String(v));
const need = (c, why) => { if (!c) throw new Error('bad item: ' + why); };
const choicesOf = it => { need(Array.isArray(it.choices) && it.choices.length >= 2 && it.choices.every(c => c && typeof c.t === 'string'), 'choices'); return it.choices; };
const optionsOf = it => { need(Array.isArray(it.options) && it.options.length >= 2 && it.options.every(o => o && Array.isArray(o.grid) && o.grid.length), 'options'); return it.options; };
const sayList = cs => ' 보기는 ' + cs.map(c => c.t).join(', ') + ' 입니다.';
const fixed = (n, d) => Math.round(n * d) / d;

/* ---- 보기 단추 줄 (글 보기) ---- */
function choiceList(ctx, cs, onPick) {
  const list = h('div', { class: 'choices', role: 'group', 'aria-label': '보기' }, cs.map((c, i) => h('button', { type: 'button', class: 'choice', id: 'choice-' + i, 'data-i': String(i), text: c.t })));
  list.addEventListener('click', e => { const b = e.target.closest('.choice'); if (!b || ctx.finished || list.dataset.done) return; list.dataset.done = '1'; onPick(Number(b.dataset.i), list); });
  return list;
}
/* 고른 뒤 보기 표시. 기준·앵커 문항은 고른 것만 중립색으로, 정답은 알리지 않아요. */
function markChoices(list, cs, i, neutral) {
  list.querySelectorAll('.choice').forEach((x, k) => {
    x.disabled = true;
    if (neutral) { if (k === i) { x.classList.add('sel'); x.dataset.tag = '선택하신 답'; } else x.classList.add('dim'); return; }
    if (cs[k].ok) { x.classList.add('right'); x.dataset.tag = k === i ? '정답입니다' : '정답'; }
    else if (k === i) { x.classList.add('picked'); x.dataset.tag = '선택하신 답'; }
    else x.classList.add('dim');
  });
}
const errOf = c => (c && c.err ? [c.err] : []);
const rightText = cs => { const c = cs.find(x => x.ok); return c ? c.t : ''; };

/* ---- 글 보기 한 문제 (날짜·말 놀이·장보기·일정·생각·글자 세기·길 찾기·옛날 이야기) ---- */
function choiceItem(ctx, it, o) {
  const cs = choicesOf(it), measure = isMeasure(it);
  const promptText = o.prompt || it.prompt || '알맞은 것을 골라 주세요.';
  ctx.prompt(promptText, (o.speak || it.speak || promptText) + sayList(cs));
  const wrap = h('div', { class: 'stack' });
  if (o.pre) wrap.append(o.pre);
  const list = choiceList(ctx, cs, (i, lst) => {
    const ok = !!cs[i].ok;
    ctx.pickIdx = [i];
    ctx.logItem(it, { score: ok ? 1 : 0, ok, err: errOf(cs[i]), pick: [i] });
    markChoices(lst, cs, i, measure);
    if (measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
    const ex = it.explain ? ' ' + it.explain : '';
    const talk = it.talk ? ' ' + it.talk : '';
    ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '맞아요! 정답은 ‘' + rightText(cs) + '’입니다.' + ex : (o.wrongTalk ? '괜찮아요. 정답은 ‘' + rightText(cs) + '’예요.' + talk : '괜찮아요. 정답은 ‘' + rightText(cs) + '’입니다.' + ex) });
  });
  wrap.append(list); ctx.box.append(wrap);
}

/* ---- 모양(이모지 격자) ---- */
/* blank: 빈칸(⬜)을 글자 없이 옅게 그려요 (길 찾기 지도: 장소 그림이 또렷하게) */
const miniGrid = (grid, cls, blank) => h('span', { class: 'mini' + (cls ? ' ' + cls : ''), style: '--n:' + grid.length, 'aria-hidden': 'true' }, grid.flatMap(row => row.map(c => (blank && c === '⬜' ? h('i', { class: 'e' }) : h('i', { text: str(c) })))));
/* 격자 칸의 글자(이모지) 크기를 칸 너비에 맞춰요 */
export function fitGrids(root) {
  root.querySelectorAll('.mini').forEach(el => {
    const n = Number(getComputedStyle(el).getPropertyValue('--n')) || 3, w = el.clientWidth || el.parentElement.clientWidth || 120;
    el.style.setProperty('--gfs', Math.max(18, Math.floor(((w - 3 * (n - 1)) / n) * 0.66)) + 'px');
  });
}
function gridOptions(ctx, it, pre, promptText, speakText) {
  const opts = optionsOf(it), measure = isMeasure(it), n = opts[0].grid.length;
  ctx.prompt(promptText, speakText || promptText);
  const wrap = h('div', { class: 'stack' });
  if (pre) wrap.append(pre);
  const list = h('div', { class: 'gopts', role: 'group', 'aria-label': '보기', style: '--oc:' + (n >= 5 ? 1 : 2) }, opts.map((o, i) =>
    h('button', { type: 'button', class: 'gopt', id: 'opt-' + i, 'data-i': String(i), 'aria-label': '보기 ' + (i + 1) + '번' }, h('span', { class: 'gno', text: (i + 1) + '번' }), miniGrid(o.grid))));
  list.addEventListener('click', e => {
    const b = e.target.closest('.gopt'); if (!b || ctx.finished || list.dataset.done) return; list.dataset.done = '1';
    const i = Number(b.dataset.i), ok = !!opts[i].ok;
    ctx.pickIdx = [i];
    ctx.logItem(it, { score: ok ? 1 : 0, ok, err: errOf(opts[i]), pick: [i] });
    list.querySelectorAll('.gopt').forEach((x, k) => {
      x.disabled = true;
      if (measure) { x.classList.add(k === i ? 'sel' : 'dim'); return; }
      if (opts[k].ok) x.classList.add('right'); else if (k === i) x.classList.add('picked'); else x.classList.add('dim');
    });
    if (measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
    const right = opts.findIndex(x => x.ok) + 1;
    ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '맞아요! ' + (it.explain || '') : '괜찮아요. 정답은 ' + right + '번이에요. ' + (it.explain || '') });
  });
  wrap.append(list); ctx.box.append(wrap);
  fitGrids(wrap);
}

/* =========================== 형식별 =========================== */
export const R = {};

/* 날짜·계절 (오늘은 며칠?): 정답은 서버가 계산해서 보기에 들어 있어요. 날짜 범위(validFrom~validTo)는 꺼낼 때 이미 걸렀어요. */
R.date_q = (ctx, it) => choiceItem(ctx, it, {});

/* 말 놀이 */
R.lang_complete = (ctx, it) => {
  const sentence = str(it.body && it.body.sentence); need(sentence, 'sentence');
  choiceItem(ctx, it, { prompt: it.prompt || '빈칸에 알맞은 말을 골라 주세요.', speak: (it.speak || (it.prompt || '빈칸에 알맞은 말을 골라 주세요.')) + ' ' + sentence.replace(/_+/g, ' 빈칸 '),
    pre: h('div', { class: 'card filled center t-headline wordcard', id: 'sentence', text: sentence }) });
};
R.lang_relation = (ctx, it) => choiceItem(ctx, it, {});
R.lang_category = (ctx, it) => choiceItem(ctx, it, {});
R.word_find = (ctx, it) => choiceItem(ctx, it, {});
R.analogy = (ctx, it) => choiceItem(ctx, it, { pre: h('div', { class: 'card filled center t-headline wordcard', id: 'analogy', text: str(it.prompt) }) });

/* 장보기: 구조화된 본문(가게·물건·수량·덤·낸 돈)을 장바구니 목록으로 그려요 */
const dealText = d => (d.type === 'bogo' ? '하나 사면 하나 더 드려요' + (d.item ? ' (' + d.item + ')' : '') : d.pct + '% 할인' + (d.item ? ' (' + d.item + ')' : ''));
R.shop_calc = (ctx, it) => {
  const b = it.body || {}; need(Array.isArray(b.shops) && b.shops.length, 'shops');
  const pre = h('div', { class: 'stack', id: 'shop-body' }, b.scene ? h('p', { class: 't-label muted', text: b.scene }) : null,
    b.shops.map(sh => h('section', { class: 'card outlined', 'aria-label': str(sh.name) }, h('div', { class: 't-title-m', text: str(sh.name) }),
      h('ul', { class: 'shop', 'aria-label': str(sh.name) + ' 물건' }, (sh.lines || []).map(l => h('li', null, h('span', { text: str(l.item) + (l.qty > 1 ? ' ' + l.qty + str(l.unit) : '') }), h('b', { text: won(l.price) + (l.qty > 1 ? ' × ' + l.qty : '') })))),
      sh.deal ? h('p', { class: 't-small deal', text: dealText(sh.deal) }) : null)),
    b.pay ? h('p', { class: 't-title-m', text: won(b.pay) + '을 냈어요' }) : null);
  const spoken = (b.scene ? b.scene + '. ' : '') + b.shops.map(sh => sh.name + '에서 ' + (sh.lines || []).map(l => l.item + ' ' + (l.qty > 1 ? l.qty + str(l.unit) + ', 한 ' + str(l.unit) + '에 ' : '') + l.price + '원').join(', ') + (sh.deal ? '. ' + dealText(sh.deal) : '')).join('. ') + (b.pay ? '. ' + b.pay + '원을 냈어요' : '');
  choiceItem(ctx, it, { pre, speak: spoken + '. ' + str(it.prompt) });
};
R.schedule = (ctx, it) => choiceItem(ctx, it, {});
R.logic = (ctx, it) => choiceItem(ctx, it, {});
R.reminiscence = (ctx, it) => choiceItem(ctx, it, { wrongTalk: true });

/* 글자 세기: 줄을 한 줄 6~10칸으로 접어 큰 글자로 */
R.letter_search = (ctx, it) => {
  const b = it.body || {}, line = b.line; need(Array.isArray(line) && line.length >= 4, 'line');
  const n = line.length, cols = n <= 6 ? n : n % 6 === 0 ? 6 : n % 5 === 0 ? 5 : n % 4 === 0 ? 4 : 6;     // 한 줄에 6칸까지: 칸이 커서 또렷해요
  const pre = h('div', { class: 'lsline', id: 'lsline', style: '--c:' + cols, role: 'img', 'aria-label': '글자 줄: ' + line.join(' ') }, line.map(c => h('b', { text: str(c) })));
  choiceItem(ctx, it, { pre, speak: str(it.speak || it.prompt) });
};

/* 길 찾기: 지도(이모지 격자)와 장소 이름표 */
R.route = (ctx, it) => {
  const b = it.body || {}, map = b.map; need(Array.isArray(map) && map.length >= 3, 'map');
  const used = {}; map.forEach(r => r.forEach(c => { if (PLACE_NAMES[c]) used[c] = true; }));
  const pre = h('div', { class: 'stack', id: 'route-body' },
    h('div', { class: 'mapwrap' }, miniGrid(map, 'map', true)),
    h('ul', { class: 'legend', 'aria-label': '장소 이름' }, Object.keys(used).map(e => h('li', null, h('span', { class: 'lg-e', text: e }), PLACE_NAMES[e]))),
    b.frame === 'heading' && b.heading ? h('p', { class: 't-body muted', text: '처음에는 ' + ({ up: '위쪽', down: '아래쪽', left: '왼쪽', right: '오른쪽' }[b.heading] || '') + '을 보고 서 있어요.' }) : null);
  const promptText = str(b.text || it.prompt);
  choiceItem(ctx, it, { pre, prompt: promptText, speak: promptText });
  fitGrids(pre);
};

/* 모양 이어 가기: 바뀌는 모양들을 보여 주고 다음 모양 고르기 */
R.grid_pattern = (ctx, it) => {
  const b = it.body || {}, frames = b.frames; need(Array.isArray(frames) && frames.length >= 2, 'frames');
  const n = frames[0].length;
  const pre = h('div', { class: 'frames', id: 'frames', style: '--fc:' + (n >= 5 ? 1 : 2), 'aria-label': '바뀌는 모양들' },
    frames.map((g, i) => h('div', { class: 'frame' }, h('span', { class: 'gno', text: (i + 1) + '번째' }), miniGrid(g))),
    h('div', { class: 'frame ask' }, h('span', { class: 'gno', text: '다음은?' }), h('span', { class: 'qbox', text: '?', 'aria-hidden': 'true' })));
  gridOptions(ctx, it, pre, it.prompt || '모양이 규칙대로 바뀌어요. 다음 모양은 무엇일까요?', str(it.speak || it.prompt || '모양이 규칙대로 바뀌어요. 다음 모양은 무엇일까요?'));
};
/* 돌린 모양 찾기 */
R.grid_rotate = (ctx, it) => {
  const b = it.body || {}; need(Array.isArray(b.src) && b.src.length >= 3, 'src');
  const pre = h('div', { class: 'srcwrap' }, h('span', { class: 'gno', text: '원래 모양' }), miniGrid(b.src, 'src'));
  gridOptions(ctx, it, pre, it.prompt || '돌린 모양을 찾아 주세요.', str(it.speak || it.prompt));
  fitGrids(pre);
};
/* 모양 기억하기: 잠깐 칠해졌다가 사라져요 */
R.grid_memory = (ctx, it) => {
  const b = it.body || {}, n = b.size; need(Number.isInteger(n) && n >= 3 && n <= 5 && Array.isArray(b.cells), 'memory');
  const empty = '⬜', fill = str(b.fill || '🟩'), show = Math.max(1000, Math.min(6000, Number(b.showMs) || 3000));
  const mk = on => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => (on && b.cells.some(x => x[0] === r && x[1] === c) ? fill : empty)));
  ctx.prompt('칠해진 칸을 잘 보세요. 준비되면 아래 버튼을 눌러 주세요. 모양은 잠깐만 보여요.');
  const holder = h('div', { class: 'srcwrap', id: 'mem-grid' }, miniGrid(mk(false), 'src'));
  const go = h('button', { type: 'button', class: 'btn filled', id: 'btn-mem-ready', text: '준비됐어요' });
  const box = h('div', { class: 'stack' }, holder, go);
  ctx.box.append(box); fitGrids(box);
  go.addEventListener('click', () => {
    if (ctx.finished) return; go.remove();
    holder.textContent = ''; holder.append(miniGrid(mk(true), 'src')); fitGrids(holder);
    ctx.prompt('잘 보세요. 곧 사라져요.');
    setTimeout(() => {
      if (ctx.finished || !holder.isConnected) return;
      box.remove();
      gridOptions(ctx, it, null, '방금 본 모양은 어느 것일까요?', '방금 본 모양은 어느 것일까요?');
    }, show);
  });
};

/* 단어 기억하기: 낱말을 보고(읽어 드리고) → 섞어 놓은 낱말 중 본 것을 모두 고르기 */
R.word_recog = (ctx, it) => {
  const b = it.body || {}, targets = b.targets, foils = b.foils || []; need(Array.isArray(targets) && targets.length >= 2, 'targets');
  const N = targets.length, measure = isMeasure(it);
  const grid = it.present && Array.isArray(it.present.grid) && it.present.grid.length >= N ? it.present.grid : shuffle(targets.concat(foils.map(f => f.t)));
  const errBy = {}; foils.forEach(f => { errBy[f.t] = f.err || 'INTR_UNREL'; });
  ctx.prompt(N + '가지 낱말을 기억해 주세요. 준비되면 아래 버튼을 눌러 주세요.', N + '가지 낱말을 기억해 주세요. ' + targets.join(', ') + '.');
  const shown = h('div', { class: 'chips', id: 'shown' }, targets.map((w, i) => h('span', { class: 'chip show', id: 'word-' + i, text: w })));
  const memorized = h('button', { class: 'btn filled', id: 'btn-memorized', type: 'button', text: '다 외웠어요' });
  ctx.box.append(h('div', { class: 'stack' }, shown, memorized));
  memorized.addEventListener('click', () => {
    if (ctx.finished) return;
    const sel = new Set(); let checked = false;
    ctx.prompt('방금 본 낱말 ' + N + '개를 모두 골라 주세요.');
    const cnt = h('div', { class: 't-label muted', id: 'cnt', 'aria-live': 'polite' });
    const pool = h('div', { class: 'chips', id: 'pool' }, grid.map((w, i) => h('button', { type: 'button', class: 'chip', id: 'pick-' + i, 'aria-pressed': 'false', 'data-i': String(i), 'data-w': w, text: w })));
    const check = h('button', { class: 'btn filled', id: 'btn-check', type: 'button', text: '확인하기', disabled: '' });
    ctx.box.textContent = ''; ctx.box.append(h('div', { class: 'stack' }, cnt, pool, check));
    const upd = () => { cnt.textContent = '선택한 낱말: ' + sel.size + ' / ' + N; check.disabled = sel.size !== N; };
    pool.addEventListener('click', e => {
      const bt = e.target.closest('.chip'); if (!bt || checked) return;
      const w = bt.dataset.w;
      if (sel.has(w)) { sel.delete(w); bt.setAttribute('aria-pressed', 'false'); }
      else { if (sel.size >= N) { toast('이미 ' + N + '개를 골랐어요. 하나를 다시 눌러 빼 보세요.'); return; } sel.add(w); bt.setAttribute('aria-pressed', 'true'); }
      upd();
    });
    check.addEventListener('click', () => {
      if (checked || sel.size !== N) return; checked = true;
      let hits = 0; const err = [], pickIdx = [];
      pool.querySelectorAll('.chip').forEach((bt, i) => {
        const w = bt.dataset.w, isT = targets.includes(w), isSel = sel.has(w);
        if (isSel) pickIdx.push(i);
        bt.disabled = true; bt.setAttribute('aria-pressed', 'false');
        if (isT && isSel) hits++;
        else if (isSel) err.push(errBy[w] || 'INTR_UNREL');
        if (measure) { if (isSel) bt.classList.add('sel'); return; }
        if (isT && isSel) { bt.classList.add('right'); bt.append(h('span', { class: 'sr', text: ' 맞아요' })); }
        else if (isT) { bt.classList.add('missed'); bt.append(' (정답)'); }
        else if (isSel) { bt.classList.add('wrongpick'); bt.append(' (보지 않은 낱말)'); }
      });
      if (hits < N) err.push('MISS');
      check.hidden = true;
      const ok = hits === N;
      ctx.logItem(it, { score: hits / N, ok, err: Array.from(new Set(err)), pick: pickIdx });
      if (measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
      ctx.finish({ correct: hits, total: N, ok, msg: ok ? '모두 기억하셨어요! 정말 잘하셨어요.' : N + '개 중 ' + hits + '개를 기억하셨어요. 괜찮아요. 점선으로 표시한 낱말이 보여 드린 낱말이에요: ' + targets.join(', ') });
    });
    upd();
  });
};

/* 순서 맞추기: 단계는 올바른 순서로 저장돼 있고, present.order 가 보여 줄 순서예요. 끼어든 단계(intruder)는 빼야 해요. */
R.sequence = (ctx, it) => {
  const b = it.body || {}, steps = b.steps; need(Array.isArray(steps) && steps.length >= 3, 'steps');
  const n = steps.length, intr = typeof b.intruder === 'string' && b.intruder ? b.intruder : null, measure = isMeasure(it);
  const order = it.present && Array.isArray(it.present.order) && it.present.order.length === n ? it.present.order.slice() : shuffle(steps.map((_, i) => i));
  const disp = order.map(i => ({ s: steps[i], i })); if (intr) disp.splice(Math.min(disp.length, 1 + (it.id.length % n)), 0, { s: intr, i: -1 });
  const title = str(b.title);
  const q = '‘' + title + '’ 순서대로 하나씩 눌러 주세요. 가장 먼저 할 일부터 눌러요.' + (intr ? ' 관계없는 것 하나는 누르지 마세요.' : '');
  ctx.prompt(q, q);
  const info = h('div', { class: 't-label muted', id: 'stepinfo', 'aria-live': 'polite', text: '지금은 1번째 할 일을 찾아보세요.' });
  const chosen = h('ul', { class: 'steps', id: 'chosen', 'aria-label': '내가 고른 순서' });
  const avail = h('ul', { class: 'steps', id: 'avail' }, disp.map((d, k) => h('li', null, h('button', { type: 'button', class: 'btn outlined stepbtn', id: 'step-' + k, 'data-i': String(d.i), 'data-k': String(k), text: d.s }))));
  ctx.box.append(h('div', { class: 'stack' }, info, chosen, avail));
  let next = 0, mistakes = 0, firstErr = null, intrTap = false; const taps = [];
  const finish = () => {
    const placed = taps.filter(i => i >= 0);
    let wrongPos = -1; placed.forEach((v, p) => { if (wrongPos < 0 && v !== p) wrongPos = p; });
    if (wrongPos >= 0 && !firstErr) firstErr = Math.abs(placed[wrongPos] - wrongPos) === 1 ? 'SEQ_ADJ' : 'SEQ_FAR';
    const err = (firstErr ? [firstErr] : []).concat(intrTap ? ['SEQ_INTRUDER'] : []);
    const ok = !firstErr && !intrTap && placed.length === n;
    const score = ok ? 1 : Math.max(0, n / (n + mistakes + (measure ? placed.filter((v, p) => v !== p).length : 0)));
    ctx.logItem(it, { score: measure ? (placed.filter((v, p) => v === p).length / n) : score, ok, err, pick: taps.filter(v => v >= 0) });
    if (measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
    info.textContent = '순서를 모두 맞추셨어요!';
    ctx.finish({ correct: n, total: n + mistakes, ok: !mistakes, msg: '순서를 완성하셨어요! ' + (mistakes ? '다시 고른 횟수는 ' + mistakes + '번이에요. 괜찮아요.' : '한 번에 모두 맞추셨어요.') });
  };
  avail.addEventListener('click', e => {
    const bt = e.target.closest('.stepbtn'); if (!bt || ctx.finished) return;
    const i = Number(bt.dataset.i);
    if (measure) {                                     // 기준·앵커: 틀렸다고 알려 주지 않고, 고른 순서대로 쌓아요
      taps.push(i); if (i < 0) intrTap = true;
      chosen.append(h('li', { class: 'chosen' }, h('span', { class: 'num-badge', text: String(taps.length) }), h('span', { text: bt.textContent })));
      bt.closest('li').remove(); next++;
      if (taps.length >= n) finish(); else info.textContent = '지금은 ' + (taps.length + 1) + '번째 할 일을 찾아보세요.';
      return;
    }
    if (i === next) {
      taps.push(i); chosen.append(h('li', { class: 'chosen' }, h('span', { class: 'num-badge', text: String(next + 1) }), h('span', { text: steps[i] })));
      bt.closest('li').remove(); next++; beep('ok');
      if (next === n) finish(); else info.textContent = '지금은 ' + (next + 1) + '번째 할 일을 찾아보세요.';
    } else {
      mistakes++; beep('soft'); bt.classList.add('shake'); setTimeout(() => bt.classList.remove('shake'), 400);
      if (i < 0) intrTap = true; else if (!firstErr) firstErr = Math.abs(i - next) === 1 ? 'SEQ_ADJ' : 'SEQ_FAR';
      toast(i < 0 ? '그건 이 일과 관계없는 것 같아요. 다른 것을 눌러 보세요.' : '괜찮아요. ' + (next + 1) + '번째로 할 일을 다시 생각해 보세요.');
    }
  });
};

/* 이야기 듣기 (story_recall): 이야기를 읽어 드리고 → 바로 묻는 질문 → (코스 끝에) 늦게 묻는 질문 */
function storyQuestion(ctx, spec, onDone) {
  const q = spec.q, cs = q.choices; need(Array.isArray(cs) && cs.length >= 2, 'story choices');
  ctx.prompt(q.q, q.q + sayList(cs));
  const wrap = h('div', { class: 'stack' });
  const list = choiceList(ctx, cs, (i, lst) => {
    const ok = !!cs[i].ok, err = errOf(cs[i]);
    if (ok === false && spec.immOk === true) err.push('DELAY_LOSS');
    ctx.pickIdx = [i];
    ctx.logItem(null, { id: spec.id, role: spec.role, fmt: 'story_recall', cd: 'memory', lv: spec.lv, score: ok ? 1 : 0, ok, err, pick: [i] });
    markChoices(lst, cs, i, spec.measure);
    onDone(ok, i);
  });
  wrap.append(list); ctx.box.append(wrap);
  return wrap;
}
export { storyQuestion };
R.story_recall = (ctx, it) => {
  const b = it.body || {}, qs = b.questions; need(typeof b.story === 'string' && b.story && Array.isArray(qs) && qs.length >= 1, 'story');
  const measure = isMeasure(it), course = S.course && !S.course.replay && S.course.games ? S.course : null;
  const imm = [], later = [];
  qs.forEach((q, i) => ((q.delayed && course) ? later : imm).push({ q, i }));
  if (!imm.length) { imm.push(later.shift()); }
  ctx.prompt('이야기를 잘 들어 주세요. 다 들으면 아래 버튼을 눌러 주세요.', '이야기를 잘 들어 주세요. ' + b.story);
  const card = h('div', { class: 'card filled storycard', id: 'story-text', text: b.story });
  const done = h('button', { class: 'btn filled', id: 'btn-story-done', type: 'button', text: '다 들었어요' });
  ctx.box.append(h('div', { class: 'stack' }, card, done));
  const answers = {}; let oks = 0, k = 0;
  const ask = () => {
    ctx.box.textContent = '';
    const x = imm[k], spec = { id: it.id + '#q' + x.i, q: x.q, role: roleOf(it), lv: it.level, measure };
    const wrap = storyQuestion(ctx, spec, (ok, pi) => {
      answers[x.q.slot || x.i] = ok; if (ok) oks++;
      const last = k + 1 >= imm.length;
      if (last) {
        if (later.length) later.forEach(y => course.delayed.push({ id: it.id + '#q' + y.i, q: y.q, role: roleOf(it), lv: it.level, measure, itemId: it.id, slot: y.q.slot, immOk: answers[y.q.slot] }));
        if (measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
        return ctx.finish({ correct: oks, total: imm.length, ok: oks === imm.length, msg: oks === imm.length ? '이야기를 잘 기억하셨어요!' : imm.length + '개 중 ' + oks + '개를 기억하셨어요. 괜찮아요.' });
      }
      const nx = h('button', { class: 'btn filled', id: 'btn-q-next', type: 'button', text: '다음 질문' });
      nx.addEventListener('click', () => { k++; ask(); });
      if (measure) { k++; ask(); return; }   // 기준·앵커: 맞았는지 알리지 않고 바로 다음 질문
      wrap.append(h('div', { class: 'fb ' + (ok ? 'good' : 'soft'), text: ok ? '맞아요!' : '괜찮아요. 정답은 ‘' + rightText(q_cs(x)) + '’예요.' }), nx);
    });
    void wrap;
  };
  const q_cs = x => x.q.choices;
  done.addEventListener('click', () => { if (!ctx.finished) ask(); });
};

/* 코스 끝: 늦게 묻는 이야기 질문 한 개 (게임 '이야기 다시 떠올리기' 의 한 문제) */
export function delayedQuestion(ctx, spec) {
  ctx.bankItem({ id: spec.id, role: spec.role, format: 'story_recall', cdomain: 'memory', level: spec.lv });
  const wrap = storyQuestion(ctx, spec, (ok) => {
    if (spec.measure) return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: NEUTRAL_MSG });
    ctx.finish({ correct: ok ? 1 : 0, total: 1, ok, msg: ok ? '맞아요! 잘 기억하셨어요.' : '괜찮아요. 정답은 ‘' + rightText(spec.q.choices) + '’예요.' });
  });
  void wrap;
}

/* 은행 문항이 이 형식이고, 다른 게임에 끼워 넣어도 되는지 (기준·앵커 끼워 넣기용) */
const HOSTABLE = ['date_q', 'lang_complete', 'lang_relation', 'lang_category', 'word_find', 'analogy', 'shop_calc', 'schedule', 'logic', 'reminiscence', 'letter_search', 'route', 'grid_pattern', 'grid_rotate', 'grid_memory', 'word_recog', 'sequence', 'story_recall'];
export const hostable = it => HOSTABLE.includes(it.format) && !!R[it.format];

/* 문항 한 개를 그려요. 문항 모양이 깨져 있으면(예외) 화면을 비우고 false → 게임은 코드 문항으로 가요. */
export function tryBank(ctx, it) {
  try { ctx.bankItem(it); R[it.format](ctx, it); return true; }
  catch (e) { ctx.box.textContent = ''; ctx.logged = false; try { console.warn('문항을 그리지 못했어요', it && it.id, e && e.message); } catch (x) {} return false; }
}
export { fixed };
