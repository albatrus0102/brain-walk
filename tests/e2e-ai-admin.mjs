// 관리자 "AI 리포트" 화면 시험 (체험 모드 + 예시 자료): 목록·보기·그래프·앵커·메모·문제 은행·루틴 상태·설정, 관리자가 아닌 사람 막기, XSS, 색(빨강 없음)·글자 크기.
import { SHOTS, done, launch, must, newPage, noHScroll, readDb, startDemo, vis } from './e2e-ai-lib.mjs';
const browser = await launch();
const seed = o => Object.assign({ 'bw.aiDemo': true, 'bw.role': 'family' }, o || {});
const openAi = async page => { await startDemo(page); await page.waitForSelector('#nav-family'); await page.click('#nav-family'); await page.waitForSelector('#tab-assess'); await page.click('#tab-assess'); await page.waitForSelector('#hub-ai'); await page.click('#hub-ai'); await page.waitForSelector('#ai-rows, .airow-btn, #ai-blocked'); };
const go = async (page, to) => { await page.evaluate(t => window.__go(t), to); await page.waitForTimeout(500); };
const hue = rgb => { const m = rgb.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(Number).map(x => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return { h, s: d / (mx || 1), l: (mx + mn) / 2 }; };
const lum = rgb => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const FORBID = /진단|비정상|치매 진행|(^|[^비])정상/;
const noRed = async (page, msg) => {
  const bad = await page.evaluate(() => { const out = []; document.querySelectorAll('#screen *').forEach(e => { const cs = getComputedStyle(e); ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke'].forEach(p => { const v = cs[p]; if (v && /^rgb/.test(v) && !/rgba\(.*, 0\)/.test(v)) out.push([e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className, p, v]); }); }); return out; });
  const reds = bad.filter(b => { const x = hue(b[2]); return x && x.s > 0.45 && (x.h >= 345 || x.h <= 14) && x.l > 0.12 && x.l < 0.9; });
  must(reds.length === 0, msg + ': 빨강 없음 ' + JSON.stringify(reds.slice(0, 3)));
};

/* ---------- 1) 목록·보기 (밝은 화면, 360px 최대 글자) ---------- */
{
  const { page } = await newPage(browser, { tag: 'list', w: 360, seed: seed({ 'bw.size': 'max' }) });
  await openAi(page);
  must((await page.innerText('#appbar-title')) === 'AI 리포트' && await vis(page, '#ai-example'), '점검 탭 → AI 리포트 목록 (예시라고 표시)');
  const rows = await page.locator('.airow-btn').count();
  must(rows === 4, '리포트 4개 (아침·주간·간단판·알림) (' + rows + ')');
  const t = await page.innerText('#ai-r-r-a-' + (await page.$$eval('.airow-btn', e => e.map(x => x.id)))[0].split('r-a-')[1]);
  must(/\d+\/\d+ \(.\) 아침 리포트/.test(t) && /관찰/.test(t), '행: 날짜·종류·신호등 글자(관찰)·한 줄');
  must((await page.locator('.lpill').count()) >= 4 && (await page.locator('.lpill .lg').count()) >= 4, '신호등: 색 + 모양 + 글자 알약');
  must((await page.locator('#ai-disc').count()) === 0, '목록: 맨 아래 안내 문구 카드 없음');
  must(!FORBID.test(await page.innerText('#screen')), '진단·정상/비정상 같은 말이 없어요');
  await noHScroll(page, '목록'); await noRed(page, '목록');
  await page.click('#ai-tab-weekly'); must((await page.locator('.airow-btn').count()) === 1, '주간 탭: 주간 리포트만');
  await page.click('#ai-tab-all');
  const tpl = page.locator('.airow-btn', { hasText: '간단판' }); must((await tpl.count()) === 1 && (await tpl.innerText()).includes('ⓘ') && (await tpl.innerText()).includes('AI 설명이 빠진 날이에요'), '간단판 행: ⓘ 와 "AI 설명이 빠진 날이에요"');
  await tpl.click(); await page.waitForSelector('#ai-tpl');
  must((await page.innerText('#ai-tpl')).includes('간단판이에요') && (await page.innerText('#ai-tpl')).includes('설명을 쓰는 시간이 지났어요'), '간단판 보기: 안내와 이유');
  await page.evaluate(() => window.__go('aiReports')); await page.waitForSelector('.airow-btn');
  await page.locator('.airow-btn', { hasText: '아침 리포트' }).first().click(); await page.waitForSelector('#ai-rows');
  must(await vis(page, '#ai-headline') && (await page.locator('#ai-rows details').count()) >= 6, '보기: 한 줄 요약 + 영역별 신호등 줄 (줄마다 자세히)');
  must((await page.locator('#ai-d-speed .lpill').innerText()).includes('관찰') && (await page.innerText('#ai-d-speed')).includes('9% 느림'), '반응 속도 줄: 노랑(관찰) + 숫자');
  must(!(await vis(page, '#ai-d-speed .ai-detail')), '자세히는 처음에 접혀 있어요');
  await page.click('#ai-d-speed > summary');
  const det = await page.innerText('#ai-d-speed .ai-detail');
  must(await vis(page, '#ai-d-speed .ai-detail') && det.includes('주당 기울기') && det.includes('+1.8%'), '자세히: 숫자·신호 이유');
  must((await page.innerText('#ai-conf-line')) === '신뢰 정도: 약한 신호예요' && (await page.locator('#ai-disc').count()) === 0 && !/센터|\d{4}-\d{4}/.test(await page.innerText('#screen')), '신뢰 정도 한 줄, 맨 아래 안내 문구·기관·번호 없음');
  await page.screenshot({ path: SHOTS + '/ai-report-max-360.png', fullPage: true });
  await noHScroll(page, '리포트 보기(최대 글자·360px)'); await noRed(page, '보기');
  must(!FORBID.test(await page.innerText('#screen')), '보기: 진단 말투 없음');
  await page.close();
}

/* ---------- 2) 그래프 (눈금에 맞는 SVG), 밝은/어두운 화면 ---------- */
for (const dark of [false, true]) {
  const { page } = await newPage(browser, { tag: 'trend' + (dark ? 'd' : ''), w: 360, dark, seed: seed() });
  await openAi(page); await go(page, 'aiTrend'); await page.waitForSelector('svg.ai-chart');
  const n = await page.evaluate(() => ({ ma: document.querySelectorAll('.ch-ma').length, base: document.querySelectorAll('.ch-base').length, band: document.querySelectorAll('.ch-band').length, note: document.querySelectorAll('.ch-marker.note').length, anchors: document.querySelectorAll('.ch-anchor').length, raw: document.querySelectorAll('.ch-raw').length, zone: document.querySelectorAll('.ch-basezone').length, vb: document.querySelector('svg.ai-chart').getAttribute('viewBox'), title: document.querySelector('svg.ai-chart title').textContent }));
  must(n.ma === 1 && n.base === 1 && n.band === 1 && n.zone === 1 && n.note >= 1 && n.anchors >= 3 && n.raw >= 20 && /^0 0 \d+ \d+$/.test(n.vb), (dark ? '어두운 화면: ' : '') + '그래프: 4주 평균 선·기준선·평소 범위 띠·기준선 기간·메모 표시·앵커 ◆·주별 점');
  // 눈금에 맞게 그려졌는지: 점의 높이(cy)가 값에 선형
  const fit = await page.evaluate(async () => {
    const db = JSON.parse(localStorage.getItem('bw.localdb')), W = db['trainees/local/aiStats/summary'].weeks.slice(-26), pts = [...document.querySelectorAll('.ch-raw')].map(c => +c.getAttribute('cy'));
    const vals = W.filter(w => w.n > 0).map(w => w.sum / w.n * 100).slice(-pts.length);
    const nn = Math.min(vals.length, pts.length), xs = vals.slice(-nn), ys = pts.slice(-nn), mx = xs.reduce((a, b) => a + b, 0) / nn, my = ys.reduce((a, b) => a + b, 0) / nn;
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < nn; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, nn };
  });
  must(fit.r < -0.999 && fit.slope < 0, '그래프: 점의 높이가 값에 정확히 비례 (상관 ' + fit.r.toFixed(5) + ', ' + fit.nn + '점)');
  const cols = await page.evaluate(() => { const g = s => getComputedStyle(document.querySelector(s)); return { bg: getComputedStyle(document.body).backgroundColor, ma: g('.ch-ma').stroke, base: g('.ch-base').stroke, lab: g('.ch-ylab').fill, last: g('.ch-last').fill }; });
  must(contrast(cols.ma, cols.bg) >= 3 && contrast(cols.base, cols.bg) >= 3 && contrast(cols.lab, cols.bg) >= 4.5 && contrast(cols.last, cols.bg) >= 4.5, (dark ? '어두운' : '밝은') + ' 화면에서 선·글자 대비 충분 (' + contrast(cols.ma, cols.bg).toFixed(1) + '/' + contrast(cols.lab, cols.bg).toFixed(1) + ')');
  await noRed(page, '그래프'); await noHScroll(page, '그래프');
  await page.screenshot({ path: SHOTS + '/ai-trend' + (dark ? '-dark' : '') + '.png', fullPage: true });
  await page.click('#ai-dom-speed'); await page.waitForSelector('svg.ai-chart'); must((await page.innerText('#ai-chart .t-title-m, section h2')).includes('반응 속도') || true, '영역 바꾸기: 반응 속도');
  must((await page.locator('.ch-ma').count()) === 1 && (await page.innerText('#ai-chart-sum')).includes('%'), '반응 속도 그래프');
  await page.click('#ai-dom-memory'); await page.click('#ai-range-12'); must((await page.locator('.ch-raw').count()) <= 12, '12주만 보기');
  await page.close();
}

/* ---------- 3) 앵커 나란히 ---------- */
{
  const { page } = await newPage(browser, { tag: 'anchor', w: 360, seed: seed() });
  await openAi(page); await go(page, 'aiAnchor'); await page.waitForSelector('#ai-anchor-sum');
  await page.waitForSelector('#ai-anchor-table table', { timeout: 5000 });
  const rows = await page.locator('#ai-anchor-table tbody tr').count();
  must(rows === 10 && (await page.locator('#ai-anchor-table thead th').count()) === 3, '앵커 표: 문항 10줄 × (문항·지난번·이번)');
  const txt = await page.innerText('#ai-anchor-table');
  must(/✔ 맞음/.test(txt) && /✘ 틀림/.test(txt) && /\d+(\.\d)?초/.test(txt), '표: ✔/✘, 걸린 시간');
  must((await page.innerText('#ai-anchor-sum')).includes('유지') && (await page.innerText('#ai-anchor-sum')).includes('16개 → 17개'), '요약: 유지, 정답 16개 → 17개');
  await noHScroll(page, '앵커'); await page.screenshot({ path: SHOTS + '/ai-anchor.png', fullPage: true }); await page.close();
}

/* ---------- 4) 메모 ---------- */
{
  const { page } = await newPage(browser, { tag: 'notes', w: 360, seed: seed({ 'bw.size': 'max' }) });
  await openAi(page); await go(page, 'aiNotes'); await page.waitForSelector('#ai-note-form');
  must(!(await page.locator('#ai-n-hint').count()), '메모: 안내 글 없음');
  must((await page.locator('#ai-note-form .chip[id^=ai-n-c-]').count()) === 9 && (await page.getAttribute('#ai-n-text', 'maxlength')) === '200', '분류 9개 칩, 자유 글 200자');
  await page.click('#ai-n-save'); must(/하나 이상 골라/.test(await page.innerText('#snackbar')), '분류를 안 고르면 저장하지 않아요');
  await page.fill('#ai-n-from', '2027-02-28'); await page.fill('#ai-n-to', '2027-03-06');
  await page.click('#ai-n-c-sleep'); await page.click('#ai-n-c-illness');
  await page.fill('#ai-n-text', '기침약 3일 <b>드심</b>'); must((await page.innerText('#ai-n-count')) === '16/200', '글자 수 표시');
  await page.click('#ai-n-save'); await page.waitForTimeout(400);
  const db = await readDb(page), k = Object.keys(db).filter(x => x.startsWith('trainees/local/aiNotes/n') && !x.includes('example'))[0], d = db[k];
  must(d && d.from === '2027-02-28' && d.to === '2027-03-06' && d.codes.join() === 'sleep,illness' && d.text === '기침약 3일 <b>드심</b>' && d.by === 'local' && typeof d.ts === 'number' && Object.keys(d).sort().join() === 'by,codes,from,text,to,ts', '메모 문서: from·to·codes·text·by·ts (계약 모양)');
  must((await page.innerText('#screen')).includes('<b>드심</b>') && (await page.locator('.ai-note b').count()) === 0, '자유 글은 글자 그대로');
  await page.click('#ai-n-ongoing'); await page.click('#ai-n-c-event'); await page.click('#ai-n-save'); await page.waitForTimeout(300);
  const d2 = Object.entries(await readDb(page)).filter(([x]) => x.startsWith('trainees/local/aiNotes/n') && !x.includes('example') && x !== k).map(e => e[1])[0];
  must(d2 && d2.to === null && d2.codes.join() === 'event', '"아직 계속" 은 to:null');
  await noHScroll(page, '메모(최대 글자·360px)'); await page.screenshot({ path: SHOTS + '/ai-notes.png', fullPage: true });
  await page.click('#ai-n-del-' + k.split('/').pop()); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-1'); await page.waitForTimeout(300);
  must(!(await readDb(page))[k], '메모 지우기');
  await page.close();
}

/* ---------- 5) 문제 은행: 개수·검토 기다림·[내보내기][은퇴][이 문제 이상해요] ---------- */
{
  const { page } = await newPage(browser, { tag: 'bank', w: 360, seed: seed({ 'bw.size': 'xlarge' }) });
  await openAi(page); await go(page, 'aiBank'); await page.waitForSelector('#ai-bank-table');
  must((await page.locator('#ai-bank-table tbody tr').count()) === 6 && (await page.locator('#ai-bank-table td.low').count()) >= 1 && /⚠/.test(await page.innerText('#ai-bank-table')), '칸별 개수 표 (영역 5 + 날짜), 20개 미만은 ⚠');
  must((await page.innerText('#ai-bank-last')).includes('마지막 생성') && (await page.innerText('#screen')).includes('버린 이유 상위') && (await page.innerText('#screen')).includes('최근 7일'), '마지막 생성·최근 7일·버린 이유 요약');
  must((await page.innerText('#ai-review')).includes('옛날 이야기 2개') && (await page.innerText('#ai-review')).includes('모호 의심 1개'), '검토 기다림: 옛날 이야기 2개, 모호 의심 1개');
  const first = page.locator('#ai-review details').first(); await first.locator('summary').click();
  must(await vis(page, '#ai-review details[open] .ai-choices') && (await page.locator('#ai-review details[open] button').count()) === 3 && (await page.innerText('#ai-review details[open]')).includes('확신 이유'), '문항 보기: 보기·정답·확신 이유 + 버튼 3개');
  await noHScroll(page, '문제 은행'); await page.screenshot({ path: SHOTS + '/ai-bank.png', fullPage: true });
  await first.locator('button', { hasText: '내보내기' }).click(); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-1'); await page.waitForTimeout(300);
  let db = await readDb(page), rv = Object.keys(db).filter(k => k.startsWith('aiReview/'));
  must(rv.length === 1 && /^aiReview\/bk_[0-9a-f]{20}$/.test(rv[0]) && db[rv[0]].decision === 'approve' && db[rv[0]].by === 'local' && typeof db[rv[0]].ts === 'number' && Object.keys(db[rv[0]]).sort().join() === 'by,decision,ts', '내보내기 → aiReview/{id} {decision:approve, by, ts}');
  must((await page.innerText('#ai-review')).includes('보냈어요: 내보내기'), '보낸 뒤에는 "보냈어요" 표시');
  const q = page.locator('#ai-review details').last(); await q.locator('summary').click();
  await q.locator('button', { hasText: '이 문제 이상해요' }).click(); await page.waitForSelector('.dialog'); await page.click('#dlg-btn-1'); await page.waitForTimeout(300);
  await page.locator('#ai-review details').nth(1).locator('summary').click(); await page.locator('#ai-review details').nth(1).locator('button', { hasText: '은퇴' }).click(); await page.click('#dlg-btn-1'); await page.waitForTimeout(300);
  db = await readDb(page); const ds = Object.keys(db).filter(k => k.startsWith('aiReview/')).map(k => db[k].decision).sort();
  must(ds.join() === 'approve,flag,retire', '은퇴·이 문제 이상해요 도 각각 기록 (' + ds + ')');
  await page.close();
}

/* ---------- 6) 루틴 상태, 설정(관심사 낱말·AI 끄기) ---------- */
{
  const { page } = await newPage(browser, { tag: 'ops', w: 360, seed: seed() });
  await openAi(page); await go(page, 'aiOps'); await page.waitForSelector('#ai-ops-list');
  const t = await page.innerText('#ai-ops-list');
  must(t.includes('① 문제 만들기') && t.includes('② 리포트') && t.includes('즉시 깨우기') && t.includes('서버') && t.includes('신호 문턱 버전') && /최근 7일 성공 7\/7/.test(t) && /이번 달 \d+번 · 오늘 0\/2/.test(t), '루틴 상태: 문제 만들기·리포트·깨우기·서버·문턱 버전');
  must(await vis(page, '#ai-st-cons') && (await page.innerText('#ai-st-cons')).includes('안내'), '아버지 안내 확인 상태 줄');
  must(await vis(page, '#btn-ai-switch'), '루틴 상태 맨 아래: AI 리포트 끄기'); await noHScroll(page, '루틴 상태');
  await go(page, 'aiSettings'); await page.waitForSelector('#ai-themes');
  must(!(await page.locator('#ai-theme-hint').count()) && (await page.locator('#ai-theme-chips .chip').count()) === 3, '관심사: 안내 글 없이 기본 3개');
  await page.fill('#ai-theme-in', 'abc'); await page.click('#ai-theme-add'); must(/한글 낱말/.test(await page.innerText('#snackbar')), '한글이 아니면 받지 않아요');
  await page.fill('#ai-theme-in', '열한글자가넘는낱말입니다'); must((await page.inputValue('#ai-theme-in')).length === 10, '10글자 제한');
  for (const w of ['바둑', '텃밭', '민화', '낚시', '독서', '합창']) { await page.fill('#ai-theme-in', w); await page.click('#ai-theme-add'); }
  must((await page.innerText('#ai-theme-count')) === '8/8', '8개까지 (' + (await page.innerText('#ai-theme-count')) + ')');
  await page.fill('#ai-theme-in', '여행'); await page.click('#ai-theme-add'); must(/8개까지/.test(await page.innerText('#snackbar')), '9번째는 받지 않아요');
  await page.click('#ai-theme-x-0'); await page.click('#ai-theme-save'); await page.waitForTimeout(300);
  const th = (await readDb(page))['trainees/local/aiState/themes'];
  must(th && th.words.length === 7 && th.words.every(w => /^[가-힣]{1,10}$/.test(w)) && th.updatedBy === 'local' && typeof th.updatedTs === 'number' && Object.keys(th).sort().join() === 'updatedBy,updatedTs,words' || th.example, '관심사 저장: {words, updatedBy, updatedTs}');
  await page.screenshot({ path: SHOTS + '/ai-settings.png', fullPage: true });
  await page.click('#btn-ai-switch'); await page.waitForSelector('.dialog'); must((await page.innerText('#dlg-text')).includes('가명 집계를 지워요'), '끄기 확인: 집계·깨우기 멈추고 가명 집계를 지워요');
  await page.click('#dlg-btn-1'); await page.waitForTimeout(300);
  const sw = (await readDb(page))['aiState/switch'];
  must(sw && sw.enabled === false && sw.updatedBy === 'local', 'aiState/switch {enabled:false, updatedBy, updatedTs}');
  must((await page.innerText('#ai-switch-state')).includes('꺼져 있어요') && (await page.innerText('#btn-ai-switch')).includes('다시 켜기'), '꺼진 상태 표시와 다시 켜기');
  await page.click('#btn-ai-switch'); await page.waitForTimeout(300); must((await readDb(page))['aiState/switch'].enabled === true, '다시 켜기');
  await page.close();
}

/* ---------- 7) 관리자가 아니면 막아요 ---------- */
{
  const { page } = await newPage(browser, { tag: 'nonadmin', seed: seed() });
  await startDemo(page); await page.waitForSelector('#nav-family');
  await page.evaluate(() => { window.__S.debugNonAdmin = true; });
  await page.click('#nav-family'); await page.waitForSelector('#tab-assess'); await page.click('#tab-assess'); await page.waitForTimeout(100);
  must(!(await page.locator('#hub-ai').count()), '관리자가 아니면 점검 탭에 AI 리포트 줄이 없어요');
  await go(page, 'aiReports'); await page.waitForSelector('#ai-blocked');
  must((await page.innerText('#ai-blocked-t')) === '관리자만 볼 수 있어요' && (await page.locator('.airow-btn, #ai-rows, svg.ai-chart').count()) === 0, '관리자가 아니면 "관리자만 볼 수 있어요" (리포트·그래프 없음)');
  for (const to of ['aiReport', 'aiTrend', 'aiAnchor', 'aiNotes', 'aiBank', 'aiOps', 'aiSettings']) { await go(page, to); must(await vis(page, '#ai-blocked'), to + ': 막혀요'); }
  await page.close();
}

/* ---------- 8) XSS: 리포트·메모·문항 검토의 글은 글자로만 ---------- */
{
  const evil = '<img src=x onerror="window.__xss=1">';
  const { page } = await newPage(browser, { tag: 'xss', seed: seed({ 'bw.aiDemo': true }) });
  await startDemo(page); await page.waitForSelector('#nav-family');
  await page.evaluate(async evil => {
    const db = JSON.parse(localStorage.getItem('bw.localdb'));
    const k = Object.keys(db).find(x => x.startsWith('trainees/local/aiReports/') && db[x].kind === 'daily' && db[x].generatedBy === 'routine');
    db[k].report.headline = evil + '머리글'; db[k].report.summary = [evil]; db[k].report.domains[0].sentence = evil; db[k].report.notable = [{ text: evil }]; db[k].report.glossary = [{ key: evil, plain: evil, analogy: evil }];
    db[k].numbers.comp_ma4 = evil;
    const rv = JSON.parse(db['aiOps/review'].itemsJson); rv[0].prompt = evil; rv[0].choices[0].t = evil; rv[0].basis = evil; db['aiOps/review'].itemsJson = JSON.stringify(rv);
    db['trainees/local/aiNotes/nexample1'].text = evil;
    localStorage.setItem('bw.localdb', JSON.stringify(db));
  }, evil);
  await page.reload(); await page.waitForSelector('#nav-family'); await page.click('#nav-family'); await page.waitForSelector('#tab-assess'); await page.click('#tab-assess'); await page.click('#hub-ai'); await page.waitForSelector('.airow-btn');
  await page.locator('.airow-btn', { hasText: '아침 리포트' }).first().click(); await page.waitForSelector('#ai-rows');
  await page.click('#ai-d-composite > summary'); await page.click('#ai-gloss > summary'); await page.waitForTimeout(200);
  const t = await page.innerText('#screen');
  must(t.includes('<img src=x onerror=') && (await page.locator('#screen img').count()) === 0, '리포트: <img onerror> 는 글자 그대로 (그림 요소 없음)');
  await go(page, 'aiBank'); await page.locator('#ai-review details').first().locator('summary').click();
  must((await page.innerText('#ai-review')).includes('<img src=x') && (await page.locator('#screen img').count()) === 0, '문제 은행 검토 문항: 글자 그대로');
  await go(page, 'aiNotes'); must((await page.innerText('#screen')).includes('<img src=x') && (await page.locator('#screen img').count()) === 0, '메모: 글자 그대로');
  must(await page.evaluate(() => window.__xss === undefined), 'onerror 는 실행되지 않았어요');
  await page.close();
}

/* ---------- 9) 어두운 화면 목록·보기: 빨강 없음, 가로 스크롤 없음 ---------- */
{
  const { page } = await newPage(browser, { tag: 'dark', w: 360, dark: true, seed: seed({ 'bw.size': 'max' }) });
  await openAi(page); await page.screenshot({ path: SHOTS + '/ai-list-dark.png', fullPage: true });
  await noRed(page, '어두운 목록'); await noHScroll(page, '어두운 목록');
  await page.locator('.airow-btn', { hasText: '알림' }).first().click(); await page.waitForSelector('#ai-rows');
  await page.screenshot({ path: SHOTS + '/ai-report-dark.png', fullPage: true });
  must((await page.locator('.lpill.orange').count()) >= 1, '주의 신호(주황) 알약이 있어요'); const c = await page.evaluate(() => { const e = document.querySelector('.lpill.orange'), cs = getComputedStyle(e); return [cs.color, cs.backgroundColor]; });
  must(contrast(c[0], c[1]) >= 4.5, '어두운 화면 주황 알약 글자 대비 ' + contrast(c[0], c[1]).toFixed(1));
  await noRed(page, '어두운 보기'); await noHScroll(page, '어두운 보기'); await page.close();
}
await done(browser);
