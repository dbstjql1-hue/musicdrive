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
    audio_size_bytes BIGINT DEFAULT 0,
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

-- 4. VS 대결 투표 관련 테이블 추가

-- VS 대결 매치 테이블 (vs_matches)
CREATE TABLE IF NOT EXISTS public.vs_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    song1_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    song2_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- VS 대결 투표 테이블 (vs_votes)
CREATE TABLE IF NOT EXISTS public.vs_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES public.vs_matches(id) ON DELETE CASCADE,
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(match_id, session_id)
);

-- 5. 관리자 분석 데이터 수집

ALTER TABLE public.playlists
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.likes
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.vs_votes
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.vs_votes
    ALTER COLUMN session_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.play_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id TEXT,
    song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    source TEXT,
    delivery_source TEXT,
    estimated_bytes BIGINT NOT NULL DEFAULT 0,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.play_history
    ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.play_history
    ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE public.play_history
    ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.songs
    ADD COLUMN IF NOT EXISTS audio_size_bytes BIGINT DEFAULT 0;
ALTER TABLE public.play_history
    ADD COLUMN IF NOT EXISTS delivery_source TEXT;
ALTER TABLE public.play_history
    ADD COLUMN IF NOT EXISTS estimated_bytes BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id TEXT,
    song_id UUID REFERENCES public.songs(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS playlists_user_id_idx
    ON public.playlists (user_id);
CREATE INDEX IF NOT EXISTS likes_user_id_created_at_idx
    ON public.likes (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS likes_song_user_unique_idx
    ON public.likes (song_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vs_votes_user_id_created_at_idx
    ON public.vs_votes (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vs_votes_match_user_unique_idx
    ON public.vs_votes (match_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS play_history_user_played_at_idx
    ON public.play_history (user_id, played_at DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS play_history_song_played_at_idx
    ON public.play_history (song_id, played_at DESC);
CREATE INDEX IF NOT EXISTS play_history_session_played_at_idx
    ON public.play_history (session_id, played_at DESC)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_activity_user_created_at_idx
    ON public.user_activity (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_activity_event_created_at_idx
    ON public.user_activity (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_song_created_at_idx
    ON public.user_activity (song_id, created_at DESC)
    WHERE song_id IS NOT NULL;

ALTER TABLE public.play_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.play_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_activity FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.play_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_activity TO service_role;

DROP POLICY IF EXISTS "Service role manages play history" ON public.play_history;
CREATE POLICY "Service role manages play history"
    ON public.play_history FOR ALL TO service_role
    USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages user activity" ON public.user_activity;
CREATE POLICY "Service role manages user activity"
    ON public.user_activity FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 실시간 채팅은 테이블에 저장하지 않고 private Realtime 채널로만 전달합니다.
-- 클라이언트는 수신과 접속 현황만 사용할 수 있고, 메시지 발송은 서버의 필터를 통과해야 합니다.
DROP POLICY IF EXISTS "MusicDrive chat members receive realtime" ON realtime.messages;
CREATE POLICY "MusicDrive chat members receive realtime"
    ON realtime.messages FOR SELECT TO authenticated
    USING (
      (SELECT realtime.topic()) = 'room:musicdrive:lobby'
      AND realtime.messages.extension IN ('broadcast', 'presence')
    );

DROP POLICY IF EXISTS "MusicDrive chat members publish presence" ON realtime.messages;
CREATE POLICY "MusicDrive chat members publish presence"
    ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK (
      (SELECT realtime.topic()) = 'room:musicdrive:lobby'
      AND realtime.messages.extension = 'presence'
    );

-- 로그인 직후 노출되는 운영 공지입니다. 브라우저는 백엔드 API로만 조회하며,
-- 작성과 게시 상태 변경은 service_role을 사용하는 관리자 API에서만 처리합니다.
CREATE TABLE IF NOT EXISTS public.login_notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    notice_type TEXT NOT NULL DEFAULT 'update'
        CHECK (notice_type IN ('update', 'maintenance', 'announcement')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS login_notices_one_active_idx
    ON public.login_notices (is_active)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS login_notices_created_at_idx
    ON public.login_notices (created_at DESC);

ALTER TABLE public.login_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_notices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.login_notices TO service_role;

DROP POLICY IF EXISTS "Service role manages login notices" ON public.login_notices;
CREATE POLICY "Service role manages login notices"
    ON public.login_notices FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 사이트 운영 설정입니다. 노래 만들기 질문 양식처럼 관리자가 수정하는 값을 저장합니다.
CREATE TABLE IF NOT EXISTS public.site_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_settings TO service_role;

DROP POLICY IF EXISTS "Service role manages site settings" ON public.site_settings;
CREATE POLICY "Service role manages site settings"
    ON public.site_settings FOR ALL TO service_role
    USING (true) WITH CHECK (true);
