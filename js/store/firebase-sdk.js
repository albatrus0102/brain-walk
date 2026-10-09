/* Firebase JS SDK 로더 (빌드 없이 CDN 의 모듈을 동적 import).
 * 버전은 한 곳에서만 고정합니다. sw.js / pages.yml 의 버전과 같아야 해요. */
export const SDK_VERSION = '11.10.0';
export const CDN = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION;

let importer = name => import(CDN + '/' + name + '.js');
/* 테스트용: 노드에서는 npm 'firebase' 패키지로 바꿔 끼울 수 있어요. */
export function setSdkImporter(fn) { importer = fn; }
export const loadSdk = name => importer('firebase-' + name);
