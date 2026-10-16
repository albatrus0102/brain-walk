import { alarmOf, courseStatus, focusId, getPlan, myTrainee, todayS, trainees } from './data.js';
import { alarmShouldShow } from './logic.js';
import { isTrainingDay } from './program.js';
import { beep, effectiveSound, say } from './sound.js';
import { S } from './state.js';
import { render } from './ui/shell.js';
import { LS } from './util.js';

/* ================= 알람 (앱이 열려 있을 때) ================= */
/* 알람 요일의 기본값은 훈련 계획의 훈련 요일이에요 (알람은 훈련하는 날에만 울려요) */
export const alarmCfg = (id = focusId()) => alarmOf(id) || (id && id === myTrainee() ? LS.get('bw.alarm', null) : null) || { time: '10:00', days: (getPlan(id).weekdays || [0, 1, 2, 3, 4, 5, 6]).slice() };
/* 오늘 훈련하는 날인데 아직 시작하지 않은 훈련하는 분들 (가족 기기의 확인 시간 배너) */
export const notStartedIds = now => trainees().filter(id => isTrainingDay(getPlan(id), now) && !courseStatus(id).any);
export function alarmTick(quiet) {
  try {
    const now = new Date(), cs = courseStatus(), snooze = Number(LS.get('bw.snooze', 0)) || 0;
    const me = myTrainee(), due = !!me && isTrainingDay(getPlan(me), now) && alarmShouldShow(alarmCfg(me), now, cs.done, snooze);
    const rem = S.myReminder;
    S.remIds = !me && rem && rem.enabled ? notStartedIds(now) : [];
    const remDue = !me && S.remIds.length > 0 && alarmShouldShow({ time: rem.time, days: [0, 1, 2, 3, 4, 5, 6] }, now, false, 0) && LS.get('bw.remDismiss', '') !== todayS();
    const changed = due !== S.alarmDue || remDue !== S.remDue;
    S.alarmDue = due; S.remDue = remDue;
    if (due && LS.get('bw.alarmFired', '') !== todayS()) {
      LS.set('bw.alarmFired', todayS());
      if (S.interacted && effectiveSound()) { beep('chime'); say('훈련할 시간이에요. 오늘의 훈련을 시작해 볼까요?'); }
    }
    if (changed && !quiet && S.screen === 'home') render(true);
  } catch (e) {}
}
