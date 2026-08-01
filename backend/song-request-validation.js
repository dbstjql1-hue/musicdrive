const COMPLETED_SONG_TITLE_MAX_LENGTH = 100;

function validateCompletedSongTitle(value) {
  if (typeof value !== 'string') {
    return { error: '완성된 노래 제목을 올바르게 입력해주세요.' };
  }

  const normalized = value.trim();
  if (normalized.length > COMPLETED_SONG_TITLE_MAX_LENGTH) {
    return { error: `완성된 노래 제목은 ${COMPLETED_SONG_TITLE_MAX_LENGTH}자 이하로 입력해주세요.` };
  }

  return { value: normalized || null };
}

module.exports = {
  COMPLETED_SONG_TITLE_MAX_LENGTH,
  validateCompletedSongTitle
};
