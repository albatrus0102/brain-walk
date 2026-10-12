import { reg, regTask } from './registry.js';
import { S } from '../state.js';
import { delayedQuestion, tryBank } from './items.js';

/* ================= AI 문제 은행으로만 하는 새 게임 (CLIENT-CONTRACT §2.3) =================
 * 훈련 계획에서 관리자가 켜기 전에는 나오지 않아요 (defOff). 은행이 비어 있으면 코스에서 빠지고 (session.js),
 * 골라서 하기에서 열면 "오늘은 준비된 문제가 없어요" 라고만 말해요. 모든 글은 items.js 가 textContent 로 그려요. */
function emptyRound(ctx) {
  ctx.logged = true;                       // 코드가 만든 문항이 아니라서 기록하지 않아요
  ctx.prompt('오늘은 준비된 문제가 아직 없어요. 다음에 또 만나요.');
  ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: '괜찮아요. 다음에 새 문제가 준비되면 만나요.' });
}
function bankGame(def) {
  reg(Object.assign({ defOff: true, bank: true }, def, {
    play(ctx) {
      const it = ctx.draw(def.cd, def.formats);
      if (it && tryBank(ctx, it)) return;
      emptyRound(ctx);
    }
  }));
}
bankGame({ id: 'story', name: '이야기 듣기', domain: 'memory', desc: '짧은 이야기를 듣고 기억해요', rounds: 2, cd: 'memory', hostCds: ['memory'], formats: ['story_recall'] });
bankGame({ id: 'shapes', name: '모양 퍼즐', domain: 'attention', desc: '모양의 규칙을 찾고 돌린 모양을 골라요', rounds: 3, cd: 'visuospatial', hostCds: ['visuospatial'], formats: ['grid_pattern', 'grid_rotate', 'grid_memory'] });
bankGame({ id: 'route', name: '길 찾기', domain: 'executive', desc: '동네 지도에서 길을 따라가 봐요', rounds: 3, cd: 'visuospatial', hostCds: ['visuospatial'], formats: ['route'] });
bankGame({ id: 'think', name: '생각 퍼즐', domain: 'executive', desc: '순서와 시간을 차근차근 생각해요', rounds: 3, cd: 'executive', hostCds: ['executive'], formats: ['logic', 'schedule'] });
bankGame({ id: 'letters', name: '글자 찾기', domain: 'attention', desc: '줄에서 같은 글자가 몇 개인지 세어요', rounds: 3, cd: 'attention', hostCds: ['attention'], formats: ['letter_search'] });
bankGame({ id: 'olden', name: '옛날 이야기', domain: 'orientation', desc: '그 시절 살림과 풍습을 떠올려요', rounds: 3, cd: 'reminiscence', hostCds: [], formats: ['reminiscence'] });

/* 코스 끝에 늦게 묻는 이야기 질문 (이야기 듣기 에서 모아 둔 것). 훈련 코스 목록에는 나오지 않는 내부 게임이에요. */
regTask({ id: 'delayedq', name: '이야기 다시 떠올리기', domain: 'memory', desc: '아까 들은 이야기를 떠올려요', rounds: 1, cd: 'memory', hostCds: [],
  play(ctx) {
    const list = (S.course && S.course.delayed) || [], spec = list[ctx.round];
    if (!spec) { ctx.logged = true; ctx.prompt('다시 물어볼 이야기가 없어요.'); return ctx.finish({ neutral: true, ok: true, correct: 0, total: 0, msg: '괜찮아요. 마무리해요.' }); }
    delayedQuestion(ctx, spec);
  }
});
