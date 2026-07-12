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
const upload = multer({ storage: multer.memoryStorage() }).fields([
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

// 2.5. 관리자 비밀번호 검증 (POST /api/admin/verify)
app.post('/api/admin/verify', (req, res) => {
  try {
    const { adminPassword } = req.body;
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    
    console.log('[DEBUG] 어드민 패스워드 검증 요청 수신');
    console.log('[DEBUG] 입력된 비밀번호 길이:', adminPassword ? adminPassword.length : 0);
    console.log('[DEBUG] 설정된 비밀번호 길이:', expectedPassword ? expectedPassword.length : 0);
    console.log('[DEBUG] 비밀번호 일치 여부:', adminPassword === expectedPassword);

    if (adminPassword === expectedPassword) {
      res.json({ success: true, message: '인증에 성공했습니다.' });
    } else {
      res.status(401).json({ error: '관리자 비밀번호가 올바르지 않습니다.' });
    }
  } catch (err) {
    console.error('어드민 검증 오류:', err.message);
    res.status(500).json({ error: '비밀번호 검증 중 오류가 발생했습니다.' });
  }
});

// 3. 신규 음원 등록 및 업로드 (POST /api/songs) - 관리자용
app.post('/api/songs', upload, async (req, res) => {
  try {
    const { title, artist, lyrics, category, adminPassword } = req.body;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    
    console.log('[DEBUG] 음원 업로드 요청 - 관리자 검증');
    console.log('[DEBUG] 입력된 비밀번호 길이:', adminPassword ? adminPassword.length : 0);
    console.log('[DEBUG] 설정된 비밀번호 길이:', expectedPassword ? expectedPassword.length : 0);
    console.log('[DEBUG] 비밀번호 일치 여부:', adminPassword === expectedPassword);

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
    console.error('음원 등록 오류 상세:', err);
    res.status(500).json({ 
      error: `음원 등록 실패: ${err.message || err}`,
      details: err
    });
  }
});

// 3.5. 음원 정보 수정 (PUT /api/songs/:id) - 관리자용
app.put('/api/songs/:id', upload, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, artist, lyrics, category, adminPassword } = req.body;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (adminPassword !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    if (!title || !artist) {
      return res.status(400).json({ error: '곡 제목과 아티스트 이름은 필수입니다.' });
    }

    // 기존 음원 정보 조회
    const { data: existingSong, error: getErr } = await supabase
      .from('songs')
      .select('*')
      .eq('id', id)
      .single();

    if (getErr || !existingSong) {
      return res.status(404).json({ error: '해당 음원을 찾을 수 없습니다.' });
    }

    let coverUrl = existingSong.cover_url;
    const coverFile = req.files && req.files.cover ? req.files.cover[0] : null;

    if (coverFile) {
      // 신규 앨범 커버 업로드
      const timestamp = Date.now();
      const cleanFileName = (name) => name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
      const coverPath = `${timestamp}_${cleanFileName(coverFile.originalname)}`;
      
      const { data: coverUpload, error: coverErr } = await supabase.storage
        .from('covers')
        .upload(coverPath, coverFile.buffer, {
          contentType: coverFile.mimetype,
          upsert: true
        });

      if (coverErr) throw coverErr;

      // 신규 커버 URL 획득
      const { data: coverUrlData } = supabase.storage.from('covers').getPublicUrl(coverPath);
      coverUrl = coverUrlData.publicUrl;

      // 기존에 업로드했던 커버 파일이 있다면 삭제 (Unsplash 기본 플레이스홀더 이미지는 제외)
      if (existingSong.cover_url && existingSong.cover_url.includes('/object/public/covers/')) {
        const oldCoverName = existingSong.cover_url.split('/object/public/covers/')[1];
        if (oldCoverName) {
          await supabase.storage.from('covers').remove([oldCoverName]).catch(err => {
            console.error('기존 커버 삭제 실패:', err.message);
          });
        }
      }
    }

    // 데이터베이스 업데이트
    const { data: updatedSong, error: dbErr } = await supabase
      .from('songs')
      .update({
        title,
        artist,
        cover_url: coverUrl,
        lyrics: lyrics || '',
        category: category || '일반'
      })
      .eq('id', id)
      .select()
      .single();

    if (dbErr) throw dbErr;

    res.json(updatedSong);
  } catch (err) {
    console.error('음원 수정 오류:', err);
    res.status(500).json({ error: `음원 수정 실패: ${err.message || err}` });
  }
});

// 3.6. 음원 삭제 (DELETE /api/songs/:id) - 관리자용
app.delete('/api/songs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminPassword } = req.body;
    const password = adminPassword || req.query.adminPassword;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (password !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    // 기존 음원 정보 조회 (삭제 전 파일 경로 획득 목적)
    const { data: song, error: getErr } = await supabase
      .from('songs')
      .select('*')
      .eq('id', id)
      .single();

    if (getErr || !song) {
      return res.status(404).json({ error: '해당 음원을 찾을 수 없습니다.' });
    }

    // 데이터베이스 행 삭제 (likes 및 playlist_songs는 DB 제약조건에 의해 자동 연쇄 삭제됨)
    const { error: dbErr } = await supabase
      .from('songs')
      .delete()
      .eq('id', id);

    if (dbErr) throw dbErr;

    // 오디오 파일 스토리지 삭제
    if (song.audio_url && song.audio_url.includes('/object/public/songs/')) {
      const audioFileName = song.audio_url.split('/object/public/songs/')[1];
      if (audioFileName) {
        await supabase.storage.from('songs').remove([audioFileName]).catch(err => {
          console.error('오디오 파일 삭제 실패:', err.message);
        });
      }
    }

    // 커버 파일 스토리지 삭제
    if (song.cover_url && song.cover_url.includes('/object/public/covers/')) {
      const coverFileName = song.cover_url.split('/object/public/covers/')[1];
      if (coverFileName) {
        await supabase.storage.from('covers').remove([coverFileName]).catch(err => {
          console.error('커버 파일 삭제 실패:', err.message);
        });
      }
    }

    res.json({ success: true, message: '음원이 성공적으로 삭제되었습니다.' });
  } catch (err) {
    console.error('음원 삭제 오류:', err);
    res.status(500).json({ error: `음원 삭제 실패: ${err.message || err}` });
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
    const { userId } = req.query;
    if (!userId) return res.json([]);

    const { data: playlists, error } = await supabase
      .from('playlists')
      .select('*')
      .eq('user_id', userId)
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
    const { name, description, userId } = req.body;
    if (!name || !userId) return res.status(400).json({ error: '이름과 userId는 필수입니다.' });

    const { data: newPlaylist, error } = await supabase
      .from('playlists')
      .insert([{ name, description, user_id: userId }])
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


// ==========================================
// VS 대결 투표 API 엔드포인트
// ==========================================

// 1. VS 대결 목록 조회 (GET /api/vs-matches)
app.get('/api/vs-matches', async (req, res) => {
  try {
    const { sessionId } = req.query;

    // 1) 전체 대결 가져오기
    const { data: matches, error: matchesErr } = await supabase
      .from('vs_matches')
      .select(`
        *,
        song1:song1_id(*),
        song2:song2_id(*)
      `)
      .order('created_at', { ascending: false });

    if (matchesErr) throw matchesErr;

    if (!matches || matches.length === 0) {
      return res.json([]);
    }

    // 2) 각 대결에 대한 투표 집계 정보 및 세션별 투표 여부 취합
    const matchesWithVotes = await Promise.all(matches.map(async (match) => {
      // Song 1 투표 수
      const { count: vote1Count, error: err1 } = await supabase
        .from('vs_votes')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', match.id)
        .eq('song_id', match.song1_id);

      if (err1) throw err1;

      // Song 2 투표 수
      const { count: vote2Count, error: err2 } = await supabase
        .from('vs_votes')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', match.id)
        .eq('song_id', match.song2_id);

      if (err2) throw err2;

      // 현재 사용자가 투표했는지 여부 확인
      let userVotedSongId = null;
      if (sessionId) {
        const { data: userVote, error: voteErr } = await supabase
          .from('vs_votes')
          .select('song_id')
          .eq('match_id', match.id)
          .eq('session_id', sessionId)
          .maybeSingle();

        if (voteErr) throw voteErr;
        if (userVote) {
          userVotedSongId = userVote.song_id;
        }
      }

      return {
        ...match,
        song1_votes: vote1Count || 0,
        song2_votes: vote2Count || 0,
        user_voted_song_id: userVotedSongId
      };
    }));

    res.json(matchesWithVotes);
  } catch (err) {
    console.error('VS 대결 목록 조회 오류:', err.message);
    res.status(500).json({ error: 'VS 대결 목록을 가져올 수 없습니다.' });
  }
});

// 2. VS 대결 생성 (POST /api/vs-matches) - 관리자용
app.post('/api/vs-matches', async (req, res) => {
  try {
    const { title, description, song1_id, song2_id, adminPassword } = req.body;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (adminPassword !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    if (!title || !song1_id || !song2_id) {
      return res.status(400).json({ error: '대결 제목 및 두 곡의 ID는 필수입니다.' });
    }

    const { data: newMatch, error } = await supabase
      .from('vs_matches')
      .insert([
        {
          title,
          description: description || '',
          song1_id,
          song2_id
        }
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(newMatch);
  } catch (err) {
    console.error('VS 대결 생성 오류:', err.message);
    res.status(500).json({ error: 'VS 대결을 생성할 수 없습니다.' });
  }
});

// 3. VS 대결 투표 처리 (POST /api/vs-matches/:id/vote)
app.post('/api/vs-matches/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const { songId, sessionId } = req.body;

    if (!songId || !sessionId) {
      return res.status(400).json({ error: 'songId 및 sessionId는 필수입니다.' });
    }

    // 이미 투표했는지 확인
    const { data: existingVote, error: checkErr } = await supabase
      .from('vs_votes')
      .select('*')
      .eq('match_id', id)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (checkErr) throw checkErr;

    if (existingVote) {
      // 투표 취소 또는 변경 기능 지원 (여기서는 다른 곡 클릭 시 업데이트, 동일 곡 클릭 시 취소로 처리)
      if (existingVote.song_id === songId) {
        // 투표 취소
        const { error: deleteErr } = await supabase
          .from('vs_votes')
          .delete()
          .eq('match_id', id)
          .eq('session_id', sessionId);

        if (deleteErr) throw deleteErr;
        return res.json({ success: true, voted: false, songId: null });
      } else {
        // 다른 곡으로 투표 변경
        const { data: updatedVote, error: updateErr } = await supabase
          .from('vs_votes')
          .update({ song_id: songId })
          .eq('match_id', id)
          .eq('session_id', sessionId)
          .select()
          .single();

        if (updateErr) throw updateErr;
        return res.json({ success: true, voted: true, songId: updatedVote.song_id });
      }
    } else {
      // 신규 투표 등록
      const { data: newVote, error: insertErr } = await supabase
        .from('vs_votes')
        .insert([
          {
            match_id: id,
            song_id: songId,
            session_id: sessionId
          }
        ])
        .select()
        .single();

      if (insertErr) throw insertErr;
      res.status(201).json({ success: true, voted: true, songId: newVote.song_id });
    }
  } catch (err) {
    console.error('VS 투표 처리 오류:', err.message);
    res.status(500).json({ error: '투표를 처리할 수 없습니다.' });
  }
});

// 4. VS 대결 삭제 (DELETE /api/vs-matches/:id) - 관리자용
app.delete('/api/vs-matches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminPassword } = req.body;
    const password = adminPassword || req.query.adminPassword;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (password !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    const { error } = await supabase
      .from('vs_matches')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'VS 대결이 성공적으로 삭제되었습니다.' });
  } catch (err) {
    console.error('VS 대결 삭제 오류:', err.message);
    res.status(500).json({ error: 'VS 대결을 삭제할 수 없습니다.' });
  }
});

// 5. VS 대결 수정 (PUT /api/vs-matches/:id) - 관리자용
app.put('/api/vs-matches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, song1_id, song2_id, adminPassword } = req.body;

    // 관리자 비밀번호 검증
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    if (adminPassword !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    if (!title || !song1_id || !song2_id) {
      return res.status(400).json({ error: '대결 제목 및 두 곡의 ID는 필수입니다.' });
    }

    const { data: updatedMatch, error } = await supabase
      .from('vs_matches')
      .update({
        title,
        description: description || '',
        song1_id,
        song2_id
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(updatedMatch);
  } catch (err) {
    console.error('VS 대결 수정 오류:', err.message);
    res.status(500).json({ error: 'VS 대결을 수정할 수 없습니다.' });
  }
});


// 진단 API 엔드포인트 (GET /api/diagnose)
app.get('/api/diagnose', async (req, res) => {
  const diagnosis = {
    supabaseUrlConfigured: !!process.env.SUPABASE_URL,
    supabaseServiceKeyConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    databaseConnection: null,
    songsBucketExists: null,
    coversBucketExists: null,
    errors: []
  };

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      diagnosis.errors.push('Supabase 환경 변수가 설정되지 않았습니다.');
    } else {
      // 1. 데이터베이스 연결 및 테이블 확인
      const { data, error: dbErr } = await supabase
        .from('songs')
        .select('id')
        .limit(1);
      
      if (dbErr) {
        diagnosis.databaseConnection = false;
        diagnosis.errors.push(`데이터베이스 연결 실패: ${dbErr.message}`);
      } else {
        diagnosis.databaseConnection = true;
      }

      // 2. Storage 버킷 확인
      const { data: buckets, error: storageErr } = await supabase.storage.listBuckets();
      if (storageErr) {
        diagnosis.errors.push(`스토리지 버킷 목록 조회 실패: ${storageErr.message}`);
        diagnosis.songsBucketExists = false;
        diagnosis.coversBucketExists = false;
      } else {
        const bucketNames = buckets.map(b => b.name);
        diagnosis.songsBucketExists = bucketNames.includes('songs');
        diagnosis.coversBucketExists = bucketNames.includes('covers');
        
        if (!diagnosis.songsBucketExists) {
          diagnosis.errors.push("'songs' 스토리지 버킷이 존재하지 않습니다. Supabase Storage에서 Public으로 생성해 주세요.");
        }
        if (!diagnosis.coversBucketExists) {
          diagnosis.errors.push("'covers' 스토리지 버킷이 존재하지 않습니다. Supabase Storage에서 Public으로 생성해 주세요.");
        }
      }
    }
  } catch (err) {
    diagnosis.errors.push(`진단 도중 예외 발생: ${err.message}`);
  }

  console.log('[DEBUG] 서버 상태 진단 결과:', diagnosis);
  
  if (diagnosis.errors.length > 0) {
    res.status(500).json({ status: 'error', diagnosis });
  } else {
    res.json({ status: 'healthy', diagnosis });
  }
});

// 12. 수파베이스 로컬 동기화 및 깃 푸시 API (POST /api/admin/sync)
app.post('/api/admin/sync', async (req, res) => {
  try {
    const { adminPassword } = req.body;
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';

    if (adminPassword !== expectedPassword) {
      return res.status(403).json({ error: '관리자 인증 비밀번호가 일치하지 않습니다.' });
    }

    const { exec } = require('child_process');
    const path = require('path');
    const rootDir = path.join(__dirname, '..');

    const runCmd = (cmd) => {
      return new Promise((resolve, reject) => {
        exec(cmd, { cwd: rootDir }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      });
    };

    console.log('[SYNC] Starting sync script execution via web dashboard...');
    // A. sync_assets.js 스크립트 실행
    await runCmd('node backend/sync_assets.js');
    console.log('[SYNC] Sync assets script completed.');

    // B. git status 확인하여 커밋할 항목이 있는지 체크
    const statusOutput = await runCmd('git status --porcelain');
    if (statusOutput.trim() === '') {
      console.log('[SYNC] No changes to commit.');
      return res.json({ success: true, message: '동기화 완료 (추가로 커밋할 파일 없음)' });
    }

    // C. 깃허브 스테이징, 커밋 및 푸시
    console.log('[SYNC] Changes detected. Committing and pushing to git...');
    await runCmd('git add .');
    await runCmd(`git commit -m "sync: 수파베이스 음원 로컬 동기화 (Admin Web Dashboard)"`);
    await runCmd('git push origin main');
    console.log('[SYNC] Push to git completed successfully.');

    res.json({ success: true, message: '동기화 및 깃허브 배포가 성공적으로 완료되었습니다.' });
  } catch (err) {
    console.error('동기화 처리 API 오류:', err.message || err);
    res.status(500).json({ error: `동기화 실패: ${err.message || err}` });
  }
});

// ==========================================
// 자유게시판(Board) API 엔드포인트
// ==========================================

// 1. 게시글 목록 조회
app.get('/api/board', async (req, res) => {
  try {
    const { data: posts, error } = await supabase
      .from('board_posts')
      .select('id, title, author, views, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(posts || []);
  } catch (err) {
    console.error('게시글 목록 조회 오류:', err);
    res.status(500).json({ error: '게시글 목록을 가져올 수 없습니다.' });
  }
});

// 2. 게시글 상세 조회 (조회수 증가 포함)
app.get('/api/board/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: post, error: getErr } = await supabase
      .from('board_posts')
      .select('*')
      .eq('id', id)
      .single();

    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    // 조회수 + 1 업데이트 로직
    await supabase.from('board_posts').update({ views: post.views + 1 }).eq('id', id);
    post.views += 1;

    res.json(post);
  } catch (err) {
    console.error('게시글 상세 조회 오류:', err);
    res.status(500).json({ error: '게시글을 불러올 수 없습니다.' });
  }
});

// 3. 게시글 작성
app.post('/api/board', async (req, res) => {
  try {
    const { title, content, author, password } = req.body;
    if (!title || !content || !author || !password) {
      return res.status(400).json({ error: '필수 정보를 모두 입력해주세요.' });
    }

    const { data: newPost, error } = await supabase
      .from('board_posts')
      .insert([{ title, content, author, password }])
      .select('id, title, author, created_at, views')
      .single();

    if (error) throw error;
    res.status(201).json(newPost);
  } catch (err) {
    console.error('게시글 작성 오류:', err);
    res.status(500).json({ error: '게시글을 작성할 수 없습니다.' });
  }
});

// 4. 게시글 수정
app.put('/api/board/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, password } = req.body;

    const { data: post, error: getErr } = await supabase.from('board_posts').select('password').eq('id', id).single();
    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    if (post.password !== password) return res.status(403).json({ error: '비밀번호가 일치하지 않습니다.' });

    const { data: updated, error: updateErr } = await supabase
      .from('board_posts')
      .update({ title, content })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;
    res.json(updated);
  } catch (err) {
    console.error('게시글 수정 오류:', err);
    res.status(500).json({ error: '게시글을 수정할 수 없습니다.' });
  }
});

// 5. 게시글 삭제
app.delete('/api/board/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.body.password || req.query.password;

    const { data: post, error: getErr } = await supabase.from('board_posts').select('password').eq('id', id).single();
    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    if (post.password !== password) return res.status(403).json({ error: '비밀번호가 일치하지 않습니다.' });

    const { error: deleteErr } = await supabase.from('board_posts').delete().eq('id', id);
    if (deleteErr) throw deleteErr;

    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (err) {
    console.error('게시글 삭제 오류:', err);
    res.status(500).json({ error: '게시글을 삭제할 수 없습니다.' });
  }
});

// 6. 댓글 목록 조회
app.get('/api/board/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: comments, error } = await supabase
      .from('board_comments')
      .select('id, post_id, author, content, created_at')
      .eq('post_id', id)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    res.json(comments || []);
  } catch (err) {
    console.error('댓글 목록 조회 오류:', err);
    res.status(500).json({ error: '댓글을 가져올 수 없습니다.' });
  }
});

// 7. 댓글 작성
app.post('/api/board/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { author, content, password } = req.body;
    
    if (!author || !content || !password) return res.status(400).json({ error: '필수 정보를 모두 입력해주세요.' });

    const { data: comment, error } = await supabase
      .from('board_comments')
      .insert([{ post_id: id, author, content, password }])
      .select('id, post_id, author, content, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(comment);
  } catch (err) {
    console.error('댓글 작성 오류:', err);
    res.status(500).json({ error: '댓글을 작성할 수 없습니다.' });
  }
});

// 8. 댓글 삭제
app.delete('/api/board/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const password = req.body.password || req.query.password;

    const { data: comment, error: getErr } = await supabase.from('board_comments').select('password').eq('id', commentId).single();
    if (getErr || !comment) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });

    if (comment.password !== password) return res.status(403).json({ error: '비밀번호가 일치하지 않습니다.' });

    const { error: deleteErr } = await supabase.from('board_comments').delete().eq('id', commentId);
    if (deleteErr) throw deleteErr;

    res.json({ success: true, message: '댓글이 삭제되었습니다.' });
  } catch (err) {
    console.error('댓글 삭제 오류:', err);
    res.status(500).json({ error: '댓글을 삭제할 수 없습니다.' });
  }
});

// 기본 상태 검사 엔드포인트
app.get('/', (req, res) => {
  res.json({ message: 'musicdrive Backend API Server is running!' });
});

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
