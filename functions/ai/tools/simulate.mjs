#!/usr/bin/env node
/**
 * Threshold tuning (DESIGN-AI §4.6, D.7) — run by hand 6–8 weeks after the baseline, then every 6 months.
 * Not scheduled. Prints counts only (no item content).
 *
 *   node functions/ai/tools/simulate.mjs --synthetic [--sims 2000]            # sanity run, no database
 *   GOOGLE_CLOUD_PROJECT=brain-walk node functions/ai/tools/simulate.mjs --firestore [--sims 10000] [--write]
 *        reads aiConfig/main.familyId → families/{fid}/aiStats/summary (baseline weeks) with ADC
 *        (gcloud auth application-default login). --write stores the result in families/{fid}/aiOps/thresholds.
 *
 * Search: start from the defaults; while orange alarms > 1/year or yellow > 6/year on no-change data, raise
 * |z| / EWMA L / CUSUM h by 0.1. Then report how many weeks an injected 10%p (8 weeks) + 15% RT decline needs.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { simulate, syntheticBaseline } = require('../core/simulate.js');
const { DEFAULT_T } = require('../core/signals.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const has = (k) => process.argv.includes(k);
const sims = Number(arg('--sims', has('--firestore') ? 10000 : 1000));

let base, fid = null, db = null, model = { sigma: 0.35 };
if (has('--firestore')) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT });
  db = getFirestore();
  fid = (await db.doc('aiConfig/main').get()).get('familyId');
  if (!fid) { console.error('aiConfig/main.familyId is not set'); process.exit(2); }
  const sum = (await db.doc(`families/${fid}/aiStats/summary`).get()).data() || { weeks: [] };
  base = sum.weeks.filter((w) => w.idx >= 1 && w.idx <= 4 && w.n > 0);
  const m = (await db.doc(`families/${fid}/aiStats/model`).get()).data(); if (m) model = m;
  if (base.length < 3) { console.error(`only ${base.length} baseline weeks — finish the baseline first`); process.exit(2); }
  base = base.map((w) => ({ ...w, spd: w.spd == null ? 0 : w.spd, spdN: w.spdN || 30 }));
} else base = syntheticBaseline({ seed: arg('--seed', 'synthetic') });

let T = { ...DEFAULT_T };
let r;
for (let step = 0; step < 30; step++) {
  r = simulate(base, { sims, weeks: 104, seed: 'tune' + step, thresholds: T, model });
  console.log(`step ${step}: zO=${T.zO.toFixed(2)} L_O=${T.ewmaLO.toFixed(2)} h=${T.cusumH.toFixed(1)} → orange/yr ${r.orangePerYear.toFixed(3)} yellow/yr ${r.yellowPerYear.toFixed(2)}`);
  if (r.orangePerYear <= 1 && r.yellowPerYear <= 6) break;
  T = { ...T, zY: T.zY - 0.1, zO: T.zO - 0.1, ewmaLY: T.ewmaLY + 0.1, ewmaLO: T.ewmaLO + 0.1, cusumH: T.cusumH + 0.1 };
}
const inj = simulate(base, { sims: Math.min(sims, 2000), weeks: 52, seed: 'inject', thresholds: T, model, inject: { startWeek: 10, overWeeks: 8, accDrop: 0.10, rtUp: 0.15 } });
const caught = inj.firstCaught.filter((x) => x != null).sort((a, b) => a - b);
const result = {
  thresholds: { ...T, ver: 'v' + new Date().toISOString().slice(0, 10).replace(/-/g, '') }, orangePerYear: r.orangePerYear, yellowPerYear: r.yellowPerYear,
  injected: { caughtShare: caught.length / inj.runs, medianWeeks: caught.length ? caught[Math.floor(caught.length / 2)] : null }, sims, baselineWeeks: base.length,
};
console.log(JSON.stringify(result, null, 1));
if (has('--write') && db) {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.doc(`families/${fid}/aiOps/thresholds`).set({ current: result.thresholds, history: FieldValue.arrayUnion({ ...result, at: new Date().toISOString() }) }, { merge: true });
  console.log('saved to aiOps/thresholds (used by the next aggregation run)');
}
