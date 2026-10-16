'use strict';
/**
 * The only two HTTPS endpoints the routine can reach.
 *
 *   aiRead   GET  ?doc=subjects | ?doc=current&s=<A-Z> | ?doc=bankNeeds | ?doc=job&job=w-YYYYMMDD-HHMM-xx
 *            → { ok:true, doc }:
 *              subjects  { subjects: [{ s:'A', id:'a-A-…' }, …] }  letters with a current-{L} aggregate of today (KST)
 *              current   aiAggregates/current-{L} (pseudonymized aggregate of trainee L)
 *              bankNeeds shared bank needs · job { job, aggregate }
 *            `?doc=current` without `s` is a 400. Member ids and labels never leave the server.
 *   aiSubmit POST { kind:'items'|'report', runId:'YYYYMMDD-HHMM', jobId?, payload:{…} }
 *            → { ok:true, id } — one aiInbox doc; the aiInbox trigger validates it
 *
 * Status codes: 200 ok · 400 bad request/shape · 401 wrong key · 404 not found · 405 method ·
 * 413 too large · 429 rate limited · 503 closed (key not configured / AI disabled) · 500 internal.
 * Responses and logs never contain the key, the stored hash, payload text or scores.
 */
const { db, FieldValue, expireIn } = require('./fb.js');
const { checkKey } = require('./auth.js');
const { LIMITS, RETENTION_DAYS } = require('./config.js');
const { kst } = require('./core/kdate.js');
const { JOB_RE } = require('./core/report.js');
const log = require('./log.js');

// --------------------------------------------------------- per-IP limits
// In-memory per instance (maxInstances is small), so this is approximate by design: cheap protection
// against hammering. The per-hour submit cap below is exact (Firestore transaction).
const ipHits = new Map();
function ipOf(req) {
  const xf = (req.get && req.get('x-forwarded-for')) || '';
  return (xf.split(',')[0] || req.ip || 'unknown').trim().slice(0, 64);
}
function ipLimit(req, kind) {
  const hour = Math.floor(Date.now() / 3600e3), ip = ipOf(req);
  let e = ipHits.get(ip);
  if (!e || e.hour !== hour) { e = { hour, n: 0, bad: 0 }; ipHits.set(ip, e); }
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (v.hour !== hour) ipHits.delete(k);
  if (kind === 'bad') { e.bad++; return true; }
  e.n++;
  return e.n <= LIMITS.ipPerHour && e.bad < LIMITS.badAuthPerIpHour;
}
const _resetIpLimits = () => ipHits.clear();

const send = (res, status, body) => { res.set('Cache-Control', 'no-store'); res.status(status).json(body); };
const ERR = { 400: 'bad_request', 401: 'unauthorized', 404: 'not_found', 405: 'method_not_allowed', 413: 'too_large', 429: 'rate_limited', 503: 'closed', 500: 'internal' };
const fail = (res, status, detail) => send(res, status, detail ? { ok: false, error: ERR[status], detail } : { ok: false, error: ERR[status] });

/** Firestore data → plain JSON (Timestamps to ISO strings). */
function plain(v) {
  if (v == null || typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = plain(x); return o;
}
const strip = (d) => { const o = plain(d); delete o.expireAt; delete o.s; return o; };
const LETTER_RE = /^[A-Z]$/;

/** Remember when the key was used; flag use outside the routine windows (tick sends one Telegram). */
async function noteKeyUse(kind) {
  const now = kst();
  const m = now.hour * 60 + now.minute;
  const inWindow = (m >= 3 * 60 && m < 6 * 60) || (m >= 7 * 60 && m < 10 * 60);
  const ref = db().collection('aiRate').doc('keyuse');
  try {
    await db().runTransaction(async (tx) => {
      const s = await tx.get(ref); const d = s.exists ? s.data() : {};
      const jobWindow = d.lastJobMs && Date.now() - d.lastJobMs < 3 * 3600e3;
      const upd = { lastTs: FieldValue.serverTimestamp(), lastKind: kind };
      if (!inWindow && !jobWindow) { upd.offSchedule = { date: now.date, n: (d.offSchedule && d.offSchedule.date === now.date ? d.offSchedule.n : 0) + 1 }; }
      tx.set(ref, upd, { merge: true });
    });
  } catch { /* bookkeeping only */ }
}

async function authOr(res, req) {
  if (!ipLimit(req, 'hit')) { fail(res, 429); return null; }
  const a = await checkKey(req);
  if (a.status === 401) { ipLimit(req, 'bad'); log.warn('auth', { status: 401 }); fail(res, 401); return null; }
  if (a.status !== 200) { fail(res, a.status); return null; }
  return a.cfg;
}

// ------------------------------------------------------------------ aiRead
async function aiRead(req, res) {
  try {
    if (req.method !== 'GET') return fail(res, 405);
    const q = req.query || {};
    const keys = Object.keys(q);
    const docName = q.doc;
    const shapeOk = (docName === 'subjects' || docName === 'bankNeeds') ? keys.length === 1
      : docName === 'current' ? keys.length === 2 && typeof q.s === 'string' && LETTER_RE.test(q.s)
        : docName === 'job' ? keys.length === 2 && typeof q.job === 'string' && JOB_RE.test(q.job) : false;
    const cfg = await authOr(res, req);
    if (!cfg) return;
    if (!shapeOk) return fail(res, 400, 'doc=subjects|current&s=<A-Z>|bankNeeds|job&job=<id>');
    await noteKeyUse('read:' + docName);
    let out;
    if (docName === 'job') {
      const j = await db().collection('aiJobs').doc(q.job).get();
      if (!j.exists) return fail(res, 404);
      const job = j.data();
      const a = job.aggregateId ? await db().collection('aiAggregates').doc(job.aggregateId).get() : null;
      out = { job: strip(job), aggregate: a && a.exists ? strip(a.data()) : null };
    } else if (docName === 'subjects') {
      const letters = [...new Set(Object.values(cfg.subjects || {}).filter((L) => LETTER_RE.test(L)))].sort();
      const today = kst().date;
      const snaps = letters.length ? await db().getAll(...letters.map((L) => db().collection('aiAggregates').doc(`current-${L}`))) : [];
      out = { subjects: snaps.filter((s) => s.exists && String(s.get('asOf')).slice(0, 10) === today).map((s) => ({ s: s.get('s'), id: s.get('id') })) };
    } else {
      const s = await db().collection('aiAggregates').doc(docName === 'current' ? `current-${q.s}` : docName).get();
      if (!s.exists) return fail(res, 404);
      out = strip(s.data());
    }
    log.info('read', { doc: docName, status: 200 });
    return send(res, 200, { ok: true, doc: out });
  } catch (e) {
    log.error('read_failed', { code: e && e.code ? String(e.code) : 'error' });
    return fail(res, 500);
  }
}

// ---------------------------------------------------------------- aiSubmit
function shapeError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body';
  const allowed = ['kind', 'runId', 'jobId', 'payload'];
  if (Object.keys(body).some((k) => !allowed.includes(k))) return 'keys';
  if (!['items', 'report'].includes(body.kind)) return 'kind';
  if (typeof body.runId !== 'string' || !/^\d{8}-\d{4}$/.test(body.runId)) return 'runId';
  const p = body.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'payload';
  if (body.kind === 'items') {
    if (p.schema !== 'bw.items.v1' || !Array.isArray(p.items) || p.items.length < 1 || p.items.length > LIMITS.itemsPerSubmit) return 'payload';
    if (body.jobId != null) return 'jobId';
  } else {
    if (p.schema !== 'bw.report.v1') return 'payload';
    if (!(body.jobId === 'scheduled' || (typeof body.jobId === 'string' && JOB_RE.test(body.jobId)))) return 'jobId';
    if (p.jobId !== body.jobId) return 'jobId';
  }
  return null;
}
async function aiSubmit(req, res) {
  try {
    if (req.method !== 'POST') return fail(res, 405);
    const raw = req.rawBody;
    const size = raw ? raw.length : Buffer.byteLength(JSON.stringify(req.body || ''), 'utf8');
    const cfg = await authOr(res, req);
    if (!cfg) return;
    if (size > LIMITS.bodyBytes) return fail(res, 413);
    let body = req.body;
    if (raw && (!body || typeof body !== 'object')) { try { body = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'json'); } }
    const se = shapeError(body);
    if (se) return fail(res, 400, se);
    const payload = JSON.stringify(body.payload);
    if (payload.length > LIMITS.payloadChars) return fail(res, 413);
    // exact per-hour cap on inbox writes (all keys share it; one routine key exists)
    const hour = Math.floor(Date.now() / 3600e3);
    const ctr = db().collection('aiRate').doc('submit-h' + hour);
    const okSlot = await db().runTransaction(async (tx) => {
      const s = await tx.get(ctr); const n = s.exists ? s.get('n') || 0 : 0;
      if (n >= LIMITS.submitsPerHour) return false;
      tx.set(ctr, { n: n + 1, expireAt: expireIn(2) }, { merge: true });
      return true;
    });
    if (!okSlot) { log.warn('submit_rate', { status: 429 }); return fail(res, 429); }
    await noteKeyUse('submit:' + body.kind);
    const ref = await db().collection('aiInbox').add({
      kind: body.kind, runId: body.runId, jobId: body.jobId || null, payload, size: payload.length,
      status: 'new', createdTs: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.inbox),
    });
    log.info('submit', { kind: body.kind, status: 200, bytes: payload.length, items: body.kind === 'items' ? body.payload.items.length : 0 });
    return send(res, 200, { ok: true, id: ref.id });
  } catch (e) {
    log.error('submit_failed', { code: e && e.code ? String(e.code) : 'error' });
    return fail(res, 500);
  }
}

module.exports = { aiRead, aiSubmit, shapeError, _resetIpLimits, plain };
