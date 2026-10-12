#!/usr/bin/env node
/**
 * Create (or rotate) the routine key.
 *
 *   gcloud auth application-default login            # once, as a project owner
 *   cd functions && node ai/tools/set-routine-key.mjs --project brain-walk --family <familyId> [--out ~/bw-routine-key.txt]
 *
 * 1. generates a 48-character random key (A–Z a–z 0–9, ~285 bits)
 * 2. writes it ONCE to a local file with mode 600 (default ./routine-key.txt, refuses to overwrite)
 * 3. writes ONLY sha256(key) to Firestore aiConfig/main.routineKeyHash (Admin SDK, Application Default Credentials)
 *    plus familyId / pseudonym / enabled when given. The key itself is never printed, logged or stored in the DB.
 * Then paste the key into the routine environment's setup script (see brain-walk-ai/SETUP.md) and delete the file.
 * Rotating = run again with a new --out file; the old key stops working within 60 s (config cache).
 * Revoking without a new key: --revoke (deletes routineKeyHash → endpoints answer 503).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const project = arg('--project', process.env.GOOGLE_CLOUD_PROJECT);
if (!project) { console.error('--project <id> is required'); process.exit(2); }
initializeApp({ projectId: project });
const db = getFirestore();
const ref = db.doc('aiConfig/main');

if (process.argv.includes('--revoke')) {
  await ref.set({ routineKeyHash: FieldValue.delete(), keyRevokedTs: FieldValue.serverTimestamp() }, { merge: true });
  console.log('routine key revoked (aiRead/aiSubmit answer 503 within 60 s)');
  process.exit(0);
}
const out = path.resolve(arg('--out', 'routine-key.txt').replace(/^~(?=$|\/)/, os.homedir()));
if (fs.existsSync(out)) { console.error(`${out} already exists — choose another --out (the key is shown only once)`); process.exit(2); }

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let key = '';
while (key.length < 48) { const b = crypto.randomBytes(64); for (const x of b) if (x < 248 && key.length < 48) key += ALPHA[x % 62]; }
const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex');

fs.writeFileSync(out, key + '\n', { mode: 0o600, flag: 'wx' });
fs.chmodSync(out, 0o600);
const upd = { routineKeyHash: hash, keyRotatedTs: FieldValue.serverTimestamp() };
const fam = arg('--family'); if (fam) upd.familyId = fam;
if (arg('--pseudonym')) upd.pseudonym = arg('--pseudonym');
if (process.argv.includes('--enable')) upd.enabled = true;
if (arg('--app-url')) upd.appUrl = arg('--app-url');
await ref.set(upd, { merge: true });
console.log(`key written to ${out} (mode 600). Firestore aiConfig/main now holds only its sha256.`);
console.log('Copy it into the routine environment setup script, then delete the file.');
