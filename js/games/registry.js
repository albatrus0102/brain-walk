/* ================= 데이터: 영역 / 게임 정의 ================= */
export const DOMAINS = [
  { id: 'memory', name: '기억력', desc: '보고 들은 것을 기억해요' },
  { id: 'attention', name: '주의집중력', desc: '차분히 살펴보고 집중해요' },
  { id: 'executive', name: '계산·실행기능', desc: '셈하고 순서를 생각해요' },
  { id: 'orientation', name: '지남력·언어', desc: '오늘을 알고 말을 떠올려요' },
  { id: 'speed', name: '처리속도', desc: '빠르게 알아차려요' }
];
export const DOM = Object.fromEntries(DOMAINS.map(d => [d.id, d]));
export const GAMES = {};
export const GAME_ORDER = [];
export function reg(g) { GAMES[g.id] = g; GAME_ORDER.push(g.id); }
export const gamesOf = d => GAME_ORDER.filter(id => GAMES[id].domain === d);
/* 월간 점검 전용 과제: GAMES 에는 등록하되 GAME_ORDER 에는 넣지 않아서 훈련 코스·골라서 하기에 나오지 않아요.
 * play(ctx) 는 ctx.finish({ correct: 점수(0~100), total: 100, ok, msg, metrics }) 로 끝내요. 규준이나 기준점은 없고, 본인의 처음 기록과 비교해서만 봐요. */
export function regTask(g) { g.task = true; GAMES[g.id] = g; }
