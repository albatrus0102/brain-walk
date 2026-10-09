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
