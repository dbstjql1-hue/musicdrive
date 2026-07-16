const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNoticePayload } = require('./notice-validation');

test('공지 입력값의 공백을 정리하고 정상 값을 반환한다', () => {
  assert.deepEqual(validateNoticePayload({
    title: '  업데이트 안내  ',
    content: '  변경 내용입니다.  ',
    noticeType: 'update'
  }), {
    value: {
      title: '업데이트 안내',
      content: '변경 내용입니다.',
      noticeType: 'update'
    }
  });
});

test('허용되지 않은 공지 유형을 거부한다', () => {
  assert.deepEqual(validateNoticePayload({
    title: '안내',
    content: '내용',
    noticeType: 'unknown'
  }), { error: '공지 유형이 올바르지 않습니다.' });
});

test('빈 제목과 너무 긴 내용은 거부한다', () => {
  assert.equal(validateNoticePayload({
    title: ' ',
    content: '내용',
    noticeType: 'announcement'
  }).error, '제목은 1자 이상 100자 이하로 입력해 주세요.');

  assert.equal(validateNoticePayload({
    title: '안내',
    content: '가'.repeat(4001),
    noticeType: 'announcement'
  }).error, '내용은 1자 이상 4,000자 이하로 입력해 주세요.');
});
