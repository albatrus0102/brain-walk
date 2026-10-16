import { S } from './state.js';

/* ================= 소리 (음성 안내 + 부드러운 효과음) ================= */
export const synth = (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined') ? window.speechSynthesis : null;
function koVoice() {
  if (S.voice) return S.voice;
  try { const vs = synth.getVoices() || []; S.voice = vs.find(v => /^ko[-_]KR/i.test(v.lang)) || vs.find(v => /^ko/i.test(v.lang)) || null; } catch (e) {}
  return S.voice;
}
/* 실제로 쓰는 화면·소리 설정은 display.js 의 applyDisplay 가 S.eff 에 넣어요 (훈련하는 분 기기는 관리자가 정한 값) */
export const effectiveSound = () => (S.eff ? S.eff.voice : S.prefs.sound);
export const speechRate = () => (S.eff && S.eff.rate) || 0.9;
let cur = null;   // 크롬은 참조가 없는 발화를 지워 버려서 끝 신호(onend)가 안 와요: 붙잡아 둬요
function speakNow(u) {
  cur = u;
  const busy = synth.speaking || synth.pending;
  try { if (synth.paused) synth.resume(); } catch (e) {}   // 백그라운드에 다녀오면 멈춤 상태로 남는 기기가 있어요
  if (busy) { synth.cancel(); setTimeout(() => { if (cur === u) synth.speak(u); }, 80); }   // 안드로이드 크롬: cancel 바로 뒤 speak 는 무시될 때가 있어요
  else synth.speak(u);
}
export function stopSpeech() { cur = null; try { if (synth) synth.cancel(); } catch (e) {} }
/* rate: 미리 듣기처럼 정해진 빠르기로 읽을 때만. onEnd: 다 읽었을 때 (읽을 수 있을 때만 불려요). 돌려주는 값: 읽기 시작했는지 */
export function say(text, force, rate, onEnd) {
  if (!synth || !text) return false;
  if (!force && !effectiveSound()) return false;
  try {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = rate || speechRate(); u.pitch = 1;
    const v = koVoice(); if (v) u.voice = v;
    if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
    speakNow(u);
    return true;
  } catch (e) { return false; }
}
/* 소리 안내로 문제를 읽어 줄 수 있는지 (한국어 목소리가 있어야 '읽기가 끝난 때'를 믿을 수 있어요) */
export const canSpeakKo = () => !!(synth && effectiveSound() && koVoice());
/* 읽어 주고 끝나면 cb 를 한 번 불러요. 소리가 꺼져 있거나 못 읽으면 noVoiceMs 뒤에, 끝 신호가 안 오면 maxMs 뒤에 불러요. 돌려주는 함수로 취소해요. */
export function sayThen(text, cb, noVoiceMs, maxMs) {
  let fired = false, t1 = null, t2 = null;
  const fire = () => { if (fired) return; fired = true; clearTimeout(t1); clearTimeout(t2); cb(); };
  if (!synth || !text || !effectiveSound()) { t1 = setTimeout(fire, noVoiceMs == null ? 3000 : noVoiceMs); return () => { fired = true; clearTimeout(t1); }; }
  try {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = speechRate(); u.pitch = 1; u.onend = fire; u.onerror = fire;
    const v = koVoice(); if (v) u.voice = v;
    speakNow(u);
  } catch (e) { t1 = setTimeout(fire, noVoiceMs == null ? 3000 : noVoiceMs); }
  t2 = setTimeout(fire, maxMs || 9000);
  return () => { fired = true; clearTimeout(t1); clearTimeout(t2); };
}
let actx = null;
export function beep(kind) {
  if (!effectiveSound()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
    const notes = kind === 'ok' ? [523.25, 659.25] : kind === 'chime' ? [523.25, 659.25, 783.99] : [392, 349.23];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.14;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.3);
    });
  } catch (e) {}
}
if (synth) {
  try { synth.onvoiceschanged = () => { S.voice = null; }; synth.getVoices(); } catch (e) {}   // 목록은 늦게 와요: 미리 불러 둬요
  // 앱으로 돌아오면 멈춰 있던 음성 엔진을 깨워요
  try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && synth.paused) synth.resume(); }); } catch (e) {}
}
