#!/usr/bin/env node
/**
 * 오늘의 두뇌 산책 — GitHub Actions fallback push sender.
 * Deploy as scripts/send-reminders.mjs; run by .github/workflows/reminders.yml
 * every ~10 minutes (GitHub delays scheduled runs 5–30 min, sometimes more).
 *
 * For projects WITHOUT the Blaze plan (no Cloud Functions). Handles:
 *   1. the daily training alarm to the trainee (state/alarm, Asia/Seoul)
 *   2. each family member's reminder (reminders/{memberId}) if not trained yet
 *   3. chat messages / nudges still in push:'pending' (delayed, not instant)
 *   4. messages deferred by quiet hours (21:00–08:00) -> one digest after 08:00
 *   5. purge of expired join/transfer codes and stale devices
 *
 * Safe to run alongside the Cloud Functions: every send is claimed first in a
 * Firestore transaction (messages.push state machine, pushState/{memberId}
 * lastAlarmSentDate / lastReminderSentDate / lastNudgePushAt).
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT  service-account JSON (repo secret). Not needed
 *                             when FIRESTORE_EMULATOR_HOST is set (local test).
 *   APP_URL                   https://<user>.github.io/brain-walk/  (repo variable)
 *   WINDOW_MIN                due window after the alarm time, default 90
 *   PENDING_GRACE_SEC         leave newer 'pending' messages to Cloud Functions, default 120
 *   DRY_RUN=1                 log notifications instead of sending (state is still claimed!)
 *   GCLOUD_PROJECT            project id when using the emulator
 *   NOW_MS                    (tests only) pretend the current time is this epoch-ms
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// ------------------------------------------------------------------ setup
const env = process.env;
const DRY_RUN = env.DRY_RUN === '1';
if (env.FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: env.GCLOUD_PROJECT || 'demo-bw' });
} else {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('FIREBASE_SERVICE_ACCOUNT secret is missing. See README (GitHub Actions 설정).');
    process.exit(1);
  }
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole key file).');
    process.exit(1);
  }
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
}
const db = getFirestore();
const fcm = DRY_RUN ? null : getMessaging();

const APP_URL = (env.APP_URL || '').replace(/\/?$/, '/');
if (!/^https:\/\//.test(APP_URL) && !DRY_RUN) {
  console.error('APP_URL repository variable must be set, e.g. https://you.github.io/brain-walk/');
  process.exit(1);
}
const WINDOW_MIN = Number(env.WINDOW_MIN || 90);
const PENDING_GRACE_MS = Number(env.PENDING_GRACE_SEC || 120) * 1000;

const COURSE_N = 5;
const QUIET_START = 21 * 60;
const QUIET_END = 8 * 60;
const NUDGE_PUSH_GAP_MS = 110 * 60 * 1000;
const MAX_MESSAGE_AGE_MS = 14 * 3600 * 1000;
const DEVICE_STALE_MS = 90 * 864e5;
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const stats = { families: 0, alarms: 0, reminders: 0, messages: 0, digests: 0, pushes: 0, deadTokens: 0, errors: 0 };
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ------------------------------------------------------------- time (KST)
function kstNow(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600 * 1000); // Korea: UTC+9, no DST
  const p = (n) => String(n).padStart(2, '0');
  return {
    ms,
    dateKey: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: d.getUTCDay(),
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
function withSubject(word) {
  const c = String(word || '').trim();
  const last = c.charCodeAt(c.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return c + ((last - 0xac00) % 28 ? '이' : '가');
  return c + '이(가)';
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const famRef = (fid) => db.collection('families').doc(fid);

// ---------------------------------------------------------- family context
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

async function tokensFor(ctx, memberIds) {
  const out = [];
  const seen = new Set();
  for (const mid of new Set(memberIds)) {
    if (!ctx.members.has(mid)) continue;
    const snap = await famRef(ctx.fid).collection('members').doc(mid).collection('devices').get();
    const valid = ctx.uidsByMember.get(mid) || new Set();
    for (const d of snap.docs) {
      const { token, uid } = d.data();
      if (!token || !valid.has(uid)) { await d.ref.delete().catch(() => {}); continue; } // revoked device
      if (seen.has(token)) continue;
      seen.add(token);
      out.push({ token, ref: d.ref, memberId: mid });
    }
  }
  return out;
}

async function sendPush(entries, { title, body, path = '', tag, ttlSec = 6 * 3600, data = {} }) {
  if (!entries.length) return 0;
  if (DRY_RUN) {
    log('[dry-run] push', JSON.stringify({ to: entries.map((e) => e.memberId), title, body, path, tag }));
    return entries.length;
  }
  let ok = 0;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const res = await fcm.sendEachForMulticast({
      tokens: chunk.map((e) => e.token),
      data: Object.fromEntries(Object.entries({ ...data, path }).map(([k, v]) => [k, String(v)])),
      webpush: {
        headers: { TTL: String(ttlSec), Urgency: 'high' },
        notification: {
          title, body,
          icon: APP_URL + 'icons/icon-192.png',
          badge: APP_URL + 'icons/badge-72.png',
          tag, renotify: true, lang: 'ko',
        },
        fcmOptions: { link: APP_URL + path },
      },
    });
    ok += res.successCount;
    for (let j = 0; j < res.responses.length; j++) {
      const r = res.responses[j];
      if (r.success) continue;
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) { stats.deadTokens++; await chunk[j].ref.delete().catch(() => {}); }
      else log('push failed', chunk[j].memberId, code);
    }
  }
  stats.pushes += ok;
  return ok;
}

// ------------------------------------------------------- claim primitives
async function claimMessage(ref, from, to) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('push') !== from) return false;
    tx.update(ref, { push: to, pushAt: FieldValue.serverTimestamp() });
    return true;
  });
}
async function claimDaily(fid, memberId, field, dateKey) {
  const ref = famRef(fid).collection('pushState').doc(memberId);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.get(field) === dateKey) return false;
    tx.set(ref, { [field]: dateKey, [field + 'At']: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
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

// ------------------------------------------------------------ messages
function recipientsOf(ctx, msg) {
  if (msg.kind === 'nudge') return msg.toId && msg.toId !== msg.authorId && ctx.members.has(msg.toId) ? [msg.toId] : [];
  return [...ctx.members.keys()].filter((m) => m !== msg.authorId);
}

async function runMessageQueue(now) {
  const ctxCache = new Map();
  const getCtx = async (fid) => { if (!ctxCache.has(fid)) ctxCache.set(fid, await loadFamily(fid)); return ctxCache.get(fid); };
  const states = isQuiet(now) ? ['pending'] : ['pending', 'deferred'];
  const docs = [];
  for (const st of states) {
    const snap = await db.collectionGroup('messages').where('push', '==', st).limit(300).get();
    snap.docs.forEach((d) => docs.push({ d, st }));
  }
  // One notification per (family, recipient) per run: delayed pushes must not
  // arrive as a burst, and the overnight backlog becomes a single digest.
  const digest = new Map(); // fid -> Map(memberId -> {chat, nudge, last, overnight})
  for (const { d, st } of docs) {
    const fid = d.ref.parent.parent.id;
    const msg = d.data();
    const sentMs = msg.sts && msg.sts.toMillis ? msg.sts.toMillis() : Number(msg.ts) || 0;
    if (st === 'pending' && now.ms - sentMs < PENDING_GRACE_MS) continue; // Cloud Function may still own it
    if (now.ms - sentMs > MAX_MESSAGE_AGE_MS) { await claimMessage(d.ref, st, 'expired'); continue; }
    if (msg.deleted || msg.kind === 'summary') { await claimMessage(d.ref, st, 'none'); continue; }
    if (isQuiet(now)) { await claimMessage(d.ref, st, 'deferred'); continue; } // st is 'pending' here
    if (!(await claimMessage(d.ref, st, 'sent'))) continue;
    if (msg.kind === 'nudge' && !(await claimNudgeSlot(fid, msg.authorId, now.ms))) {
      await d.ref.update({ push: 'throttled' });
      continue;
    }
    stats.messages++;
    const ctx = await getCtx(fid);
    if (!digest.has(fid)) digest.set(fid, new Map());
    const author = (ctx.members.get(msg.authorId) || {}).name || '가족';
    for (const mid of recipientsOf(ctx, msg)) {
      const e = digest.get(fid).get(mid) || { chat: 0, nudge: 0, last: null, overnight: false };
      if (msg.kind === 'nudge') e.nudge += 1; else e.chat += 1;
      if (st === 'deferred') e.overnight = true;
      e.last = { author, msg };
      digest.get(fid).set(mid, e);
    }
  }

  for (const [fid, perMember] of digest) {
    const ctx = await getCtx(fid);
    for (const [mid, e] of perMember) {
      const tokens = await tokensFor(ctx, [mid]);
      const total = e.chat + e.nudge;
      let n;
      if (e.nudge && !e.chat) {
        n = {
          title: `${e.last.author}님이 응원을 보냈어요`,
          body: clip(e.last.msg.text, 80) || '오늘의 두뇌 산책, 함께 해요!',
          path: '?open=home', tag: `nudge-${fid}`,
        };
      } else if (total === 1) {
        const m = e.last.msg;
        n = {
          title: m.kind === 'system' ? '우리 가족 대화방' : e.last.author,
          body: clip(m.text, 120) || (m.kind === 'record' ? '훈련 기록을 공유했어요' : '새 메시지가 있어요'),
          path: '?open=chat', tag: `chat-${fid}`,
        };
      } else {
        n = {
          title: '우리 가족 대화방',
          body: (e.overnight ? '밤사이 ' : '') + `새 메시지 ${total}개가 있어요.` + (e.nudge && mid === ctx.traineeId ? ' 가족이 응원도 보냈어요.' : ''),
          path: '?open=chat', tag: `chat-${fid}`,
        };
      }
      stats.digests++;
      await sendPush(tokens, { ...n, ttlSec: 6 * 3600, data: { type: 'chat', familyId: fid } });
    }
  }
}

// ------------------------------------------------------- alarms/reminders
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

async function runAlarmsForFamily(fid, now) {
  const ctx = await loadFamily(fid);
  let done = null;
  const isDone = async () => (done == null ? (done = await courseDoneToday(ctx, now.dateKey)) : done);

  const a = ctx.alarm;
  if (ctx.traineeId && a && Array.isArray(a.days) && a.days.includes(now.weekday) && isDue(a.time, now, WINDOW_MIN)) {
    if (!(await isDone()) && (await claimDaily(fid, ctx.traineeId, 'lastAlarmSentDate', now.dateKey))) {
      stats.alarms++;
      await sendPush(await tokensFor(ctx, [ctx.traineeId]), {
        title: '훈련할 시간이에요!',
        body: '오늘의 두뇌 산책을 시작해 볼까요? 천천히 하셔도 괜찮아요.',
        path: '?open=course', tag: `alarm-${now.dateKey}`, ttlSec: 3 * 3600,
        data: { type: 'alarm', familyId: fid },
      });
    }
  }

  if (!ctx.traineeId || isQuiet(now)) return; // reminders respect quiet hours
  const rems = await famRef(fid).collection('reminders').get();
  for (const r of rems.docs) {
    const mid = r.id;
    const { time, enabled } = r.data();
    if (!enabled || mid === ctx.traineeId || !ctx.members.has(mid) || !isDue(time, now, WINDOW_MIN)) continue;
    if (await isDone()) return;
    if (!(await claimDaily(fid, mid, 'lastReminderSentDate', now.dateKey))) continue;
    stats.reminders++;
    await sendPush(await tokensFor(ctx, [mid]), {
      title: '오늘의 두뇌 산책',
      body: `${withSubject(ctx.traineeLabel)} 아직 훈련 전이에요. 응원 한마디 보내 볼까요?`,
      path: '?open=family', tag: `reminder-${now.dateKey}`, ttlSec: 3 * 3600,
      data: { type: 'reminder', familyId: fid },
    });
  }
}

// ------------------------------------------------------------------ purge
async function purge() {
  const del = async (q) => {
    const s = await q.limit(400).get();
    if (s.empty) return 0;
    const b = db.batch();
    s.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    return s.size;
  };
  const nowTs = Timestamp.now();
  return {
    joinCodes: await del(db.collection('joinCodes').where('expiresTs', '<', nowTs)),
    transferCodes: await del(db.collection('transferCodes').where('expiresTs', '<', nowTs)),
    devices: await del(db.collectionGroup('devices').where('updatedAt', '<', Timestamp.fromMillis(Date.now() - DEVICE_STALE_MS))),
  };
}

// ------------------------------------------------------------------- main
async function main() {
  const now = kstNow(env.NOW_MS ? Number(env.NOW_MS) : Date.now());
  log(`KST ${now.dateKey} ${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`,
    `weekday=${now.weekday} quiet=${isQuiet(now)} window=${WINDOW_MIN}m dryRun=${DRY_RUN}`);

  const fams = await db.collection('families').select().get();
  for (const f of fams.docs) {
    stats.families++;
    try { await runAlarmsForFamily(f.id, now); } catch (e) { stats.errors++; log('alarm error', f.id, e.message); }
  }
  try { await runMessageQueue(now); } catch (e) { stats.errors++; log('queue error', e.message); }
  if (now.minutes >= 3 * 60 && now.minutes < 3 * 60 + 30) {
    try { log('purge', JSON.stringify(await purge())); } catch (e) { stats.errors++; log('purge error', e.message); }
  }
  log('done', JSON.stringify(stats));
  if (stats.errors) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
