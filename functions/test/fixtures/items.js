'use strict';
/**
 * One valid item per format (DESIGN-AI Appendix A examples, corrected where the example itself breaks
 * a rule: lang_complete particles, route ⛪ → 🏫, card_theme 🐚/🏖️ not in the allowlist).
 * Tests mutate deep copies of these to build bad cases.
 */
const SCORES = { clear: 5, single: 5, distractor: 4, plain: 5, respect: 5, safe: 5, original: 5 };
const qa = (solve, extra = {}) => ({ solve1: solve, solve2: solve, scores: { ...SCORES }, risk: '헷갈릴 만한 보기가 분명히 달라요', basis: null, ...extra });
let n = 0;
const base = (format, cdomain, level, extra) => ({
  schema: 'bw.item.v1', tempId: `g-20261116-0331-${String(++n).padStart(4, '0')}`, format, cdomain, level,
  role: 'training', specVer: 'ref-v1', theme: null, features: {}, prompt: null, speak: null, explain: null, validFrom: null, validTo: null, ...extra,
});

const good = {
  word_recog: base('word_recog', 'memory', 3, {
    role: 'reference',
    features: { targets: 5, total: 10, semFoils: 1, phonFoils: 0, delayed: false },
    prompt: '다섯 가지 낱말을 기억해 주세요.',
    body: { theme: '김장', targets: ['배추', '마늘', '소금', '고춧가루', '무'],
      foils: [{ t: '양파', err: 'INTR_SEM' }, { t: '우산', err: 'INTR_UNREL' }, { t: '기차', err: 'INTR_UNREL' }, { t: '연필', err: 'INTR_UNREL' }, { t: '시계', err: 'INTR_UNREL' }] },
    qa: qa('배추,마늘,소금,고춧가루,무'),
  }),
  card_theme: base('card_theme', 'memory', 2, {
    features: { cards: 10, similarPairs: 1 },
    body: { theme: '바닷가', cards: [['🦀', '게'], ['🐟', '물고기'], ['🐙', '문어'], ['⛵', '돛단배'], ['🌊', '파도'], ['🦑', '오징어'], ['🐬', '돌고래'], ['🐳', '고래'], ['🐠', '열대어'], ['🦐', '새우']], similar: [[2, 5]] },
    qa: qa(null),
  }),
  emoji_set: base('emoji_set', 'attention', 4, {
    features: { sim: 3 }, body: { pairs: [['😀', '😃'], ['🐭', '🐹'], ['🍐', '🍏']], category: '닮은 얼굴과 동물' }, qa: qa(null),
  }),
  date_q: base('date_q', 'orientation', 3, {
    validFrom: '2026-12-13', validTo: '2026-12-19', prompt: '다음 주 금요일은 무슨 날일까요?',
    body: { query: { type: 'holiday_of', ref: 'next_week', weekday: 5 } }, features: { type: 'holiday_of' }, qa: qa('성탄절'),
  }),
  lang_complete: base('lang_complete', 'language', 2, {
    prompt: '빈칸에 알맞은 말은?', body: { sentence: '비가 많이 와서 ____을 챙겼어요.', answer: '우산' },
    choices: [{ t: '우산', ok: true }, { t: '수건', err: 'SEM_NEAR' }, { t: '수박', err: 'SEM_FAR' }, { t: '우상', err: 'PHON' }], qa: qa('우산'),
  }),
  lang_relation: base('lang_relation', 'language', 3, {
    role: 'reference', prompt: '‘넓다’와 뜻이 반대인 말은?', body: { word: '넓다', rel: 'antonym', answer: '좁다' },
    choices: [{ t: '좁다', ok: true }, { t: '높다', err: 'SEM_NEAR' }, { t: '넓적하다', err: 'PHON' }, { t: '크다', err: 'REL_REVERSE' }], qa: qa('좁다'),
  }),
  lang_category: base('lang_category', 'language', 4, {
    role: 'reference', prompt: '다음 중 ‘채소’가 아닌 것을 골라 주세요.',
    body: { category: '채소', mode: 'odd_one_out', members: ['배추', '시금치', '오이'], odd: '참외' },
    choices: [{ t: '참외', ok: true }, { t: '배추', err: 'SEM_NEAR' }, { t: '시금치', err: 'SEM_NEAR' }, { t: '오이', err: 'SEM_NEAR' }], qa: qa('참외'),
  }),
  word_find: base('word_find', 'language', 3, {
    role: 'reference', prompt: '비 올 때 펴서 머리 위에 드는 것은 무엇일까요?', body: { desc: '비 올 때 펴서 머리 위에 드는 것', answer: '우산' },
    choices: [{ t: '우산', ok: true }, { t: '우비', err: 'SEM_NEAR' }, { t: '양산', err: 'SEM_NEAR' }, { t: '우상', err: 'PHON' }], qa: qa('우산'),
  }),
  analogy: base('analogy', 'language', 3, {
    role: 'reference', prompt: '바늘 : 실 = 붓 : ?', body: { a: '바늘', b: '실', c: '붓', answer: '먹물', rel: 'tool_material' },
    choices: [{ t: '먹물', ok: true }, { t: '종이', err: 'REL_WRONG' }, { t: '연필', err: 'SEM_NEAR' }, { t: '벼루', err: 'REL_WRONG' }], qa: qa('먹물'),
  }),
  shop_calc: base('shop_calc', 'executive', 4, {
    role: 'reference', prompt: '이만 원을 냈어요. 거스름돈은 얼마일까요?',
    features: { lines: 3, shops: 2, maxQty: 2, deals: 1, ask: 'change' },
    body: { scene: '동네 시장', shops: [
      { name: '채소 가게', lines: [{ item: '배추', price: 3500, qty: 2, unit: '포기' }, { item: '대파', price: 2000, qty: 1, unit: '단' }] },
      { name: '두부 가게', lines: [{ item: '두부', price: 1800, qty: 2, unit: '모' }], deal: { type: 'bogo', item: '두부' } }], pay: 20000, ask: 'change' },
    choices: [{ t: '9,200원', ok: true }, { t: '7,400원', err: 'CALC_DEAL_IGNORED' }, { t: '12,700원', err: 'CALC_NOQTY' }, { t: '10,800원', err: 'CALC_SUM_AS_CHANGE' }],
    qa: qa('9,200원'),
  }),
  sequence: base('sequence', 'executive', 3, {
    role: 'reference', features: { steps: 5, intruder: false },
    body: { kind: 'procedure', title: '택배 보내기',
      steps: ['상자에 물건을 넣는다', '테이프로 상자를 봉한다', '받는 주소를 붙인다', '우체국 창구에 낸다', '요금을 내고 영수증을 받는다'],
      before: [[0, 1, '넣어야 봉할 수 있음'], [1, 2, '봉한 상자에 붙임'], [2, 3, '주소가 있어야 접수'], [3, 4, '접수 후 요금']] },
    qa: qa('상자에 물건을 넣는다>테이프로 상자를 봉한다>받는 주소를 붙인다>우체국 창구에 낸다>요금을 내고 영수증을 받는다'),
  }),
  schedule: base('schedule', 'executive', 3, {
    role: 'reference', prompt: '병원 예약이 오후 2시예요. 버스로 40분 걸리고, 10분 일찍 도착하고 싶어요. 늦어도 몇 시에 나가야 할까요?',
    body: { events: [{ what: '병원 예약', at: '14:00' }], travelMin: 40, bufferMin: 10, ask: 'latest_departure' },
    choices: [{ t: '오후 1시 10분', ok: true }, { t: '오후 1시 20분', err: 'TIME_BUFFER_SKIP' }, { t: '오후 2시 40분', err: 'TIME_DIR' }, { t: '오후 1시', err: 'CALC_NEAR' }],
    qa: qa('오후 1시 10분'),
  }),
  logic: base('logic', 'executive', 3, {
    role: 'reference', prompt: '영수는 민호보다 키가 크고, 민호는 철수보다 키가 커요. 누가 가장 작을까요?',
    features: { people: 3, facts: 2 },
    body: { type: 'order', attr: '키', entities: ['영수', '민호', '철수'], facts: [['영수', '>', '민호'], ['민호', '>', '철수']], ask: 'min' },
    choices: [{ t: '철수', ok: true }, { t: '영수', err: 'LOGIC_REVERSE' }, { t: '민호', err: 'LOGIC_PARTIAL' }], qa: qa('철수'),
  }),
  letter_search: base('letter_search', 'attention', 3, {
    role: 'reference', prompt: '아래 줄에서 ‘가’는 몇 개일까요?',
    body: { line: ['가', '거', '기', '가', '고', '가', '구', '거', '가', '기', '고', '가'], target: '가' },
    features: { length: 12, lookalikes: 7, targets: 5 },
    choices: [{ t: '5개', ok: true }, { t: '4개', err: 'COUNT_UNDER' }, { t: '6개', err: 'COUNT_OVER' }, { t: '7개', err: 'LOOKALIKE' }], qa: qa('5개'),
  }),
  story_recall: base('story_recall', 'memory', 3, {
    role: 'reference', features: { sentences: 4, facts: 6, questions: 3, delayedQ: 1, choices: 4 },
    body: {
      story: '토요일 아침, 영수 씨는 손녀와 함께 시장에 갔어요. 생선 가게에서 고등어 두 마리를 샀어요. 옆 가게 아주머니가 귤 하나를 덤으로 주셨어요. 돌아오는 길에 붕어빵을 사서 나눠 먹었어요.',
      facts: [{ slot: 'day', v: '토요일' }, { slot: 'with', v: '손녀' }, { slot: 'place', v: '시장' }, { slot: 'bought', v: '고등어' }, { slot: 'count', v: '두 마리' }, { slot: 'snack', v: '붕어빵' }],
      questions: [
        { q: '영수 씨는 누구와 함께 갔나요?', slot: 'with', delayed: false, choices: [{ t: '손녀', ok: true }, { t: '아들', err: 'INTR_SEM' }, { t: '아주머니', err: 'SRC_CONF' }, { t: '친구', err: 'INTR_UNREL' }] },
        { q: '생선 가게에서 무엇을 샀나요?', slot: 'bought', delayed: false, choices: [{ t: '고등어', ok: true }, { t: '갈치', err: 'INTR_SEM' }, { t: '귤', err: 'SRC_CONF' }, { t: '두부', err: 'INTR_UNREL' }] },
        { q: '돌아오는 길에 무엇을 먹었나요?', slot: 'snack', delayed: true, choices: [{ t: '붕어빵', ok: true }, { t: '호떡', err: 'INTR_SEM' }, { t: '귤', err: 'SRC_CONF' }, { t: '국수', err: 'INTR_UNREL' }] }] },
    qa: qa('손녀|고등어|붕어빵'),
  }),
  prospective: base('prospective', 'memory', 2, {
    body: { cue: '🌼', event: 'after_last_item', instruction: '오늘 마지막 문제가 끝나면 화면 아래 🌼 단추를 눌러 주세요.', reminderMid: false },
    features: { event: 'after_last_item', distractorCue: false }, qa: qa(null),
  }),
  grid_pattern: base('grid_pattern', 'visuospatial', 3, {
    role: 'reference', prompt: '모양이 규칙대로 바뀌어요. 다음 모양은 무엇일까요?',
    features: { size: 3, frames: 3, rules: 1, cells: 1 },
    body: { size: 3, empty: '⬜', frames: [
      [['🔵', '⬜', '⬜'], ['⬜', '⬜', '⬜'], ['⬜', '⬜', '⬜']],
      [['⬜', '🔵', '⬜'], ['⬜', '⬜', '⬜'], ['⬜', '⬜', '⬜']],
      [['⬜', '⬜', '🔵'], ['⬜', '⬜', '⬜'], ['⬜', '⬜', '⬜']]], rule: { op: 'shift', dx: 1, dy: 0, wrap: 'next_row' } },
    options: [{ grid: 'SERVER' }, { grid: 'SERVER', err: 'RULE_PARTIAL' }, { grid: 'SERVER', err: 'MIRROR' }, { grid: 'SERVER', err: 'STEP_SKIP' }],
    qa: qa('⬜⬜⬜/🔵⬜⬜/⬜⬜⬜'),
  }),
  grid_rotate: base('grid_rotate', 'visuospatial', 3, {
    role: 'reference', prompt: '왼쪽 모양을 시계 방향으로 한 번(90도) 돌리면 어느 것일까요?',
    features: { size: 3, colored: 5, op: 'rot90' },
    body: { size: 3, src: [['🟧', '🟧', '⬜'], ['⬜', '🟧', '⬜'], ['⬜', '🟧', '🟦']], op: 'rot90' },
    options: [{ grid: 'SERVER' }, { grid: 'SERVER', err: 'MIRROR' }, { grid: 'SERVER', err: 'ROT_ANGLE' }, { grid: 'SERVER', err: 'ROT_ANGLE' }],
    qa: qa('⬜⬜🟧/🟧🟧🟧/🟦⬜⬜'),
  }),
  grid_memory: base('grid_memory', 'visuospatial', 3, {
    role: 'reference', features: { size: 4, cells: 5, showMs: 3000 },
    body: { size: 4, cells: [[0, 1], [1, 3], [2, 0], [3, 2], [3, 3]], showMs: 3000, fill: '🟩' },
    options: [{ grid: 'SERVER' }, { grid: 'SERVER', err: 'CELL_SHIFT' }, { grid: 'SERVER', err: 'MIRROR' }, { grid: 'SERVER', err: 'MISS' }],
    qa: qa('⬜🟩⬜⬜/⬜⬜⬜🟩/🟩⬜⬜⬜/⬜⬜🟩🟩'),
  }),
  route: base('route', 'visuospatial', 3, {
    role: 'reference', features: { size: 4, steps: 3, turns: 1, frame: 'screen' },
    body: { size: 4, map: [['⬜', '🏠', '⬜', '🏥'], ['⬜', '⬜', '🌳', '⬜'], ['🏪', '⬜', '🏦', '⬜'], ['⬜', '📮', '⬜', '🏫']],
      start: [0, 1], frame: 'screen', steps: [{ dir: 'down', go: 2 }, { dir: 'right', go: 1 }], text: '집에서 아래로 두 칸, 오른쪽으로 한 칸 가면 어디일까요?' },
    choices: 'SERVER', qa: qa('은행'),
  }),
  reminiscence: base('reminiscence', 'reminiscence', 2, {
    prompt: '연탄을 갈 때 쓰던 도구는 무엇일까요?',
    body: { topic: '옛날 살림', answer: '연탄집게', talk: '연탄불을 꺼뜨리지 않으려고 밤에 일어나 갈곤 했지요.' },
    choices: [{ t: '연탄집게', ok: true }, { t: '부지깽이', err: 'ERA_NEAR' }, { t: '국자', err: 'PLAUSIBLE' }, { t: '가위', err: 'PLAUSIBLE' }],
    qa: qa('연탄집게', { basis: '연탄 난방은 1970~80년대 도시 가정에 널리 쓰였고 연탄집게는 그 도구로 널리 알려짐' }),
  }),
};

const clone = (x) => JSON.parse(JSON.stringify(x));
module.exports = { good, clone, qa, SCORES };
