import { S } from './state.js';

/* ================= 소리 (음성 안내 + 부드러운 효과음) ================= */
export const synth = (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined') ? window.speechSynthesis : null;
function koVoice() {
  if (S.voice) return S.voice;
  try { const vs = synth.getVoices() || []; S.voice = vs.find(v => /^ko[-_]KR/i.test(v.lang)) || vs.find(v => /^ko/i.test(v.lang)) || null; } catch (e) {}
  return S.voice;
}
export function stopSpeech() { try { if (synth) synth.cancel(); } catch (e) {} }
export function say(text, force) {
  if (!synth || !text) return;
  if (!force && !S.prefs.sound) return;
  try {
    synth.cancel();
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = 0.9; u.pitch = 1;
    const v = koVoice(); if (v) u.voice = v;
    synth.speak(u);
  } catch (e) {}
}
let actx = null;
export function beep(kind) {
  if (!S.prefs.sound) return;
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
if (synth) { try { synth.onvoiceschanged = () => { S.voice = null; }; } catch (e) {} }
