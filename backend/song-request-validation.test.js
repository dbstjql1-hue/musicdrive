const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCompletedSongTitle } = require('./song-request-validation');

test('완성된 노래 제목의 앞뒤 공백을 정리한다', () => {
  assert.deepEqual(validateCompletedSongTitle('  새벽 드라이브  '), { value: '새벽 드라이브' });
});

test('빈 완성 노래 제목은 null로 정리해 기존 제목을 지울 수 있다', () => {
  assert.deepEqual(validateCompletedSongTitle('   '), { value: null });
});

test('완성된 노래 제목은 문자열이며 100자 이하여야 한다', () => {
  assert.deepEqual(validateCompletedSongTitle(null), {
    error: '완성된 노래 제목을 올바르게 입력해주세요.'
  });
  assert.deepEqual(validateCompletedSongTitle('가'.repeat(101)), {
    error: '완성된 노래 제목은 100자 이하로 입력해주세요.'
  });
});
