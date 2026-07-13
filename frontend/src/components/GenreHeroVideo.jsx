import { useEffect, useRef, useState } from 'react';

export function GenreHeroVideo({ media, isPlaying }) {
  const videoRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(() => {
        // 브라우저가 자동 재생을 잠시 막으면 canplay 이벤트에서 다시 시도합니다.
      });
    } else {
      video.pause();
    }
  }, [isPlaying, media.src]);

  const handleCanPlay = () => {
    setIsReady(true);
    if (isPlaying) {
      videoRef.current?.play().catch(() => {});
    }
  };

  return (
    <div
      className={`hero-genre-video${isReady ? ' is-ready' : ''}`}
      style={{ '--genre-video-position': media.objectPosition || 'center' }}
      aria-label={media.label}
    >
      <video
        ref={videoRef}
        src={media.src}
        autoPlay={isPlaying}
        loop
        muted
        playsInline
        preload="none"
        onCanPlay={handleCanPlay}
        aria-hidden="true"
      />
    </div>
  );
}
