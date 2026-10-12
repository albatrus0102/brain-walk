'use strict';
/**
 * The ONLY logger the AI functions use. It writes counts and codes, never content:
 * values must be finite numbers, booleans, or short code strings ([A-Za-z0-9_:.-], ≤ 32 chars — a
 * 48-char routine key or a 64-char hash can never pass).
 * Anything else (item text, scores as strings, names, keys, tokens, URLs) is dropped and replaced
 * by "[dropped]". Field names must be short identifiers.
 *
 * Health numbers are not logged either: callers pass counts (accepted=12), not scores.
 */
let sink = null;
function out() {
  if (sink) return sink;
  try { sink = require('firebase-functions/logger'); } catch { sink = { info: console.log, warn: console.warn, error: console.error }; }
  return sink;
}
const CODE = /^[A-Za-z0-9_:.\-]{0,32}$/;
function clean(v, depth = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : '[dropped]';
  if (typeof v === 'boolean' || v == null) return v;
  if (typeof v === 'string') return CODE.test(v) && !/^(https?|bot)/i.test(v) ? v : '[dropped]';
  if (depth < 2 && Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  if (depth < 2 && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) if (/^[A-Za-z0-9_:.\-]{1,40}$/.test(k)) o[k] = clean(x, depth + 1);
    return o;
  }
  return '[dropped]';
}
function emit(level, event, fields) {
  const ev = CODE.test(String(event)) ? String(event) : 'event';
  out()[level](`ai.${ev}`, clean(fields || {}));
}
/** Emulator-only debugging: full error to stderr when AI_DEBUG_ERRORS=true (never in production). */
function debugError(e) { if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.AI_DEBUG_ERRORS === 'true') console.error(e); }
module.exports = {
  debugError,
  info: (e, f) => emit('info', e, f),
  warn: (e, f) => emit('warn', e, f),
  error: (e, f) => emit('error', e, f),
  clean,
  /** tests: route output somewhere else */
  _setSink: (s) => { sink = s; },
};
