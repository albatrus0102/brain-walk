#!/usr/bin/env node
/**
 * "베끼면 안 되는 목록" 지문 만들기 (DESIGN-AI 부록 B.6).
 *
 * 원문은 저장소에 두지 않아요. 개발자가 공개된 출처에서 옮긴 원문을 **저장소 밖의** 파일에 적고,
 * 이 스크립트로 해시만 만들어 data/donotcopy.json 에 합쳐요.
 *
 *   node functions/ai/tools/make-donotcopy.mjs <원문파일> [--write]
 *
 * 원문 파일 형식 (한 줄에 하나):
 *   words <이름> : 낱말1, 낱말2, 낱말3        → 낱말마다 해시 (겹치는 낱말 수를 셀 수 있게)
 *   story <이름> : 이야기 문장 …             → 글자 3-그램 해시 집합
 * '#' 으로 시작하는 줄은 주석이에요.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { dncWordHash, trigrams, dncGramHash } = require('../core/text.js');

const [src, flag] = process.argv.slice(2);
if (!src) { console.error('usage: make-donotcopy.mjs <source-file outside the repo> [--write]'); process.exit(2); }
const out = { wordSets: [], stories: [] };
for (const raw of fs.readFileSync(src, 'utf8').split('\n')) {
  const line = raw.trim(); if (!line || line.startsWith('#')) continue;
  const m = line.match(/^(words|story)\s+([^:]+):\s*(.+)$/); if (!m) { console.error('skip (bad line)'); continue; }
  const [, kind, label, body] = m;
  if (kind === 'words') out.wordSets.push({ label: label.trim(), h: body.split(/[,，]/).map(w => w.trim()).filter(Boolean).map(dncWordHash) });
  else out.stories.push({ label: label.trim(), g: [...trigrams(body)].map(dncGramHash) });
}
const file = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/donotcopy.json');
const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const s of out.wordSets) { cur.wordSets = cur.wordSets.filter(x => x.label !== s.label); cur.wordSets.push(s); }
for (const s of out.stories) { cur.stories = cur.stories.filter(x => x.label !== s.label); cur.stories.push(s); }
if (flag === '--write') { fs.writeFileSync(file, JSON.stringify(cur, null, 1) + '\n'); console.log(`wrote ${out.wordSets.length} word sets, ${out.stories.length} stories`); }
else console.log(JSON.stringify(out, null, 1));
