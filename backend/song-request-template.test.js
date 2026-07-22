const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSongRequestTemplate } = require('./song-request-template');

test('노래 요청 질문 양식의 공백과 줄바꿈을 정리한다', () => {
  assert.deepEqual(validateSongRequestTemplate('  첫 번째 질문입니다.\r\n두 번째 질문입니다.  '), {
    value: '첫 번째 질문입니다.\n두 번째 질문입니다.'
  });
});

test('너무 짧거나 긴 질문 양식을 거부한다', () => {
  assert.deepEqual(validateSongRequestTemplate('짧음'), {
    error: '질문 양식을 10자 이상 입력해주세요.'
  });
  assert.deepEqual(validateSongRequestTemplate('가'.repeat(5001)), {
    error: '질문 양식은 5,000자 이하로 입력해주세요.'
  });
});
