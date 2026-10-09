import { getLevel } from '../../data.js';
import { DOMAINS, GAMES, gamesOf } from '../../games/registry.js';
import { SCREENS } from '../registry.js';
import { levelDots } from '../widgets.js';
import { esc } from '../../util.js';

SCREENS.pick = {
  html() {
    return '<div class="stack"><h1 class="t-headline" id="pick-h">어떤 훈련을 해 볼까요?</h1><p class="t-body muted">하고 싶은 훈련을 하나 골라 주세요. 단계는 정답률에 따라 자동으로 맞춰져요.</p>' +
      DOMAINS.map(d => '<section aria-labelledby="dom-' + d.id + '"><h2 class="t-title" id="dom-' + d.id + '">' + d.name + '</h2><p class="t-small muted">' + d.desc + '</p><div class="pick-list mt">' +
        gamesOf(d.id).map(id => '<button type="button" class="gamebtn" id="game-' + id + '" data-act="game" data-id="' + id + '"><span><strong>' + esc(GAMES[id].name) + '</strong><span class="t-small muted">' + esc(GAMES[id].desc) + '</span></span><span class="t-small" style="text-align:right">' + getLevel(id) + '단계<br>' + levelDots(getLevel(id)) + '</span></button>').join('') +
        '</div></section>').join('') + '</div>';
  }
};
