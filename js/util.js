export const $ = (s, r) => (r || document).querySelector(s);
/*UTIL-START*/
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
export const pick = (a, n) => shuffle(a).slice(0, n);
export const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pad2 = n => String(n).padStart(2, '0');
export const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const won = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
export const WD = ['일','월','화','수','목','금','토'];
export const SEASONS = ['봄','여름','가을','겨울'];
export const seasonOf = m => m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울';
export const fmtDur = s => s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초';
export const dayNum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
export const parseYmd = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const clampLv = v => { v = Math.round(Number(v)); return v >= 1 && v <= 5 ? v : 1; };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => dayNum(parseYmd(b)) - dayNum(parseYmd(a));
export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
export const DKEYS = ['memory', 'attention', 'executive', 'orientation', 'speed'];

export const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
export function dedupe(correct, wrongs, n, filler) {
  const out = [correct];
  for (const w of shuffle(wrongs)) { if (out.length >= n) break; if (!out.includes(w)) out.push(w); }
  if (filler) { let guard = 0; while (out.length < n && guard++ < 200) { const w = filler(); if (!out.includes(w)) out.push(w); } }
  return shuffle(out);
}

export const isDocPath = p => String(p).split('/').length % 2 === 0;
export const withId = d => Object.assign({}, d.data(), { id: d.id });
