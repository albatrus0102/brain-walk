#!/usr/bin/env node
/**
 * Runs tests/ai-emulator.test.mjs and then tests/ai-client-contract.test.mjs (app-built docs → rules → functions) inside `firebase emulators:exec --only functions,firestore` and then
 * scans EVERYTHING printed (emulator, function logs, test output) for leaks: the routine key, its hash,
 * Telegram/fire tokens, item text, names and formatted scores must never appear.
 *
 *   cd tests && npm run test:ai      (Java 11+, functions/node_modules installed: cd functions && npm i)
 *
 * Writes emulator-only files functions/.env.local and functions/.secret.local for the run (fake values,
 * pointing Telegram and the routine fire URL at a local mock) and restores whatever was there before.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fn = (f) => path.join(root, 'functions', f);
const PORT = 18765;
const KEY = crypto.randomBytes(36).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 48);
const SECRETS = { TELEGRAM_BOT_TOKEN: 'tg-test-SECRET-7d1f', TELEGRAM_CHAT_ID: '4242', ROUTINE_REPORTER_URL: `http://127.0.0.1:${PORT}/fire`, ROUTINE_REPORTER_TOKEN: 'fire-test-SECRET-9a2c' };
const files = {
  '.env.local': `APP_URL=https://example.test/brain-walk/\nTELEGRAM_API_BASE=http://127.0.0.1:${PORT}/tg\nAI_CONFIG_TTL_SEC=1\n${process.env.AI_DEBUG_ERRORS ? "AI_DEBUG_ERRORS=true\n" : ""}`,
  '.secret.local': Object.entries(SECRETS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
};
const backup = {};
for (const [f, body] of Object.entries(files)) { if (fs.existsSync(fn(f))) backup[f] = fs.readFileSync(fn(f)); fs.writeFileSync(fn(f), body); }
const restore = () => { for (const f of Object.keys(files)) { if (backup[f]) fs.writeFileSync(fn(f), backup[f]); else fs.rmSync(fn(f), { force: true }); } };

const bin = path.join(root, 'tests/node_modules/.bin/firebase');
const child = spawn(bin, ['emulators:exec', '--only', 'functions,firestore', '--project', 'demo-bw', 'node tests/ai-emulator.test.mjs && node tests/ai-client-contract.test.mjs'], {
  cwd: root, env: { ...process.env, AI_TEST_KEY: KEY, AI_TEST_PORT: String(PORT), AI_TEST_SECRETS: JSON.stringify(SECRETS) },
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
child.on('close', (code) => {
  restore();
  const keyHash = crypto.createHash('sha256').update(KEY).digest('hex');
  // Things that must never be printed by functions or tests. (The test prints only names of checks and counts.)
  const forbidden = [KEY, keyHash, SECRETS.TELEGRAM_BOT_TOKEN, SECRETS.ROUTINE_REPORTER_TOKEN,
    '토요일 아침', '손녀와 함께', '고등어', '연탄집게', '택배 보내기', '배추', '시험아버지', '시험아들', '%p', '주당 ', '평소 범위', '느림'];
  const leaks = forbidden.filter((s) => out.includes(s)).map((s) => (s === KEY ? '<routine key>' : s === keyHash ? '<key hash>' : s.includes('SECRET') ? '<secret>' : s));
  const pass = /AI EMULATOR: ALL PASSED/.test(out) && /AI CLIENT CONTRACT: ALL PASSED/.test(out);   // + the app ↔ backend contract test (ai-client-contract.test.mjs)
  console.log(`\nlog scan: ${leaks.length ? 'LEAKS ' + JSON.stringify(leaks) : 'no key, secret, item text, name or score in any output'}`);
  process.exit(code === 0 && pass && !leaks.length ? 0 : 1);
});
