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

## 3) 화면 시험 (Playwright, 체험 모드 중심)
Playwright(Chromium)로 화면을 직접 눌러 봐요. 콘솔 오류가 하나라도 있으면 실패해요. 모두 `firebase-config.js` 가 **채워지지 않은 상태**에서 돌려요(설정 안내 화면부터 시험).

| 파일 | 확인하는 것 |
|---|---|
| `e2e-demo.mjs` | 설정 안내 → 체험 모드 → 오늘의 훈련 한 판 → 훈련하는 분 메뉴 3개 → 설정(ICS 실제 다운로드, 삭제 확인) → 채팅 안내 |
| `e2e-surveys.mjs` | 설문 목록, KDSQ-C 원문/채점/참고 기준 문구, PHQ-9 9번 안내 창(109, 1577-0199), 본인 답은 점수 숨김, 가족 기록의 설문 결과 |
| `e2e-tasks.mjs` | 월간 점검 2부분의 자체 과제 8개 끝까지(타이머 20배속), 쉬는 화면/내일 이어서 하기, 가족 기록의 과제 상세 |
| `e2e-records.mjs` | 잠 기록, 시계 그리기(캔버스, 저장 크기), 가족의 시계 그림 보기, 일상생활 체크 |
| `e2e-clinical.mjs` | 치매안심센터 카드, 병원·센터 검사 기록 폼(점진적 입력), 추세, 재검 알림, 채팅 공유 확인창, 훈련하는 분에게 숨김 |
| `e2e-onboarding.mjs` | 연결 실패 → 체험 모드, `?join=CODE` 미리 입력, 가입 화면들, 초대 복사/카톡 문구/대체 복사, iOS 홈 화면 안내 (SDK 로드를 막고 화면만 확인. 실제 가입은 스모크 시험이 에뮬레이터로 확인) |
| `e2e-install.mjs` | 홈 화면 설치 안내: 가짜 `beforeinstallprompt` 로 설치 카드·`prompt()` 호출·`appinstalled`·닫기 7일, 카카오톡/네이버 안 `kakaotalk://`·`intent://` 링크(`?join=` 유지), 아이폰 사파리 그림 안내, 설정의 "앱 설치" 줄, 가장 큰 글자·다크 화면 |
| `e2e-pwa.mjs` | 매니페스트, 아이콘, 서비스 워커 등록, 오프라인에서 앱 열림 |

```
cd .. && python3 -m http.server 8765 --directory ..   # 저장소 폴더 이름이 brain-walk 라서 /brain-walk/ 아래로 보이게 상위 폴더에서 서빙
cd tests && BASE=http://localhost:8765/brain-walk/ CHROME=/path/to/chromium node e2e-demo.mjs   # 나머지도 같은 방법
npm run test:e2e   # = e2e-demo 만
```
(`CHROME` 을 비우면 `/opt/pw-browsers/chromium`, `PW_MODULES` 로 playwright 위치를 바꿀 수 있어요.)

## 4) 기타
- `npm run check` : `sw.js` 문법과 캐시 파일 목록이 실제 파일과 같은지 확인.
- 모든 JS 문법 확인: `find js tools -name '*.js' -o -name '*.mjs' | xargs -n1 node --check`
