-- ==========================================
-- Supabase Database Schema for musicdrive
-- 이 파일을 Supabase의 [SQL Editor] -> [New query]에 복사하여 실행해주세요.
-- ==========================================

-- 1. 테이블 생성

-- 곡 정보 테이블 (songs)
CREATE TABLE IF NOT EXISTS public.songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    audio_url TEXT NOT NULL,
    cover_url TEXT NOT NULL,
    lyrics TEXT,
    category TEXT DEFAULT '일반',
    play_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 플레이리스트 테이블 (playlists)
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 플레이리스트 곡 매핑 테이블 (playlist_songs)
CREATE TABLE IF NOT EXISTS public.playlist_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE,
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(playlist_id, song_id)
);

-- 좋아요 정보 테이블 (likes)
-- 개별 세션 또는 브라우저 지문 ID(fingerprint)를 기준으로 중복 좋아요 방지
CREATE TABLE IF NOT EXISTS public.likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL, -- 클라이언트(브라우저)에서 생성한 고유 세션 키
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(song_id, session_id)
);

-- 2. 좋아요 갱신 트리거 및 함수 설정

-- 좋아요 추가/삭제 시 songs 테이블의 likes_count를 업데이트하는 함수
CREATE OR REPLACE FUNCTION public.handle_song_like_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.songs
        SET likes_count = likes_count + 1
        WHERE id = NEW.song_id;
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.songs
        SET likes_count = GREATEST(0, likes_count - 1)
        WHERE id = OLD.song_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
CREATE OR REPLACE TRIGGER on_song_like_change
AFTER INSERT OR DELETE ON public.likes
FOR EACH ROW
EXECUTE FUNCTION public.handle_song_like_change();

-- 3. 스토리지 버킷 및 보안 정책(RLS) 안내
-- 이 사이트는 음악 포트폴리오 사이트이므로, 프론트엔드/백엔드에서 데이터베이스 접근을 유연하게 하기 위해 RLS를 비활성화하거나,
-- 전체 읽기/쓰기를 수동으로 허용할 수 있습니다.
-- 기본적으로 모든 테이블은 RLS(Row Level Security)가 비활성화된 상태로 생성되며, 필요시 활성화할 수 있습니다.

/*
======================================================
[필수 작업: Supabase Storage 버킷 생성 안내]
데이터베이스 스크립트 실행 후, Supabase 대시보드에서 다음 설정을 해주셔야 음원 및 앨범 아트 업로드가 가능합니다.

1. Supabase 대시보드의 왼쪽 메뉴에서 [Storage] 클릭
2. [New Bucket]을 눌러 다음 두 개의 버킷을 생성합니다:
   - 버킷명: `songs`  (반드시 "Public"으로 설정하여 다른 사용자들이 음원을 들을 수 있도록 합니다)
   - 버킷명: `covers` (반드시 "Public"으로 설정하여 앨범 커버를 표시할 수 있도록 합니다)
3. 버킷 생성 후 각 버킷의 [Policies] 메뉴로 이동하여:
   - 'Allowed Operations'에 대해 Select, Insert, Delete 권한을 누구나(anon/authenticated) 가질 수 있도록 하거나,
   - 혹은 백엔드 서비스가 서비스 롤 키(service_role key)를 사용하여 업로드하므로 스토리지 정책을 우회할 수 있습니다. 
     (저희 백엔드는 supabase의 service_role key를 사용하여 권한 정책 없이도 업로드 가능하게 개발할 예정입니다.)
======================================================
*/
