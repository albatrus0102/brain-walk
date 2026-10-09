import { Store } from '../store/store.js';
import { S } from '../state.js';
import { writeErrMsg, traineeId } from '../data.js';
import { SURVEYS, bandOf } from './content.js';
import { toast } from '../ui/dom.js';
import { ymd } from '../util.js';

/* 설문 기록: surveys/{id} = { kind, version, answers[], score, ts, date, mode, answeredBy, subjectId?, relation? } */
export const recordsOf = kind => (S.surveys || []).filter(x => x && x.kind === kind && typeof x.ts === 'number').sort((a, b) => b.ts - a.ts);
export const scoreOf = (kind, answers) => SURVEYS[kind].score(answers);

export async function saveSurvey(kind, answers, mode, relation) {
  const sv = SURVEYS[kind], now = new Date();
  const doc = { kind, version: sv.version, answers: answers.slice(), score: sv.score(answers), ts: Date.now(), date: ymd(now), mode, answeredBy: S.myId || 'local' };
  if (traineeId()) doc.subjectId = traineeId();
  if (relation) doc.relation = String(relation).slice(0, 20);
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  try { await Store.setDoc('surveys/' + id, doc); return Object.assign({ id }, doc); }
  catch (e) { toast(writeErrMsg(e)); return null; }
}

/* 지난번과 비교 (중립 표현: 높다/낮다. 좋고 나쁨을 색으로 나누지 않아요) */
export function trendOf(kind) {
  const r = recordsOf(kind); if (r.length < 2) return null;
  const d = Math.round((r[0].score - r[1].score) * 100) / 100, u = SURVEYS[kind].id === 'iqcode' ? '점' : '점';
  if (Math.abs(d) < (kind === 'iqcode' ? 0.1 : 1)) return { dir: 'same', text: '지난번(' + r[1].date.slice(5).replace('-', '/') + ')과 비슷해요' };
  return { dir: d > 0 ? 'up' : 'down', text: '지난번(' + r[1].date.slice(5).replace('-', '/') + ')보다 ' + Math.abs(d) + u + (d > 0 ? ' 높아요' : ' 낮아요') };
}
export function summaryOf(kind) {
  const r = recordsOf(kind); if (!r.length) return null;
  const sv = SURVEYS[kind], last = r[0];
  return { last, band: bandOf(sv, last.score), trend: trendOf(kind), history: r.slice(0, 6).reverse(), count: r.length };
}
