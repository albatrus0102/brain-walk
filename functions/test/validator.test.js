'use strict';
/* Validator: every format passes with a good fixture and fails with targeted bad fixtures (DESIGN-AI §2.6, B). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { good, clone } = require('./fixtures/items.js');
const { checkItem, checkItems } = require('../ai/core/item.js');

const CTX = { specVer: 'ref-v1', today: '2026-12-10' };
const run = (it, ctx = {}) => checkItem(it, { ...CTX, ...ctx });
const bad = (name, base, mutate, code, ctx) => test(`${base}: ${name} → ${code}`, () => {
  const it = clone(good[base]); mutate(it);
  const r = run(it, ctx);
  assert.equal(r.ok, false, `expected rejection (${code})`);
  assert.ok(r.codes.includes(code), `codes ${JSON.stringify(r.codes)} should include ${code}`);
});

test('every good fixture passes, with the expected role', () => {
  const trainingOnly = new Set(['card_theme', 'emoji_set', 'date_q', 'lang_complete', 'prospective', 'reminiscence']);
  for (const [k, it] of Object.entries(good)) {
    const r = run(it);
    assert.equal(r.ok, true, `${k}: ${r.codes}`);
    if (it.role === 'reference') assert.equal(r.role, 'reference', `${k} should stay reference`);
    if (trainingOnly.has(k)) assert.equal(r.role, 'training');
  }
});

test('server fills choices/options for SERVER formats and fixes presentation order deterministically', () => {
  const a = run(good.route), b = run(good.route);
  assert.deepEqual(a.item.choices, b.item.choices);
  assert.equal(a.item.choices.find((c) => c.ok).t, '은행');
  assert.deepEqual(a.item.choices.map((c) => c.err).filter(Boolean).sort(), ['CELL_SHIFT', 'CELL_SHIFT', 'LR_CONF']);
  const g = run(good.grid_rotate);
  assert.equal(g.item.options.length, 4);
  assert.ok(g.item.options.every((o) => Array.isArray(o.grid)));
  const s = run(good.sequence);
  assert.notDeepEqual(s.item.present.order, [0, 1, 2, 3, 4]);
});

test('reference logic items get a server-written prompt from the fact structure', () => {
  const r = run(good.logic);
  assert.equal(r.item.prompt, '영수는 민호보다 키가 커요. 민호는 철수보다 키가 커요. 누가 가장 작을까요?');
});

test('reference route items get the server template text', () => {
  const r = run(good.route);
  assert.equal(r.item.body.text, '집에서 아래로 두 칸, 오른쪽으로 한 칸 가면 어디일까요?');
});

// ---------------------------------------------------------------- common
bad('wrong schema', 'word_find', (x) => { x.schema = 'bw.item.v0'; }, 'schema');
bad('bad tempId', 'word_find', (x) => { x.tempId = 'x1'; }, 'schema');
bad('unknown format', 'word_find', (x) => { x.format = 'mmse_recall'; }, 'format');
bad('cdomain mismatch', 'word_find', (x) => { x.cdomain = 'memory'; }, 'cdomain');
bad('level 6', 'word_find', (x) => { x.level = 6; }, 'level');
bad('prompt over 60 chars', 'word_find', (x) => { x.prompt = '가'.repeat(61); }, 'length');
bad('choice over 14 chars', 'word_find', (x) => { x.choices[1].t = '가'.repeat(15); }, 'length');
bad('latin letters', 'word_find', (x) => { x.body.desc = 'umbrella 비 올 때 드는 것'; }, 'charset');
bad('emoji outside the allowlist', 'lang_complete', (x) => { x.prompt = '빈칸에 알맞은 말은? 🛸🦩🧿'; }, 'charset');
bad('two correct choices', 'word_find', (x) => { x.choices[1] = { t: '우비', ok: true }; }, 'answer');
bad('duplicate choice text', 'word_find', (x) => { x.choices[1].t = '양산'; }, 'choices');
bad('wrong choice without err code', 'word_find', (x) => { delete x.choices[1].err; }, 'errcode');
bad('err code from another family', 'word_find', (x) => { x.choices[1].err = 'CALC_NOQTY'; }, 'errcode');
bad('theme not in today\'s list', 'word_recog', (x) => { x.theme = '골프'; x.role = 'training'; }, 'theme', { themes: ['낚시'] });

// ---------------------------------------------------------- banned / PII
bad('medical word', 'lang_complete', (x) => { x.body.sentence = '치매 예방에 좋은 ____을 챙겼어요.'; }, 'banned:medical');
bad('death word', 'word_find', (x) => { x.body.desc = '장례식에 입고 가는 옷'; }, 'banned:death');
bad('politics', 'word_find', (x) => { x.body.desc = '선거 날 들고 가는 것'; }, 'banned:politics');
bad('brand', 'shop_calc', (x) => { x.body.scene = '이마트 할인'; }, 'banned:brand');
bad('shaming wording in explain', 'word_find', (x) => { x.explain = '틀렸습니다 다시 보세요'; }, 'banned:shaming');
bad('famous test task shape', 'word_find', (x) => { x.prompt = '100에서 7을 빼면 얼마일까요?'; }, 'banned:test_tasks');
bad('phone number', 'word_find', (x) => { x.body.desc = '010-1234-5678 로 거는 것'; }, 'pii');
bad('road address', 'story_recall', (x) => { x.body.story = x.body.story.replace('시장에 갔어요', '중앙로 12에 있는 시장에 갔어요'); }, 'pii');
bad('real-looking name', 'story_recall', (x) => { x.body.story = x.body.story.replace('영수 씨는', '김태희 씨는'); }, 'name');
test('allow list: 부처님오신날 / 꽃병 / 병아리 / 커피가 are not banned', () => {
  const it = clone(good.word_find); it.body.desc = '부처님오신날 꽃병 옆 병아리'; it.prompt = '커피가 식기 전에 마시는 그릇은?';
  const r = run(it); assert.ok(!r.codes.some((c) => c.startsWith('banned')), r.codes.join(','));
});
test('"버스로 40분" is not mistaken for an address', () => { assert.equal(run(good.schedule).ok, true); });

// -------------------------------------------------------------- dedupe
test('exact duplicate (same hash) is rejected', () => {
  const first = run(good.analogy);
  const r = run(good.analogy, { recent: { hashes: new Set([first.hash]), sketches: {}, wordLists: [] } });
  assert.deepEqual(r.codes, ['dup']);
});
test('near duplicate (3-gram sketch ≥ 0.7) is rejected', () => {
  const first = run(good.story_recall);
  const it = clone(good.story_recall); it.body.story = it.body.story.replace('나눠 먹었어요', '같이 먹었어요');
  const r = run(it, { recent: { hashes: new Set(), sketches: { story_recall: [first.sketch] }, wordLists: [] } });
  assert.ok(r.codes.includes('near_dup'), r.codes.join(','));
});
test('word list overlapping ≥ 60% with a recent list is rejected', () => {
  const r = run(good.word_recog, { recent: { hashes: new Set(), sketches: {}, wordLists: [['배추', '마늘', '소금', '사과', '포도']] } });
  assert.ok(r.codes.includes('wordlist_overlap'));
});
test('checkItems dedupes inside one batch', () => {
  const p = { schema: 'bw.items.v1', runId: '20261116-0331', items: [good.analogy, good.analogy] };
  const r = checkItems(p, CTX);
  assert.equal(r.accepted.length, 1); assert.deepEqual(r.rejected[0].codes, ['dup']);
});

// --------------------------------------------------------- do-not-copy
bad('known screening word set (hash match)', 'word_recog', (x) => {
  x.body.targets = ['나무', '자동차', '모자'];
  x.body.foils = [{ t: '사과', err: 'INTR_UNREL' }, { t: '고등어', err: 'INTR_UNREL' }, { t: '장미', err: 'INTR_UNREL' }];
  x.features = { targets: 3, total: 6, semFoils: 0, phonFoils: 0, delayed: false }; x.level = 1; x.role = 'training';
  x.qa.solve1 = x.qa.solve2 = '나무,자동차,모자';
}, 'copy_risk');
bad('the app\'s own monthly-check word list', 'word_recog', (x) => {
  x.body.targets = ['우산', '고구마', '기차', '달력', '나비'];
  x.body.foils = [{ t: '감자', err: 'INTR_SEM' }, { t: '축구', err: 'INTR_UNREL' }, { t: '피아노', err: 'INTR_UNREL' }, { t: '잠자리', err: 'INTR_SEM' }, { t: '바지', err: 'INTR_UNREL' }];
  x.features = { targets: 5, total: 10, semFoils: 2, phonFoils: 0, delayed: false }; x.role = 'training';
  x.qa.solve1 = x.qa.solve2 = '우산,고구마,기차,달력,나비';
}, 'copy_risk');
bad('clock-drawing pattern', 'lang_complete', (x) => { x.prompt = '시계에 11시 10분을 그려 볼까요?'; }, 'copy_risk');

// -------------------------------------------------------------------- qa
bad('qa missing', 'word_find', (x) => { delete x.qa; }, 'qa_missing');
bad('qa score below 4', 'word_find', (x) => { x.qa.scores.plain = 3; }, 'qa_scores');
bad('qa score key missing', 'word_find', (x) => { delete x.qa.scores.original; }, 'qa_scores');
bad('blind solves disagree', 'word_find', (x) => { x.qa.solve2 = '우비'; }, 'qa_solve');
bad('blind solve differs from the answer', 'shop_calc', (x) => { x.qa.solve1 = x.qa.solve2 = '9,300원'; }, 'qa_solve');
bad('reminiscence without basis', 'reminiscence', (x) => { x.qa.basis = null; }, 'qa_missing');

// ------------------------------------------------------------- per format
bad('word_recog: features lie about targets', 'word_recog', (x) => { x.features.targets = 6; }, 'features');
bad('word_recog: INTR_SEM foil not in a target category', 'word_recog', (x) => { x.body.foils[0] = { t: '기린', err: 'INTR_SEM' }; }, 'errcode');
bad('word_recog: INTR_PHON foil too far in sound', 'word_recog', (x) => { x.body.foils[1] = { t: '컴퓨터', err: 'INTR_PHON' }; x.features.phonFoils = 1; }, 'errcode');
bad('word_recog: reference level table (5/10 at L3)', 'word_recog', (x) => { x.body.targets.pop(); x.features.targets = 4; x.features.total = 9; x.qa.solve1 = x.qa.solve2 = '배추,마늘,소금,고춧가루'; }, 'level');
bad('word_recog: target repeated as foil', 'word_recog', (x) => { x.body.foils[1].t = '배추'; }, 'choices');
bad('card_theme: emoji outside the allowlist', 'card_theme', (x) => { x.body.cards[0][0] = '🧿'; }, 'emoji');
bad('card_theme: cards count lies', 'card_theme', (x) => { x.features.cards = 9; }, 'features');
bad('emoji_set: sim level lies', 'emoji_set', (x) => { x.features.sim = 1; }, 'features');
bad('emoji_set: identical pair', 'emoji_set', (x) => { x.body.pairs[0] = ['😀', '😀']; }, 'choices');
bad('date_q: no special day on that date', 'date_q', (x) => { x.body.query.weekday = 1; }, 'date_no_holiday');
bad('date_q: answer changes inside the window', 'date_q', (x) => { x.body.query = { type: 'weekday_of', ref: 'today' }; x.features.type = 'weekday_of'; }, 'date_window');
bad('date_q: window over two weeks', 'date_q', (x) => { x.validTo = '2026-12-31'; }, 'date_window');
bad('date_q: uncertain solar term (2030 우수 near midnight)', 'date_q', (x) => {
  x.validFrom = '2030-01-01'; x.validTo = '2030-01-05'; x.body.query = { type: 'date_of', name: '우수', year: 2030 }; x.features.type = 'date_of';
}, 'date_uncertain', { today: '2029-12-30' });
test('date_q: server computes 추석 2027 and builds the choices', () => {
  const it = clone(good.date_q); it.validFrom = '2027-09-01'; it.validTo = '2027-09-05'; it.body.query = { type: 'date_of', name: '추석', year: 2027 }; it.features.type = 'date_of'; it.qa.solve1 = it.qa.solve2 = '9월 15일';
  const r = run(it, { today: '2027-08-30' });
  assert.equal(r.ok, true, r.codes.join(','));
  assert.equal(r.item.choices.find((c) => c.ok).t, '9월 15일');
});
bad('lang_complete: particle gives the answer away', 'lang_complete', (x) => { x.choices[1].t = '모자'; }, 'particle');
bad('lang_complete: two blanks', 'lang_complete', (x) => { x.body.sentence = '____와 ____을 챙겼어요.'; }, 'field');
test('lang_relation: a distractor that is also a registered antonym is rejected', () => {
  const lx = require('../ai/core/lexicon.js').lexicon();
  lx.rel.add('넓다|antonym|높다');
  try { assert.ok(run(good.lang_relation).codes.includes('answer')); } finally { lx.rel.delete('넓다|antonym|높다'); }
});
test('lang_relation: unregistered pair is kept as training only', () => {
  const it = clone(good.lang_relation); it.body.word = '단단하다'; it.prompt = '‘단단하다’와 뜻이 반대인 말은?'; it.body.answer = '물렁하다';
  it.choices = [{ t: '물렁하다', ok: true }, { t: '딱딱하다', err: 'REL_REVERSE' }, { t: '단정하다', err: 'PHON' }, { t: '무겁다', err: 'SEM_FAR' }]; it.qa.solve1 = it.qa.solve2 = '물렁하다';
  const r = run(it); assert.equal(r.ok, true, r.codes.join(',')); assert.equal(r.role, 'training');
});
bad('lang_category: odd one is actually in the category', 'lang_category', (x) => { x.body.odd = '상추'; x.choices[0].t = '상추'; x.qa.solve1 = x.qa.solve2 = '상추'; }, 'recompute');
bad('lang_category: ambiguous word (배)', 'lang_category', (x) => { x.choices[1].t = '배'; x.body.members[0] = '배'; }, 'lexicon');
bad('lang_category: L1 must have 3 choices', 'lang_category', (x) => { x.level = 1; }, 'level');
bad('word_find: description contains the answer', 'word_find', (x) => { x.body.desc = '비 올 때 쓰는 우산'; }, 'answer_leak');
test('analogy: a distractor with the same relation to c is rejected', () => {
  const lx = require('../ai/core/lexicon.js').lexicon();
  lx.rel.add('붓|tool_material|종이');
  try { assert.ok(run(good.analogy).codes.includes('answer')); } finally { lx.rel.delete('붓|tool_material|종이'); }
});
test('analogy: pair not in the relation lexicon stays training-only', () => {
  const it = clone(good.analogy); it.body = { a: '숟가락', b: '국', c: '젓가락', answer: '반찬', rel: 'tool_material' }; it.prompt = '숟가락 : 국 = 젓가락 : ?';
  it.choices = [{ t: '반찬', ok: true }, { t: '컵', err: 'SEM_NEAR' }, { t: '물', err: 'REL_WRONG' }]; it.qa.solve1 = it.qa.solve2 = '반찬';
  const r = run(it); assert.equal(r.ok, true, r.codes.join(',')); assert.equal(r.role, 'training');
});
bad('shop_calc: wrong change', 'shop_calc', (x) => { x.choices[0].t = '9,300원'; x.qa.solve1 = x.qa.solve2 = '9,300원'; }, 'recompute');
bad('shop_calc: CALC_NOQTY amount is not the no-quantity total', 'shop_calc', (x) => { x.choices[2].t = '12,500원'; }, 'errcode');
bad('shop_calc: price outside the real range', 'shop_calc', (x) => { x.body.shops[0].lines[1].price = 90000; }, 'price');
bad('shop_calc: price not in 100 won steps', 'shop_calc', (x) => { x.body.shops[0].lines[1].price = 2050; }, 'field');
bad('shop_calc: money format', 'shop_calc', (x) => { x.choices[1].t = '7400원'; }, 'format_money');
bad('shop_calc: features lie', 'shop_calc', (x) => { x.features.deals = 0; }, 'features');
bad('shop_calc: digits in the prompt not in the body', 'shop_calc', (x) => { x.prompt = '30000원을 냈어요. 거스름돈은 얼마일까요?'; }, 'prompt_numbers');
bad('sequence: order not unique (missing link)', 'sequence', (x) => { x.body.before.splice(1, 1); }, 'unique');
bad('sequence: duplicate step', 'sequence', (x) => { x.body.steps[2] = x.body.steps[1]; }, 'choices');
bad('sequence: step over 22 chars', 'sequence', (x) => { x.body.steps[0] = '가'.repeat(23); }, 'length');
bad('schedule: wrong departure', 'schedule', (x) => { x.choices[0].t = '오후 1시 30분'; x.qa.solve1 = x.qa.solve2 = '오후 1시 30분'; x.choices[1].t = '오후 1시 25분'; }, 'recompute');
bad('schedule: TIME_DIR distractor is not the reversed calculation', 'schedule', (x) => { x.choices[2].t = '오후 3시'; }, 'errcode');
bad('schedule: number in the prompt not in the body', 'schedule', (x) => { x.prompt = x.prompt.replace('40분', '45분'); }, 'prompt_numbers');
bad('logic: two possible answers', 'logic', (x) => { x.body.facts = [['영수', '>', '민호']]; x.features.facts = 1; }, 'unique');
bad('logic: answer is not what the facts say', 'logic', (x) => { x.choices = [{ t: '민호', ok: true }, { t: '영수', err: 'LOGIC_REVERSE' }, { t: '철수', err: 'LOGIC_PARTIAL' }]; x.qa.solve1 = x.qa.solve2 = '민호'; }, 'recompute');
bad('logic: person name outside the allowed list', 'logic', (x) => { x.body.entities[0] = '태희'; }, 'name');
bad('letter_search: count is wrong', 'letter_search', (x) => { x.body.line[1] = '가'; }, 'features');
bad('letter_search: LOOKALIKE is not target + most similar', 'letter_search', (x) => { x.choices[3].t = '8개'; }, 'errcode');
bad('letter_search: line too short for L3', 'letter_search', (x) => { x.body.line = x.body.line.slice(0, 8); x.features = { length: 8, lookalikes: 5, targets: 3 }; x.choices = [{ t: '3개', ok: true }, { t: '2개', err: 'COUNT_UNDER' }, { t: '4개', err: 'COUNT_OVER' }]; x.qa.solve1 = x.qa.solve2 = '3개'; }, 'level');
bad('story_recall: answer not in the story', 'story_recall', (x) => { x.body.questions[1].choices[0].t = '삼치'; x.body.facts[3].v = '삼치'; }, 'recompute');
bad('story_recall: SRC_CONF distractor not in the story', 'story_recall', (x) => { x.body.questions[0].choices[2].t = '이모'; }, 'errcode');
bad('story_recall: unrelated distractor appears in the story', 'story_recall', (x) => { x.body.questions[0].choices[3].t = '시장'; }, 'errcode');
bad('story_recall: sentence count lies', 'story_recall', (x) => { x.features.sentences = 5; }, 'features');
bad('story_recall: story over 220 chars', 'story_recall', (x) => { x.body.story += ' 그리고'.repeat(60); }, 'field');
bad('prospective: cue not an app button', 'prospective', (x) => { x.body.cue = '🍎'; }, 'field');
bad('prospective: instruction misses the event phrase', 'prospective', (x) => { x.body.instruction = '화면 아래 🌼 단추를 눌러 주세요.'; }, 'field');
bad('grid_pattern: frames do not follow the rule', 'grid_pattern', (x) => { x.body.frames[2] = x.body.frames[1]; }, 'recompute');
bad('grid_pattern: two options collide', 'grid_pattern', (x) => { x.options[3].err = 'RULE_PARTIAL'; }, 'grid_options');
bad('grid_pattern: emoji outside allowlist', 'grid_pattern', (x) => { x.body.frames[0][2][2] = '🧿'; }, 'grid');
bad('grid_rotate: symmetric source', 'grid_rotate', (x) => { x.body.src = [['🟧', '⬜', '🟧'], ['⬜', '🟧', '⬜'], ['🟧', '⬜', '🟧']]; x.features.colored = 5; }, 'grid_symmetric');
bad('grid_rotate: wrong op for the level', 'grid_rotate', (x) => { x.body.op = 'same'; x.features.op = 'same'; }, 'level');
bad('grid_memory: cell outside the grid', 'grid_memory', (x) => { x.body.cells[0] = [4, 0]; }, 'grid');
bad('grid_memory: level table (L3 = 4×4, 5 cells, 3 s)', 'grid_memory', (x) => { x.body.showMs = 2000; x.features.showMs = 2000; }, 'level');
bad('route: walks off the map', 'route', (x) => { x.body.steps[0].go = 4; x.body.text = '집에서 아래로 네 칸, 오른쪽으로 한 칸 가면 어디일까요?'; x.features.steps = 5; }, 'route');
bad('route: ends on an empty cell', 'route', (x) => { x.body.steps = [{ dir: 'down', go: 1 }]; x.body.text = '집에서 아래로 한 칸 가면 어디일까요?'; x.features.steps = 1; x.features.turns = 0; }, 'route');
bad('route: text and steps disagree', 'route', (x) => { x.body.text = '집에서 아래로 세 칸, 오른쪽으로 한 칸 가면 어디일까요?'; }, 'prompt_numbers');
bad('route: place emoji not allowed (church)', 'route', (x) => { x.body.map[3][3] = '⛪'; }, 'emoji');
bad('reminiscence: number as the answer', 'reminiscence', (x) => { x.body.answer = '1970년'; x.choices[0].t = '1970년'; x.qa.solve1 = x.qa.solve2 = '1970년'; }, 'answer_number');
test('reminiscence goes to admin review', () => { assert.equal(run(good.reminiscence).review, true); });

// --------------------------------------------------------------- roles
test('reference request for a training-only format is downgraded, not rejected', () => {
  const it = clone(good.lang_complete); it.role = 'reference';
  const r = run(it); assert.equal(r.ok, true); assert.equal(r.role, 'training');
});
test('reference with a theme is downgraded', () => {
  const it = clone(good.shop_calc); it.theme = '낚시';
  const r = run(it, { themes: ['낚시'] }); assert.equal(r.ok, true); assert.equal(r.role, 'training');
});
test('reference with another spec version is rejected', () => {
  const it = clone(good.shop_calc); it.specVer = 'ref-v0';
  assert.deepEqual(run(it).codes, ['spec']);
});

// --------------------------------------------------------------- quota
test('checkItems stops at maxItems and marks the rest as quota', () => {
  const items = ['word_find', 'analogy', 'shop_calc', 'logic'].map((k) => good[k]);
  const r = checkItems({ schema: 'bw.items.v1', runId: '20261116-0331', items }, { ...CTX, maxItems: 2 });
  assert.equal(r.accepted.length, 2); assert.equal(r.rejected.filter((x) => x.codes.includes('quota')).length, 2);
});
test('checkItems rejects a malformed envelope', () => {
  assert.equal(checkItems({ schema: 'bw.items.v1', runId: 'now', items: [] }, CTX).schemaOk, false);
});

// ---- review hardening: a compromised generator cannot smuggle fields, markup or deep nesting; answer keys are recomputed right
const { qa } = require('./fixtures/items.js');
bad('markup in an unknown body key', 'lang_complete', (it) => { it.body.html = '<img src=x onerror=alert(1)>'; }, 'charset');
bad('markup in a choice extra key', 'lang_complete', (it) => { it.choices[1].note = '<script>'; }, 'charset');
bad('ampersand entity in qa.risk', 'lang_complete', (it) => { it.qa.risk = '&lt;b&gt;'; }, 'charset');
bad('own __proto__ key', 'lang_complete', (it) => { Object.defineProperty(it.body, '__proto__', { value: { polluted: 1 }, enumerable: true, configurable: true, writable: true }); }, 'field');
bad('deeply nested features', 'lang_complete', (it) => { let d = it.features = {}; for (let i = 0; i < 50; i++) { d.x = {}; d = d.x; } }, 'field');

test('unknown top-level, body and choice keys are dropped from the stored item', () => {
  const it = clone(good.lang_complete); it.extra = '아무 말'; it.body.note = '메모'; it.choices[1].note = '메모';
  const r = run(it);
  assert.equal(r.ok, true, String(r.codes));
  assert.deepEqual(Object.keys(r.item.body).sort(), ['answer', 'sentence']);
  assert.equal(r.item.extra, undefined);
  for (const c of r.item.choices) assert.deepEqual(Object.keys(c).sort(), c.ok ? ['ok', 't'] : ['err', 't']);
  assert.equal(({}).polluted, undefined);
});
test('every good fixture keeps its format fields after whitelisting', () => {
  for (const [k, it] of Object.entries(good)) {
    const r = run(it);
    for (const key of Object.keys(it.body)) assert.ok(key in r.item.body || (k === 'route' && key === 'text'), `${k}.body.${key} dropped`);
  }
});

const setItem = (choices, answer) => Object.assign(clone(good.logic), {
  role: 'training', prompt: '참새는 모두 새예요. 새는 물고기가 아니에요. 짹짹이는 물고기예요. 짹짹이는 참새일까요?',
  body: { type: 'set', facts: [['all', '참새', '새'], ['none', '새', '물고기'], ['is', '짹짹이', '물고기']], ask: ['is', '짹짹이', '참새'] },
  features: { people: 0, facts: 3 }, choices, qa: qa(answer),
});
test('logic set: disjointness through a superset gives 아니요, not 알 수 없어요', () => {
  assert.equal(run(setItem([{ t: '아니요', ok: true }, { t: '네', err: 'LOGIC_REVERSE' }, { t: '알 수 없어요', err: 'LOGIC_PARTIAL' }], '아니요')).ok, true);
  const wrong = run(setItem([{ t: '알 수 없어요', ok: true }, { t: '네', err: 'LOGIC_PARTIAL' }, { t: '아니요', err: 'LOGIC_PARTIAL' }], '알 수 없어요'));
  assert.equal(wrong.ok, false); assert.ok(wrong.codes.includes('recompute'));
});
test('logic set: contradictory facts are rejected', () => {
  const it = setItem([{ t: '네', ok: true }, { t: '아니요', err: 'LOGIC_REVERSE' }, { t: '알 수 없어요', err: 'LOGIC_PARTIAL' }], '네');
  it.body.facts = [['all', '참새', '새'], ['none', '참새', '새'], ['is', '짹짹이', '참새']]; it.prompt = '참새는 모두 새예요. 참새는 새가 아니에요. 짹짹이는 참새예요. 짹짹이는 참새일까요?';
  const r = run(it); assert.equal(r.ok, false); assert.ok(r.codes.includes('unique'));
});
test('grid_pattern alternate (A, B, A → B) is accepted; alternate combined with another rule is not', () => {
  const A = [['🔵', '⬜', '⬜'], ['⬜', '⬜', '⬜'], ['⬜', '⬜', '⬜']], B = [['⬜', '⬜', '⬜'], ['⬜', '⬜', '🔵'], ['⬜', '⬜', '⬜']];
  const it = clone(good.grid_pattern);
  Object.assign(it, { role: 'training', features: { size: 3, frames: 3, rules: 1, cells: 1 }, qa: qa('⬜⬜⬜/⬜⬜🔵/⬜⬜⬜'),
    options: [{ grid: 'SERVER' }, { grid: 'SERVER', err: 'MIRROR' }, { grid: 'SERVER', err: 'STEP_SKIP' }] });
  it.body = { size: 3, frames: [A, B, A], rule: { op: 'alternate' } };
  const r = run(it); assert.equal(r.ok, true, String(r.codes));
  assert.deepEqual(r.item.options.find((o) => o.ok).grid, B);
  it.body.rule = [{ op: 'alternate' }, { op: 'rotate90' }]; it.features.rules = 2;
  assert.equal(run(it).ok, false);
});
