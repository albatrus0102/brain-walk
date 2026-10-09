/* 진입점: 모든 화면/게임 모듈을 불러오고 시작합니다. (빌드 없이 브라우저가 직접 읽는 ES 모듈) */
import './games/index.js';
import './ui/screens/index.js';
import './ui/chat.js';
import './events.js';
import { boot } from './boot.js';

boot();
