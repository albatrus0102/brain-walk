import { acknowledge, withdraw, consentSpeech, consentText } from '../../ai/consent.js';
import { traineeLabel } from '../../data.js';
import { say } from '../../sound.js';
import { ACTS } from '../acts.js';
import { dialog, toast } from '../dom.js';
import { SCREENS } from '../registry.js';
import { go } from '../shell.js';
import { esc } from '../../util.js';

/* 아버지 안내 화면 (처음 한 번, DESIGN-AI §8.6). 글자 크기는 화면 설정을 따르고, 소리 안내가 켜져 있으면 읽어 드려요. */
SCREENS.aiConsent = {
  html() {
    const t = consentText(traineeLabel());
    return '<div class="stack consent"><h1 class="t-headline" id="cons-h">' + esc(t.title) + '</h1>' +
      '<section class="card elevated" aria-label="안내">' + t.paras.map((p, i) => '<p class="t-body' + (i ? ' mt' : '') + '" id="cons-p' + i + '">' + esc(p) + '</p>').join('') + '</section>' +
      '<div class="cta"><button class="btn filled huge" id="btn-consent-ok" type="button" data-act="consent-ok">알겠어요</button>' +
      '<button class="btn tonal" id="btn-consent-fam" type="button" data-act="consent-fam">가족과 함께 봤어요</button></div></div>';
  },
  bind() { say(consentSpeech(traineeLabel())); }
};
async function ack(withFamily) {
  const ok = await acknowledge(withFamily);
  if (!ok) toast('지금은 저장하지 못했어요. 다음에 한 번 더 보여 드릴게요.');
  go('home');
  import('../../boot.js').then(m => m.startFlow()).catch(() => {});
}
ACTS['consent-ok'] = () => ack(false);
ACTS['consent-fam'] = () => ack(true);
ACTS['consent-withdraw'] = () => dialog('가족이 숫자를 살펴보는 것을 멈출까요?', '멈추면 새 숫자를 모으지 않아요. 훈련은 그대로 하실 수 있어요. 나중에 안내를 다시 보면 다시 시작해요.', [{ label: '그대로 둘게요', kind: 'filled' }, { label: '멈추기', kind: 'text', run: async () => toast((await withdraw()) ? '멈췄어요.' : '지금은 저장하지 못했어요.') }]);
