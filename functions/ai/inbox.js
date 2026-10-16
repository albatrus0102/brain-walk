'use strict';
/**
 * aiInbox onDocumentCreated: validate routine output instantly (DESIGN-AI Appendix B.1).
 * items  → checkItems (+ DB dedupe, daily quota; themes = union of the trainees' themes) → aiBank / aiRejects →
 *          every trainee's packs, shared bank needs, bank status
 * report → checkReport → trainees/{mid}/aiReports (or the template) → Telegram
 * Logs counts and codes only.
 */
const { db, fam, FieldValue, expireIn } = require('./fb.js');
const { checkItems } = require('./core/item.js');
const { getConfig, SPEC_VER, LIMITS, RETENTION_DAYS } = require('./config.js');
const bank = require('./bank.js');
const { handleReport } = require('./reports.js');
const F = require('./family.js');
const kd = require('./core/kdate.js');
const log = require('./log.js');

async function claim(ref) {
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('status') !== 'new') return null;
    tx.update(ref, { status: 'processing' });
    return s.data();
  });
}
const preview = (it) => String((it && (it.prompt || (it.body && (it.body.story || it.body.title || it.body.sentence || it.body.desc)))) || '').slice(0, 80);

async function processInbox(ref, nowMs = Date.now()) {
  const doc = await claim(ref);
  if (!doc) return { skipped: true };
  const cfg = await getConfig();
  const fid = cfg.familyId;
  let payload;
  try { payload = JSON.parse(doc.payload); } catch { await ref.update({ status: 'done', result: { error: 'json' } }); log.warn('inbox', { kind: doc.kind, error: 'json' }); return { error: 'json' }; }
  if (!fid) { await ref.update({ status: 'done', result: { error: 'no_family' } }); return { error: 'no_family' }; }

  if (doc.kind === 'report') {
    const r = await handleReport(fid, payload, doc.jobId || 'scheduled', nowMs);
    await ref.update({ status: 'done', result: { ok: r.ok, codes: r.codes } });
    log.info('report', { ok: r.ok, codes: r.codes, job: doc.jobId === 'scheduled' ? 'scheduled' : 'job' });
    return r;
  }

  const ctxs = await F.traineeContexts(fid);
  const themes = F.unionThemes(ctxs.map((c) => c.themes));
  const recent = await bank.loadRecent();
  const res = checkItems(payload, { specVer: SPEC_VER, today: kd.kst(nowMs).date, themes, recent, maxItems: LIMITS.itemsPerSubmit });
  if (!res.schemaOk) { await ref.update({ status: 'done', result: { error: 'schema' } }); log.warn('inbox', { kind: 'items', error: 'schema' }); return { error: 'schema' }; }
  const take = await bank.takeQuota(res.accepted.length);
  const accepted = res.accepted.slice(0, take);
  res.accepted.slice(take).forEach((a) => res.rejected.push({ i: a.i, tempId: a.item.tempId, format: a.item.format, codes: ['quota'] }));
  await bank.insertAccepted(accepted, { inboxId: ref.id });
  await bank.addStems(accepted.map((a) => a.item));
  const codes = {};
  for (let i = 0; i < res.rejected.length; i += 400) {
    const b = db().batch();
    for (const r of res.rejected.slice(i, i + 400)) {
      r.codes.forEach((c) => { codes[c] = (codes[c] || 0) + 1; });
      b.set(db().collection('aiRejects').doc(), { inboxId: ref.id, tempId: r.tempId || null, format: r.format || null, codes: r.codes, preview: preview(payload.items[r.i]), ts: FieldValue.serverTimestamp(), expireAt: expireIn(RETENTION_DAYS.rejects) });
    }
    await b.commit();
  }
  const result = { accepted: accepted.length, rejected: res.rejected.length, codes, downgraded: accepted.filter((a) => a.role !== a.requestedRole).length };
  const today = kd.kst(nowMs).date;
  const h = fam(fid).collection('aiOps').doc('health');
  const hs = await h.get(); const gen = (hs.exists && hs.get('gen')) || {};
  const okDays = (gen.okDays || []).filter((d) => d >= kd.addDays(today, -6));
  if (accepted.length && !okDays.includes(today)) okDays.push(today);
  await h.set({ gen: { lastSubmitTs: FieldValue.serverTimestamp(), lastRunId: payload.runId, lastAccepted: accepted.length, lastRejected: res.rejected.length, lastOkDate: accepted.length ? today : (gen.lastOkDate || null), okDays } }, { merge: true });
  // last-7-days intake for the bank screen
  const bs = await fam(fid).collection('aiOps').doc('bank').get();
  const intake = ((bs.exists && bs.get('intake')) || []).filter((x) => x.date >= kd.addDays(today, -6));
  intake.push({ date: today, received: payload.items.length, accepted: accepted.length, rejected: res.rejected.length, codes });
  if (accepted.length) for (const c of ctxs) await bank.rebuildPacks(fid, c.mid, c.themes);
  const counts = await bank.bankCounts();
  await bank.writeBankStatus(fid, counts, { intake });
  await F.writeFamilyBankNeeds(fid, counts, ctxs);
  await ref.update({ status: 'done', result });   // last: packs, needs and status are already rebuilt
  log.info('items', { received: payload.items.length, accepted: accepted.length, rejected: res.rejected.length, codes });
  return result;
}

module.exports = { processInbox };
