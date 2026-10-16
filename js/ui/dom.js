import { ic } from '../icons.js';
import { $ } from '../util.js';
import { closeLayer, openLayer } from './nav.js';

/* ================= 스낵바 / 다이얼로그 ================= */
let snackT = null;
export function toast(msg) {
  const el = $('#snackbar'); el.textContent = msg; el.hidden = false;
  clearTimeout(snackT); snackT = setTimeout(() => { el.hidden = true; }, 4200);
}
let dialogReturn = null, dialogLayer = null;
/* extra: 본문 아래에 넣을 DOM 노드(입력칸 등, 선택). opts.nopush: 뒤로 가기 칸을 쌓지 않아요 (앱 닫기 확인창) */
export function dialog(title, text, actions, onClose, extra, opts) {
  const sc = $('#scrim'); if (dialogLayer) { closeLayer(dialogLayer); dialogLayer = null; } else dialogReturn = document.activeElement; sc.textContent = '';
  let closed = false;
  let layer = null;
  const close = () => { if (closed) return false; closed = true; closeLayer(layer); if (dialogLayer === layer) dialogLayer = null; sc.hidden = true; sc.textContent = ''; try { dialogReturn && dialogReturn.focus(); } catch (e) {} return true; };
  const acts = h('div', { class: 'actions' }, actions.map((a, i) => h('button', { class: 'btn ' + (a.kind || 'text'), id: 'dlg-btn-' + i, type: 'button', onclick: () => {
    if (a.keep) { a.run && a.run(); return; }
    close(); Promise.resolve(a.run && a.run()).catch(() => {}).then(() => { if (onClose) onClose(); });
  } }, a.label)));
  sc.append(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', 'aria-describedby': text ? 'dlg-text' : null },
    h('h2', { class: 't-headline-s', id: 'dlg-title', text: title }), (text ? h('p', { class: 't-body mt', id: 'dlg-text', text: text }) : null), extra || null, acts));
  sc.hidden = false;
  layer = dialogLayer = openLayer(() => { if (close() && onClose) onClose(); }, opts);   // 뒤로 가기·Escape 는 창을 닫아요
  sc.onkeydown = e => {
    if (e.key === 'Tab') {
      const bs = sc.querySelectorAll('button,input,textarea'); const f = bs[0], l = bs[bs.length - 1];
      if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
      else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
    }
  };
  const first = sc.querySelector('button'); if (first) first.focus();
}

/* ================= DOM 도우미 (사용자 글은 항상 textContent) ================= */
export function h(tag, props) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) {
    const kids = [].concat(arguments[i]);
    kids.forEach(c => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  }
  return e;
}
export const svgIcon = k => { const w = document.createElement('span'); w.innerHTML = ic(k); return w.firstChild; };
export const btnEl = (label, cls, onclick, id, icon) => h('button', { class: 'btn ' + cls, type: 'button', id, onclick }, icon ? svgIcon(icon) : null, label);

/* ================= 시트 (아래에서 올라오는 메뉴) ================= */
let sheetReturn = null, sheetLayer = null;
export function openSheet(title, build) {
  const sc = $('#sheet'); sheetReturn = document.activeElement; sc.textContent = '';
  const body = h('div', { class: 'stack', style: 'margin-top:12px' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' }, h('div', { class: 'grab' }), h('h2', { class: 't-title-m', id: 'sheet-title', text: title }), body);
  build(body, panel); sc.append(panel); sc.hidden = false;
  sc.onclick = e => { if (e.target === sc) closeSheet(); };
  if (sheetLayer) closeLayer(sheetLayer);
  sheetLayer = openLayer(() => closeSheet());
  const f = panel.querySelector('button,textarea,input'); if (f) f.focus();
}
export function closeSheet() { const sc = $('#sheet'); if (sheetLayer) { const l = sheetLayer; sheetLayer = null; closeLayer(l); } sc.hidden = true; sc.textContent = ''; try { sheetReturn && sheetReturn.focus(); } catch (e) {} }
