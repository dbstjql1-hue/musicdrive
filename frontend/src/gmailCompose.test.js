import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGmailComposeUrl } from './gmailCompose.js';

test('요청자 이메일과 곡 제목으로 Gmail 작성 URL을 만든다', () => {
  const result = new URL(buildGmailComposeUrl({
    recipient: 'requester@gmail.com',
    requestTitle: '지금처럼만'
  }));

  assert.equal(result.origin + result.pathname, 'https://mail.google.com/mail/');
  assert.equal(result.searchParams.get('view'), 'cm');
  assert.equal(result.searchParams.get('fs'), '1');
  assert.equal(result.searchParams.get('to'), 'requester@gmail.com');
  assert.equal(result.searchParams.get('su'), '[musicdrive] 지금처럼만 곡 파일을 보내드립니다');
  assert.match(result.searchParams.get('body'), /"지금처럼만" 곡 파일/);
});

test('비어 있는 제목에는 기본 제목을 사용한다', () => {
  const result = new URL(buildGmailComposeUrl({
    recipient: 'requester@gmail.com',
    requestTitle: '   '
  }));

  assert.equal(result.searchParams.get('su'), '[musicdrive] 요청하신 곡 파일을 보내드립니다');
});
