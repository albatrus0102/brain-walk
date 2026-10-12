import { Store } from '../store/store.js';
import { LS, WD, addDays, parseYmd, ymd } from '../util.js';
import { nextWeekKey, sundayOf, weekKey, weekStart } from './kdate.js';

/* ================= 체험 모드(LocalAdapter)의 예시 자료 =================
 * Firebase 없이도 AI 문제 은행 게임과 관리자 AI 리포트 화면을 둘러볼 수 있게, 가짜 문제 묶음·리포트·숫자를 넣어 둬요.
 * 모든 문서에 example:true 가 있고, 화면에도 "예시예요"라고 써요. 실제 기록이 아니에요. 서버가 만든 모양은 CLIENT-CONTRACT 와 같아요.
 * LS 'bw.aiDemo' 가 false 이면 넣지 않아요 (시험에서 예전 화면 흐름을 그대로 볼 때). */
const SEED_V = 1;
const hex = (s, n) => { let h1 = 0x811c9dc5, h2 = 0x1b873593; for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + s.charCodeAt(i) * 31, 2246822519) >>> 0; } return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + ((h1 ^ (h2 >>> 3)) >>> 0).toString(16).padStart(8, '0')).slice(0, n); };
const bkId = k => 'bk_' + hex(k, 20);

/* ---- 문항 만들기 도우미 ---- */
const base = (key, format, cd, lv, o) => Object.assign({ id: bkId(key), format, cdomain: cd, level: lv, role: 'training', specVer: null, theme: null, prompt: null, speak: null, body: {}, choices: null, options: null, present: null, explain: null, validFrom: null, validTo: null, noFeedback: false }, o);
/* 보기 만들기: 정답을 k 번째 자리에 (서버가 정한 최종 순서처럼 고정) */
const ch = (ans, wrongs, k) => { const a = wrongs.map(w => (Array.isArray(w) ? { t: w[0], err: w[1] } : { t: w, err: 'SEM_NEAR' })); a.splice((k || 0) % (a.length + 1), 0, { t: ans, ok: true }); return a; };
const mc = (key, format, cd, lv, prompt, body, ans, wrongs, explain, k) => base(key, format, cd, lv, { prompt, body, choices: ch(ans, wrongs, k), explain: explain || null });

/* ---- 격자 계산 ---- */
const E = '⬜';
const grid = (n, fill) => Array.from({ length: n }, () => Array.from({ length: n }, () => fill == null ? E : fill));
const clone = g => g.map(r => r.slice());
const rot90 = g => g[0].map((_, c) => g.map(r => r[c]).reverse());
const flipH = g => g.map(r => r.slice().reverse());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shiftRight = g => { const n = g.length, flat = [].concat.apply([], g), i = flat.findIndex(c => c !== E), out = flat.map(() => E); out[(i + 1) % flat.length] = flat[i]; return Array.from({ length: n }, (_, r) => out.slice(r * n, r * n + n)); };
const gridOpts = (correct, variants, k) => { const o = variants.filter(v => !same(v[0], correct) && variants.findIndex(w => same(w[0], v[0])) === variants.indexOf(v)).map(v => ({ grid: v[0], err: v[1] })); o.splice((k || 0) % (o.length + 1), 0, { grid: correct, ok: true }); return o; };
const cellsGrid = (n, cells, fill) => { const g = grid(n); cells.forEach(c => { g[c[0]][c[1]] = fill; }); return g; };

function rotateItem(key, lv, src, op, k) {
  const rots = { rot90: g => rot90(g), rot180: g => rot90(rot90(g)), rot270: g => rot90(rot90(rot90(g))) };
  const correct = rots[op](src);
  const others = ['rot90', 'rot180', 'rot270'].filter(x => x !== op).map(x => [rots[x](src), 'ROT_ANGLE']);
  const txt = { rot90: '시계 방향으로 한 번(90도) 돌리면', rot180: '반대로 한 번(180도) 돌리면', rot270: '반시계 방향으로 한 번(90도) 돌리면' }[op];
  return base(key, 'grid_rotate', 'visuospatial', lv, { prompt: '왼쪽 모양을 ' + txt + ' 어느 것일까요?', body: { size: src.length, src, op }, options: gridOpts(correct, [[flipH(correct), 'MIRROR']].concat(others), k), explain: '돌려도 칸의 짜임은 그대로예요. 한 귀퉁이씩 따라가 보세요.' });
}
function memoryItem(key, lv, n, cells, ms, fill, k) {
  const correct = cellsGrid(n, cells, fill), moved = cells.slice(); moved[0] = [cells[0][0], (cells[0][1] + 1) % n];
  const wrongs = [[cellsGrid(n, moved, fill), 'CELL_SHIFT'], [flipH(correct), 'MIRROR'], [cellsGrid(n, cells.slice(0, -1), fill), 'MISS']];
  return base(key, 'grid_memory', 'visuospatial', lv, { prompt: '칠해진 칸을 잘 보세요.', body: { size: n, cells, showMs: ms, fill }, options: gridOpts(correct, wrongs, k), explain: '칸의 위치를 한 줄씩 떠올려 보세요.' });
}
function patternItem(key, lv, n, start, fill, k) {
  const g0 = cellsGrid(n, [start], fill), f1 = shiftRight(g0), f2 = shiftRight(f1), correct = shiftRight(f2);
  return base(key, 'grid_pattern', 'visuospatial', lv, { prompt: '모양이 규칙대로 바뀌어요. 다음 모양은 무엇일까요?', body: { size: n, empty: E, frames: [g0, f1, f2], rule: { op: 'shift', dx: 1, dy: 0, wrap: 'next_row' } }, options: gridOpts(correct, [[flipH(correct), 'MIRROR'], [shiftRight(correct), 'STEP_SKIP'], [clone(f2), 'RULE_PARTIAL']], k), explain: '동그라미가 한 칸씩 오른쪽으로 가요. 줄 끝에서는 다음 줄 처음으로 가요.' });
}
const DIRV = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const PLACE = { '🏠': '집', '🏥': '병원', '🏪': '가게', '📮': '우체통', '⛪': '교회', '🏫': '학교', '🌳': '나무', '🚏': '정류장', '🏦': '은행', '🍞': '빵집' };
const DIRW = { up: '위', down: '아래', left: '왼쪽', right: '오른쪽' }, CNT = ['', '한', '두', '세', '네', '다섯', '여섯'];
function routeItem(key, lv, map, start, steps, k) {
  const go = (st, swap) => { let [r, c] = start; for (const s of st) { const d = swap ? ({ left: 'right', right: 'left' }[s.dir] || s.dir) : s.dir; r += DIRV[d][0] * s.go; c += DIRV[d][1] * s.go; } return [r, c]; };
  const name = p => (map[p[0]] && map[p[0]][p[1]] && PLACE[map[p[0]][p[1]]]) || null;
  const end = go(steps), ans = name(end);
  const short = steps.map(s => ({ dir: s.dir, go: s.go })); short[short.length - 1].go -= 1;
  const wr = []; [[go(steps, true), 'LR_CONF'], [go(short.filter(s => s.go > 0)), 'STEP_SKIP']].forEach(x => { const nm = name(x[0]); if (nm && nm !== ans && !wr.some(w => w[0] === nm)) wr.push([nm, x[1]]); });
  [[0, 1], [1, 0], [0, -1], [-1, 0]].forEach(d => { const nm = name([end[0] + d[0], end[1] + d[1]]); if (nm && wr.length < 3 && nm !== ans && !wr.some(w => w[0] === nm)) wr.push([nm, 'CELL_SHIFT']); });
  const DIRTXT = { up: '위로', down: '아래로', left: '왼쪽으로', right: '오른쪽으로' };
  const text = PLACE[map[start[0]][start[1]]] + '에서 ' + steps.map(s => DIRTXT[s.dir] + ' ' + CNT[s.go] + ' 칸').join(', ') + ' 가면 어디일까요?';
  return base(key, 'route', 'visuospatial', lv, { body: { size: map.length, map, start, frame: 'screen', steps, text }, choices: ch(ans, wr, k), explain: '출발한 곳에서 한 칸씩 손가락으로 따라가 보세요.' });
}
const letterItem = (key, lv, line, target, look) => {
  const n = line.filter(c => c === target).length, lk = line.filter(c => c === look).length;
  return base(key, 'letter_search', 'attention', lv, { prompt: '아래 줄에서 ‘' + target + '’는 몇 개일까요?', body: { line, target }, choices: ch(n + '개', [[(n - 1) + '개', 'COUNT_UNDER'], [(n + 1) + '개', 'COUNT_OVER'], lk && lk !== 1 ? [(n + lk) + '개', 'LOOKALIKE'] : [(n + 2) + '개', 'COUNT_OVER']], n % 3), explain: '손가락으로 짚으면서 하나씩 세어 보세요.' });
};
const wordItem = (key, lv, theme, targets, foils, k) => {
  const all = targets.concat(foils.map(f => f[0])), rot = ((k || 0) % all.length);
  return base(key, 'word_recog', 'memory', lv, { prompt: targets.length + '가지 낱말을 기억해 주세요.', body: { theme, targets, foils: foils.map(f => ({ t: f[0], err: f[1] })) }, present: { grid: all.slice(rot).concat(all.slice(0, rot)) } });
};
const U = 'INTR_UNREL', SM = 'INTR_SEM', PH = 'INTR_PHON';
const storyItem = (key, lv, story, facts, qs) => base(key, 'story_recall', 'memory', lv, { body: { story, facts, questions: qs.map(q => ({ q: q[0], slot: q[1], delayed: !!q[2], choices: ch(q[3], q[4], q[5] || 0) })) } });
const seqItem = (key, lv, title, steps, order, intruder) => base(key, 'sequence', 'executive', lv, { body: Object.assign({ kind: 'procedure', title, steps, before: steps.slice(1).map((_, i) => [i, i + 1]) }, intruder ? { intruder } : {}), present: { order }, explain: '앞 일이 끝나야 다음 일을 할 수 있어요.' });

/* ---- 훈련 묶음 ---- */
function trainingItems(today) {
  const wd = WD[parseYmd(today).getDay()], tm = WD[parseYmd(addDays(today, 1)).getDay()];
  const m = parseYmd(today).getMonth() + 1, season = m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울';
  const ss = ['봄', '여름', '가을', '겨울'], wds = ['일', '월', '화', '수', '목', '금', '토'];
  const xmasYear = (m === 12 && parseYmd(today).getDate() > 25) ? parseYmd(today).getFullYear() + 1 : parseYmd(today).getFullYear();
  const days = Math.round((Date.UTC(xmasYear, 11, 25) - Date.UTC(parseYmd(today).getFullYear(), m - 1, parseYmd(today).getDate())) / 864e5);
  const dq = (key, lv, prompt, query, ans, wrongs, k) => base(key + today, 'date_q', 'orientation', lv, { prompt, body: { query }, choices: ch(ans, wrongs, k), validFrom: today, validTo: today, explain: null });
  const items = [
    // 기억
    wordItem('w1a', 1, '부엌', ['냄비', '숟가락', '접시'], [['우산', U], ['기차', U], ['연필', U]], 1),
    wordItem('w1b', 1, '장보기', ['사과', '두부', '우유'], [['의자', U], ['구름', U], ['시계', U]], 3),
    wordItem('w2a', 2, '김장', ['배추', '마늘', '소금', '무'], [['기차', U], ['연필', U], ['시계', U], ['우산', U]], 2),
    wordItem('w2b', 2, '시장', ['콩나물', '대파', '계란', '식빵'], [['라디오', U], ['거울', U], ['모자', U], ['베개', U]], 5),
    wordItem('w3a', 3, '김장', ['배추', '마늘', '소금', '고춧가루', '무'], [['양파', SM], ['우산', U], ['기차', U], ['연필', U], ['시계', U]], 4),
    wordItem('w3b', 3, '가을 나들이', ['단풍', '도토리', '밤', '은행잎', '감'], [['배', SM], ['가방', U], ['안경', U], ['신발', U], ['라디오', U]], 7),
    wordItem('w4a', 4, '명절', ['송편', '떡국', '한복', '윷놀이', '세배', '차례'], [['만두', SM], ['부침개', SM], ['가방', U], ['안경', U], ['자전거', U], ['라디오', U]], 2),
    storyItem('s1a', 1, '화요일 오후, 미숙 씨는 마당에서 빨래를 널었어요. 바람이 불어 수건이 하나 날아갔어요.', [{ slot: 'laundry', v: '빨래' }, { slot: 'what', v: '수건' }],
      [['미숙 씨는 무엇을 널었나요?', 'laundry', false, '빨래', [['이불', SM], ['마당', 'SRC_CONF'], ['신발', U]], 0], ['바람에 날아간 것은 무엇인가요?', 'what', false, '수건', [['양말', SM], ['모자', U], ['빨래집게', PH]], 2]]),
    storyItem('s2a', 2, '토요일 아침, 영수 씨는 손녀와 함께 시장에 갔어요. 생선 가게에서 고등어 두 마리를 샀어요.', [{ slot: 'with', v: '손녀' }, { slot: 'bought', v: '고등어' }],
      [['영수 씨는 누구와 함께 갔나요?', 'with', false, '손녀', [['아들', SM], ['생선 가게 주인', 'SRC_CONF'], ['친구', U]], 1], ['생선 가게에서 무엇을 샀나요?', 'bought', false, '고등어', [['갈치', SM], ['두부', U], ['귤', U]], 2]]),
    storyItem('s2b', 2, '일요일 오후, 순자 씨는 공원에서 친구를 만났어요. 둘은 벤치에서 따뜻한 보리차를 마셨어요. 친구가 손수건 한 장을 선물로 주었어요.',
      [{ slot: 'where', v: '공원' }, { slot: 'drink', v: '보리차' }, { slot: 'gift', v: '손수건' }],
      [['순자 씨는 어디에서 친구를 만났나요?', 'where', false, '공원', [['시장', SM], ['집', U], ['병원', U]], 0], ['둘은 무엇을 마셨나요?', 'drink', false, '보리차', [['옥수수차', SM], ['우유', U], ['커피', U]], 2], ['친구가 선물로 준 것은 무엇인가요?', 'gift', true, '손수건', [['양말', SM], ['벤치', 'SRC_CONF'], ['모자', U]], 3]]),
    storyItem('s3a', 3, '일요일 오후, 순자 씨는 공원에서 친구를 만났어요. 둘은 벤치에서 따뜻한 보리차를 마셨어요. 친구가 손수건 한 장을 선물로 주었어요. 해가 지기 전에 집으로 돌아왔어요.',
      [{ slot: 'where', v: '공원' }, { slot: 'drink', v: '보리차' }, { slot: 'gift', v: '손수건' }],
      [['순자 씨는 어디에서 친구를 만났나요?', 'where', false, '공원', [['시장', SM], ['집', U], ['병원', U]], 0], ['둘은 무엇을 마셨나요?', 'drink', false, '보리차', [['옥수수차', SM], ['우유', U], ['커피', U]], 2], ['친구가 선물로 준 것은 무엇인가요?', 'gift', true, '손수건', [['양말', SM], ['벤치', 'SRC_CONF'], ['모자', U]], 3]]),
    base('c2a', 'card_theme', 'memory', 2, { body: { theme: '바닷가', cards: [['🐚', '조개'], ['🦀', '게'], ['🐟', '물고기'], ['🐙', '문어'], ['⛵', '돛단배'], ['🌊', '파도'], ['🐬', '돌고래'], ['⚓', '닻']] } }),
    base('pm2', 'prospective', 'memory', 2, { body: { cue: '🌼', event: 'after_last_item', instruction: '오늘 마지막 문제가 끝나면 화면 아래 🌼 단추를 눌러 주세요.', reminderMid: false } }),
    // 주의
    letterItem('l1a', 1, ['가', '거', '기', '가', '고', '가', '구', '거'], '가', '거'),
    letterItem('l1b', 1, ['서', '시', '서', '사', '서', '소', '시', '서'], '서', '시'),
    letterItem('l2a', 2, ['나', '다', '나', '라', '나', '마', '다', '나', '바', '나', '라', '사'], '나', '다'),
    letterItem('l3a', 3, ['고', '구', '그', '고', '기', '고', '구', '그', '고', '기', '구', '고', '그', '기', '고', '구', '그', '기'], '고', '구'),
    base('e1a', 'emoji_set', 'attention', 1, { body: { pairs: [['🍎', '🐶'], ['🚗', '🌳'], ['⭐', '🐟']], category: '서로 다른 그림' } }),
    base('e2a', 'emoji_set', 'attention', 2, { body: { pairs: [['🍎', '🍅'], ['🐱', '🐯'], ['🌻', '🌼']], category: '같은 종류' } }),
    base('e3a', 'emoji_set', 'attention', 3, { body: { pairs: [['😀', '😃'], ['🐭', '🐹'], ['🍐', '🍏']], category: '아주 닮은 그림' } }),
    // 계산·순서
    base('sh1', 'shop_calc', 'executive', 1, { prompt: '합계는 얼마일까요?', body: { scene: '동네 시장', shops: [{ name: '채소 가게', lines: [{ item: '두부', price: 2000, qty: 1, unit: '모' }, { item: '콩나물', price: 1000, qty: 1, unit: '봉지' }] }], ask: 'total' }, choices: ch('3,000원', [['2,500원', 'CALC_NEAR'], ['4,000원', 'CALC_NEAR'], ['1,000원', 'CALC_STEP_SKIP']], 2) }),
    base('sh2', 'shop_calc', 'executive', 2, { prompt: '오천 원을 냈어요. 거스름돈은 얼마일까요?', body: { scene: '동네 시장', shops: [{ name: '과일 가게', lines: [{ item: '사과', price: 1500, qty: 1, unit: '개' }, { item: '귤', price: 1500, qty: 1, unit: '봉지' }] }], pay: 5000, ask: 'change' }, choices: ch('2,000원', [['3,000원', 'CALC_SUM_AS_CHANGE'], ['3,500원', 'CALC_NEAR'], ['1,500원', 'CALC_STEP_SKIP']], 1) }),
    base('sh3', 'shop_calc', 'executive', 3, { prompt: '합계는 얼마일까요?', body: { scene: '동네 시장', shops: [{ name: '채소 가게', lines: [{ item: '배추', price: 3500, qty: 2, unit: '포기' }, { item: '대파', price: 2000, qty: 1, unit: '단' }, { item: '두부', price: 1800, qty: 1, unit: '모' }] }], ask: 'total' }, choices: ch('10,800원', [['7,300원', 'CALC_NOQTY'], ['9,000원', 'CALC_STEP_SKIP'], ['11,100원', 'CALC_NEAR']], 0) }),
    base('sh4', 'shop_calc', 'executive', 4, { prompt: '이만 원을 냈어요. 거스름돈은 얼마일까요?', body: { scene: '전통시장', shops: [{ name: '채소 가게', lines: [{ item: '배추', price: 3500, qty: 2, unit: '포기' }, { item: '대파', price: 2000, qty: 1, unit: '단' }] }, { name: '두부 가게', lines: [{ item: '두부', price: 1800, qty: 2, unit: '모' }], deal: { type: 'bogo', item: '두부' } }], pay: 20000, ask: 'change' },
      choices: ch('9,200원', [['7,400원', 'CALC_DEAL_IGNORED'], ['12,700원', 'CALC_NOQTY'], ['10,800원', 'CALC_SUM_AS_CHANGE']], 3), explain: '두부는 하나 사면 하나 더 주니까 두 모에 1,800원이에요.' }),
    seqItem('q2a', 2, '손 씻기', ['손에 물을 적신다', '비누를 묻힌다', '구석구석 문지른다', '물로 헹군다'], [2, 0, 3, 1]),
    seqItem('q3a', 3, '택배 보내기', ['상자에 물건을 넣는다', '테이프로 상자를 봉한다', '받는 주소를 붙인다', '우체국 창구에 낸다', '요금을 내고 영수증을 받는다'], [3, 0, 4, 2, 1]),
    seqItem('q4a', 4, '라면 끓이기', ['냄비에 물을 붓는다', '물이 끓으면 면을 넣는다', '3분 끓인다', '불을 끈다'], [1, 3, 0, 2]),
    base('lg1', 'logic', 'executive', 1, { prompt: '사과는 배보다 크고, 배는 귤보다 커요. 누가 가장 클까요?', body: { type: 'order', attr: '크기', entities: ['사과', '배', '귤'], facts: [['사과', '>', '배'], ['배', '>', '귤']], ask: 'max' }, choices: ch('사과', [['귤', 'LOGIC_REVERSE'], ['배', 'LOGIC_PARTIAL']], 0), explain: '사과 > 배 > 귤 순서로 커요.' }),
    base('lg2', 'logic', 'executive', 2, { prompt: '영수는 민호보다 키가 크고, 민호는 철수보다 키가 커요. 누가 가장 작을까요?', body: { type: 'order', attr: '키', entities: ['영수', '민호', '철수'], facts: [['영수', '>', '민호'], ['민호', '>', '철수']], ask: 'min' }, choices: ch('철수', [['영수', 'LOGIC_REVERSE'], ['민호', 'LOGIC_PARTIAL']], 1), explain: '영수 > 민호 > 철수 순서로 키가 커요.' }),
    base('lg3', 'logic', 'executive', 3, { prompt: '순자는 영희보다 나이가 많고, 영희는 미숙보다 나이가 많아요. 미숙은 정희보다 많아요. 누가 가장 나이가 많을까요?', body: { type: 'order', attr: '나이', entities: ['순자', '영희', '미숙', '정희'], facts: [['순자', '>', '영희'], ['영희', '>', '미숙'], ['미숙', '>', '정희']], ask: 'max' }, choices: ch('순자', [['정희', 'LOGIC_REVERSE'], ['영희', 'LOGIC_PARTIAL'], ['미숙', 'LOGIC_PARTIAL']], 2) }),
    base('sc2', 'schedule', 'executive', 2, { prompt: '병원 예약이 오후 2시예요. 버스로 40분 걸려요. 늦어도 몇 시에 나가야 할까요?', body: { events: [{ what: '병원 예약', at: '14:00' }], travelMin: 40, bufferMin: 0, ask: 'latest_departure' }, choices: ch('오후 1시 20분', [['오후 2시 40분', 'TIME_DIR'], ['오후 1시', 'CALC_NEAR'], ['오후 1시 40분', 'CALC_NEAR']], 0), explain: '2시에서 40분을 거꾸로 세면 1시 20분이에요.' }),
    base('sc3', 'schedule', 'executive', 3, { prompt: '병원 예약이 오후 2시예요. 버스로 40분 걸리고, 10분 일찍 도착하고 싶어요. 늦어도 몇 시에 나가야 할까요?', body: { events: [{ what: '병원 예약', at: '14:00' }], travelMin: 40, bufferMin: 10, ask: 'latest_departure' }, choices: ch('오후 1시 10분', [['오후 1시 20분', 'TIME_BUFFER_SKIP'], ['오후 2시 40분', 'TIME_DIR'], ['오후 1시', 'CALC_NEAR']], 3), explain: '40분에 일찍 도착할 10분을 더해서 50분 전에 나가요.' }),
    // 언어
    mc('lc1', 'lang_complete', 'language', 1, '빈칸에 알맞은 말을 골라 주세요.', { sentence: '비가 많이 와서 ____을 챙겼어요.', answer: '우산' }, '우산', [['모자', 'SEM_NEAR'], ['수박', 'SEM_FAR']], '비 올 때는 우산이 필요해요.', 1),
    mc('lc2', 'lang_complete', 'language', 2, '빈칸에 알맞은 말을 골라 주세요.', { sentence: '추워서 따뜻한 ____을 입고 나갔어요.', answer: '외투' }, '외투', [['부채', 'SEM_NEAR'], ['수영복', 'SEM_NEAR'], ['우산', 'SEM_FAR']], '추운 날에는 두꺼운 외투를 입어요.', 0),
    mc('lr2', 'lang_relation', 'language', 2, '‘넓다’와 뜻이 반대인 말은?', { word: '넓다', rel: 'antonym', answer: '좁다' }, '좁다', [['높다', 'SEM_NEAR'], ['넓적하다', 'PHON'], ['크다', 'REL_REVERSE']], '넓다의 반대말은 좁다예요.', 2),
    mc('lr3', 'lang_relation', 'language', 3, '‘기쁘다’와 뜻이 비슷한 말은?', { word: '기쁘다', rel: 'synonym', answer: '즐겁다' }, '즐겁다', [['슬프다', 'REL_REVERSE'], ['기다리다', 'PHON'], ['무겁다', 'SEM_FAR']], null, 1),
    mc('lk1', 'lang_category', 'language', 1, '다음 중 ‘과일’이 아닌 것을 골라 주세요.', { category: '과일', mode: 'odd_one_out', members: ['사과', '포도'], odd: '의자' }, '의자', [['사과', 'SEM_FAR'], ['포도', 'SEM_FAR']], '의자는 앉는 가구예요.', 1),
    mc('lk2', 'lang_category', 'language', 2, '다음 중 ‘동물’에 해당하는 것을 골라 주세요.', { category: '동물', mode: 'pick', members: ['호랑이'], answer: '호랑이' }, '호랑이', [['소나무', 'SEM_FAR'], ['냄비', 'SEM_FAR'], ['버스', 'SEM_FAR']], null, 3),
    mc('lk3', 'lang_category', 'language', 3, '다음 중 ‘채소’가 아닌 것을 골라 주세요.', { category: '채소', mode: 'odd_one_out', members: ['배추', '시금치', '오이'], odd: '참외' }, '참외', [['배추', 'SEM_NEAR'], ['시금치', 'SEM_NEAR'], ['오이', 'SEM_NEAR']], '참외는 과일이에요.', 0),
    mc('lk4', 'lang_category', 'language', 4, '다음 중 ‘곡식’이 아닌 것을 골라 주세요.', { category: '곡식', mode: 'odd_one_out', members: ['쌀', '보리', '콩'], odd: '당근' }, '당근', [['쌀', 'SEM_NEAR'], ['보리', 'SEM_NEAR'], ['콩', 'SEM_NEAR']], '당근은 채소예요.', 2),
    mc('wf2', 'word_find', 'language', 2, '비 올 때 펴서 머리 위에 드는 것은 무엇일까요?', { desc: '비 올 때 펴서 머리 위에 드는 것', answer: '우산' }, '우산', [['우비', 'SEM_NEAR'], ['양산', 'SEM_NEAR'], ['우상', 'PHON']], null, 0),
    mc('wf3', 'word_find', 'language', 3, '밤하늘에 떠서 달빛 아래 반짝이는 작은 빛은 무엇일까요?', { desc: '밤하늘에 떠서 반짝이는 작은 빛', answer: '별' }, '별', [['달', 'SEM_NEAR'], ['벌', 'PHON'], ['구름', 'SEM_FAR']], null, 1),
    mc('an3', 'analogy', 'language', 3, '바늘 : 실 = 붓 : ?', { a: '바늘', b: '실', c: '붓', answer: '먹물', rel: 'tool_material' }, '먹물', [['종이', 'REL_WRONG'], ['연필', 'SEM_NEAR'], ['벼루', 'REL_WRONG']], '바늘에는 실을, 붓에는 먹물을 써요.', 2),
    // 모양·공간
    rotateItem('r2a', 2, [['🟧', '⬜', '⬜'], ['🟧', '🟧', '⬜'], ['⬜', '⬜', '🟦']], 'rot180', 1),
    rotateItem('r3a', 3, [['🟧', '🟧', '⬜'], ['⬜', '🟧', '⬜'], ['⬜', '🟧', '🟦']], 'rot90', 2),
    memoryItem('m1a', 1, 3, [[0, 1], [1, 2], [2, 0]], 4000, '🟩', 1),
    memoryItem('m3a', 3, 4, [[0, 1], [1, 3], [2, 0], [3, 2], [3, 3]], 3000, '🟩', 2),
    patternItem('p2a', 2, 3, [0, 0], '🔵', 1),
    patternItem('p3a', 3, 4, [0, 0], '🟣', 2),
    routeItem('rt1a', 1, [['⬜', '🏠', '⬜'], ['🏪', '⬜', '🌳'], ['⬜', '🏦', '📮']], [0, 1], [{ dir: 'down', go: 1 }, { dir: 'right', go: 1 }], 1),
    routeItem('rt2a', 2, [['⬜', '🏫', '⬜', '⬜'], ['🏪', '⬜', '🚏', '⬜'], ['⬜', '🏠', '⬜', '🏦'], ['⬜', '⬜', '⬜', '⬜']], [0, 1], [{ dir: 'down', go: 2 }, { dir: 'left', go: 1 }], 1),
    routeItem('rt3a', 3, [['⬜', '🏠', '⬜', '🏥'], ['⬜', '⬜', '🌳', '⬜'], ['🏪', '⬜', '🏦', '⬜'], ['⬜', '📮', '⬜', '⛪']], [0, 1], [{ dir: 'down', go: 2 }, { dir: 'right', go: 1 }], 0),
    // 날짜 (서버가 달력으로 계산해 둔 정답, 오늘만 맞는 질문)
    dq('d1', 1, '지금은 어느 계절일까요?', { type: 'season_of', ref: 'today' }, season, ss.filter(s => s !== season).slice(0, 3).map(s => [s, 'SEASON']), 1),
    dq('d2', 2, '내일은 무슨 요일일까요?', { type: 'weekday_of', ref: 'tomorrow' }, tm + '요일', [wds[(wds.indexOf(tm) + 6) % 7] + '요일', wds[(wds.indexOf(tm) + 1) % 7] + '요일', wds[(wds.indexOf(tm) + 3) % 7] + '요일'].map((t, i) => [t, i < 2 ? 'DATE_NEAR' : 'DATE_WEEKDAY']), 2),
    dq('d3', 3, '크리스마스까지 며칠 남았을까요?', { type: 'days_until', name: '성탄절' }, days + '일', [[(days + 1) + '일', 'DATE_NEAR'], [Math.max(1, days - 1) + '일', 'DATE_NEAR'], [(days + 7) + '일', 'DATE_WEEKDAY']], 1),
    dq('d3w', 3, '오늘은 무슨 요일일까요?', { type: 'weekday_of', ref: 'today' }, wd + '요일', [wds[(wds.indexOf(wd) + 6) % 7] + '요일', wds[(wds.indexOf(wd) + 1) % 7] + '요일', wds[(wds.indexOf(wd) + 3) % 7] + '요일'].map((t, i) => [t, i < 2 ? 'DATE_NEAR' : 'DATE_WEEKDAY']), 3),
    // 옛날 이야기 (관리자가 내보낸 것만 묶음에 들어가요)
    base('re1', 'reminiscence', 'reminiscence', 2, { prompt: '연탄을 갈 때 쓰던 도구는 무엇일까요?', body: { topic: '옛 살림', answer: '연탄집게', talk: '연탄불을 꺼뜨리지 않으려고 밤에 일어나 갈곤 했지요.' }, choices: ch('연탄집게', [['부지깽이', 'ERA_NEAR'], ['국자', 'PLAUSIBLE'], ['가위', 'PLAUSIBLE']], 1), talk: '연탄불을 꺼뜨리지 않으려고 밤에 일어나 갈곤 했지요.' }),
    base('re3', 'reminiscence', 'reminiscence', 2, { prompt: '겨울에 군고구마를 구울 때 쓰던 통은 무엇일까요?', body: { topic: '겨울 간식', answer: '드럼통', talk: '골목마다 군고구마 냄새가 나던 겨울이 있었지요.' }, choices: ch('드럼통', [['양동이', 'ERA_NEAR'], ['항아리', 'PLAUSIBLE'], ['소쿠리', 'PLAUSIBLE']], 2), talk: '골목마다 군고구마 냄새가 나던 겨울이 있었지요.' }),
    base('re2', 'reminiscence', 'reminiscence', 2, { prompt: '설날 아침에 어른께 드리는 인사는 무엇일까요?', body: { topic: '명절 풍습', answer: '세배', talk: '새해 첫날 한복을 입고 절을 올리면 세뱃돈을 받던 기억이 나지요.' }, choices: ch('세배', [['성묘', 'ERA_NEAR'], ['쥐불놀이', 'PLAUSIBLE'], ['달맞이', 'PLAUSIBLE']], 0), talk: '새해 첫날 한복을 입고 절을 올리면 세뱃돈을 받던 기억이 나지요.' })
  ];
  return items;
}
const cellOf = it => it.cdomain + '-L' + it.level;

/* ---- 이번 주 기준·앵커 묶음 ---- */
function measureItems() {
  const R = (key, it) => Object.assign(it, { id: bkId('m:' + key), role: 'reference', noFeedback: true, level: 3, specVer: 'ref-v1', explain: null });
  const ref = [
    R('w1', wordItem('x', 3, '시장', ['배추', '마늘', '소금', '고춧가루', '무'], [['양파', SM], ['우산', U], ['기차', U], ['연필', U], ['시계', U]], 3)),
    R('w2', wordItem('y', 3, '가을', ['단풍', '도토리', '밤', '은행잎', '감'], [['배', SM], ['가방', U], ['안경', U], ['신발', U], ['라디오', U]], 6)),
    R('s1', storyItem('z', 3, '금요일 저녁, 정희 씨는 아들과 함께 영화관에 갔어요. 둘은 따뜻한 옥수수를 나눠 먹었어요. 영화가 끝난 뒤 버스를 타고 돌아왔어요.', [{ slot: 'who', v: '아들' }, { slot: 'where', v: '영화관' }, { slot: 'food', v: '옥수수' }],
      [['정희 씨는 누구와 함께 갔나요?', 'who', false, '아들', [['딸', SM], ['버스 기사', 'SRC_CONF'], ['친구', U]], 1], ['어디에 갔나요?', 'where', false, '영화관', [['공원', SM], ['시장', U], ['병원', U]], 0], ['둘이 나눠 먹은 것은 무엇인가요?', 'food', false, '옥수수', [['감자', SM], ['버스', 'SRC_CONF'], ['사탕', U]], 2]])),
    R('l1', letterItem('a', 3, ['마', '머', '미', '마', '모', '마', '무', '머', '마', '미', '모', '마'], '마', '머')),
    R('l2', letterItem('b', 3, ['소', '수', '사', '소', '서', '소', '수', '사', '소', '서', '수', '소'], '소', '수')),
    R('l3', letterItem('c', 3, ['바', '배', '버', '바', '보', '바', '부', '배', '바', '버', '보', '바'], '바', '배')),
    R('p1', base('p1', 'shop_calc', 'executive', 3, { prompt: '합계는 얼마일까요?', body: { scene: '마트', shops: [{ name: '마트', lines: [{ item: '우유', price: 2500, qty: 2, unit: '개' }, { item: '식빵', price: 3000, qty: 1, unit: '봉지' }, { item: '계란', price: 5000, qty: 1, unit: '판' }] }], ask: 'total' }, choices: ch('13,000원', [['10,500원', 'CALC_NOQTY'], ['11,000원', 'CALC_STEP_SKIP'], ['13,500원', 'CALC_NEAR']], 1) })),
    R('p2', base('p2', 'shop_calc', 'executive', 3, { prompt: '만 원을 냈어요. 거스름돈은 얼마일까요?', body: { scene: '동네 시장', shops: [{ name: '생선 가게', lines: [{ item: '고등어', price: 4000, qty: 2, unit: '마리' }] }], pay: 10000, ask: 'change' }, choices: ch('2,000원', [['8,000원', 'CALC_SUM_AS_CHANGE'], ['6,000원', 'CALC_NOQTY'], ['3,000원', 'CALC_NEAR']], 2) })),
    R('sc', base('sc', 'schedule', 'executive', 3, { prompt: '버스 정류장까지 걸어서 15분이에요. 오전 10시 약속에 늦지 않으려면 늦어도 몇 시에 나가야 할까요?', body: { events: [{ what: '약속', at: '10:00' }], travelMin: 15, bufferMin: 0, ask: 'latest_departure' }, choices: ch('오전 9시 45분', [['오전 10시 15분', 'TIME_DIR'], ['오전 9시 30분', 'CALC_NEAR'], ['오전 9시 55분', 'CALC_NEAR']], 0) })),
    R('lg', base('lg', 'logic', 'executive', 3, { prompt: '민수는 정호보다 달리기가 빠르고, 정호는 상우보다 빨라요. 누가 가장 느릴까요?', body: { type: 'order', attr: '달리기', entities: ['민수', '정호', '상우'], facts: [['민수', '>', '정호'], ['정호', '>', '상우']], ask: 'min' }, choices: ch('상우', [['민수', 'LOGIC_REVERSE'], ['정호', 'LOGIC_PARTIAL']], 1) })),
    R('sq', seqItem('sq', 3, '차 우려내기', ['물을 끓인다', '찻잔에 찻잎을 넣는다', '뜨거운 물을 붓는다', '3분 정도 우려낸다', '따뜻할 때 마신다'], [2, 4, 0, 3, 1])),
    R('k1', mc('k1', 'lang_category', 'language', 3, '다음 중 ‘탈것’이 아닌 것을 골라 주세요.', { category: '탈것', mode: 'odd_one_out', members: ['버스', '기차', '자전거'], odd: '냉장고' }, '냉장고', [['버스', 'SEM_NEAR'], ['기차', 'SEM_NEAR'], ['자전거', 'SEM_NEAR']], null, 1)),
    R('k2', mc('k2', 'lang_category', 'language', 3, '다음 중 ‘꽃’에 해당하는 것을 골라 주세요.', { category: '꽃', mode: 'pick', members: ['국화'], answer: '국화' }, '국화', [['소나무', 'SEM_NEAR'], ['호박', 'SEM_FAR'], ['붕어', 'SEM_FAR']], null, 2)),
    R('wf', mc('wf', 'word_find', 'language', 3, '글씨를 쓰고 나서 틀린 것을 지울 때 쓰는 것은 무엇일까요?', { desc: '틀린 글씨를 지울 때 쓰는 것', answer: '지우개' }, '지우개', [['연필', 'SEM_NEAR'], ['필통', 'SEM_NEAR'], ['지우게', 'PHON']], null, 0)),
    R('an', mc('an', 'analogy', 'language', 3, '새 : 날다 = 물고기 : ?', { a: '새', b: '날다', c: '물고기', answer: '헤엄치다', rel: 'cause_effect' }, '헤엄치다', [['걷다', 'REL_WRONG'], ['울다', 'REL_WRONG'], ['달리다', 'REL_WRONG']], null, 1)),
    R('ro1', rotateItem('ro1', 3, [['🟧', '🟧', '⬜'], ['⬜', '🟧', '⬜'], ['⬜', '🟧', '🟦']], 'rot270', 2)),
    R('ro2', rotateItem('ro2', 3, [['🟦', '⬜', '⬜'], ['🟦', '🟦', '⬜'], ['⬜', '🟦', '🟧']], 'rot90', 0)),
    R('me', memoryItem('me', 3, 4, [[0, 0], [1, 2], [2, 1], [3, 3], [2, 3]], 3000, '🟨', 1)),
    R('rt', routeItem('rt', 3, [['⬜', '🏫', '⬜', '🌳'], ['🏪', '⬜', '🚏', '⬜'], ['🏠', '⬜', '🏦', '⬜'], ['⬜', '🍞', '⬜', '📮']], [0, 1], [{ dir: 'down', go: 2 }, { dir: 'right', go: 1 }], 1)),
    R('pa', patternItem('pa', 3, 3, [1, 0], '🟠', 2))
  ];
  const A = (key, it) => Object.assign(it, { id: bkId('a:' + key), role: 'anchor', noFeedback: true, level: 3, specVer: 'ref-v1', explain: null });
  const anchor = [
    A('w', wordItem('aw', 3, '부엌', ['냄비', '국자', '주걱', '도마', '접시'], [['프라이팬', SM], ['우산', U], ['기차', U], ['연필', U], ['시계', U]], 2)),
    A('l', letterItem('al', 3, ['다', '라', '다', '타', '다', '라', '다', '타', '다', '라', '타', '다'], '다', '타')),
    A('s', base('as', 'shop_calc', 'executive', 3, { prompt: '합계는 얼마일까요?', body: { scene: '동네 시장', shops: [{ name: '채소 가게', lines: [{ item: '감자', price: 3000, qty: 2, unit: '봉지' }, { item: '양파', price: 2500, qty: 1, unit: '봉지' }] }], ask: 'total' }, choices: ch('8,500원', [['5,500원', 'CALC_NOQTY'], ['9,000원', 'CALC_NEAR'], ['6,000원', 'CALC_STEP_SKIP']], 1) })),
    A('k', mc('ak', 'lang_category', 'language', 3, '다음 중 ‘악기’가 아닌 것을 골라 주세요.', { category: '악기', mode: 'odd_one_out', members: ['피아노', '북', '장구'], odd: '선풍기' }, '선풍기', [['피아노', 'SEM_NEAR'], ['북', 'SEM_NEAR'], ['장구', 'SEM_NEAR']], null, 0)),
    A('r', rotateItem('ar', 3, [['🟥', '🟥', '⬜'], ['⬜', '🟥', '⬜'], ['⬜', '🟥', '🟦']].map(r => r.map(c => (c === '🟥' ? '🟧' : c))), 'rot90', 1))
  ];
  return { ref, anchor };
}

/* ---- 관리자용 예시 리포트·숫자 ---- */
const P = (n, d) => Math.round(n * d) / d;
function adminDocs(today) {
  const wkNow = weekKey(today), wkLast = nextWeekKey(wkNow, -1), idxNow = 21;
  const weeks = [], startWk = nextWeekKey(wkLast, -(idxNow - 1));
  const noise = i => Math.sin(i * 2.3) * 0.025 + Math.cos(i * 1.1) * 0.015;
  for (let i = 0; i < idxNow; i++) {
    const wk = nextWeekKey(startWk, i), st = weekStart(wk), acc = i === 0 ? 0.70 + noise(i) : 0.775 + noise(i) - (i >= 12 && i <= 13 ? 0.095 : 0) - (i >= 18 ? 0.012 * (i - 17) : 0);
    const dom = {}, shift = { memory: 0, attention: 0.03, executive: -0.03, language: 0.1, visuospatial: -0.06 };
    ['memory', 'attention', 'executive', 'language', 'visuospatial'].forEach((d, k) => { const a = Math.max(0.3, Math.min(1, acc + shift[d] + noise(i + k * 3) * 1.4 - (d === 'memory' && i >= 18 ? 0.03 * (i - 17) : 0))); dom[d] = [6, P(6 * a, 100)]; });
    const n = 30 - (i % 5 === 3 ? 4 : 0), spd = i < 12 ? noise(i) * 0.4 : 0.012 * (i - 11) + noise(i) * 0.3;
    weeks.push({ wk, start: st, idx: i, phase: i === 0 ? 'familiarization' : i <= 4 ? 'baseline' : 'monitoring', n, sum: P(n * acc, 100), offered: 30, adequate: true, dom, spd: P(spd, 1000), spdN: 40, iiv: 0.2, ies: null, sessions: 28 + (i % 3), abandoned: i % 6 === 2 ? 1 : 0, dateQ: { n: 20, wrong: i % 4 === 0 ? 1 : 0 }, pm: { n: 1, ok: 1 }, env: 'android|xlarge|1', anchorSet: i >= 1 && (i - 1) % 4 === 0 ? ['A', 'B', 'C'][((i - 1) / 4) % 3] : null });
  }
  const aw = weeks.filter(w => w.anchorSet), cmp = [];
  aw.forEach(w => { const prev = aw.find(x => x.anchorSet === w.anchorSet && x.idx === w.idx - 12); if (prev) cmp.push({ set: w.anchorSet, wk: w.wk, prevWk: prev.wk, x1: 20, x2: 20, correct1: 16, correct2: 17, bothOk: 14, up: 3, down: 2, bothWrong: 1, pSign: 1.0, pWil: 0.41, spdChange: -4, rci: 0.4, pe: null, verdict: 'green' }); });
  const anchorRows = (wkKey, bias) => ['memory', 'memory', 'attention', 'attention', 'executive', 'executive', 'language', 'language', 'visuospatial', 'visuospatial'].map((cd, i) => ({ id: bkId('anc' + i), cd, s: (i + bias) % 7 === 3 ? 0 : 1, ok: (i + bias) % 7 !== 3, rt: 4200 + i * 900 + bias * 150, err: (i + bias) % 7 === 3 ? [['MISS', 'CALC_NOQTY', 'LR_CONF', 'INTR_SEM'][i % 4]] : [], date: addDays(weekStart(wkKey), 2) }));
  const noteFrom = weeks[12].start, noteTo = addDays(noteFrom, 6);
  const now = Date.now(), dayMs = 864e5, dt = k => ymd(new Date(now - k * dayMs));
  const lights = { composite: 'green', memory: 'green', attention: 'green', executive: 'green', language: 'green', visuospatial: 'green', speed: 'yellow', participation: 'green' };
  const nums = { comp_ma4: '74%', comp_base: '77%', comp_band: '±9%p', mem_ma4: '66%', mem_base: '70%', mem_band: '±21%p', att_ma4: '81%', att_base: '80%', exe_ma4: '72%', exe_base: '76%', lan_ma4: '88%', lan_base: '86%', vis_ma4: '65%', vis_base: '71%', spd_change: '9% 느림', spd_slope: '+1.8%', spd_slope_lo: '+0.2%', spd_slope_hi: '+3.4%', spd_since: '3/7 주', part_days14: '14', part_planned14: '14', part_abandon14: '3%' };
  const sentences = { composite: '전체 4주 평균은 74%예요. 평소(77%) 범위 안이에요.', memory: '기억은 66%로 평소(70%)와 비슷해요. 문항이 적은 영역이라 ±21%p까지는 흔들림이에요.', attention: '집중은 81%로 평소와 같아요.', executive: '계산·순서는 72%로 평소(76%) 범위 안이에요.', language: '언어는 88%로 평소보다 조금 높아요. 거의 다 맞히셔서 속도를 함께 봐요.', visuospatial: '모양·공간은 65%로 평소(71%) 범위 안이에요.', speed: '답하는 속도가 평소보다 9% 느려요. 3월 7일 주부터 관찰 중이에요.', participation: '최근 14일 중 14일 모두 훈련하셨어요.' };
  const mkReport = (id, kind, date, o) => Object.assign({ id, v: 1, kind, date, basedOn: 'a-' + date.replace(/-/g, '') + '-0650', jobId: 'scheduled', generatedBy: 'routine', rejectCodes: null, lights, confidence: 'weak', phase: 'monitoring', thresholdsVer: 'v1', orange: 0, ts: now - (now - new Date(date + 'T07:41:00').getTime() > 0 ? 0 : 0), example: true }, o);
  const dayTs = d => new Date(d + 'T07:41:00').getTime();
  const d1 = dt(1), d2 = dt(2), d3 = dt(3), d9 = ymd(parseYmd(sundayOf(today)));
  const rep1 = mkReport('r-a-' + d1.replace(/-/g, '') + '-0650', 'daily', d1, {
    ts: dayTs(d1), numbers: nums,
    report: { headline: '어제는 평소처럼 훈련을 마치셨어요. 전체 흐름은 평소 범위 안이고, 반응 속도만 4주째 조금 느린 쪽이라 지켜보는 중이에요.', summary: ['기준 문항 6개 중 5개 정답 (이번 주 누적 11개 중 9개)', '하루 숫자는 원래 많이 흔들려요. 아래 4주 흐름을 봐 주세요.'],
      domains: Object.keys(lights).map(d => ({ domain: d, light: lights[d], sentence: sentences[d] })), notable: [{ text: '반응 속도가 평소보다 9% 느린 상태가 4주째예요. 정답률은 그대로라 “천천히 신중하게” 푸신 것으로도 설명돼요.', evidence: ['spd_change'] }],
      confounders: ['감기·몸살 ' + noteFrom.slice(5).replace('-', '/') + '~' + noteTo.slice(5).replace('-', '/') + ' 메모가 있어요'], doctorPoints: [{ text: '지금은 급하게 상의할 일은 없어요. 다음 정기 진료 때 “최근 4주 반응 속도가 처음보다 9% 느리고, 같은 기간 감기가 있었다”고 그래프와 함께 말씀드려 볼 만해요.', evidence: ['spd_change'] }],
      glossary: [{ key: '4주 평균', plain: '최근 4주의 기준 문항 정답률을 합쳐서 낸 평균이에요.', analogy: '하루 날씨 말고 한 달 날씨를 보는 것' }, { key: '평소 범위', plain: '처음 4주 동안의 실력 주변에서 우연히 흔들릴 수 있는 폭이에요.', analogy: '체중이 하루에 오르내리는 폭' }] },
    domains: [{ domain: 'speed', light: 'yellow', metrics: ['spd_change', 'spd_slope', 'spd_slope_lo', 'spd_slope_hi', 'spd_since'] }], signals: [{ key: 'S3:speed', rule: 'S3', domain: 'speed', level: 'yellow', why: ['speed_ewma_yellow', 'speed_slope_pos_8w'], downgraded: true, evidence: [] }] });
  const lightsW = Object.assign({}, lights, { speed: 'green' });
  const rep2 = mkReport('r-a-' + d9.replace(/-/g, '') + '-0650-w', 'weekly', d9, {
    ts: dayTs(d9), lights: lightsW, confidence: 'concordant', numbers: Object.assign({}, nums, { spd_change: '1% 느림', anc_set: 'A', anc_prev: '11/17', anc_cur: '2/9', anc_n: '20', anc_c1: '16', anc_c2: '17', anc_both: '14', anc_up: '3', anc_down: '2', anc_bothwrong: '1', anc_p_sign: '1.00', anc_spd: '4% 빨라짐', anc_p_wil: '0.41', anc_rci: '+0.4' }),
    report: { headline: '이번 주는 6일 훈련하셨어요. 12주 전과 똑같은 문제(앵커 A)를 다시 푸셨는데 “유지”예요. 장기 흐름은 평평해요.', summary: ['훈련 6일/7일 · 하루 평균 16분 · 그만둔 게임 1번', '기준 문항 30개 중 28개를 푸셨고 22개 정답 (79%)'],
      domains: Object.keys(lightsW).map(d => ({ domain: d, light: lightsW[d], sentence: d === 'speed' ? '반응 속도는 평소와 같아요 (+1%).' : sentences[d] })).concat([{ domain: 'anchor', light: 'green', sentence: '같은 문제를 다시 풀었는데 정답이 16개에서 17개가 됐어요. 바뀐 5개는 우연으로 설명돼요. 판정은 유지예요.' }]),
      notable: [{ text: '기억이 3주 연속 내려갔어요 (75% → 67% → 58%). 하지만 모두 합쳐 17%p로, 문항이 적은 영역의 흔들림 범위(21%p) 안이라 신호로 보지 않아요. 다음 주에도 봐요.', evidence: ['mem_drop3'] }],
      trend: ['전체 4주 평균 76% (평소 77%) · 기울기 한 달에 -0.2%p (범위 -1.5 ~ +1.1)'],
      anchor: ['정답: 16개 → 17개 · 둘 다 맞음 14 · 틀림→맞음 3 · 맞음→틀림 2 · 둘 다 틀림 1', '같은 문제를 다시 풀면 점수가 오르기 쉬워서, 오른 것은 “좋아짐”이 아니라 “유지”로 적어요.'],
      confounders: ['가족 행사(설) ' + noteFrom.slice(5).replace('-', '/') + '~' + noteTo.slice(5).replace('-', '/') + '이 있었어요'], doctorPoints: [{ text: '따로 상의할 변화는 없어요. 정기 진료 때 “3개월 흐름이 평평하다” 정도로 전하면 충분해요.', evidence: [] }],
      glossary: [{ key: '앵커', plain: '12주마다 똑같이 다시 내는 문제 묶음이에요.', analogy: '매년 같은 눈금자로 키를 재는 것' }, { key: '신뢰 변화 지수', plain: '차이가 측정 흔들림보다 몇 배 큰지예요.', analogy: '' }] },
    domains: [{ domain: 'anchor', light: 'green', metrics: ['anc_set', 'anc_prev', 'anc_cur', 'anc_n', 'anc_c1', 'anc_c2', 'anc_both', 'anc_up', 'anc_down', 'anc_bothwrong', 'anc_p_sign', 'anc_spd', 'anc_p_wil', 'anc_rci'] }], anchor: { set: 'A', verdict: 'green', peReady: false, metrics: ['anc_c1', 'anc_c2', 'anc_up'] }, signals: [] });
  const lightsA = Object.assign({}, lights, { speed: 'orange', composite: 'yellow' });
  const rep3 = mkReport('r-a-' + d3.replace(/-/g, '') + '-1410-al', 'alert', d3, {
    ts: new Date(d3 + 'T14:10:00').getTime(), lights: lightsA, orange: 1, confidence: 'concordant', jobId: 'w-' + d3.replace(/-/g, '') + '-1410-a1', numbers: Object.assign({}, nums, { spd_change: '14% 느림', spd_slope: '+2.1%', spd_slope_lo: '+0.9%', spd_slope_hi: '+3.3%', comp_ma4: '67%', comp_band: '±9%p' }),
    report: { headline: '반응 속도가 8주째 조금씩 느려지는 흐름이에요. 정답률은 그대로예요.', summary: ['최근 4주 동안 답하는 속도가 처음보다 14% 느려졌어요 (주당 +2.1%, 범위 +0.9~+3.3%).', '같은 기간 정답률은 그대로라, “천천히 신중하게 푸신 것”만으로는 설명되지 않아요.'],
      domains: [{ domain: 'speed', light: 'orange', sentence: '답하는 속도가 처음보다 14% 느려졌고 8주째 조금씩 느려지는 흐름이에요.' }, { domain: 'composite', light: 'yellow', sentence: '전체 정답률은 평소보다 10%p 낮아요 (평소 범위 ±9%p를 조금 넘었어요).' }],
      notable: [{ text: '같은 기간 관리자 메모는 없고, 기기·글자 크기 변경도 없어요.', evidence: ['spd_slope'] }], confounders: [], doctorPoints: [{ text: '이 그래프를 보여 드리고, 최근 잠·약·기분에 달라진 것이 있었는지 함께 이야기해 보세요. 급한 상황을 뜻하지는 않아요.', evidence: ['spd_change'] }], glossary: [] },
    domains: [{ domain: 'speed', light: 'orange', metrics: ['spd_change', 'spd_slope', 'spd_slope_lo', 'spd_slope_hi'] }], signals: [{ key: 'S3:speed', rule: 'S3', domain: 'speed', level: 'orange', why: ['speed_ewma_orange_2w', 'speed_slope_pos_8w'], downgraded: false, evidence: [] }] });
  const rep4 = mkReport('r-a-' + d2.replace(/-/g, '') + '-0650', 'daily', d2, { ts: dayTs(d2), generatedBy: 'template', rejectCodes: ['timeout'], numbers: nums, report: { headline: '', summary: [], domains: [] }, domains: [{ domain: 'speed', light: 'yellow', metrics: ['spd_change'] }], signals: [] });
  const reports = [rep1, rep2, rep3, rep4];
  const cells = {}; ['memory', 'attention', 'executive', 'language', 'visuospatial'].forEach((d, i) => [1, 2, 3, 4, 5].forEach(l => { cells[d + '|' + l] = 17 + ((i * 3 + l * 5) % 11) + (l === 3 ? 2 : 0); })); cells['orientation|1'] = 12;
  const intake = []; for (let k = 6; k >= 0; k--) intake.push({ date: dt(k), received: 70 + k * 3, accepted: 58 + k * 2, rejected: 12 + k, codes: { recompute: 3 + (k % 3), length: 2, dup: 2, pii: k === 2 ? 1 : 0, banned_x: 1 } });
  const ex = { example: true };
  const review = [
    Object.assign(trainingItems(today).find(i => i.id === bkId('re1')), { status: 'pending_review', why: 'reminiscence', basis: '연탄 난방은 1970~80년대 도시 가정에 널리 쓰였고, 연탄집게는 그 도구로 널리 알려짐', risk: '‘부지깽이’도 불 때 쓰지만 연탄과는 다른 도구', nExp: 0 }),
    Object.assign(trainingItems(today).find(i => i.id === bkId('re2')), { status: 'pending_review', why: 'reminiscence', basis: '세배는 설날 아침에 어른께 절을 올리는 풍습으로 널리 알려짐', risk: '‘성묘’는 설 연휴에 하지만 아침 인사가 아님', nExp: 0 }),
    Object.assign(base('qz1', 'word_find', 'language', 3, { prompt: '더운 여름에 시원한 바람을 만들어 주는 것은 무엇일까요?', body: { desc: '더울 때 시원한 바람을 만드는 것', answer: '선풍기' }, choices: ch('선풍기', [['부채', 'SEM_NEAR'], ['에어컨', 'SEM_NEAR'], ['난로', 'SEM_FAR']], 1) }), { status: 'quarantined', why: 'same_wrong_pick', basis: null, risk: '‘부채’와 ‘에어컨’도 시원한 바람을 만들 수 있어서 헷갈릴 수 있어요', nExp: 2 })
  ];
  return { weeks, cmp, anchorRows, reports, cells, intake, review, noteFrom, noteTo, wkNow, wkLast, startWk, now, dt, ex, nums, aw };
}

/* ---- 쓰기 ---- */
export async function seedDemo() {
  if (Store.mode !== 'local' || !Store.adapter) return;
  if (LS.get('bw.aiDemo', true) === false) return;
  const A = Store.adapter, today = ymd(new Date());
  const mark = await A.getDoc('aiState/demoSeed');
  if (mark && mark.v === SEED_V && mark.date === today) return;
  const ops = [], ex = { example: true };
  // 훈련 묶음 (같은 칸의 문항을 모아요)
  const cells = {}; trainingItems(today).forEach(it => { if (it.format === 'reminiscence') return; (cells[cellOf(it)] = cells[cellOf(it)] || []).push(it); });
  trainingItems(today).filter(it => it.format === 'reminiscence').forEach(it => { (cells['reminiscence-L2'] = cells['reminiscence-L2'] || []).push(it); });
  Object.keys(cells).forEach(k => { const m = /^([a-z]+)-L(\d)$/.exec(k); ops.push({ set: 'aiPacks/' + k, data: Object.assign({ v: 1, cd: m[1], lv: Number(m[2]), n: cells[k].length, itemsJson: JSON.stringify(cells[k]), builtTs: Date.now() }, ex) }); });
  // 이번 주부터 세 주치 기준·앵커 묶음
  const M = measureItems(), wk = weekKey(today);
  for (let k = 0; k < 3; k++) {
    const key = nextWeekKey(wk, k);
    ops.push({ set: 'aiPacks/measure-' + key, data: Object.assign({ v: 1, week: key, start: weekStart(key), specVer: 'ref-v1', nRef: M.ref.length, nAnchor: k === 0 ? M.anchor.length : 0, referenceJson: JSON.stringify(M.ref), anchorJson: JSON.stringify(k === 0 ? M.anchor : []), anchorSet: k === 0 ? 'A' : null, plan: { perDay: 5, firstPosition: 1 }, noFeedback: true, ready: true, builtTs: Date.now() }, ex) });
  }
  // 관리자용 숫자·리포트
  const D = adminDocs(today);
  D.reports.forEach(r => { const id = r.id; delete r.id; ops.push({ set: 'aiReports/' + id, data: r }); });
  ops.push({ set: 'aiStats/summary', data: Object.assign({ weeks: D.weeks, anchorCmp: D.cmp }, ex) });
  D.cmp.forEach((c, i) => { ops.push({ set: 'aiStats/' + c.prevWk, data: Object.assign({ wk: c.prevWk, anchorRows: D.anchorRows(c.prevWk, 0) }, ex) }, { set: 'aiStats/' + c.wk, data: Object.assign({ wk: c.wk, anchorRows: D.anchorRows(c.wk, 1 + i) }, ex) }); });
  ops.push({ set: 'aiState/plan', data: Object.assign({ startDate: D.weeks[0].start, startWeek: D.startWk, phase: 'monitoring', refLevels: { memory: 3, attention: 3, executive: 3, language: 3, visuospatial: 3 }, specVer: 'ref-v1', changePoints: [{ date: D.weeks[16].start, kind: 'device' }] }, ex) });
  ops.push({ set: 'aiOps/health', data: Object.assign({ gen: { lastSubmitTs: D.now - 5 * 36e5, lastRunId: D.dt(0).replace(/-/g, '') + '-0331', lastAccepted: 63, lastRejected: 12, lastOkDate: D.dt(0), okDays: [6, 5, 4, 3, 2, 1, 0].map(D.dt) }, rep: { lastReportTs: D.now - 2 * 36e5, lastAggId: 'a-' + D.dt(0).replace(/-/g, '') + '-0650', lastGeneratedBy: 'routine', lastKind: 'daily' }, server: { lastRun: D.now - 4 * 6e4, lastTick: D.now - 4 * 6e4, state: 'ok', reason: null }, tg: { lastKind: 'daily', lastResult: 'sent', lastTs: D.now - 2 * 36e5 }, phase: 'monitoring', thresholdsVer: 'v1' }, ex) });
  ops.push({ set: 'aiOps/wakes', data: Object.assign({ days: { [D.dt(3)]: 1 }, lastWake: {}, log: [], open: [], deferred: [] }, ex) });
  ops.push({ set: 'aiOps/bank', data: Object.assign({ cells: D.cells, review: 3, quarantine: 1, total: 400, anchors: { A: true, B: true, C: true }, reservedWeeks: [0, 1, 2].map(k => nextWeekKey(wk, k)), intake: D.intake }, ex) });
  ops.push({ set: 'aiOps/review', data: Object.assign({ n: D.review.length, itemsJson: JSON.stringify(D.review) }, ex) });
  ops.push({ set: 'aiOps/thresholds', data: Object.assign({ current: { ver: 'v1' }, history: [] }, ex) });
  ops.push({ set: 'aiState/demoSeed', data: { v: SEED_V, date: today } });
  // 사용자가 직접 고친 것은 덮어쓰지 않아요: 관심사 낱말, AI 켜기, 메모
  if (!(await A.getDoc('aiState/themes'))) ops.push({ set: 'aiState/themes', data: { words: ['낚시', '등산', '트로트'], updatedBy: 'local', updatedTs: Date.now(), example: true } });
  if (!(await A.getDoc('aiState/switch'))) ops.push({ set: 'aiState/switch', data: { enabled: true, updatedBy: 'local', updatedTs: Date.now(), example: true } });
  if (!(await A.query('aiNotes', {})).length) {
    ops.push({ set: 'aiNotes/nexample1', data: { from: D.noteFrom, to: D.noteTo, codes: ['illness', 'sleep'], text: '예시: 기침약 3일 드심', by: 'local', ts: Date.now(), example: true } });
    ops.push({ set: 'aiNotes/nexample2', data: { from: addDays(D.noteFrom, 28), to: null, codes: ['device'], text: '예시: 새 휴대폰으로 바꿈', by: 'local', ts: Date.now(), example: true } });
  }
  await A.batch(ops);
}
void WD;
