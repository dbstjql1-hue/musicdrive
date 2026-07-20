const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CHAT_LENGTH,
  createFallbackChatNickname,
  detectChatDeviceType,
  extractChatMentionKeys,
  moderateChatMessage,
  moderateChatNickname,
  normalizeForMatching,
  validateChatNickname,
} = require('./chat-moderation');

test('allows normal music conversation', () => {
  const result = moderateChatMessage('오늘 노래 정말 좋아요 🎵');
  assert.equal(result.allowed, true);
  assert.equal(result.content, '오늘 노래 정말 좋아요 🎵');
});

test('normalizes spacing and punctuation used to evade filters', () => {
  assert.equal(normalizeForMatching('ㅅ ! ㅂ'), 'ㅅㅂ');
  assert.equal(moderateChatMessage('ㅅ ! ㅂ').allowed, false);
});

test('does not block a safe word that contains a similar syllable sequence', () => {
  assert.equal(moderateChatMessage('새로운 시작의 시발점이네요').allowed, true);
});

test('blocks sexual, advertising, personal information, and spam patterns', () => {
  assert.equal(moderateChatMessage('야 동 보자').code, 'sexual');
  assert.equal(moderateChatMessage('https://example.com 홍보합니다').code, 'advertising');
  assert.equal(moderateChatMessage('010-1234-5678 연락주세요').code, 'personal_info');
  assert.equal(moderateChatMessage('도배도배도배도배').code, 'spam');
});

test('allows common Korean chat reactions without weakening spam blocking', () => {
  assert.equal(moderateChatMessage('ㅋㅋㅋㅋㅋㅋㅋㅋ').allowed, true);
  assert.equal(moderateChatMessage('오늘 노래 좋다ㅎㅎㅎㅎㅎ').allowed, true);
  assert.equal(moderateChatMessage('ㅠㅠㅠㅠㅠ').allowed, true);
  assert.equal(moderateChatMessage('가가가가가가가').code, 'spam');
  assert.equal(moderateChatMessage('도배도배도배도배').code, 'spam');
});

test('enforces the 200 character limit and moderates nicknames', () => {
  assert.equal(moderateChatMessage('가'.repeat(MAX_CHAT_LENGTH + 1)).code, 'too_long');
  assert.equal(moderateChatNickname(' 음악 친구 '), '음악 친구');
  assert.equal(moderateChatNickname('ㅅㅂ'), null);
});

test('detects mobile and PC chat clients from the request user agent', () => {
  assert.equal(detectChatDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'mobile');
  assert.equal(detectChatDeviceType('Mozilla/5.0 (Linux; Android 15; SM-S938N) Mobile'), 'mobile');
  assert.equal(detectChatDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'pc');
  assert.equal(detectChatDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)'), 'pc');
});

test('validates public nicknames without exposing identity data', () => {
  assert.equal(validateChatNickname('별빛DJ').nickname, '별빛DJ');
  assert.equal(validateChatNickname('music_fan7').allowed, true);
  assert.equal(validateChatNickname('음악 친구').code, 'invalid_nickname');
  assert.equal(validateChatNickname('관리자').code, 'reserved_nickname');
  assert.match(createFallbackChatNickname('12345678-abcd-ef00-1234-567890abcdef'), /^음악친구_[a-f0-9]{8}$/u);
});

test('extracts normalized unique nickname mentions', () => {
  assert.deepEqual(extractChatMentionKeys('@별빛DJ 안녕하세요 @music_Fan7 @별빛DJ'), ['별빛dj', 'music_fan7']);
});
