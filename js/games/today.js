import { reg } from './registry.js';
import { SEASONS, WD, dedupe, seasonOf, shuffle } from '../util.js';

/* ---------- 7. 오늘은 며칠? ---------- */
reg({
  id: 'today', name: '오늘은 며칠?', domain: 'orientation', desc: '오늘의 날짜와 요일을 떠올려요', rounds: 5,
  play(ctx) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), w = now.getDay();
    const tm = new Date(y, m - 1, d + 1), ym = new Date(y, m - 1, d - 1);
    const dim = (yy, mm) => new Date(yy, mm, 0).getDate();
    const nC = ctx.level === 1 ? 3 : 4;
    const kinds = ['season', 'month', 'weekday', 'year', 'day'];
    if (ctx.level >= 3) kinds.push('tomorrow', 'nextmonth');
    if (ctx.level >= 5) kinds.push('yesterday');
    if (!ctx.mem.kinds) ctx.mem.kinds = shuffle(kinds).slice(0, 5);
    const kind = ctx.mem.kinds[ctx.round % ctx.mem.kinds.length];
    const base = '오늘은 ' + y + '년 ' + m + '월 ' + d + '일 ' + WD[w] + '요일이에요.';
    const near = (v, lo, hi, suf) => { const c = []; for (let o = 1; o <= 4; o++) { if (v - o >= lo) c.push(v - o); if (v + o <= hi) c.push(v + o); } return c.map(x => x + suf); };
    let q, ans, wrongs, extra = '';
    if (kind === 'season') { q = '지금은 어느 계절일까요?'; ans = seasonOf(m); wrongs = SEASONS.filter(s => s !== ans); }
    else if (kind === 'month') { q = '오늘은 몇 월일까요?'; ans = m + '월'; wrongs = ctx.level < 3 ? near(m, 1, 12, '월').slice(0, 4) : near(m, 1, 12, '월'); }
    else if (kind === 'weekday') { q = '오늘은 무슨 요일일까요?'; ans = WD[w] + '요일'; wrongs = WD.filter((_, i) => i !== w).map(x => x + '요일'); }
    else if (kind === 'year') { q = '올해는 몇 년일까요?'; ans = y + '년'; wrongs = [y - 1, y + 1, y - 2, y + 2, y - 3].map(x => x + '년'); }
    else if (kind === 'day') { q = '오늘은 며칠일까요?'; ans = d + '일'; wrongs = near(d, 1, dim(y, m), '일'); }
    else if (kind === 'tomorrow') { q = '내일은 무슨 요일일까요?'; ans = WD[tm.getDay()] + '요일'; wrongs = WD.filter((_, i) => i !== tm.getDay()).map(x => x + '요일'); }
    else if (kind === 'nextmonth') { q = '다음 달은 몇 월일까요?'; const nm = (m % 12) + 1; ans = nm + '월'; wrongs = near(nm, 1, 12, '월'); }
    else { q = '어제는 며칠이었을까요?'; ans = ym.getDate() + '일'; wrongs = near(ym.getDate(), 1, dim(ym.getFullYear(), ym.getMonth() + 1), '일'); }
    wrongs = wrongs.filter(x => x !== ans);
    const choices = dedupe(ans, wrongs.slice(0, 5), nC);
    if (!choices.includes(ans)) choices[0] = ans;
    ctx.prompt(q);
    ctx.mc({ choices, answer: ans, speakChoices: true, right: '맞아요! ' + base, wrong: '괜찮아요. 정답은 ‘' + ans + '’입니다. ' + base });
  }
});

