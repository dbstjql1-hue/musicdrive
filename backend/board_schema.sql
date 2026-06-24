-- 자유게시판 글 테이블 (board_posts)
CREATE TABLE IF NOT EXISTS public.board_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    password TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 자유게시판 댓글 테이블 (board_comments)
CREATE TABLE IF NOT EXISTS public.board_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.board_posts(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    password TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
