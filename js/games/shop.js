import { reg } from './registry.js';
import { dedupe, esc, pick, rnd, shuffle, won } from '../util.js';

/* ---------- 5. 장보기 계산 ---------- */
const SHOP_ITEMS = [
  ['사과', 1500, '개', 1], ['배', 3000, '개', 1], ['두부', 2000, '모', 1], ['콩나물', 1000, '봉지', 1], ['계란', 5000, '판', 1], ['우유', 2500, '개', 1],
  ['식빵', 3000, '봉지', 1], ['대파', 1500, '단', 1], ['감자', 3000, '봉지', 1], ['고등어', 4000, '마리', 1], ['김', 2000, '봉지', 1], ['바나나', 3500, '송이', 1],
  ['귤', 4000, '봉지', 1], ['양파', 2500, '봉지', 1], ['라면', 1000, '봉지', 1], ['호박', 2000, '개', 1],
  ['두유', 1200, '개', 0], ['시금치', 1800, '단', 0], ['당근', 1300, '개', 0], ['어묵', 2700, '봉지', 0], ['요구르트', 1600, '개', 0], ['쌈장', 2300, '통', 0], ['비누', 2900, '개', 0], ['멸치', 6500, '봉지', 0]
];
const PAYS = [[5000, '오천 원'], [10000, '만 원'], [20000, '이만 원'], [50000, '오만 원']];
reg({
  id: 'shop', name: '장보기 계산', domain: 'executive', desc: '시장에서 물건값을 계산해요', rounds: 5,
  play(ctx) {
    const lv = ctx.level, nItems = [2, 2, 3, 3, 4][lv - 1], easyOnly = lv <= 2, useQty = lv >= 3, maxQty = lv >= 4 ? 3 : 2;
    let lines, total, noQty, kind, pay;
    for (let tries = 0; tries < 50; tries++) {
      const pool = SHOP_ITEMS.filter(it => !easyOnly || it[3] === 1);
      lines = pick(pool, nItems).map(it => ({ name: it[0], price: it[1], unit: it[2], qty: useQty ? rnd(1, maxQty) : 1 }));
      total = lines.reduce((s, l) => s + l.price * l.qty, 0); noQty = lines.reduce((s, l) => s + l.price, 0);
      kind = lv === 1 ? 'sum' : lv === 2 ? (Math.random() < 0.5 ? 'sum' : 'change') : (Math.random() < 0.4 ? 'sum' : 'change');
      if (kind === 'change') {
        const ok = PAYS.filter(p => p[0] > total); if (!ok.length) continue;
        pay = (lv >= 4 && ok.length > 1 && Math.random() < 0.4) ? ok[1] : ok[0];
      }
      if (total < 50000) break;
    }
    const ans = kind === 'sum' ? total : pay[0] - total;
    const step = easyOnly ? 500 : 100, offs = [1, 2, 3, 4, 5, 10, 20].map(k => k * step * (easyOnly ? 1 : 1));
    const cand = [];
    offs.forEach(o => { cand.push(ans + o); if (ans - o > 0) cand.push(ans - o); });
    if (kind === 'sum' && useQty && noQty !== total) cand.unshift(noQty);
    const wrongs = cand.filter(v => v > 0 && v !== ans);
    const near = wrongs.slice(0, 8);
    const choices = dedupe(ans, kind === 'sum' && useQty && noQty !== total ? [noQty].concat(shuffle(near).slice(0, 4)) : shuffle(near).slice(0, 5), 4,
      () => ans + (rnd(1, 20) * step) * (Math.random() < .5 ? 1 : 1)).map(v => v);
    const q = kind === 'sum' ? '합계는 얼마일까요?' : pay[1] + '을 내면 거스름돈은 얼마일까요?';
    const spoken = lines.map(l => l.name + ' ' + (l.qty > 1 ? l.qty + l.unit + ', 한 ' + l.unit + '에 ' : '') + l.price + '원').join(', ');
    ctx.prompt(q, '장바구니에 담은 물건이에요. ' + spoken + '. ' + q);
    const list = '<ul class="shop card outlined" aria-label="장바구니">' + lines.map(l =>
      '<li><span>' + esc(l.name) + (l.qty > 1 ? ' ' + l.qty + esc(l.unit) : '') + '</span><b>' + won(l.price) + (l.qty > 1 ? ' × ' + l.qty : '') + '</b></li>').join('') + '</ul>';
    ctx.mc({ pre: list, choices: choices.map(won), answer: won(ans), speakChoices: false,
      right: '맞아요! ' + (kind === 'sum' ? '합계는 ' : '거스름돈은 ') + won(ans) + '이에요.',
      wrong: '괜찮아요. 천천히 다시 생각해 봐요. 정답은 ‘' + won(ans) + '’입니다.' });
  }
});

