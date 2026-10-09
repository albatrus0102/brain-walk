import { courseStatus, isTrainee, todayS, traineeId } from './data.js';
import { alarmShouldShow } from './logic.js';
import { beep, say } from './sound.js';
import { S } from './state.js';
import { render } from './ui/shell.js';
import { LS } from './util.js';

/* ================= 알람 (앱이 열려 있을 때) ================= */
export const alarmCfg = () => S.alarm || LS.get('bw.alarm', null) || { time: '10:00', days: [0, 1, 2, 3, 4, 5, 6] };
export function alarmTick(quiet) {
  try {
    const now = new Date(), cs = courseStatus(), snooze = Number(LS.get('bw.snooze', 0)) || 0;
    const due = isTrainee() && alarmShouldShow(alarmCfg(), now, cs.done, snooze);
    const rem = S.myReminder;
    const remDue = !isTrainee() && !!traineeId() && !!(rem && rem.enabled) && alarmShouldShow({ time: rem.time, days: [0, 1, 2, 3, 4, 5, 6] }, now, cs.any, 0) && LS.get('bw.remDismiss', '') !== todayS();
    const changed = due !== S.alarmDue || remDue !== S.remDue;
    S.alarmDue = due; S.remDue = remDue;
    if (due && LS.get('bw.alarmFired', '') !== todayS()) {
      LS.set('bw.alarmFired', todayS());
      if (S.interacted && S.prefs.sound) { beep('chime'); say('훈련할 시간이에요. 오늘의 훈련을 시작해 볼까요?'); }
    }
    if (changed && !quiet && S.screen === 'home') render(true);
  } catch (e) {}
}
