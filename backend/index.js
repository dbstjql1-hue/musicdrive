const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// Supabase 연결 설정
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Storage 업로드를 위해 service_role 키 권장

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('경고: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Multer 설정 (파일 업로드 메모리 저장소)
const storage = multer.memoryStorage();
const upload = multer.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);

// 1. 전체 곡 목록 조회 및 검색 (GET /api/songs)
app.get('/api/songs', async (req, res) => {
  try {
    const { query, category } = req.query;
    
    let dbQuery = supabase
      .from('songs')
      .select('*')
      .order('created_at', { ascending: false });

    // 검색어 필터링 (제목 또는 아티스트)
    if (query) {
      dbQuery = dbQuery.or(`title.ilike.%${query}%,artist.ilike.%${query}%`);
    }

    // 카테고리 필터링
    if (category && category !== '전체') {
      dbQuery = dbQuery.eq('category', category);
    }

    const { data: songs, error } = await dbQuery;

    if (error) throw error;
    res.json(songs);
  } catch (err) {
    console.error('곡 목록 조회 오류:', err.message);
    res.status(500).json({ error: '곡 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

// 2. 단일 곡 세부 정보 조회 (GET /api/songs/:id)
app.get('/api/songs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: song, error } = await supabase
      .from('songs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!song) return res.status(404).json({ error: '해당 곡을 찾을 수 없습니다.' });

    res.json(song);
  } catch (err) {
    console.error('곡 상세 조회 오류:', err.message);
    res.status(500).json({ error: '곡 상세 정보를 불러오는 중 오류가 발생했습니다.' });
  }
});

// 3. 신규 음원 등록 및 업로드 (POST /api/songs) - 관리자용
app.post('/api/songs', upload, async (req, res) => {
  try {
    const { title, artist, lyrics, category, adminPassword } = req.body;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (adminPassword !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    if (!title || !artist) {
      return res.status(400).json({ error: '곡 제목과 아티스트 이름은 필수입니다.' });
    }

    if (!req.files || !req.files.audio) {
      return res.status(400).json({ error: '오디오 파일(.mp3, .wav 등)은 필수입니다.' });
    }

    const audioFile = req.files.audio[0];
    const coverFile = req.files.cover ? req.files.cover[0] : null;

    // 파일 고유 식별자 생성
    const timestamp = Date.now();
    const cleanFileName = (name) => name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();

    // 1) 오디오 파일 Supabase Storage 업로드
    const audioPath = `${timestamp}_${cleanFileName(audioFile.originalname)}`;
    const { data: audioUpload, error: audioErr } = await supabase.storage
      .from('songs')
      .upload(audioPath, audioFile.buffer, {
        contentType: audioFile.mimetype,
        upsert: true
      });

    if (audioErr) throw audioErr;

    // 오디오 파일 Public URL 획득
    const { data: audioUrlData } = supabase.storage.from('songs').getPublicUrl(audioPath);
    const audioUrl = audioUrlData.publicUrl;

    // 2) 앨범 커버 파일 업로드 (기본값 설정 제공)
    let coverUrl = 'https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=500&auto=format&fit=crop&q=60'; // 기본 플레이스홀더 이미지
    if (coverFile) {
      const coverPath = `${timestamp}_${cleanFileName(coverFile.originalname)}`;
      const { data: coverUpload, error: coverErr } = await supabase.storage
        .from('covers')
        .upload(coverPath, coverFile.buffer, {
          contentType: coverFile.mimetype,
          upsert: true
        });

      if (coverErr) throw coverErr;

      // 커버 파일 Public URL 획득
      const { data: coverUrlData } = supabase.storage.from('covers').getPublicUrl(coverPath);
      coverUrl = coverUrlData.publicUrl;
    }

    // 3) 데이터베이스 등록
    const { data: newSong, error: dbErr } = await supabase
      .from('songs')
      .insert([
        {
          title,
          artist,
          audio_url: audioUrl,
          cover_url: coverUrl,
          lyrics: lyrics || '',
          category: category || '일반'
        }
      ])
      .select()
      .single();

    if (dbErr) throw dbErr;

    res.status(201).json(newSong);
  } catch (err) {
    console.error('음원 등록 오류:', err.message);
    res.status(500).json({ error: `음원 등록 실패: ${err.message}` });
  }
});

// 4. 곡 재생 횟수 증가 (POST /api/songs/:id/play)
app.post('/api/songs/:id/play', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 먼저 현재 조회수 조회
    const { data: song, error: getErr } = await supabase
      .from('songs')
      .select('play_count')
      .eq('id', id)
      .single();

    if (getErr) throw getErr;

    // 조회수 증가 업데이트
    const { data: updatedSong, error: updateErr } = await supabase
      .from('songs')
      .update({ play_count: (song.play_count || 0) + 1 })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json({ success: true, play_count: updatedSong.play_count });
  } catch (err) {
    console.error('재생 횟수 업데이트 오류:', err.message);
    res.status(500).json({ error: '재생 횟수를 업데이트할 수 없습니다.' });
  }
});

// 5. 좋아요 토글 (POST /api/songs/:id/like)
app.post('/api/songs/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.body; // 클라이언트 식별용 고유 키

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId는 필수입니다.' });
    }

    // 이미 좋아요를 눌렀는지 체크
    const { data: existingLike, error: checkErr } = await supabase
      .from('likes')
      .select('*')
      .eq('song_id', id)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (checkErr) throw checkErr;

    let liked = false;
    if (existingLike) {
      // 좋아요 취소
      const { error: deleteErr } = await supabase
        .from('likes')
        .delete()
        .eq('song_id', id)
        .eq('session_id', sessionId);

      if (deleteErr) throw deleteErr;
      liked = false;
    } else {
      // 좋아요 추가
      const { error: insertErr } = await supabase
        .from('likes')
        .insert([{ song_id: id, session_id: sessionId }]);

      if (insertErr) throw insertErr;
      liked = true;
    }

    // 업데이트된 likes_count 재조회
    const { data: updatedSong, error: songErr } = await supabase
      .from('songs')
      .select('likes_count')
      .eq('id', id)
      .single();

    if (songErr) throw songErr;

    res.json({ success: true, liked, likes_count: updatedSong.likes_count });
  } catch (err) {
    console.error('좋아요 토글 오류:', err.message);
    res.status(500).json({ error: '좋아요 설정을 변경할 수 없습니다.' });
  }
});

// 6. 좋아요 목록 조회 (GET /api/songs/liked/:sessionId)
app.get('/api/songs/liked/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data: likes, error: likesErr } = await supabase
      .from('likes')
      .select('song_id')
      .eq('session_id', sessionId);

    if (likesErr) throw likesErr;

    const songIds = likes.map(l => l.song_id);
    res.json(songIds);
  } catch (err) {
    console.error('좋아요 목록 조회 오류:', err.message);
    res.status(500).json({ error: '좋아요 목록을 불러오지 못했습니다.' });
  }
});

// 7. 플레이리스트 전체 조회 (GET /api/playlists)
app.get('/api/playlists', async (req, res) => {
  try {
    const { data: playlists, error } = await supabase
      .from('playlists')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(playlists);
  } catch (err) {
    console.error('플레이리스트 조회 오류:', err.message);
    res.status(500).json({ error: '플레이리스트를 불러올 수 없습니다.' });
  }
});

// 8. 플레이리스트 생성 (POST /api/playlists)
app.post('/api/playlists', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: '플레이리스트 이름은 필수입니다.' });

    const { data: newPlaylist, error } = await supabase
      .from('playlists')
      .insert([{ name, description }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(newPlaylist);
  } catch (err) {
    console.error('플레이리스트 생성 오류:', err.message);
    res.status(500).json({ error: '플레이리스트를 생성할 수 없습니다.' });
  }
});

// 9. 특정 플레이리스트의 곡 목록 조회 (GET /api/playlists/:id/songs)
app.get('/api/playlists/:id/songs', async (req, res) => {
  try {
    const { id } = req.params;

    // 플레이리스트 매핑 데이터 조회
    const { data: playlistSongs, error: mapErr } = await supabase
      .from('playlist_songs')
      .select('song_id, added_at')
      .eq('playlist_id', id)
      .order('added_at', { ascending: true });

    if (mapErr) throw mapErr;

    if (playlistSongs.length === 0) {
      return res.json([]);
    }

    // 연결된 곡 데이터 일괄 조회
    const songIds = playlistSongs.map(ps => ps.song_id);
    const { data: songs, error: songErr } = await supabase
      .from('songs')
      .select('*')
      .in('id', songIds);

    if (songErr) throw songErr;

    // 매핑 순서에 맞게 정렬
    const sortedSongs = playlistSongs
      .map(ps => songs.find(s => s.id === ps.song_id))
      .filter(Boolean);

    res.json(sortedSongs);
  } catch (err) {
    console.error('플레이리스트 곡 조회 오류:', err.message);
    res.status(500).json({ error: '플레이리스트의 곡을 가져올 수 없습니다.' });
  }
});

// 10. 플레이리스트에 곡 추가 (POST /api/playlists/:id/songs)
app.post('/api/playlists/:id/songs', async (req, res) => {
  try {
    const { id } = req.params;
    const { songId } = req.body;

    if (!songId) return res.status(400).json({ error: 'songId는 필수입니다.' });

    const { data: added, error } = await supabase
      .from('playlist_songs')
      .insert([{ playlist_id: id, song_id: songId }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // 중복 키 제약 조건 (이미 존재함)
        return res.status(400).json({ error: '이미 플레이리스트에 추가된 곡입니다.' });
      }
      throw error;
    }

    res.status(201).json(added);
  } catch (err) {
    console.error('플레이리스트 곡 추가 오류:', err.message);
    res.status(500).json({ error: '플레이리스트에 곡을 추가할 수 없습니다.' });
  }
});

// 11. 플레이리스트에서 곡 제거 (DELETE /api/playlists/:id/songs/:songId)
app.delete('/api/playlists/:id/songs/:songId', async (req, res) => {
  try {
    const { id, songId } = req.params;

    const { error } = await supabase
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', id)
      .eq('song_id', songId);

    if (error) throw error;
    res.json({ success: true, message: '곡이 플레이리스트에서 제거되었습니다.' });
  } catch (err) {
    console.error('플레이리스트 곡 제거 오류:', err.message);
    res.status(500).json({ error: '플레이리스트에서 곡을 제거하지 못했습니다.' });
  }
});

// 기본 상태 검사 엔드포인트
app.get('/', (req, res) => {
  res.json({ message: 'musicdrive Backend API Server is running!' });
});

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
