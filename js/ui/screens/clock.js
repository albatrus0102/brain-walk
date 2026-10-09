import { Store } from '../../store/store.js';
import { S } from '../../state.js';
import { traineeLabel, writeErrMsg } from '../../data.js';
import { esc, ymd } from '../../util.js';
import { h, openSheet, closeSheet, toast, btnEl } from '../dom.js';
import { SCREENS } from '../registry.js';
import { go } from '../shell.js';

/* 시계 그리기: 훈련하는 분이 그린 그림을 작은 PNG(data URL, 200KB 이하)로 저장해요.
 * 자동 채점은 하지 않고, 가족이 시간 순서대로 나란히 보는 기록용이에요. 그림 종이는 흰색/짙은 잉크 고정(저장본이 밝은 화면에서도 같게 보이도록). */
const PAPER = '#FFFFFF', INK = '#1A1A1A', MAX_CHARS = 190000;
export const CLOCK_PROMPT = '11시 10분을 가리키는 시계를 그려 주세요';

SCREENS.clock = {
  html() {
    return '<div class="stack"><h1 class="t-headline" id="clk-h">시계 그리기</h1>' +
      '<section class="card primary"><p class="t-title" id="clk-prompt">' + CLOCK_PROMPT + '</p><p class="t-body mt">손가락으로 동그라미, 숫자, 바늘을 그려 보세요. 틀려도 괜찮아요.</p></section>' +
      '<div class="canvas-wrap"><canvas id="clock-canvas" width="720" height="720" role="img" aria-label="시계를 그리는 칸"></canvas></div>' +
      '<div class="row"><button class="btn outlined" id="btn-clock-clear" type="button">지우고 다시 그리기</button><button class="btn text" id="btn-clock-cancel" type="button">그만두기</button></div>' +
      '<div class="cta"><button class="btn filled" id="btn-clock-done" type="button" disabled>다 그렸어요</button></div></div>';
  },
  bind(el) {
    const cv = el.querySelector('#clock-canvas'), ctx = cv.getContext('2d'), done = el.querySelector('#btn-clock-done');
    const blank = () => { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height); ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; done.disabled = true; S.clockInk = false; };
    blank();
    let drawing = false, last = null;
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); drawing = true; last = pt(e); try { cv.setPointerCapture(e.pointerId); } catch (x) {} ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y + 0.1); ctx.stroke(); });
    cv.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; if (!S.clockInk) { S.clockInk = true; done.disabled = false; } });
    const up = () => { drawing = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    el.querySelector('#btn-clock-clear').addEventListener('click', blank);
    el.querySelector('#btn-clock-cancel').addEventListener('click', () => go('pick'));
    done.addEventListener('click', async () => {
      done.disabled = true;
      const img = shrink(cv);
      if (!img) { toast('그림이 너무 커서 저장하지 못했어요. 지우고 다시 그려 주세요.'); done.disabled = false; return; }
      const now = new Date(), id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      try { await Store.setDoc('clocks/' + id, { date: ymd(now), ts: Date.now(), userId: S.myId || 'local', img: img.url, w: img.w, h: img.h }); go('clockDone'); }
      catch (e) { toast(writeErrMsg(e)); done.disabled = false; }
    });
  }
};
/* 360 → 300 → 240px 로 줄이고, 그래도 크면 JPEG */
export function shrink(cv) {
  for (const px of [360, 300, 240]) {
    const t = document.createElement('canvas'); t.width = px; t.height = px; const c = t.getContext('2d');
    c.fillStyle = PAPER; c.fillRect(0, 0, px, px); c.drawImage(cv, 0, 0, px, px);
    for (const fmt of [['image/png'], ['image/jpeg', 0.75]]) { const url = t.toDataURL(fmt[0], fmt[1]); if (url.length <= MAX_CHARS) return { url, w: px, h: px }; }
  }
  return null;
}

SCREENS.clockDone = {
  html() {
    return '<div class="stack"><h1 class="t-headline center" id="cd-h">오늘도 수고하셨어요</h1><section class="card primary center"><p class="t-title">그려 주셔서 고마워요.</p><p class="t-body mt">그림은 가족이 함께 보관해 둘게요.</p></section>' +
      '<div class="cta"><button class="btn filled" id="btn-cd-home" type="button" data-act="home">처음으로</button></div></div>';
  }
};

/* 가족: 시간 순서대로 나란히 보기 */
const label = d => esc(String(d.date).slice(5).replace('-', '/'));
/* 저장된 그림만 보여 줘요: PNG/JPEG data URL 이고 base64 글자만 있는 것 (규칙과 같은 조건) */
const IMG_OK = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const clockList = () => (S.clocks || []).filter(c => c && typeof c.img === 'string' && IMG_OK.test(c.img)).sort((a, b) => b.ts - a.ts);
SCREENS.clocks = {
  html() {
    const list = clockList();
    let o = '<div class="stack"><h1 class="t-headline" id="clks-h">시계 그림</h1><p class="t-body muted">' + esc(traineeLabel()) + '이(가) 그린 시계예요. 채점하지 않고 변화를 나란히 살펴보는 기록이에요. 가족만 볼 수 있어요.</p>';
    if (!list.length) o += '<section class="card outlined empty"><p class="t-title">아직 그림이 없어요</p><p class="t-body muted">"' + CLOCK_PROMPT + '"라고 부탁해 보세요.</p></section>';
    else {
      const first = list[list.length - 1], lastc = list[0];
      if (list.length > 1) o += '<section class="card elevated" id="clk-compare" aria-labelledby="cmp-h"><h2 class="t-title" id="cmp-h">처음과 가장 최근</h2><div class="thumbs mt"><figure><img alt="처음 시계 그림 ' + label(first) + '" src="' + esc(first.img) + '"><figcaption>처음 · ' + esc(first.date) + '</figcaption></figure><figure><img alt="가장 최근 시계 그림 ' + label(lastc) + '" src="' + esc(lastc.img) + '"><figcaption>최근 · ' + esc(lastc.date) + '</figcaption></figure></div></section>';
      o += '<section class="card outlined" aria-labelledby="all-h"><h2 class="t-title" id="all-h">모두 보기 (' + list.length + '장)</h2><div class="thumbs mt" id="clk-grid">' + list.map((c, i) => '<figure><button type="button" class="hub-item" style="padding:6px;min-height:0" data-act="clockopen" data-i="' + i + '" id="clk-' + i + '" aria-label="' + esc(c.date) + ' 시계 그림 크게 보기"><img alt="' + esc(c.date) + ' 시계 그림" src="' + esc(c.img) + '"></button><figcaption>' + esc(c.date) + '</figcaption></figure>').join('') + '</div></section>';
    }
    return o + '<div class="cta"><button class="btn filled" id="btn-clk-draw" type="button" data-act="nav" data-to="clock">' + esc(traineeLabel()) + '께 그리기 부탁하기</button></div></div>';
  }
};
export function openClock(i) {
  const list = clockList(), c = list[i]; if (!c) return;
  openSheet(c.date + ' 시계 그림', body => { body.append(h('img', { src: c.img, alt: c.date + ' 시계 그림', style: 'width:100%;height:auto;border:2px solid var(--md-sys-color-outline-variant);border-radius:var(--md-sys-shape-corner-medium)' }), btnEl('닫기', 'text', closeSheet, 'clk-close')); });
}
