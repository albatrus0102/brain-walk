'use strict';
/**
 * Trainees of the configured family (DESIGN-MULTI §1, §4.1).
 *
 *   families/{fid}/state/trainees      { v:1, ids:[mid…] (≤4, display order), labels:{mid:'아버지'}, updatedBy, updatedTs }
 *   families/{fid}/trainees/{mid}/…    per-trainee state, aiState, aiStats, aiSignals, aiReports, aiOps, aiNotes, aiPacks
 *   aiConfig/main.subjects             { [mid]: 'A'|'B'|… } pseudonym letters (server only, never reused)
 *
 * Labels are read only by the push code (functions/index.js); the AI side never copies them anywhere.
 */
const { db, fam } = require('./fb.js');
const { getConfig, _resetConfigCache, MAX_TRAINEES } = require('./config.js');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** state/trainees → { ids, labels } (missing doc = empty set; bad ids dropped; max 4). */
function normalizeTrainees(d) {
  const ids = [];
  for (const id of (d && Array.isArray(d.ids) ? d.ids : [])) if (typeof id === 'string' && MID_RE.test(id) && !ids.includes(id) && ids.length < MAX_TRAINEES) ids.push(id);
  const labels = {};
  const src = (d && d.labels && typeof d.labels === 'object') ? d.labels : {};
  ids.forEach((id) => { labels[id] = typeof src[id] === 'string' && src[id].trim() ? src[id].trim().slice(0, 12) : ''; });
  return { ids, labels };
}
async function loadTrainees(fid) {
  const s = await fam(fid).collection('state').doc('trainees').get();
  return normalizeTrainees(s.exists ? s.data() : null);
}
/** families/{fid}/trainees/{mid} (the subtree root; the doc itself is never written). */
const tref = (fid, mid) => fam(fid).collection('trainees').doc(mid);

/**
 * Pure: give every mid without a letter the next unused letter (A first). Letters already in `subjects`
 * are never handed out again, even if their member is no longer a trainee. Returns { subjects, added }.
 */
function assignLetters(subjects, mids) {
  const out = { ...(subjects || {}) };
  const used = new Set(Object.values(out));
  const added = {};
  for (const mid of mids) {
    if (out[mid]) continue;
    const L = LETTERS.find((x) => !used.has(x));
    if (!L) break;
    out[mid] = L; used.add(L); added[mid] = L;
  }
  return { subjects: out, added };
}
/** Letter of an eligible trainee, assigned in a transaction on first use. Returns 'A'… or null (all 26 used). */
async function ensureLetter(mid) {
  const cfg = await getConfig();
  if (cfg.subjects && cfg.subjects[mid]) return cfg.subjects[mid];
  const ref = db().collection('aiConfig').doc('main');
  const L = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const cur = (s.exists && s.get('subjects')) || {};
    if (cur[mid]) return cur[mid];
    const r = assignLetters(cur, [mid]);
    if (!r.added[mid]) return null;
    tx.set(ref, { subjects: r.subjects }, { merge: true });
    return r.added[mid];
  });
  _resetConfigCache();
  return L;
}
const letterOf = (cfg, mid) => (cfg && cfg.subjects && cfg.subjects[mid]) || null;
function midOfLetter(cfg, L) {
  for (const [mid, x] of Object.entries((cfg && cfg.subjects) || {})) if (x === L) return mid;
  return null;
}
/** Letter → member id with a fresh config read when the cached one does not know the letter yet. */
async function resolveLetter(L) {
  let mid = midOfLetter(await getConfig(), L);
  if (!mid) mid = midOfLetter(await getConfig(true), L);
  return mid;
}

/** Theme words check (B.7): ≤ 8, 1–10 Hangul syllables each, no banned word, no PII, not a person name. */
function validThemes(words) {
  const { lexicon } = require('./core/lexicon.js');
  const { bannedHit, piiHit } = require('./core/checks.js');
  const lx = lexicon();
  return (Array.isArray(words) ? words : []).filter((w) => typeof w === 'string' && /^[가-힣]{1,10}$/.test(w) && !bannedHit(lx, w) && !piiHit(lx, w) && !lx.names.has(w)).slice(0, 8);
}
async function loadThemes(fid, mid) {
  const s = await tref(fid, mid).collection('aiState').doc('themes').get();
  return validThemes(s.exists ? s.get('words') : []);
}
/** Union of the trainees' theme words (≤ 16), for item checks and bank needs. */
function unionThemes(lists) {
  const out = [];
  for (const l of lists) for (const w of l) if (!out.includes(w)) out.push(w);
  return out.slice(0, 16);
}

/**
 * What bank needs and packs depend on, for every trainee currently in T:
 * [{ mid, L (or null before the first eligible run), plan (aiState/plan or null), themes }]
 */
async function traineeContexts(fid) {
  const cfg = await getConfig();
  const { ids } = await loadTrainees(fid);
  const out = [];
  for (const mid of ids) {
    const [p, themes] = await Promise.all([tref(fid, mid).collection('aiState').doc('plan').get(), loadThemes(fid, mid)]);
    out.push({ mid, L: letterOf(cfg, mid), plan: p.exists ? p.data() : null, themes });
  }
  return out;
}

/** Rebuild training packs (all or some cells) for every trainee in T, each with their own theme filter. */
async function rebuildAllPacks(fid, cells = null) {
  const bank = require('./bank.js');
  const ctxs = await traineeContexts(fid);
  for (const c of ctxs) await bank.rebuildPacks(fid, c.mid, c.themes, cells);
  return ctxs.length;
}
/** Shared bank needs from every trainee's plan and themes (letters only; no member ids leave the server). */
async function writeFamilyBankNeeds(fid, counts, ctxs = null) {
  const bank = require('./bank.js');
  const { VERSION } = require('./core/index.js');
  const cs = ctxs || (await traineeContexts(fid));
  const subjects = cs.filter((c) => c.L).map((c) => ({ L: c.L, plan: c.plan })).sort((a, b) => (a.L < b.L ? -1 : 1));
  return bank.writeBankNeeds({ subjects, nTrainees: Math.max(1, cs.length), themes: unionThemes(cs.map((c) => c.themes)), counts, validator: { version: VERSION } });
}

module.exports = {
  LETTERS, normalizeTrainees, loadTrainees, tref, assignLetters, ensureLetter, letterOf, midOfLetter, resolveLetter,
  validThemes, loadThemes, unionThemes, traineeContexts, rebuildAllPacks, writeFamilyBankNeeds,
};
