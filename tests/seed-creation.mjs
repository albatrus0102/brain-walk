// 시험용: Firestore 에뮬레이터에 '가족방 만들기 코드'(해시만)와 appConfig/primary 를 심어요 (규칙을 건너뛰는 에뮬레이터 관리자 권한).
import { createHash } from 'node:crypto';
const sha = x => createHash('sha256').update(x).digest('hex');
// 앱과 같은 정리: 대문자, 공백·줄표 제거 (앱이 보내는 증거 = sha256(정리한 코드))
const norm = c => String(c).toUpperCase().replace(/[\s\-\u2010-\u2015\u2212]+/g, '');
export const CREATE_CODE = 'test-create-code-1';
const HOST = () => process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
async function put(path, fields) {
  const url = `http://${HOST()}/v1/projects/demo-bw/databases/(default)/documents/${path}`;
  const r = await fetch(url, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + path + ' ' + r.status + ' ' + await r.text());
}
export async function seedCreation(code = CREATE_CODE, primaryFid = null) {
  await put('appConfig/creation', { codeHash: { stringValue: sha(sha(norm(code))) }, setBy: { stringValue: 'seed' }, updatedTs: { timestampValue: new Date().toISOString() } });
  if (primaryFid) await put('appConfig/primary', { fid: { stringValue: primaryFid } });
}
// 에뮬레이터 관리자 권한으로 문서가 있는지 확인 (규칙을 건너뜀)
export async function docExists(path) {
  const r = await fetch(`http://${HOST()}/v1/projects/demo-bw/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } });
  return r.ok;
}
