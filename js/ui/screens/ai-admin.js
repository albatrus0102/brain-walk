import { AD, aiAccess, ensureAdminSubs, isExample, msOf, parseItems, tpath, weekDoc } from '../../ai/admin-data.js';
import { noteDoc, noteId, reviewDoc, switchDoc, themesDoc } from '../../ai/admin-docs.js';
import { mean, movingAvg, sd, trendChart } from '../../ai/charts.js';
import { CONFIDENCE, DOMAIN_NAMES, KIND_NAMES, NOTE_CODES, NOTE_NAME, PHASE, REJECT_CODES_REPORT, TREND_DOMAINS, BANK_ROWS, FORMAT_NAMES, errLabel, lightOf, numLabel, rejectLabel, topLight } from '../../ai/labels.js';
import { weekKey, weekStart } from '../../ai/kdate.js';
import { observationState, setObservation } from '../../ai/consent.js';
import { adminNames, traineeLabel } from '../../data.js';
import { traineeChipsEl } from '../widgets.js';
import { S } from '../../state.js';
import { Store } from '../../store/store.js';
import { ACTS } from '../acts.js';
import { dialog, h, svgIcon, toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { go, render } from '../shell.js';
import { WD, addDays, parseYmd, ymd } from '../../util.js';

/* ================= 관리자 "AI 리포트" (점검 탭, DESIGN-AI §8) =================
 * 관리자만 봐요. 리포트·문항·메모 등 AI 가 만든 글은 모두 DOM 의 textContent 로만 넣어요 (innerHTML 금지).
 * 병을 판단하는 말과 빨간색은 쓰지 않아요. 신호등은 색 + 모양 + 글자로 함께 알려요. */
export const AI_BACK = { aiReports: 'assess', aiReport: 'aiReports', aiTrend: 'aiReports', aiAnchor: 'aiReports', aiNotes: 'aiReports', aiBank: 'aiReports', aiOps: 'aiReports', aiSettings: 'aiReports' };
const by = () => S.myId || 'local';
const mdw = s => { const d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + ' (' + WD[d.getDay()] + ')'; };
/* 주 번호(2026-W37) 대신 그 주가 시작하는 날짜로: "9/13 주" */
const wkLabel = wk => { const st = weekStart(wk); if (!st) return String(wk || ''); const d = parseYmd(st); return (d.getMonth() + 1) + '/' + d.getDate() + ' 주'; };
const md = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : '');
const when = ms => { if (!ms) return '기록 없음'; const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const section = (title, ...kids) => h('section', { class: 'card outlined ai-sec' }, title ? h('h2', { class: 't-title', text: title }) : null, ...kids);
const note = (text, cls) => h('p', { class: 't-body ' + (cls || 'muted'), text });
const pill = (light, label) => { const l = lightOf(light); return h('span', { class: 'lpill ' + l.cls }, h('span', { class: 'lg', 'aria-hidden': 'true', text: l.glyph }), label || l.word); };
const btn = (label, cls, act, id, data) => h('button', Object.assign({ type: 'button', class: 'btn ' + cls, id, 'data-act': act }, data || {}), label);

/* 화면 틀: 접근 확인 → 구독 시작 → 안쪽 그리기 */
/* family=true: 가족 전체 화면(문제 은행)이라 훈련하는 분 고르기가 없어요 */
function screen(titleText, fill, family) {
  return {
    html() { return '<div class="stack" id="ai-root"></div>'; },
    bind(el) {
      const root = el.querySelector('#ai-root');
      const acc = aiAccess();
      if (acc !== 'ok') { root.append(h('h1', { class: 't-headline', id: 'ai-h', text: 'AI 리포트' }), blocked(acc)); return; }
      ensureAdminSubs();
      root.append(h('h1', { class: 't-headline', id: 'ai-h', text: titleText }));
      if (!family) { const c = traineeChipsEl(false); if (c) root.append(c); }
      if (AD.denied) root.append(h('section', { class: 'card tertiary', id: 'ai-denied' }, h('p', { class: 't-body', text: '이 기기에서는 AI 리포트를 읽을 수 없어요' })));
      if (isExample()) root.append(h('p', { class: 'chip-status', id: 'ai-example', text: '예시' }));
      fill(root);
    }
  };
}
function blocked(acc) {
  return h('section', { class: 'card tertiary', id: 'ai-blocked' },
    h('p', { class: 't-title', id: 'ai-blocked-t', text: acc === 'trainee' ? '이 기기는 ' + traineeLabel() + ' 훈련용이에요' : '관리자만 볼 수 있어요' }),
    acc === 'trainee' ? null : h('p', { class: 't-body mt', text: '관리자: ' + (adminNames().join(', ') || '방 주인') }));
}

/* ---------------- 리포트 목록 ---------------- */
const TABS = [['all', '모두'], ['daily', '아침'], ['weekly', '주간'], ['alert', '알림']];
const attentionCount = r => Object.keys(r.lights || {}).filter(k => k !== 'composite' && ['yellow', 'orange'].includes((r.lights || {})[k])).length;
SCREENS.aiReports = screen('AI 리포트', root => {
  const tab = S.aiTab || 'all', rs = AD.reports.filter(r => tab === 'all' || r.kind === tab);
  root.append(h('div', { class: 'seg many', role: 'radiogroup', 'aria-label': '리포트 종류' }, TABS.map(t => h('button', { type: 'button', id: 'ai-tab-' + t[0], role: 'radio', 'aria-checked': String(tab === t[0]), 'data-act': 'ai-tab', 'data-v': t[0], text: t[1] }))));
  if (!rs.length) root.append(section(null, note(AD.ready.reports ? '아직 리포트가 없어요' : '불러오는 중이에요…')));
  const wrap = h('div', { class: 'ai-list-wrap', id: 'ai-list' });
  rs.forEach(r => {
    const tpl = r.generatedBy === 'template', rp = r.report || {}, n = attentionCount(r);
    wrap.append(h('button', { type: 'button', class: 'airow-btn', id: 'ai-r-' + r.id, 'data-act': 'ai-open', 'data-id': r.id },
      h('span', { class: 'ai-r-main' },
        h('span', { class: 'ai-r-top' }, h('strong', { text: mdw(r.date) + ' ' + (KIND_NAMES[r.kind] || '리포트') + (tpl ? ' (간단판) ⓘ' : '') }), pill(topLight(r)), n ? h('span', { class: 'ai-count', text: n + '개 살펴봐요' }) : null),
        h('span', { class: 'ai-r-line', text: tpl ? 'AI 설명이 빠진 날이에요. 숫자와 신호등만 보여 드려요.' : (rp.headline || '') })),
      svgIcon('chevron')));
  });
  if (rs.length) root.append(wrap);
  root.append(h('h2', { class: 't-title', text: '더 보기' }),
    h('div', { class: 'rows' }, [['aiTrend', 'hub-ai-trend', '흐름 그래프', 'trend'], ['aiAnchor', 'hub-ai-anchor', '같은 문제 다시 풀기', 'swap'], ['aiNotes', 'hub-ai-notes', '메모 더하기', 'edit'], ['aiBank', 'hub-ai-bank', '문제 은행', 'list'], ['aiOps', 'hub-ai-ops', '루틴 상태', 'flag'], ['aiSettings', 'hub-ai-settings', '설정', 'tune']].map(i =>
      h('button', { type: 'button', class: 'hub-item', id: i[1], 'data-act': 'nav', 'data-to': i[0] }, h('span', { class: 'lead' }, svgIcon(i[3])), h('span', { style: 'flex:1;min-width:0' }, h('strong', { text: i[2] })), svgIcon('chevron')))));
});
ACTS['ai-tab'] = b => { S.aiTab = b.dataset.v; render(true); const nb = document.getElementById('ai-tab-' + S.aiTab); if (nb) nb.focus(); };
ACTS['ai-open'] = b => { S.aiSel = b.dataset.id; go('aiReport'); };

/* ---------------- 리포트 보기 ---------------- */
const PREFIX = { composite: 'comp_', memory: 'mem_', attention: 'att_', executive: 'exe_', language: 'lan_', visuospatial: 'vis_', speed: 'spd_', participation: 'part_', anchor: 'anc_' };
const WHY = {
  speed_ewma_yellow: '최근 주에 무게를 둔 평균선이 경계선을 넘었어요.', speed_ewma_orange_2w: '그 평균선이 2주 연속 더 높은 경계선을 넘었어요.', speed_slope_pos_8w: '8주 동안 조금씩 느려지는 쪽의 흐름이에요.',
  comp_drop_yellow: '전체 4주 평균이 평소 범위를 조금 벗어났어요.', mem_drop3: '3주 연속 내려갔지만 흔들림 범위 안이에요.', part_low: '훈련한 날이 계획보다 적었어요.'
};
function briefOf(r, d) {
  const n = r.numbers || {};
  if (['composite', 'memory', 'attention', 'executive', 'language', 'visuospatial'].includes(d)) { const p = PREFIX[d]; return n[p + 'ma4'] ? n[p + 'ma4'] + (n[p + 'base'] ? ' (평소 ' + n[p + 'base'] + ')' : '') : ''; }
  if (d === 'speed') return n.spd_change ? '평소보다 ' + n.spd_change : '';
  if (d === 'participation') return n.part_days14 ? '최근 14일 중 ' + n.part_days14 + (n.part_planned14 ? '/' + n.part_planned14 : '') + '일' : '';
  return '';
}
function numbersList(r, d) {
  const n = r.numbers || {}, p = PREFIX[d]; if (!p) return null;
  const keys = Object.keys(n).filter(k => k.indexOf(p) === 0);
  if (!keys.length) return null;
  return h('dl', { class: 'ai-nums' }, keys.flatMap(k => [h('dt', { text: numLabel(k) }), h('dd', { text: String(n[k]) })]));
}
function domainRow(r, d, light, sentence, rid) {
  const key = 'air-' + rid + '-' + d, open = !!S.xpOpen[key], brief = briefOf(r, d);
  const sig = (r.signals || []).filter(s => s.domain === d);
  const why = [].concat.apply([], sig.map(s => s.why || [])).map(c => WHY[c]).filter(Boolean);
  const body = h('div', { class: 'ai-detail' },
    numbersList(r, d) || note('이 영역의 숫자가 아직 없어요.'),
    why.length ? h('ul', { class: 'ai-why' }, why.map(t => h('li', { text: t }))) : null,
    null);
  return h('details', { class: 'airow', id: 'ai-d-' + d, 'data-xp': key, open: open ? '' : null },
    h('summary', null, h('span', { class: 'ai-sum' }, h('span', { class: 'ai-sum-top' }, pill(light), h('strong', { text: DOMAIN_NAMES[d] || d }), brief ? h('span', { class: 'ai-brief', text: brief }) : null), sentence ? h('span', { class: 'ai-line', text: sentence }) : null), h('span', { class: 'ai-more' }, '자세히', svgIcon('expand'))), body);
}
SCREENS.aiReport = screen('AI 리포트', root => {
  const r = AD.reports.find(x => x.id === S.aiSel);
  if (!r) { root.append(section(null, note(AD.ready.reports ? '리포트가 없어요' : '불러오는 중이에요…'))); return; }
  const rp = r.report || {}, tpl = r.generatedBy === 'template';
  document.getElementById('ai-h').textContent = mdw(r.date) + ' ' + (KIND_NAMES[r.kind] || '리포트');
  root.append(h('p', { class: 't-small muted', id: 'ai-sub', text: (PHASE[r.phase] ? PHASE[r.phase] + ' · ' : '') + (r.date || '') }));
  if (tpl) root.append(h('section', { class: 'card tertiary', id: 'ai-tpl' }, h('p', { class: 't-title-m', text: 'ⓘ 간단판이에요' }), h('p', { class: 't-body mt', text: 'AI 설명이 빠진 날이라 숫자와 신호등만 보여 드려요.' + (r.rejectCodes && r.rejectCodes[0] && REJECT_CODES_REPORT[r.rejectCodes[0]] ? ' (' + REJECT_CODES_REPORT[r.rejectCodes[0]] + ')' : '') })));
  if (rp.headline) root.append(h('section', { class: 'card primary', id: 'ai-headline' }, h('p', { class: 't-label muted', text: '한 줄 요약' }), h('p', { class: 't-title', text: rp.headline })));
  if (Array.isArray(rp.summary) && rp.summary.length) root.append(h('ul', { class: 'ai-list', id: 'ai-summary' }, rp.summary.map(t => h('li', { class: 't-body', text: t }))));
  // 영역별 신호등: 문장은 리포트 것, 없으면 신호등만
  const doms = Array.isArray(rp.domains) && rp.domains.length ? rp.domains.map(x => ({ d: x.domain, light: x.light, sentence: x.sentence })) : Object.keys(r.lights || {}).map(k => ({ d: k, light: r.lights[k], sentence: '' }));
  root.append(h('h2', { class: 't-title', text: '영역별 흐름' }), h('div', { class: 'ai-rows', id: 'ai-rows' }, doms.map(x => domainRow(r, x.d, x.light, x.sentence, r.id))));
  const list = (title, arr, id) => { if (Array.isArray(arr) && arr.length) root.append(section(title, h('ul', { class: 'ai-list', id }, arr.map(t => h('li', { class: 't-body', text: typeof t === 'string' ? t : t.text })))));  };
  list('눈여겨볼 점', rp.notable, 'ai-notable');
  list('함께 봐야 할 일', rp.confounders, 'ai-conf');
  if (r.kind === 'weekly') { list('12주 흐름', rp.trend, 'ai-trend-lines'); list('같은 문제 다시 풀기', rp.anchor, 'ai-anchor-lines'); }
  list('의사와 이야기해 볼 만한 점', rp.doctorPoints, 'ai-doctor');
  if (Array.isArray(rp.glossary) && rp.glossary.length) root.append(h('details', { class: 'field-opt', id: 'ai-gloss', 'data-xp': 'air-gl-' + r.id, open: S.xpOpen['air-gl-' + r.id] ? '' : null }, h('summary', { text: '용어 풀이' }), h('dl', { class: 'ai-nums' }, rp.glossary.flatMap(g => [h('dt', { text: g.key }), h('dd', { text: g.plain + (g.analogy ? ' (' + g.analogy + ')' : '') })]))));
  const nk = Object.keys(r.numbers || {});
  if (nk.length) root.append(h('details', { class: 'field-opt', id: 'ai-allnums', 'data-xp': 'air-nm-' + r.id, open: S.xpOpen['air-nm-' + r.id] ? '' : null }, h('summary', { text: '숫자 모두 보기' }), h('dl', { class: 'ai-nums' }, nk.flatMap(k => [h('dt', { text: numLabel(k) }), h('dd', { text: String(r.numbers[k]) })]))));
  root.append(h('p', { class: 't-body', id: 'ai-conf-line', text: '신뢰 정도: ' + (CONFIDENCE[r.confidence] || '아직 판단하기 일러요') }));
});

/* ---------------- 흐름 그래프 ---------------- */
function seriesFor(dk, weeks) {
  return weeks.map(w => {
    if (dk === 'composite') return { n: w.adequate === false ? 0 : w.n, sum: w.sum };
    if (dk === 'participation') return { n: 1, sum: w.sessions || 0 };
    const x = (w.dom || {})[dk]; return x && w.adequate !== false ? { n: x[0], sum: x[1] } : { n: 0, sum: 0 };
  });
}
function parseBand(rs) {
  for (const r of rs) { const m = /([0-9.]+)/.exec(String(((r.numbers || {}).comp_band) || '')); if (m) return Number(m[1]); }
  return null;
}
function buildTrend(dk, range) {
  const st = AD.stats; if (!st || !Array.isArray(st.weeks) || !st.weeks.length) return null;
  let weeks = st.weeks.slice().sort((a, b) => (a.start < b.start ? -1 : 1)); if (range > 0) weeks = weeks.slice(-range);
  const baseIdx = []; weeks.forEach((w, i) => { if (w.idx >= 1 && w.idx <= 4) baseIdx.push(i); });
  const labels = weeks.map(w => ({ wk: w.wk, start: w.start, idx: w.idx }));
  const find = start => { for (let i = weeks.length - 1; i >= 0; i--) if (weeks[i].start <= start) return i; return -1; };
  const notes = AD.notes.map(n => ({ i: find(n.from), text: (n.codes || []).map(c => NOTE_NAME[c] || c).join('·') + ' ' + n.from })).filter(m => m.i >= 0 && weeks[m.i].start >= weeks[0].start);
  const cps = ((AD.plan && AD.plan.changePoints) || []).map(c => ({ i: find(c.date), text: ({ device: '기기 바뀜', size: '글자 크기 바뀜', speech: '소리 안내 바뀜' }[c.kind] || c.kind || '바뀜') + ' ' + c.date })).filter(m => m.i >= 0);
  const anchors = []; weeks.forEach((w, i) => { if (w.anchorSet) anchors.push(i); });
  const common = { weeks: labels, baseFrom: baseIdx.length ? baseIdx[0] : null, baseTo: baseIdx.length ? baseIdx[baseIdx.length - 1] : null, notes, changes: cps, anchors };
  if (dk === 'speed') {
    const pc = weeks.map(w => (w.spd == null ? null : (Math.exp(w.spd) - 1) * 100));
    const ma = pc.map((v, i) => { const xs = pc.slice(Math.max(0, i - 3), i + 1).filter(x => x != null); return xs.length >= 2 ? mean(xs) : null; });
    const bs = baseIdx.map(i => pc[i]).filter(x => x != null), band = Math.max(3, 1.5 * (sd(bs) || 0));
    return Object.assign(common, { kind: 'plain', unit: '%', raw: pc, ma, base: 0, band, lo: Math.min(-band - 2, ...pc.filter(x => x != null)), hi: Math.max(band + 2, ...pc.filter(x => x != null)), title: '반응 속도: 평소보다 느린 정도(%)', unitNote: '0%가 평소 속도, 위로 갈수록 느려요' });
  }
  const pts = seriesFor(dk, weeks);
  if (dk === 'participation') {
    const raw = pts.map(p => p.sum), ma = raw.map((v, i) => { const xs = raw.slice(Math.max(0, i - 3), i + 1); return xs.length >= 2 ? mean(xs) : null; });
    return Object.assign(common, { kind: 'plain', unit: '개', raw, ma, base: null, band: null, lo: 0, title: '한 주에 한 게임 수', unitNote: '' });
  }
  const raw = pts.map(p => (p.n > 0 ? p.sum / p.n * 100 : null)), ma = movingAvg(pts, 4).map(v => (v == null ? null : v * 100));
  const bn = baseIdx.reduce((s, i) => s + pts[i].n, 0), bsum = baseIdx.reduce((s, i) => s + pts[i].sum, 0);
  const base = baseIdx.length >= 3 && bn > 0 ? bsum / bn * 100 : null;
  const bs = baseIdx.map(i => raw[i]).filter(x => x != null);
  let band = dk === 'composite' ? parseBand(AD.reports) : null; if (band == null && bs.length >= 2) band = Math.min(21, Math.max(6, 1.7 * sd(bs)));
  return Object.assign(common, { kind: 'pct', raw, ma, base, band: base == null ? null : band, title: (DOMAIN_NAMES[dk] || dk) + ' 정답률(기준 문항)', unitNote: '' });
}
const RANGES = [[12, '12주'], [26, '26주'], [0, '전체']];
SCREENS.aiTrend = screen('흐름 그래프', root => {
  const dk = S.aiDom || 'composite', range = S.aiRange == null ? 26 : S.aiRange;
  root.append(h('div', { class: 'chips', role: 'group', 'aria-label': '영역 고르기' }, TREND_DOMAINS.map(d => h('button', { type: 'button', class: 'chip', id: 'ai-dom-' + d, 'aria-pressed': String(dk === d), 'data-act': 'ai-dom', 'data-v': d, text: DOMAIN_NAMES[d] }))));
  root.append(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '기간' }, RANGES.map(o => h('button', { type: 'button', id: 'ai-range-' + o[0], role: 'radio', 'aria-checked': String(range === o[0]), 'data-act': 'ai-range', 'data-v': String(o[0]), text: o[1] }))));
  const sp = buildTrend(dk, range);
  if (!sp) { root.append(section(null, note(AD.ready.stats ? '아직 숫자가 없어요' : '불러오는 중이에요…'))); return; }
  const lastMa = [...sp.ma].reverse().find(v => v != null);
  const rounded = v => Math.round(v);
  sp.desc = (lastMa != null ? '최근 4주 평균 ' + rounded(lastMa) + (sp.kind === 'pct' ? '%' : sp.unit || '') : '평균을 계산하는 중') + (sp.base != null ? ', 평소 ' + rounded(sp.base) + (sp.kind === 'pct' ? '%' : sp.unit || '') : '') + (sp.band != null && sp.base != null ? ', 평소 범위 ' + rounded(sp.base - sp.band) + ' ~ ' + rounded(sp.base + sp.band) : '');
  const chart = h('div', { class: 'ai-chartbox', id: 'ai-chart' });
  chart.append(trendChart(sp));
  root.append(h('section', { class: 'card outlined' }, h('h2', { class: 't-title-m', text: sp.title }), chart, h('p', { class: 't-body', id: 'ai-chart-sum', text: sp.desc })));
  root.append(h('ul', { class: 'ai-legend', id: 'ai-legend' },
    h('li', null, h('span', { class: 'lg-line ma' }), '굵은 초록 선: 4주 평균'), h('li', null, h('span', { class: 'lg-line base' }), '회색 선: 평소(기준선)'), h('li', null, h('span', { class: 'lg-band' }), '옅은 띠: 평소 범위'),
    h('li', null, h('span', { class: 'lg-dot' }), '점: 그 주의 값'), h('li', null, h('span', { class: 'lg-sym', text: '▲' }), '메모·바뀐 점'), h('li', null, h('span', { class: 'lg-sym anc', text: '◆' }), '같은 문제 다시 푼 주'), h('li', null, h('span', { class: 'lg-zone' }), '평소 실력 재는 기간')));
  if (AD.notes.length) root.append(section('메모', h('ul', { class: 'ai-list' }, AD.notes.slice(0, 6).map(n => h('li', { class: 't-body', text: n.from + (n.to ? ' ~ ' + n.to : ' ~ 계속') + ' · ' + (n.codes || []).map(c => NOTE_NAME[c] || c).join(', ') })))));
});
ACTS['ai-dom'] = b => { S.aiDom = b.dataset.v; render(true); const nb = document.getElementById('ai-dom-' + S.aiDom); if (nb) nb.focus(); };
ACTS['ai-range'] = b => { S.aiRange = Number(b.dataset.v); render(true); const nb = document.getElementById('ai-range-' + S.aiRange); if (nb) nb.focus(); };

/* ---------------- 앵커 나란히 ---------------- */
const VERDICT = { green: '유지', blue: '좋아짐', yellow: '관찰', orange: '주의 신호', gray: '판단 보류' };
const secs = ms => (ms == null ? '' : (Math.round(ms / 100) / 10) + '초');
function cellOf(row) { if (!row) return h('td', { class: 'ac-none', text: '–' }); return h('td', null, h('span', { class: 'ac-ok' + (row.ok ? ' y' : ' n'), text: row.ok ? '✔ 맞음' : '✘ 틀림' }), row.rt ? h('span', { class: 'ac-rt', text: ' ' + secs(row.rt) }) : null, !row.ok && row.err && row.err.length ? h('span', { class: 'ac-err', text: row.err.map(errLabel).join(', ') }) : null); }
SCREENS.aiAnchor = screen('같은 문제 다시 풀기', root => {
  const cmp = ((AD.stats && AD.stats.anchorCmp) || []).slice().sort((a, b) => (a.wk < b.wk ? 1 : -1));
  if (!cmp.length) { root.append(section(null, note(AD.ready.stats ? '아직 비교할 게 없어요' : '불러오는 중이에요…'))); return; }
  const c = cmp.find(x => x.wk === S.aiCmp) || cmp[0];
  if (cmp.length > 1) root.append(h('div', { class: 'chips', role: 'group', 'aria-label': '비교 고르기' }, cmp.map(x => h('button', { type: 'button', class: 'chip', id: 'ai-cmp-' + x.wk, 'aria-pressed': String(x.wk === c.wk), 'data-act': 'ai-cmp', 'data-v': x.wk, text: '세트 ' + x.set + ' · ' + wkLabel(x.wk) }))));
  const vd = c.verdict || (c.up > c.down + 2 ? 'yellow' : 'green');
  root.append(h('section', { class: 'card primary', id: 'ai-anchor-sum' }, h('p', { class: 't-title-m' }, '세트 ' + (c.set || '') + ' · ', pill(vd, VERDICT[vd] || '유지')),
    h('p', { class: 't-body mt', text: '정답: ' + (c.correct1 != null ? c.correct1 : '–') + '개 → ' + (c.correct2 != null ? c.correct2 : '–') + '개' + (c.x1 != null ? ' (문항 ' + c.x1 + (c.x2 != null && c.x2 !== c.x1 ? '/' + c.x2 : '') + '개 중)' : '') }),
    h('p', { class: 't-body', text: '둘 다 맞음 ' + (c.bothOk != null ? c.bothOk : '–') + ' · 틀림→맞음 ' + (c.up != null ? c.up : '–') + ' · 맞음→틀림 ' + (c.down != null ? c.down : '–') + ' · 둘 다 틀림 ' + (c.bothWrong != null ? c.bothWrong : '–') }),
    c.pSign != null ? h('p', { class: 't-small', text: '바뀐 문항 수가 우연으로 설명되는 정도(부호 검정 p) = ' + c.pSign }) : null,
    c.rci != null ? h('p', { class: 't-small', text: '신뢰 변화 지수(RCI) = ' + c.rci + (Math.abs(c.rci) < 1.65 ? ' → 측정 흔들림 안이라 “유지”' : '') }) : null,
    c.spdChange != null ? h('p', { class: 't-small', text: '두 번 다 맞힌 문항의 속도: ' + (c.spdChange > 0 ? c.spdChange + '% 느려짐' : Math.abs(c.spdChange) + '% 빨라짐') }) : null));
  const box = h('div', { id: 'ai-anchor-table' }, note('문항별 표를 불러오는 중이에요…'));
  root.append(h('h2', { class: 't-title', text: '문항별로 나란히' }), box);
  Promise.all([weekDoc(c.prevWk), weekDoc(c.wk)]).then(([a, b]) => {
    if (!box.isConnected) return;
    const A = a.anchorRows || [], B = b.anchorRows || [], ids = Array.from(new Set(A.map(r => r.id).concat(B.map(r => r.id))));
    if (!ids.length) { box.textContent = ''; box.append(note('문항별 기록을 아직 못 받았어요.')); return; }
    const num = {}, rowLabel = r => { num[r.cd] = (num[r.cd] || 0) + 1; return (DOMAIN_NAMES[r.cd] || r.cd) + '-' + String(num[r.cd]).padStart(2, '0'); };
    const tb = h('table', { class: 'ai-table' }, h('caption', { class: 'sr', text: '앵커 문항별 지난번과 이번 비교' }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: '문항' }), h('th', { scope: 'col', text: '지난번 (' + (A[0] && A[0].date ? md(A[0].date) : wkLabel(c.prevWk)) + ')' }), h('th', { scope: 'col', text: '이번 (' + (B[0] && B[0].date ? md(B[0].date) : wkLabel(c.wk)) + ')' }))),
      h('tbody', null, ids.map(id => { const ra = A.find(r => r.id === id), rb = B.find(r => r.id === id); return h('tr', null, h('th', { scope: 'row', text: rowLabel(ra || rb) }), cellOf(ra), cellOf(rb)); })));
    box.textContent = ''; box.append(h('div', { class: 'ai-tablewrap' }, tb));
  });
});
ACTS['ai-cmp'] = b => { S.aiCmp = b.dataset.v; render(true); };

/* ---------------- 메모 ---------------- */
const draftNote = () => S.aiNoteDraft || (S.aiNoteDraft = { from: ymd(new Date()), to: ymd(new Date()), ongoing: false, codes: [], text: '' });
SCREENS.aiNotes = screen('메모 더하기', root => {
  const d = draftNote();
  root.append(h('section', { class: 'card outlined', id: 'ai-note-form' },
    h('div', { class: 'field' }, h('label', { for: 'ai-n-from', text: '언제부터' }), h('input', { class: 'input', type: 'date', id: 'ai-n-from', value: d.from })),
    h('div', { class: 'field mt' }, h('label', { for: 'ai-n-to', text: '언제까지' }), h('input', { class: 'input', type: 'date', id: 'ai-n-to', value: d.to, disabled: d.ongoing ? '' : null })),
    h('button', { type: 'button', class: 'chip mt', id: 'ai-n-ongoing', 'aria-pressed': String(d.ongoing), 'data-act': 'ai-n-ongoing', text: '아직 계속' }),
    h('div', { class: 't-title-m mt', id: 'ai-n-codes-l', text: '어떤 일인가요?' }),
    h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'ai-n-codes-l' }, NOTE_CODES.map(c => h('button', { type: 'button', class: 'chip', id: 'ai-n-c-' + c[0], 'aria-pressed': String(d.codes.includes(c[0])), 'data-act': 'ai-n-code', 'data-v': c[0], text: c[1] }))),
    h('div', { class: 'field mt' }, h('label', { for: 'ai-n-text', text: '자세한 내용 (선택, 200자)' }), h('textarea', { class: 'input', id: 'ai-n-text', rows: '3', maxlength: '200', text: d.text }), h('p', { class: 't-small muted', id: 'ai-n-count', text: d.text.length + '/200' })),
    h('div', { class: 'mt' }, btn('저장', 'filled', 'ai-n-save', 'ai-n-save'))));
  root.append(h('h2', { class: 't-title', text: '남겨 둔 메모' }));
  if (!AD.notes.length) root.append(section(null, note(AD.ready.notes ? '아직 메모가 없어요.' : '불러오는 중이에요…')));
  AD.notes.forEach(n => root.append(h('section', { class: 'card filled ai-note', id: 'ai-note-' + n.id },
    h('p', { class: 't-title-m', text: n.from + (n.to ? ' ~ ' + n.to : ' ~ 아직 계속') }), h('p', { class: 't-body', text: (n.codes || []).map(c => NOTE_NAME[c] || c).join(', ') }),
    n.text ? h('p', { class: 't-body', text: n.text }) : null, btn('지우기', 'text', 'ai-n-del', 'ai-n-del-' + n.id, { 'data-id': n.id }))));
});
ACTS['ai-n-ongoing'] = () => { const d = draftNote(); d.ongoing = !d.ongoing; render(true); const b = document.getElementById('ai-n-ongoing'); if (b) b.focus(); };
ACTS['ai-n-code'] = b => { const d = draftNote(), c = b.dataset.v, i = d.codes.indexOf(c); if (i >= 0) d.codes.splice(i, 1); else d.codes.push(c); render(true); const nb = document.getElementById('ai-n-c-' + c); if (nb) nb.focus(); };
document.addEventListener('input', e => {
  if (S.screen !== 'aiNotes') return; const t = e.target, d = draftNote();
  if (t.id === 'ai-n-from') d.from = t.value; else if (t.id === 'ai-n-to') d.to = t.value;
  else if (t.id === 'ai-n-text') { d.text = t.value.slice(0, 200); const c = document.getElementById('ai-n-count'); if (c) c.textContent = d.text.length + '/200'; }
});
ACTS['ai-n-save'] = async () => {
  const r = noteDoc(draftNote(), by(), Date.now());
  if (r.error) return toast(r.error);
  try { await Store.setDoc(tpath(AD.mid, 'aiNotes/' + noteId()), r.doc); S.aiNoteDraft = null; render(true); } catch (e) { toast('저장하지 못했어요. 관리자만 쓸 수 있어요.'); }
};
ACTS['ai-n-del'] = b => dialog('이 메모를 지울까요?', '지우면 리포트가 이 기간을 더 이상 함께 보지 않아요.', [{ label: '남겨 둘게요', kind: 'filled' }, { label: '지우기', kind: 'text', run: async () => { try { await Store.deleteDoc(tpath(AD.mid, 'aiNotes/' + b.dataset.id)); } catch (e) { toast('지우지 못했어요.'); } } }]);

/* ---------------- 문제 은행 ---------------- */
const WHY_NAMES = { reminiscence: '옛날 이야기', same_wrong_pick: '모호 의심 (같은 오답을 두 번 골랐어요)', slow_wrong: '모호 의심 (틀리고 아주 오래 걸렸어요)', admin_flag: '모호 의심 (신고)', quarantine: '모호 의심' };
const gh = (id, d) => (AD.decisions.find(x => x.id === id) || null);
function reviewCard(it) {
  const done = gh(it.id), key = 'airv-' + it.id, ch = it.choices || [];
  const body = h('div', { class: 'ai-detail' },
    h('p', { class: 't-body', text: it.prompt || (it.body && (it.body.sentence || it.body.desc || it.body.text)) || '' }),
    h('ol', { class: 'ai-choices' }, ch.map(c => h('li', { class: c.ok ? 'ok' : '', text: c.t + (c.ok ? ' ← 정답' : (c.err ? ' (' + errLabel(c.err) + ')' : '')) }))),
    it.body && it.body.talk ? h('p', { class: 't-small', text: '이야기: ' + it.body.talk }) : null,
    it.basis ? h('p', { class: 't-small', text: '확신 이유: ' + it.basis }) : null, it.risk ? h('p', { class: 't-small', text: '헷갈릴 수 있는 이유: ' + it.risk }) : null,
    it.nExp ? h('p', { class: 't-small', text: '지금까지 ' + it.nExp + '번 나왔어요.' }) : null,
    done ? h('p', { class: 'chip-status done', text: '보냈어요: ' + ({ approve: '내보내기', retire: '은퇴', flag: '이상해요' }[done.decision] || done.decision) }) : h('div', { class: 'row' },
      btn('내보내기', 'filled', 'ai-rv', 'ai-rv-approve-' + it.id, { 'data-id': it.id, 'data-d': 'approve' }), btn('은퇴', 'tonal', 'ai-rv', 'ai-rv-retire-' + it.id, { 'data-id': it.id, 'data-d': 'retire' }), btn('이 문제 이상해요', 'outlined', 'ai-rv', 'ai-rv-flag-' + it.id, { 'data-id': it.id, 'data-d': 'flag' })));
  return h('details', { class: 'airow', id: 'ai-rv-' + it.id, 'data-xp': key, open: S.xpOpen[key] ? '' : null },
    h('summary', null, h('span', { class: 'ai-sum' }, h('span', { class: 'ai-sum-top' }, h('strong', { text: FORMAT_NAMES[it.format] || it.format }), (WHY_NAMES[it.why] || '검토') === (FORMAT_NAMES[it.format] || it.format) ? null : h('span', { class: 'ai-brief', text: WHY_NAMES[it.why] || '검토' })), h('span', { class: 'ai-line', text: (it.prompt || '').slice(0, 60) })), h('span', { class: 'ai-more' }, '보기', svgIcon('expand'))), body);
}
SCREENS.aiBank = screen('문제 은행', root => {
  const bk = AD.bank, cells = (bk && bk.cells) || {};
  const gen = (AD.famHealth && AD.famHealth.gen) || (AD.health && AD.health.gen);
  root.append(h('p', { class: 't-body', id: 'ai-bank-last', text: '마지막 생성 ' + (gen && gen.lastSubmitTs ? when(msOf(gen.lastSubmitTs)) + (gen.lastRejected != null && gen.lastAccepted != null ? ' (받은 ' + (gen.lastAccepted + gen.lastRejected) + '개 중 ' + gen.lastAccepted + '개 통과)' : '') : '기록 없음') }));
  const tb = h('table', { class: 'ai-table bank', id: 'ai-bank-table' }, h('caption', { class: 'sr', text: '아직 안 쓴 훈련 문항 개수 (목표: 칸마다 20개)' }),
    h('thead', null, h('tr', null, h('th', { scope: 'col', text: '영역' }), [1, 2, 3, 4, 5].map(l => h('th', { scope: 'col', 'aria-label': l + '단계', text: String(l) })))),
    h('tbody', null, BANK_ROWS.map(r => h('tr', null, h('th', { scope: 'row', text: r[1] }), [1, 2, 3, 4, 5].map(l => { const n = cells[r[0] + '|' + l]; return h('td', { class: n != null && n < 20 ? 'low' : '' }, n == null ? '–' : String(n) + (n < 20 ? ' ⚠' : '')); }))),
      h('tr', null, h('th', { scope: 'row', text: '날짜' }), h('td', { colSpan: '5', text: totalOrient(cells) }))));
  root.append(section('아직 안 쓴 훈련 문항 (목표: 칸마다 20개)', h('div', { class: 'ai-tablewrap' }, tb), bk ? null : note(AD.ready.bank ? '아직 문제 은행 기록이 없어요.' : '불러오는 중이에요…')));
  if (bk) {
    const an = bk.anchors || {}, rw = bk.reservedWeeks || [];
    root.append(section('기준 문항과 앵커', note('기준 세트: ' + (rw.length ? rw.map(wkLabel).join(', ') + ' 준비됨' : '준비된 주가 없어요'), 't-body'), note('앵커: ' + ['A', 'B', 'C'].map(k => k + (an[k] ? ' 얼림 ✓' : ' 아직')).join(' · '), 't-body')));
    const ik = bk.intake || [], last7 = ik.slice(-7), rec = last7.reduce((s, x) => s + (x.received || 0), 0), acc = last7.reduce((s, x) => s + (x.accepted || 0), 0), rej = last7.reduce((s, x) => s + (x.rejected || 0), 0);
    const codes = {}; last7.forEach(x => Object.keys(x.codes || {}).forEach(c => { const l = rejectLabel(c); codes[l] = (codes[l] || 0) + x.codes[c]; }));
    const top = Object.keys(codes).sort((a, b) => codes[b] - codes[a]).slice(0, 5);
    root.append(section('최근 7일', note(rec ? '받음 ' + rec + ' · 통과 ' + acc + ' (' + Math.round(acc / rec * 100) + '%) · 버림 ' + rej : '아직 받은 문항이 없어요.', 't-body'), top.length ? note('버린 이유 상위: ' + top.map(l => l + ' ' + codes[l]).join(' · '), 't-body') : null));
  }
  const items = parseItems(AD.review), groups = { reminiscence: [], other: [] };
  items.forEach(it => (it.why === 'reminiscence' ? groups.reminiscence : groups.other).push(it));
  const q = section('검토 기다림');
  q.id = 'ai-review';
  if (!items.length) q.append(note(AD.ready.review ? '검토를 기다리는 문항이 없어요.' : '불러오는 중이에요…'));
  if (groups.reminiscence.length) q.append(h('h3', { class: 't-title-m', text: '옛날 이야기 ' + groups.reminiscence.length + '개' }), h('div', { class: 'ai-rows' }, groups.reminiscence.map(reviewCard)));
  if (groups.other.length) q.append(h('h3', { class: 't-title-m', text: '모호 의심 ' + groups.other.length + '개' }), h('div', { class: 'ai-rows' }, groups.other.map(reviewCard)));
  root.append(q);
}, true);
const totalOrient = cells => { let n = 0, any = false; for (let l = 1; l <= 5; l++) { const v = cells['orientation|' + l]; if (v != null) { n += v; any = true; } } return any ? n + ' (앞으로 몇 주 분)' : '–'; };
ACTS['ai-rv'] = b => {
  const id = b.dataset.id, dec = b.dataset.d, name = { approve: '내보내기', retire: '은퇴', flag: '이 문제 이상해요' }[dec];
  const text = { approve: '이 문제가 훈련하는 분께 나가요. 내용이 사실과 맞는지 확인하셨나요?', retire: '이 문제를 더 이상 쓰지 않아요.', flag: '이 문제를 잠시 빼고 다시 살펴봐요. 이미 같은 문제를 다시 풀었던 앵커 문항이면 비교에서 빠져요.' }[dec];
  dialog(name + '을 보낼까요?', text, [{ label: '취소', kind: 'text' }, { label: name, kind: 'filled', run: async () => {
    try { await Store.setDoc('aiReview/' + id, reviewDoc(dec, by(), Date.now())); } catch (e) { toast('보내지 못했어요. 관리자만 쓸 수 있어요.'); }
  } }]);
};

/* ---------------- 루틴 상태 ---------------- */
const ago = ms => { if (!ms) return '기록 없음'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전'; };
const statusRow = (id, name, ok, ...lines) => h('li', { class: 'ai-st', id }, h('span', { class: 'ai-st-n' }, h('strong', { text: name }), ok == null ? null : h('span', { class: 'st-mark ' + (ok ? 'ok' : 'warn'), text: ok ? '✓' : '⚠' })), lines.filter(Boolean).map(t => h('span', { class: 'ai-line', text: t })));
SCREENS.aiOps = screen('루틴 상태', root => {
  const hl = AD.health || {}, g = (AD.famHealth && AD.famHealth.gen) || hl.gen || {}, rp = hl.rep || {}, fh = AD.famHealth || {}, sv = hl.server || fh.server || {}, tg = hl.tg || fh.tg || {}, wk = AD.wakes || {};
  if (!AD.health) root.append(section(null, note(AD.ready.health ? '아직 루틴 기록이 없어요.' : '불러오는 중이에요…')));
  const ok7 = (g.okDays || []).filter(d => d >= addDays(ymd(new Date()), -6)).length;
  const today = ymd(new Date()), mo = today.slice(0, 7), days = (wk.days || {}), moN = Object.keys(days).filter(d => d.slice(0, 7) === mo).reduce((s, d) => s + days[d], 0);
  const tid = AD.mid, cons = AD.consents.find(c => c.id === tid) || null;   // 고른 훈련하는 분의 안내 기록
  root.append(h('ul', { class: 'ai-sts', id: 'ai-ops-list' },
    statusRow('ai-st-gen', '① 문제 만들기', g.lastSubmitTs ? msOf(g.lastSubmitTs) > Date.now() - 36 * 3600e3 : null, '마지막 올림 ' + when(msOf(g.lastSubmitTs)) + ' (' + ago(msOf(g.lastSubmitTs)) + ')', g.lastAccepted != null ? '받은 문항 중 ' + g.lastAccepted + '개 통과, ' + (g.lastRejected || 0) + '개 버림' : null, '최근 7일 성공 ' + ok7 + '/7'),
    statusRow('ai-st-rep', '② 리포트', rp.lastReportTs ? msOf(rp.lastReportTs) > Date.now() - 36 * 3600e3 : null, '마지막 ' + when(msOf(rp.lastReportTs)) + ' (' + ago(msOf(rp.lastReportTs)) + ')', rp.lastGeneratedBy === 'template' ? '간단판 (AI 설명이 빠졌어요)' : rp.lastGeneratedBy ? 'AI 설명 포함' : null),
    statusRow('ai-st-wake', '즉시 깨우기', null, '이번 달 ' + moN + '번 · 오늘 ' + (days[today] || 0) + '/2'),
    statusRow('ai-st-server', '서버', sv.lastTick ? msOf(sv.lastTick) > Date.now() - 3 * 3600e3 : null, '마지막 확인 ' + ago(msOf(sv.lastTick || sv.lastRun)), sv.reason ? '상태: ' + sv.reason : null),
    statusRow('ai-st-tg', '텔레그램 알림', tg.lastResult ? tg.lastResult === 'sent' : null, tg.lastResult ? ({ sent: '보냈어요', failed: '보내지 못했어요', queued: '조용한 시간이라 기다리고 있어요' }[tg.lastResult] || tg.lastResult) + ' · ' + ago(msOf(tg.lastTs)) : '기록 없음'),
    statusRow('ai-st-th', '신호 문턱 버전', null, hl.thresholdsVer || (AD.thresholds && AD.thresholds.current && AD.thresholds.current.ver) || 'v1'),
    statusRow('ai-st-cons', traineeLabel(tid) + ' 안내 확인', cons ? !('withdrawnTs' in cons) : false, cons ? ('withdrawnTs' in cons ? '살펴보지 말아 달라고 하셨어요' : when(msOf(cons.ackTs)) + '에 확인하셨어요' + (cons.withFamily ? ' (가족과 함께)' : '')) : '아직 안내를 보지 않으셨어요')));
  root.append(switchSection());
});

/* ---------------- 설정: AI 기록 관찰 켜기, 관심사 낱말, AI 끄기 ---------------- */
/* 훈련하는 분 화면에는 안내 화면이 없어요. 관리자가 이 스위치를 켜면 consents/{훈련하는 분} 을 관리자가 대신 기록해요 (ai/consent.js). */
function observeSection() {
  const on = observationState(AD.consents, AD.mid) === 'ok';
  return h('section', { class: 'card outlined', id: 'ai-obs-sec' }, h('div', { class: 'switch-row' },
    h('div', { class: 't-title-m', id: 'ai-obs-label', text: 'AI 기록 관찰 켜기' }),
    h('button', { class: 'switch', id: 'ai-obs', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-labelledby': 'ai-obs-label', 'data-act': 'ai-obs' })));
}
ACTS['ai-obs'] = async b => {
  const want = b.getAttribute('aria-checked') !== 'true'; b.disabled = true;
  if (!(await setObservation(want, AD.mid))) toast('바꾸지 못했어요');
  render(true);
};
function switchSection() {
  const on = !AD.sw || AD.sw.enabled !== false;
  return h('section', { class: 'card outlined', id: 'ai-switch-sec' }, h('h2', { class: 't-title', text: 'AI 리포트 켜기·끄기' }),
    h('p', { class: 't-body', id: 'ai-switch-state', text: on ? '켜져 있어요.' : '꺼져 있어요.' }),
    btn(on ? 'AI 리포트 끄기' : 'AI 리포트 다시 켜기', on ? 'outlined' : 'filled', 'ai-switch', 'btn-ai-switch'));
}
const setSwitch = async enabled => { try { await Store.setDoc('aiState/switch', switchDoc(enabled, by(), Date.now())); } catch (e) { toast('바꾸지 못했어요. 관리자만 쓸 수 있어요.'); } };
ACTS['ai-switch'] = () => {
  const on = !AD.sw || AD.sw.enabled !== false;
  if (!on) return setSwitch(true);
  dialog('AI 리포트를 끌까요?', '끄면 집계와 깨우기가 멈추고, 지금까지 모은 가명 집계를 지워요. 훈련 기록은 그대로예요. 다시 켤 수 있어요.', [{ label: '그대로 둘게요', kind: 'filled' }, { label: '끄기', kind: 'text', run: () => setSwitch(false) }]);
};
const HANGUL = /^[가-힣]{1,10}$/;
const draftThemes = () => (S.aiThemeDraft && S.aiThemeDraft.mid === AD.mid ? S.aiThemeDraft : (S.aiThemeDraft = { mid: AD.mid, words: ((AD.themes && AD.themes.words) || []).slice(), base: JSON.stringify((AD.themes && AD.themes.words) || []), input: '' }));
SCREENS.aiSettings = screen('AI 리포트 설정', root => {
  const d = draftThemes();
  root.append(observeSection());
  root.append(h('section', { class: 'card outlined', id: 'ai-themes' }, h('h2', { class: 't-title', text: '관심사 낱말' }),
    h('div', { class: 'chips mt', id: 'ai-theme-chips', 'aria-label': '적어 둔 낱말' }, d.words.length ? d.words.map((w, i) => h('span', { class: 'chip show tchip' }, h('span', { text: w }), h('button', { type: 'button', class: 'tx', id: 'ai-theme-x-' + i, 'data-act': 'ai-theme-x', 'data-i': String(i), 'aria-label': w + ' 지우기', text: '×' }))) : [h('span', { class: 't-body muted', text: '아직 없어요.' })]),
    h('p', { class: 't-small muted', id: 'ai-theme-count', text: d.words.length + '/8' }),
    h('div', { class: 'field mt' }, h('label', { for: 'ai-theme-in', text: '낱말 더하기 (한글만, 10글자까지)' }), h('input', { class: 'input', id: 'ai-theme-in', type: 'text', maxlength: '10', value: d.input, autocomplete: 'off' })),
    h('div', { class: 'row mt' }, btn('더하기', 'tonal', 'ai-theme-add', 'ai-theme-add'), btn('저장', 'filled', 'ai-theme-save', 'ai-theme-save'))));
  root.append(switchSection());
});
document.addEventListener('input', e => { if (S.screen === 'aiSettings' && e.target.id === 'ai-theme-in') draftThemes().input = e.target.value; });
ACTS['ai-theme-add'] = () => {
  const d = draftThemes(), w = String(d.input || '').trim();
  if (!HANGUL.test(w)) return toast('한글 낱말을 10글자까지 적어 주세요.');
  if (d.words.includes(w)) return toast('이미 있는 낱말이에요.');
  if (d.words.length >= 8) return toast('낱말은 8개까지예요.');
  d.words.push(w); d.input = ''; render(true); const i = document.getElementById('ai-theme-in'); if (i) i.focus();
};
ACTS['ai-theme-x'] = b => { const d = draftThemes(); d.words.splice(Number(b.dataset.i), 1); render(true); };
ACTS['ai-theme-save'] = async () => {
  const d = draftThemes();
  try { await Store.setDoc(tpath(AD.mid, 'aiState/themes'), themesDoc(d.words, by(), Date.now())); S.aiThemeDraft = null; render(true); } catch (e) { toast('저장하지 못했어요. 관리자만 쓸 수 있어요.'); }
};
void weekKey;
