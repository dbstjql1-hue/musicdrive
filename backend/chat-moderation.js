const MAX_CHAT_LENGTH = 200;
const HANGUL_INITIALS = {
  'ᄀ': 'ㄱ', 'ᄁ': 'ㄲ', 'ᄂ': 'ㄴ', 'ᄃ': 'ㄷ', 'ᄄ': 'ㄸ', 'ᄅ': 'ㄹ',
  'ᄆ': 'ㅁ', 'ᄇ': 'ㅂ', 'ᄈ': 'ㅃ', 'ᄉ': 'ㅅ', 'ᄊ': 'ㅆ', 'ᄋ': 'ㅇ',
  'ᄌ': 'ㅈ', 'ᄍ': 'ㅉ', 'ᄎ': 'ㅊ', 'ᄏ': 'ㅋ', 'ᄐ': 'ㅌ', 'ᄑ': 'ㅍ', 'ᄒ': 'ㅎ',
};

function normalizeForMatching(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ᄀ-ᄒ]/gu, (character) => HANGUL_INITIALS[character] || character)
    .replace(/[\s\p{P}\p{S}_]+/gu, '');
}

const BLOCK_RULES = [
  {
    code: 'profanity',
    pattern: /(?:씨+발+|시+발+(?!점)|ㅅㅂ|병+신+|ㅂㅅ|개+새+끼+|좆+|지+랄+|엿+먹+어|미친(?:놈|년))/u,
  },
  {
    code: 'sexual',
    pattern: /(?:야+동+|섹+스+|자+위+|성+기+|음+란+|포+르+노+|porn|nude|sexchat)/u,
  },
  {
    code: 'harassment',
    pattern: /(?:죽+어+라|죽+여+버|자+살+해|꺼+져+라|성적(?:사진|영상).*보내)/u,
  },
];

const LINK_OR_AD_PATTERN = /(?:https?:\/\/|www\.|t\.me\/|discord\.gg\/|오픈채팅|카톡\s*아이디|텔레그램)/iu;
const PHONE_PATTERN = /(?:^|\D)(?:01[016789][\s.-]?)?\d{3,4}[\s.-]?\d{4}(?:\D|$)/u;
const REPEATED_CHARACTER_PATTERN = /(.)\1{6,}/u;
const REPEATED_PHRASE_PATTERN = /(.{2,12})\1{3,}/u;

function block(code, message) {
  return { allowed: false, code, message };
}

function moderateChatMessage(value) {
  const content = String(value || '').normalize('NFKC').trim();

  if (!content) return block('empty', '메시지를 입력해 주세요.');
  if (content.length > MAX_CHAT_LENGTH) {
    return block('too_long', `메시지는 ${MAX_CHAT_LENGTH}자까지 입력할 수 있습니다.`);
  }
  if (LINK_OR_AD_PATTERN.test(content)) {
    return block('advertising', '광고·외부 링크가 포함된 메시지는 전송할 수 없습니다.');
  }
  if (PHONE_PATTERN.test(content)) {
    return block('personal_info', '전화번호 등 개인정보가 포함된 메시지는 전송할 수 없습니다.');
  }
  if ((content.match(/\n/g) || []).length > 4) {
    return block('spam', '과도한 줄바꿈이 포함된 메시지는 전송할 수 없습니다.');
  }
  if (REPEATED_CHARACTER_PATTERN.test(content) || REPEATED_PHRASE_PATTERN.test(content)) {
    return block('spam', '반복 도배로 판단되어 메시지가 차단되었습니다.');
  }

  const compact = normalizeForMatching(content);
  const matchedRule = BLOCK_RULES.find((rule) => rule.pattern.test(compact));
  if (matchedRule) {
    return block(matchedRule.code, '커뮤니티 안전 기준에 맞지 않아 메시지가 자동 차단되었습니다.');
  }

  return { allowed: true, code: null, message: null, content };
}

function moderateChatNickname(value) {
  const nickname = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  const result = moderateChatMessage(nickname);
  return result.allowed ? nickname : null;
}

module.exports = {
  MAX_CHAT_LENGTH,
  moderateChatMessage,
  moderateChatNickname,
  normalizeForMatching,
};
