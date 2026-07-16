const NOTICE_TYPES = new Set(['update', 'maintenance', 'announcement']);

function validateNoticePayload(payload = {}) {
  const title = String(payload.title || '').trim();
  const content = String(payload.content || '').trim();
  const noticeType = String(payload.noticeType || '').trim();

  if (!title || title.length > 100) {
    return { error: '제목은 1자 이상 100자 이하로 입력해 주세요.' };
  }
  if (!content || content.length > 4000) {
    return { error: '내용은 1자 이상 4,000자 이하로 입력해 주세요.' };
  }
  if (!NOTICE_TYPES.has(noticeType)) {
    return { error: '공지 유형이 올바르지 않습니다.' };
  }

  return { value: { title, content, noticeType } };
}

module.exports = { NOTICE_TYPES, validateNoticePayload };
