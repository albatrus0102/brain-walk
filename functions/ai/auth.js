'use strict';
/**
 * Routine key check for aiRead / aiSubmit.
 *
 *  - aiConfig/main.routineKeyHash holds sha256(key) in hex. Storing the hash (not the key) means a
 *    database export, a console screenshot or a rules mistake never reveals a usable key.
 *  - Field missing / shorter than 16 chars / AI disabled → 503 (closed).
 *  - Header `Authorization: Bearer <key>` (or `X-Routine-Key: <key>` as a fallback for proxies that
 *    reserve Authorization). Keys shorter than 16 chars are rejected without comparing.
 *  - Constant-time compare: sha256 of both sides, then crypto.timingSafeEqual.
 *  - The key, the hash and the header never appear in responses or logs.
 */
const crypto = require('node:crypto');
const { getConfig } = require('./config.js');

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
function presentedKey(req) {
  const h = (req.get && req.get('authorization')) || (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  const x = (req.get && req.get('x-routine-key')) || (req.headers && req.headers['x-routine-key']) || '';
  return typeof x === 'string' ? x.trim() : '';
}
/** Returns { status: 200 | 401 | 503, cfg } */
async function checkKey(req) {
  let cfg;
  try { cfg = await getConfig(); } catch { return { status: 503 }; }
  const stored = typeof cfg.routineKeyHash === 'string' ? cfg.routineKeyHash.trim().toLowerCase() : '';
  if (!stored || stored.length < 16 || cfg.enabled === false || !/^[0-9a-f]+$/.test(stored)) return { status: 503 };
  const key = presentedKey(req);
  if (!key || key.length < 16 || key.length > 256) return { status: 401 };
  // sha256(stored-hash-hex) vs sha256(sha256(key)-hex): equal-length buffers, constant time
  const a = sha(stored);
  const b = sha(sha(key).toString('hex'));
  return crypto.timingSafeEqual(a, b) ? { status: 200, cfg } : { status: 401 };
}
const hashKey = (key) => sha(key).toString('hex');

module.exports = { checkKey, hashKey, presentedKey };
