# tests

세 가지 시험이 있어요. 모두 이 저장소의 루트에서 쓰는 파일을 읽으니, 아래 명령은 `tests/` 안에서 실행해요.

```
cd tests
npm install            # firebase, firebase-tools, @firebase/rules-unit-testing, playwright
```

## 1) 보안 규칙 시험 — `rules.test.mjs`
Firestore 에뮬레이터에 `firestore.rules` 를 올려 놓고 허용/거부 사례를 확인해요 (가족 만들기, 코드 탈취 시도, 만료 코드, 메시지/반응/넛지 제한, 기기 옮기기 1회용, 소유자 권한 등).

```
npm test        # = firebase emulators:exec --only firestore ... node tests/rules.test.mjs
```
필요한 것: Node 20 이상, **Java 11 이상**(에뮬레이터). 처음 실행하면 에뮬레이터 jar 를 한 번 내려받아요. 끝에 `N passed, 0 failed` 가 나와야 해요. `firestore.rules` 를 고치면 항상 다시 돌리세요.

## 2) FirebaseAdapter 스모크 시험 — `adapter-smoke.mjs`
실제 앱 코드(`js/store/*`)를 노드에서 Firestore + Auth 에뮬레이터에 연결해, 사람 셋(A 아버지, B 가족, C 새 기기)이 **서로 다른 프로세스**로 다음을 해요: 가족 만들기 → 코드로 들어가기 → 메시지·반응·확인(ack) → 넛지(2시간 제한 포함) → 기록 저장 → 가족 코드 다시 보기/새로 만들기 → 기기 옮기기 코드 → 가족 나가기 → 가족 전체 삭제.

```
npm run test:smoke
```
끝에 `SMOKE: ALL PASSED`. (노드에는 브라우저 저장소가 없어서 `localStorage` 등을 흉내 내고, SDK 는 npm `firebase` 패키지로 바꿔 끼워요. `setSdkImporter` 참고.)

## 3) 체험 모드 화면 시험 — `e2e-demo.mjs`
Playwright(Chromium)로 화면을 직접 눌러 봐요: 설정 안내 화면 → 체험 모드 → 오늘의 훈련 한 판 → 가족 기록 → 설정(ICS 다운로드, 삭제 확인) 등. 콘솔 오류가 하나라도 있으면 실패해요.

```
cd .. && python3 -m http.server 8000 --directory ..   # /brain-walk/ 아래로 보이게 하려면 상위 폴더에서 서빙
BASE=http://localhost:8000/brain-walk/ CHROME=/path/to/chromium npm run test:e2e
```
(`firebase-config.js` 가 채워지지 않은 상태에서 돌려야 설정 안내 화면부터 시험돼요. `CHROME` 을 비우면 `/opt/pw-browsers/chromium` 을 써요.)

## 4) 기타
- `npm run check` : `sw.js` 문법과 캐시 파일 목록이 실제 파일과 같은지 확인.
- 모든 JS 문법 확인: `find js tools -name '*.js' -o -name '*.mjs' | xargs -n1 node --check`
