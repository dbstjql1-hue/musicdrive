const DEFAULT_SONG_REQUEST_TEMPLATE = `곡 주제 및 제목
( 예시 : 꿈, 드라이브, 새벽, 바다, 사랑, 이별 등 )

곡의 용도는?
( 예시 : BGM, 공연음악, 게임음악, 릴스 등 )

곡의 길이는?

장르는?
( 예시 : 발라드, 힙합, 디스코, 레게, 재즈 등 )

보컬은?
( 예시 : 남자, 여자, 듀엣, 좋아하는 가수의 목소리 등 )

노랫말은?
( 넣고 싶은 가사나 이야기를 써주세요. )`;

function validateSongRequestTemplate(value) {
  const template = String(value || '').replace(/\r\n/g, '\n').trim();
  if (template.length < 10) {
    return { error: '질문 양식을 10자 이상 입력해주세요.' };
  }
  if (template.length > 5000) {
    return { error: '질문 양식은 5,000자 이하로 입력해주세요.' };
  }
  return { value: template };
}

module.exports = { DEFAULT_SONG_REQUEST_TEMPLATE, validateSongRequestTemplate };
