import { reg } from './registry.js';
import { beep } from '../sound.js';
import { toast } from '../ui/dom.js';
import { $, esc, pick, shuffle } from '../util.js';

/* ---------- 6. 순서 맞추기 ---------- */
const TASKS = [
  ['라면 끓이기', ['냄비에 물을 붓고 불을 켠다', '물이 끓으면 면과 스프를 넣는다', '면이 익을 때까지 3분 끓인다', '불을 끈다', '그릇에 담는다', '맛있게 먹는다']],
  ['차 우려내기', ['물을 끓인다', '찻잔에 찻잎을 넣는다', '뜨거운 물을 붓는다', '3분 정도 우려낸다', '찻잎을 건져낸다', '따뜻할 때 마신다']],
  ['외출 준비', ['세수를 한다', '옷을 갈아입는다', '지갑과 열쇠를 챙긴다', '신발을 신는다', '현관문을 나선다', '문을 잠근다']],
  ['손 씻기', ['소매를 걷는다', '손에 물을 적신다', '비누를 묻힌다', '30초 동안 구석구석 문지른다', '흐르는 물에 헹군다', '수건으로 닦는다']],
  ['밥 짓기', ['쌀을 그릇에 담는다', '쌀을 물에 씻는다', '밥솥에 쌀과 물을 붓는다', '뚜껑을 닫고 취사를 누른다', '밥이 다 되면 골고루 뒤섞는다', '밥을 그릇에 푼다']],
  ['전화 걸기', ['전화기를 든다', '전화번호를 찾는다', '이름이나 번호를 선택한다', '통화 버튼을 누른다', '상대방이 받으면 인사한다', '용건을 말하고 끊는다']],
  ['빨래하기', ['빨랫감을 세탁기에 넣는다', '세제를 넣는다', '세탁 버튼을 누른다', '세탁이 끝나면 꺼낸다', '빨래를 탁탁 턴다', '빨랫줄에 넌다']],
  ['버스 타기', ['정류장에서 버스를 기다린다', '버스가 오면 번호를 확인한다', '버스에 오른다', '교통카드를 찍는다', '자리에 앉는다', '내릴 곳에서 벨을 누른다']],
  ['계란프라이 만들기', ['프라이팬을 불에 올린다', '기름을 두른다', '계란을 깨서 넣는다', '노른자가 익을 때까지 굽는다', '불을 끈다', '접시에 담는다']],
  ['시장 보기', ['살 물건을 적는다', '장바구니를 챙긴다', '시장에 간다', '물건을 고른다', '값을 치른다', '집으로 돌아온다']],
  ['약 챙겨 먹기', ['물 한 컵을 준비한다', '오늘 먹을 약을 꺼낸다', '약을 입에 넣는다', '물을 마신다', '약 먹은 시간을 적는다', '약을 제자리에 둔다']],
  ['잠자리 준비', ['세수와 양치를 한다', '잠옷으로 갈아입는다', '이부자리를 편다', '불을 끈다', '이불을 덮고 눕는다', '편안히 잠든다']]
];
reg({
  id: 'order', name: '순서 맞추기', domain: 'executive', desc: '일상 속 일의 순서를 생각해요', rounds: 3,
  play(ctx) {
    const k = [3, 4, 5, 6, 6][ctx.level - 1];
    ctx.mem.used = ctx.mem.used || [];
    const avail = TASKS.filter(t => !ctx.mem.used.includes(t[0]));
    const t = pick(avail.length ? avail : TASKS, 1)[0]; ctx.mem.used.push(t[0]);
    let steps = t[1].slice();
    if (k < 6) {
      const mid = pick(Array.from({ length: 4 }, (_, i) => i + 1), k - 2).sort((a, b) => a - b);
      steps = [steps[0]].concat(mid.map(i => t[1][i]), [steps[5]]);
    }
    let order = shuffle(steps.map((s, i) => ({ s, i })));
    let guard = 0; while (order.every((o, i) => o.i === i) && guard++ < 20) order = shuffle(order);
    ctx.prompt('‘' + t[0] + '’ 순서대로 하나씩 눌러 주세요. 가장 먼저 할 일부터 눌러요.', '‘' + t[0] + '’ 순서대로 하나씩 눌러 주세요. 가장 먼저 할 일부터 눌러요.');
    ctx.box.innerHTML = '<div class="stack"><div class="t-label muted" id="stepinfo" aria-live="polite">지금은 1번째 할 일을 찾아보세요.</div><ul class="steps" id="chosen" aria-label="내가 고른 순서"></ul>' +
      '<ul class="steps" id="avail">' + order.map((o, n) => '<li><button type="button" class="btn outlined stepbtn" id="step-' + n + '" data-i="' + o.i + '">' + esc(o.s) + '</button></li>').join('') + '</ul></div>';
    let next = 0, mistakes = 0;
    ctx.box.addEventListener('click', e => {
      const b = e.target.closest('.stepbtn'); if (!b || ctx.finished) return;
      const i = +b.dataset.i;
      if (i === next) {
        const li = b.closest('li'); const num = next + 1;
        $('#chosen', ctx.box).insertAdjacentHTML('beforeend', '<li class="chosen"><span class="num-badge">' + num + '</span><span>' + esc(steps[i]) + '</span></li>');
        li.remove(); next++; beep('ok');
        if (next === steps.length) { $('#stepinfo', ctx.box).textContent = '순서를 모두 맞추셨어요!'; ctx.finish({ correct: steps.length, total: steps.length + mistakes, ok: true, msg: '순서를 완성하셨어요! ' + (mistakes ? '다시 고른 횟수는 ' + mistakes + '번이에요. 괜찮아요.' : '한 번에 모두 맞추셨어요.') }); }
        else $('#stepinfo', ctx.box).textContent = '지금은 ' + (next + 1) + '번째 할 일을 찾아보세요.';
      } else {
        mistakes++; beep('soft'); b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400);
        toast('괜찮아요. ' + (next + 1) + '번째로 할 일을 다시 생각해 보세요.');
      }
    });
  }
});

