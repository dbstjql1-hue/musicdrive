import danceCharacterVideo from '../assets/genre-videos/dance-character.mp4';

const normalizeGenre = (genre) => genre?.normalize('NFKC').trim().toLocaleLowerCase('ko-KR') || '';

// 새 장르 영상은 파일을 import한 뒤 이 매핑에 항목만 추가하면 됩니다.
const genreHeroVideos = Object.freeze({
  [normalizeGenre('댄스')]: Object.freeze({
    src: danceCharacterVideo,
    label: '댄스 장르 캐릭터 애니메이션',
    objectPosition: 'center',
  }),
});

export function getGenreHeroVideo(genre) {
  return genreHeroVideos[normalizeGenre(genre)] || null;
}
