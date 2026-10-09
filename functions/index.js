/* eslint-disable no-console */
'use strict';
/**
 * 오늘의 두뇌 산책 — Cloud Functions (2nd gen). Deploy as functions/index.js.
 *
 *   onFamilyMessage  Firestore onDocumentCreated  families/{fid}/messages/{id}
 *                    -> instant push for chat / record / system / nudge
 *   tick             onSchedule every 5 minutes (Asia/Seoul)
 *                    -> daily training alarm (trainee), family reminders,
 *                       morning flush of messages deferred by quiet hours,
 *                       retry of anything still 'pending'
 *   dailyPurge       onSchedule 03:17 KST -> expired codes, stale devices
 *
 * Requires the Blaze plan. Region asia-northeast3 (Seoul) must match the
 * Firestore database location for the Firestore trigger.
 *
 * The GitHub Actions fallback (scripts/send-reminders.mjs) implements the same
 * state machine on messages.push, so both may run at once without duplicates:
 *   pending --(claim)--> sent | deferred | throttled | expired | none
 *   deferred --(claim, after 08:00)--> sent | expired
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const fcm = getMessaging();

const REGION = 'asia-northeast3';
setGlobalOptions({ region: REGION, maxInstances: 3, memory: '256MiB', timeoutSeconds: 120 });

// e.g. https://<user>.github.io/brain-walk/   (asked once at `firebase deploy`, stored in functions/.env.<project>)
const APP_URL = defineString('APP_URL', { description: 'Public app URL with trailing slash, e.g. https://you.github.io/brain-walk/' });

// ----------------------------------------------------------------- constants
const COURSE_N = 5;                       // games in "오늘의 훈련" (DOMAINS.length in the app)
const QUIET_START = 21 * 60;              // 21:00 KST
const QUIET_END = 8 * 60;                 // 08:00 KST
const DUE_WINDOW_MIN = 30;                // fire alarm/reminder within 30 min after its time
const NUDGE_PUSH_GAP_MS = 110 * 60 * 1000; // server-side twin of the rules' 115-min limit
const PENDING_RETRY_AFTER_MS = 60 * 1000; // tick re-processes 'pending' older than this
const MAX_MESSAGE_AGE_MS = 14 * 3600 * 1000; // never push anything older (incl. overnight deferral)
const DEVICE_STALE_MS = 90 * 864e5;       // prune devices not refreshed for 90 days
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// ------------------------------------------------------------- time (KST)
/** Korea has no DST, so UTC+9 arithmetic is exact. */
function kstNow(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    ms,
    dateKey: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: d.getUTCDay(), // 0 = Sunday, same as the app's alarm.days
  };
}
const isQuiet = (now) => now.minutes >= QUIET_START || now.minutes < QUIET_END;
const hhmmToMin = (s) => (/^\d{2}:\d{2}$/.test(s || '') ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);
function isDue(hhmm, now, windowMin) {
  const t = hhmmToMin(hhmm);
  if (t == null) return false;
  const diff = now.minutes - t;
  return diff >= 0 && diff < windowMin;
}
/** Korean subject particle: 아버지 -> 아버지가, 할아버님 -> 할아버님이 */
function withSubject(word) {
  const c = String(word || '').trim();
  const last = c.charCodeAt(c.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return c + ((last - 0xac00) % 28 ? '이' : '가');
  return c + '이(가)';
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------------------------------------------------------- family context
const famRef = (fid) => db.collection('families').doc(fid);

/** Members (active), uid links, trainee, alarm. Small: one family ≈ 10 reads. */
async function loadFamily(fid) {
  const f = famRef(fid);
  const [membersSnap, uidsSnap, traineeSnap, alarmSnap] = await Promise.all([
    f.collection('members').get(),
    f.collection('uids').get(),
    f.collection('state').doc('trainee').get(),
    f.collection('state').doc('alarm').get(),
  ]);
  const members = new Map();
  membersSnap.forEach((d) => { const m = d.data(); if (!m.leftTs) members.set(d.id, m); });
  const uidsByMember = new Map();
  uidsSnap.forEach((d) => {
    const mid = d.get('memberId');
    if (!uidsByMember.has(mid)) uidsByMember.set(mid, new Set());
    uidsByMember.get(mid).add(d.id);
  });
  const trainee = traineeSnap.exists ? traineeSnap.data() : null;
  return {
    fid,
    members,
    uidsByMember,
    traineeId: trainee && members.has(trainee.userId) ? trainee.userId : null,
    traineeLabel: (trainee && trainee.displayLabel) || '아버지',
    alarm: alarmSnap.exists ? alarmSnap.data() : null,
  };
}

/**
 * FCM tokens of the given members. A device whose uid is no longer linked to
 * that member (device revoked / member left) is deleted instead of used.
 */
async function tokensFor(ctx, memberIds) {
  const out = [];
  const seen = new Set();
  await Promise.all([...new Set(memberIds)].filter((m) => ctx.members.has(m)).map(async (mid) => {
    const snap = await famRef(ctx.fid).collection('members').doc(mid).collection('devices').get();
    const valid = ctx.uidsByMember.get(mid) || new Set();
    for (const d of snap.docs) {
      const { token, uid } = d.data();
      if (!token || !valid.has(uid)) { await d.ref.delete().catch(() => {}); continue; }
      if (seen.has(token)) continue;
      seen.add(token);
      out.push({ token, ref: d.ref, memberId: mid });
    }
  }));
  return out;
}

/** Send one notification to many devices; delete dead tokens. Returns success count. */
async function sendPush(entries, { title, body, path = '', tag, ttlSec = 6 * 3600, data = {} }) {
  if (!entries.length) return 0;
  const base = APP_URL.value().replace(/\/?$/, '/');
  let ok = 0;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const res = await fcm.sendEachForMulticast({
      tokens: chunk.map((e) => e.token),
      data: Object.fromEntries(Object.entries({ ...data, path }).map(([k, v]) => [k, String(v)])),
      webpush: {
        headers: { TTL: String(ttlSec), Urgency: 'high' },
        notification: {
          title,
          body,
          icon: base + 'icons/icon-192.png',
          badge: base + 'icons/badge-72.png',
          tag,
          renotify: true,
          lang: 'ko',
        },
        fcmOptions: { link: base + path },
      },
    });
    ok += res.successCount;
    await Promise.all(res.responses.map(async (r, j) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) {
        await chunk[j].ref.delete().catch(() => {});
        logger.info('removed dead token', { member: chunk[j].memberId, code });
      } else {
        logger.warn('push failed', { member: chunk[j].memberId, code, msg: r.error && r.error.message });
      }
    }));
  }
  return ok;
}

// ------------------------------------------------------- claim primitives
/** Atomically move messages.push from `from` to `to`. True if we won. */
async function claimMessage(ref, from, to) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('push') !== from) return false;
    tx.update(ref, { push: to, pushAt: FieldValue.serverTimestamp() });
    return true;
  });
}
/** Once-per-day de-dup on pushState/{memberId}.{field} = 'YYYY-MM-DD'. */
async function claimDaily(fid, memberId, field, dateKey) {
  const ref = famRef(fid).collection('pushState').doc(memberId);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.get(field) === dateKey) return false;
    tx.set(ref, { [field]: dateKey, [field + 'At']: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
/** Server-side nudge throttle per sender (defence in depth beside the rules). */
async function claimNudgeSlot(fid, authorId, nowMs) {
  const ref = famRef(fid).collection('pushState').doc(authorId);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const last = s.exists && s.get('lastNudgePushAt') ? s.get('lastNudgePushAt').toMillis() : 0;
    if (nowMs - last < NUDGE_PUSH_GAP_MS) return false;
    tx.set(ref, { lastNudgePushAt: Timestamp.fromMillis(nowMs) }, { merge: true });
    return true;
  });
}

// ------------------------------------------------------------ chat pushes
function recipientsOf(ctx, msg) {
  if (msg.kind === 'nudge') {
    return msg.toId && msg.toId !== msg.authorId && ctx.members.has(msg.toId) ? [msg.toId] : [];
  }
  return [...ctx.members.keys()].filter((m) => m !== msg.authorId);
}

function renderMessage(ctx, msg, fid) {
  const author = (ctx.members.get(msg.authorId) || {}).name || '가족';
  if (msg.kind === 'nudge') {
    return {
      title: `${author}님이 응원을 보냈어요`,
      body: clip(msg.text, 80) || '오늘의 두뇌 산책, 함께 해요!',
      path: '?open=home', tag: `nudge-${fid}`, ttlSec: 6 * 3600,
      data: { type: 'nudge', familyId: fid },
    };
  }
  let body = clip(msg.text, 120);
  if (msg.kind === 'record' && !body) body = '훈련 기록을 공유했어요';
  return {
    title: msg.kind === 'system' ? '우리 가족 대화방' : author,
    body: body || '새 메시지가 있어요',
    path: '?open=chat', tag: `chat-${fid}`, ttlSec: 12 * 3600,
    data: { type: 'chat', familyId: fid },
  };
}

/**
 * Handle one message whose push state is `from` ('pending' or 'deferred').
 * Returns the final state or null if another worker owns it.
 */
async function processMessage(fid, ref, msg, from, now, ctxCache = new Map()) {
  const sentMs = msg.sts && msg.sts.toMillis ? msg.sts.toMillis() : Number(msg.ts) || now.ms;
  if (now.ms - sentMs > MAX_MESSAGE_AGE_MS) return (await claimMessage(ref, from, 'expired')) ? 'expired' : null;
  if (msg.deleted || msg.kind === 'summary') return (await claimMessage(ref, from, 'none')) ? 'none' : null;
  if (isQuiet(now)) {
    if (from === 'deferred') return null;               // stay deferred until 08:00
    return (await claimMessage(ref, from, 'deferred')) ? 'deferred' : null;
  }
  if (!(await claimMessage(ref, from, 'sent'))) return null;
  if (msg.kind === 'nudge' && !(await claimNudgeSlot(fid, msg.authorId, now.ms))) {
    await ref.update({ push: 'throttled' });
    return 'throttled';
  }
  if (!ctxCache.has(fid)) ctxCache.set(fid, await loadFamily(fid));
  const ctx = ctxCache.get(fid);
  const tokens = await tokensFor(ctx, recipientsOf(ctx, msg));
  await sendPush(tokens, renderMessage(ctx, msg, fid));
  return 'sent';
}

exports.onFamilyMessage = onDocumentCreated(
  { document: 'families/{familyId}/messages/{messageId}', retry: false },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data();
    if (msg.push !== 'pending') return;
    const state = await processMessage(event.params.familyId, snap.ref, msg, 'pending', kstNow());
    logger.info('message push', { fid: event.params.familyId, id: snap.id, kind: msg.kind, state });
  },
);

// -------------------------------------------------------- scheduled work
async function courseDoneToday(ctx, dateKey) {
  if (!ctx.traineeId) return false;
  const snap = await famRef(ctx.fid).collection('sessions')
    .where('date', '==', dateKey)
    .where('inCourse', '==', true)
    .where('userId', '==', ctx.traineeId)
    .select('gameId')
    .get();
  return new Set(snap.docs.map((d) => d.get('gameId'))).size >= COURSE_N;
}

/** (a) daily alarm to the trainee + per-member reminders to the family. */
async function runAlarmsForFamily(fid, now, windowMin) {
  const ctx = await loadFamily(fid);
  let done = null; // lazy: only query sessions if something is due
  const isDone = async () => (done == null ? (done = await courseDoneToday(ctx, now.dateKey)) : done);

  // Training alarm — exempt from quiet hours (the family chose that time).
  const a = ctx.alarm;
  if (ctx.traineeId && a && Array.isArray(a.days) && a.days.includes(now.weekday) && isDue(a.time, now, windowMin)) {
    if (!(await isDone()) && (await claimDaily(fid, ctx.traineeId, 'lastAlarmSentDate', now.dateKey))) {
      const tokens = await tokensFor(ctx, [ctx.traineeId]);
      const n = await sendPush(tokens, {
        title: '훈련할 시간이에요!',
        body: '오늘의 두뇌 산책을 시작해 볼까요? 천천히 하셔도 괜찮아요.',
        path: '?open=course', tag: `alarm-${now.dateKey}`, ttlSec: 3 * 3600,
        data: { type: 'alarm', familyId: fid },
      });
      logger.info('alarm', { fid, devices: tokens.length, ok: n });
    }
  }

  // Family reminders — subject to quiet hours.
  if (!ctx.traineeId || isQuiet(now)) return;
  const rems = await famRef(fid).collection('reminders').get();
  for (const r of rems.docs) {
    const mid = r.id;
    const { time, enabled } = r.data();
    if (!enabled || mid === ctx.traineeId || !ctx.members.has(mid) || !isDue(time, now, windowMin)) continue;
    if (await isDone()) return;
    if (!(await claimDaily(fid, mid, 'lastReminderSentDate', now.dateKey))) continue;
    const tokens = await tokensFor(ctx, [mid]);
    await sendPush(tokens, {
      title: '오늘의 두뇌 산책',
      body: `${withSubject(ctx.traineeLabel)} 아직 훈련 전이에요. 응원 한마디 보내 볼까요?`,
      path: '?open=family', tag: `reminder-${now.dateKey}`, ttlSec: 3 * 3600,
      data: { type: 'reminder', familyId: fid },
    });
  }
}

/** Messages left 'pending' (trigger failed) or 'deferred' (quiet hours). */
async function runMessageQueue(now, pendingOlderThanMs) {
  const ctxCache = new Map();
  const states = isQuiet(now) ? ['pending'] : ['pending', 'deferred'];
  for (const st of states) {
    const snap = await db.collectionGroup('messages').where('push', '==', st).limit(300).get();
    // Morning flush: collapse many deferred chat messages into one push per person.
    const digest = new Map(); // fid -> Map(memberId -> {chat, nudge})
    for (const d of snap.docs) {
      const fid = d.ref.parent.parent.id;
      const msg = d.data();
      const sentMs = msg.sts && msg.sts.toMillis ? msg.sts.toMillis() : 0;
      if (st === 'pending' && now.ms - sentMs < pendingOlderThanMs) continue; // trigger still owns it
      if (st === 'deferred' && now.ms - sentMs <= MAX_MESSAGE_AGE_MS && !msg.deleted) {
        if (!(await claimMessage(d.ref, 'deferred', 'sent'))) continue;
        if (!ctxCache.has(fid)) ctxCache.set(fid, await loadFamily(fid));
        const ctx = ctxCache.get(fid);
        if (!digest.has(fid)) digest.set(fid, new Map());
        for (const mid of recipientsOf(ctx, msg)) {
          const e = digest.get(fid).get(mid) || { chat: 0, nudge: 0 };
          e[msg.kind === 'nudge' ? 'nudge' : 'chat'] += 1;
          digest.get(fid).set(mid, e);
        }
        continue;
      }
      await processMessage(fid, d.ref, msg, st, now, ctxCache);
    }
    for (const [fid, perMember] of digest) {
      const ctx = ctxCache.get(fid);
      for (const [mid, e] of perMember) {
        const tokens = await tokensFor(ctx, [mid]);
        const body = e.nudge && mid === ctx.traineeId
          ? '가족이 훈련 응원을 보냈어요. 오늘도 천천히 함께 해요.'
          : `밤사이 새 메시지 ${e.chat + e.nudge}개가 있어요.`;
        await sendPush(tokens, {
          title: '우리 가족 대화방', body,
          path: e.nudge && mid === ctx.traineeId ? '?open=home' : '?open=chat',
          tag: `chat-${fid}`, ttlSec: 6 * 3600, data: { type: 'digest', familyId: fid },
        });
      }
    }
  }
}

exports.tick = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Seoul', retryCount: 0 },
  async () => {
    const now = kstNow();
    const fams = await db.collection('families').select().get();
    for (const f of fams.docs) {
      try { await runAlarmsForFamily(f.id, now, DUE_WINDOW_MIN); } catch (e) { logger.error('alarms failed', { fid: f.id, e: String(e) }); }
    }
    try { await runMessageQueue(now, PENDING_RETRY_AFTER_MS); } catch (e) { logger.error('queue failed', { e: String(e) }); }
  },
);

exports.dailyPurge = onSchedule(
  { schedule: '17 3 * * *', timeZone: 'Asia/Seoul', retryCount: 1 },
  async () => {
    const nowTs = Timestamp.now();
    const del = async (q) => {
      const s = await q.limit(400).get();
      if (s.empty) return 0;
      const b = db.batch();
      s.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      return s.size;
    };
    const jc = await del(db.collection('joinCodes').where('expiresTs', '<', nowTs));
    const tc = await del(db.collection('transferCodes').where('expiresTs', '<', nowTs));
    const dv = await del(db.collectionGroup('devices').where('updatedAt', '<', Timestamp.fromMillis(Date.now() - DEVICE_STALE_MS)));
    logger.info('purge', { joinCodes: jc, transferCodes: tc, devices: dv });
  },
);
