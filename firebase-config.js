// firebase-config.js — 관리자가 한 번만 채우는 설정 파일이에요.
//
// ▶ 이 파일의 값은 공개되어도 괜찮아요. (Firebase 웹 설정은 원래 공개용이고,
//   실제 보호는 firestore.rules 가 해요.)
// ▶ 절대 넣지 마세요: 서비스 계정 키(JSON), 비공개 키. 그런 파일은 이 저장소에 올리면 안 돼요.
// ▶ 클래식 스크립트라서 앱(index.html)과 서비스 워커(sw.js)가 같은 파일을 읽어요.
//   "export" 를 쓰지 마세요.
//
// 채우는 방법: README.md 의 4번(웹 앱 등록)과 8번(푸시 키)을 따라 하세요.
// "REPLACE_ME" 가 하나라도 남아 있으면 앱은 "관리자 설정이 필요해요" 화면을 보여 줘요.
self.BW_CONFIG = {
  firebase: {
    // Firebase 콘솔 > 프로젝트 설정(톱니바퀴) > 일반 > 내 앱(웹) > SDK 설정 및 구성 에서 복사
    apiKey: "AIzaSyAVX_pEi8RxqOjTq-l-MirQ-Z0vyOJjXZ8",
    authDomain: "brain-walk.firebaseapp.com",
    projectId: "brain-walk",
    storageBucket: "brain-walk.firebasestorage.app",
    messagingSenderId: "249297535846",
    appId: "1:249297535846:web:2dc4f8128c984a54debea7"
  },
  // 프로젝트 설정 > 클라우드 메시징 > 웹 구성 > 웹 푸시 인증서 > 키 쌍 (공개 키) — 알림에 필요해요
  vapidKey: "",   // 비워 두면 Firebase 기본 웹 푸시 키를 써요
  // (선택) App Check 의 reCAPTCHA v3 사이트 키. 쓰지 않으면 빈 문자열("")로 두세요.
  appCheckSiteKey: ""
};
