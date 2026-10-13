/* AI 리포트 화면에서 쓰는 한국어 이름표 (CLIENT-CONTRACT §0, §3). 진단 말투(병 이름, 정상/비정상)와 빨간색은 쓰지 않아요. */
export const LIGHTS = {
  green: { word: '유지', glyph: '●', cls: 'green' },
  blue: { word: '좋아짐', glyph: '▲', cls: 'blue' },
  yellow: { word: '관찰', glyph: '◆', cls: 'yellow' },
  orange: { word: '주의 신호', glyph: '■', cls: 'orange' },
  gray: { word: '판단 보류', glyph: '○', cls: 'gray' }
};
export const lightOf = k => LIGHTS[k] || LIGHTS.gray;
/* 리포트 하나의 대표 신호등: 가장 센 것 (주황 > 노랑 > 파랑 > 초록 > 회색) */
export function topLight(r) {
  const order = ['orange', 'yellow', 'blue', 'green', 'gray'];
  const ls = Object.keys(r.lights || {}).map(k => (r.lights || {})[k]);
  return order.find(o => ls.includes(o)) || (r.lights && r.lights.composite) || 'gray';
}
export const CONFIDENCE = { insufficient: '아직 판단하기 일러요', weak: '약한 신호예요', concordant: '여러 지표가 같은 방향이에요' };
export const PHASE = { familiarization: '익히는 주', baseline: '평소 실력 재는 중', monitoring: '살펴보는 중' };
export const DOMAIN_NAMES = { composite: '전체', memory: '기억', attention: '주의', executive: '계산·순서', language: '언어', visuospatial: '모양·공간', speed: '반응 속도', participation: '참여', anchor: '같은 문제 다시 풀기', orientation: '날짜', reminiscence: '옛날 이야기' };
export const TREND_DOMAINS = ['composite', 'memory', 'attention', 'executive', 'language', 'visuospatial', 'speed', 'participation'];
export const KIND_NAMES = { daily: '아침 리포트', weekly: '주간 장기 리포트', alert: '알림 리포트' };
export const NOTE_CODES = [['sleep', '잠 부족'], ['illness', '감기·몸살'], ['med_change', '약 변경'], ['hospital', '입원·수술'], ['event', '가족 행사'], ['travel', '이사·여행'], ['device', '기기 변경'], ['mood', '기분 저하'], ['other', '기타']];
export const NOTE_NAME = Object.fromEntries(NOTE_CODES);
export const REJECT_LABELS = {
  recompute: '정답 재계산 불일치', errcode: '오답 꼬리표 불일치', features: '난이도 값 불일치', level: '단계 규칙', length: '글자 수 초과', charset: '글자 모양', emoji: '이모지', choices: '보기 문제', answer: '보기 문제', unique: '답이 여럿',
  dup: '중복', near_dup: '중복', wordlist_overlap: '중복', pii: '개인정보 모양', name: '개인정보 모양', copy_risk: '검사 문항과 닮음', date_window: '날짜', date_uncertain: '날짜', date_out_of_table: '날짜', grid: '모양·길', route: '모양·길', prompt_numbers: '질문 속 숫자',
  price: '물건값', quota: '하루 한도', spec: '설계도 버전', theme: '주제', qa_missing: '품질 검토 기록', qa_scores: '품질 검토 기록', qa_solve: '품질 검토 기록'
};
export const rejectLabel = c => REJECT_LABELS[c] || (/^banned/.test(c) ? '금지어' : /^qa_/.test(c) ? '품질 검토 기록' : /^grid|^route/.test(c) ? '모양·길' : /^date_/.test(c) ? '날짜' : '기타');
export const REJECT_CODES_REPORT = { digits: '숫자가 설명과 맞지 않았어요', timeout: '설명을 쓰는 시간이 지났어요', wake_failed: 'AI 일꾼을 깨우지 못했어요' };
/* 오답 꼬리표 (아버지가 고른 보기에 붙어 있는 코드) */
export const ERR_LABELS = {
  MISS: '놓침', OMIT: '답하지 않음', ABANDON: '중간에 그만둠', SLOW: '시간 초과', INTR_SEM: '의미가 가까운 낱말', INTR_PHON: '소리가 비슷한 낱말', INTR_UNREL: '관계없는 낱말', SRC_CONF: '다른 사람·장소와 헷갈림', DELAY_LOSS: '나중에 틀림',
  PM_MISS: '부탁을 잊음', PM_EARLY: '너무 일찍 누름', PM_WRONG_CUE: '다른 단추', CALC_NOQTY: '수량 빼먹음', CALC_SUM_AS_CHANGE: '합계를 거스름돈으로', CALC_STEP_SKIP: '단계 빼먹음', CALC_DEAL_IGNORED: '덤 놓침', CALC_NEAR: '조금 틀림', CALC_FAR: '많이 틀림',
  TIME_DIR: '시간 방향 거꾸로', TIME_BUFFER_SKIP: '여유 시간 빼먹음', SEQ_ADJ: '이웃끼리 바뀜', SEQ_FAR: '멀리 바뀜', SEQ_INTRUDER: '끼어든 단계', LOGIC_REVERSE: '관계를 거꾸로', LOGIC_PARTIAL: '조건 하나만 봄', SEM_NEAR: '가까운 범주', SEM_FAR: '먼 범주',
  PHON: '소리가 비슷함', REL_WRONG: '관계 유형 틀림', REL_REVERSE: '관계를 거꾸로', MIRROR: '뒤집은 모양', ROT_ANGLE: '각도 틀림', LR_CONF: '좌우 혼동', STEP_SKIP: '한 걸음 빠뜨림', RULE_PARTIAL: '규칙을 반만 적용', CELL_SHIFT: '칸이 옮겨짐',
  COUNT_UNDER: '적게 셈', COUNT_OVER: '많이 셈', LOOKALIKE: '닮은 글자를 셈', DATE_NEAR: '하루 차이', DATE_WEEKDAY: '요일 틀림', SEASON: '계절 틀림', ERA_NEAR: '비슷한 시대', PLAUSIBLE: '그럴듯한 보기'
};
export const errLabel = c => ERR_LABELS[c] || c;
export const FORMAT_NAMES = { word_recog: '단어 기억', card_theme: '주제 카드', emoji_set: '이모지 묶음', date_q: '날짜·계절', lang_complete: '문장 완성', lang_relation: '비슷한 말·반대말', lang_category: '범주 고르기', word_find: '낱말 찾기', analogy: '낱말 관계', shop_calc: '장보기 계산', sequence: '순서 맞추기', schedule: '일정 맞추기', logic: '생각 퍼즐', letter_search: '글자 찾기', story_recall: '이야기 기억', prospective: '잊지 말고 누르기', grid_pattern: '모양 이어 가기', grid_rotate: '돌린 모양', grid_memory: '모양 기억', route: '길 찾기', reminiscence: '옛날 이야기' };
export const BANK_ROWS = [['memory', '기억'], ['attention', '주의'], ['executive', '계산·순서'], ['language', '언어'], ['visuospatial', '모양·공간']];
/* 리포트 숫자 이름표 (numbers 의 접두어 → 줄 이름). 서버가 채운 문자열을 그대로 보여 줘요. */
export const NUM_LABELS = {
  comp_ma4: '4주 평균', comp_base: '평소', comp_band: '평소 범위', comp_drop3: '3주 내림', mem_ma4: '4주 평균', mem_base: '평소', mem_band: '평소 범위', mem_mdc90: '흔들림 범위', mem_drop3: '3주 내림',
  att_ma4: '4주 평균', att_base: '평소', att_band: '평소 범위', exe_ma4: '4주 평균', exe_base: '평소', exe_band: '평소 범위', lan_ma4: '4주 평균', lan_base: '평소', lan_band: '평소 범위', vis_ma4: '4주 평균', vis_base: '평소', vis_band: '평소 범위',
  spd_change: '평소보다', spd_slope: '주당 기울기', spd_slope_lo: '기울기 아래쪽', spd_slope_hi: '기울기 위쪽', spd_since: '시작한 주',
  part_days14: '최근 14일 훈련한 날', part_planned14: '계획한 날', part_abandon14: '그만둔 비율',
  anc_set: '세트', anc_prev: '지난번', anc_cur: '이번', anc_n: '문항 수', anc_c1: '지난번 정답', anc_c2: '이번 정답', anc_both: '둘 다 맞음', anc_up: '틀림→맞음', anc_down: '맞음→틀림', anc_bothwrong: '둘 다 틀림', anc_p_sign: '부호 검정 p', anc_spd: '속도 변화', anc_p_wil: '윌콕슨 p', anc_rci: '신뢰 변화 지수', anc_pe: '연습 효과',
  today_wrong: '날짜 문항 오답', dateq_wrong: '날짜 문항 오답', check_total: '월간 점검 총점', check_date: '월간 점검 날짜', iiv: '들쭉날쭉한 정도', ies: '속도·정확도 종합'
};
export const numLabel = k => NUM_LABELS[k] || k;
