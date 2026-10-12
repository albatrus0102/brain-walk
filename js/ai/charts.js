/* ================= 추세 그래프 (인라인 SVG, 눈금에 맞춰 그려요) =================
 * 색은 CSS 토큰(.ai-chart 의 규칙)이 정해서 밝은 화면·어두운 화면에서 모두 읽혀요. 빨강은 쓰지 않아요.
 * 선: 4주 이동평균(굵은 초록) / 평소(기준선, 굵은 회색) / 평소 범위(옅은 띠) / 점: 주별 값
 * 표시: ▲ 메모·변경점 · ◆ 앵커 주 · 옅은 칸: 평소 실력 재는 기간 */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, kids) { const e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); (kids || []).forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); }); return e; }
export const W = 340, H = 240, ML = 46, MR = 14, MT = 18, MB = 44;

export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };

/* 4주 이동평균 (주마다 앞의 4주를 합쳐요). points: [{ n, sum }] → [값|null] */
export function movingAvg(points, k) {
  k = k || 4;
  return points.map((p, i) => {
    let n = 0, s = 0, used = 0;
    for (let j = Math.max(0, i - k + 1); j <= i; j++) { if (points[j] && points[j].n > 0) { n += points[j].n; s += points[j].sum; used++; } }
    return used >= 2 && n > 0 ? s / n : null;
  });
}

/* spec: { kind:'pct'|'plain', weeks:[{ wk, start, idx, label }], raw:[v|null], ma:[v|null], base:v|null, band:v|null, baseFrom:i, baseTo:i,
 *         notes:[{ i, text }], changes:[{ i, text }], anchors:[i], unit:'%', title, desc, lo, hi } */
export function trendChart(spec) {
  const n = spec.weeks.length, pw = W - ML - MR, ph = H - MT - MB;
  const vals = [].concat(spec.raw, spec.ma).filter(v => v != null);
  if (spec.base != null) { vals.push(spec.base); if (spec.band != null) { vals.push(spec.base + spec.band, spec.base - spec.band); } }
  let lo = spec.lo != null ? spec.lo : Math.min.apply(null, vals.length ? vals : [0]), hi = spec.hi != null ? spec.hi : Math.max.apply(null, vals.length ? vals : [100]);
  if (spec.kind === 'pct') { lo = Math.max(0, Math.floor((lo - 4) / 10) * 10); hi = Math.min(100, Math.ceil((hi + 4) / 10) * 10); if (hi - lo < 20) lo = Math.max(0, hi - 20); }
  else { const pad = (hi - lo) * 0.12 || 1; lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad); }
  const X = i => ML + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw), Y = v => MT + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const fmt = v => (spec.kind === 'pct' ? Math.round(v) + '%' : (Math.round(v * 10) / 10) + (spec.unit || ''));
  const svg = svgEl('svg', { class: 'ai-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-labelledby': 'cht-t cht-d', preserveAspectRatio: 'xMidYMid meet' });
  svg.append(svgEl('title', { id: 'cht-t' }, [spec.title]), svgEl('desc', { id: 'cht-d' }, [spec.desc || '']));
  // 평소 실력 재는 기간
  if (spec.baseFrom != null && spec.baseTo != null && spec.baseTo >= spec.baseFrom) {
    const x0 = X(spec.baseFrom) - (n > 1 ? pw / (n - 1) / 2 : 6), x1 = X(spec.baseTo) + (n > 1 ? pw / (n - 1) / 2 : 6);
    svg.append(svgEl('rect', { class: 'ch-basezone', x: Math.max(ML, x0), y: MT, width: Math.min(W - MR, x1) - Math.max(ML, x0), height: ph }));
  }
  // 눈금선
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = lo + (hi - lo) * t / ticks, y = Y(v);
    svg.append(svgEl('line', { class: 'ch-grid', x1: ML, x2: W - MR, y1: y, y2: y }), svgEl('text', { class: 'ch-ylab', x: ML - 6, y: y + 4, 'text-anchor': 'end' }, [fmt(v)]));
  }
  // 평소 범위 띠 + 기준선
  if (spec.base != null && spec.band != null) {
    const yt = Y(Math.min(hi, spec.base + spec.band)), yb = Y(Math.max(lo, spec.base - spec.band));
    svg.append(svgEl('rect', { class: 'ch-band', x: ML, y: yt, width: pw, height: Math.max(1, yb - yt) }));
  }
  if (spec.base != null) svg.append(svgEl('line', { class: 'ch-base', x1: ML, x2: W - MR, y1: Y(spec.base), y2: Y(spec.base) }));
  // 달 이름표 (그 달의 첫 주)
  let lastM = null;
  spec.weeks.forEach((w, i) => {
    const m = String(w.start || '').slice(5, 7);
    if (m && m !== lastM) { lastM = m; svg.append(svgEl('line', { class: 'ch-tick', x1: X(i), x2: X(i), y1: MT + ph, y2: MT + ph + 5 }), svgEl('text', { class: 'ch-xlab', x: X(i), y: MT + ph + 20, 'text-anchor': i === 0 ? 'start' : 'middle' }, [Number(m) + '월'])); }
  });
  // 주별 값 (점)
  spec.raw.forEach((v, i) => { if (v != null) svg.append(svgEl('circle', { class: 'ch-raw', cx: X(i), cy: Y(v), r: 3 })); });
  // 4주 이동평균 (선)
  const pts = []; spec.ma.forEach((v, i) => { if (v != null) pts.push([X(i), Y(v)]); });
  if (pts.length > 1) svg.append(svgEl('polyline', { class: 'ch-ma', points: pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') }));
  pts.forEach(p => svg.append(svgEl('circle', { class: 'ch-ma-dot', cx: p[0], cy: p[1], r: 4 })));
  // 앵커 주 (◆), 메모·변경점 (▲)
  (spec.anchors || []).forEach(i => svg.append(svgEl('path', { class: 'ch-anchor', d: 'M' + X(i) + ',' + (MT - 12) + ' l5,5 l-5,5 l-5,-5 z' }, [svgEl('title', {}, ['앵커 주'])])));
  const mark = (list, cls, label) => (list || []).forEach(m => {
    const x = X(m.i), y = MT + ph + 30;
    svg.append(svgEl('line', { class: 'ch-markline ' + cls, x1: x, x2: x, y1: MT, y2: MT + ph }), svgEl('path', { class: 'ch-marker ' + cls, d: 'M' + x + ',' + (y - 8) + ' l6,11 l-12,0 z' }, [svgEl('title', {}, [label + ': ' + (m.text || '')])]));
  });
  mark(spec.notes, 'note', '메모'); mark(spec.changes, 'change', '변경');
  // 마지막 값
  const lastI = (() => { for (let i = spec.ma.length - 1; i >= 0; i--) if (spec.ma[i] != null) return i; return -1; })();
  if (lastI >= 0) svg.append(svgEl('text', { class: 'ch-last', x: Math.min(W - MR, X(lastI)), y: Math.max(MT + 12, Y(spec.ma[lastI]) - 9), 'text-anchor': lastI > n * 0.8 ? 'end' : 'middle' }, [fmt(spec.ma[lastI])]));
  return svg;
}
