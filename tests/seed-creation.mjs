// 시험용: Firestore 에뮬레이터에 '가족방 만들기 코드'(해시만)와 appConfig/primary 를 심어요 (규칙을 건너뛰는 에뮬레이터 관리자 권한).
import { createHash } from 'node:crypto';
export const CREATE_CODE = 'test-create-code-1';
const HOST = () => process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
async function put(path, fields) {
  const url = `http://${HOST()}/v1/projects/demo-bw/databases/(default)/documents/${path}`;
  const r = await fetch(url, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + path + ' ' + r.status + ' ' + await r.text());
}
export async function seedCreation(code = CREATE_CODE, primaryFid = null) {
  await put('appConfig/creation', { codeHash: { stringValue: createHash('sha256').update(code).digest('hex') }, setBy: { stringValue: 'seed' }, updatedTs: { timestampValue: new Date().toISOString() } });
  if (primaryFid) await put('appConfig/primary', { fid: { stringValue: primaryFid } });
}
