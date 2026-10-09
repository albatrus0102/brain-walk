export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
/* 점수 환산식은 앱 자체 기준이에요 (규준 아님). 같은 사람의 변화를 비교하기 위한 눈금일 뿐이에요. */
export const lin = (v, best, worst) => clamp(Math.round((worst - v) / (worst - best) * 100), 0, 100);
