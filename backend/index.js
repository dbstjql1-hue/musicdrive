const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { createAssetSyncService } = require('./asset-sync');
const { createLyricsSyncService, hasTimedLyrics } = require('./lyrics-sync');
const { selectWeeklyMatch } = require('./weekly-match');
const { buildUserDashboard } = require('./user-dashboard');
const { validateNoticePayload } = require('./notice-validation');
const {
  createFallbackChatNickname,
  detectChatDeviceType,
  extractChatMentionKeys,
  moderateChatMessage,
  normalizeForMatching,
  validateChatNickname
} = require('./chat-moderation');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const allowedCorsOrigins = new Set([
  'https://musicdrive.kro.kr',
  'https://www.musicdrive.kro.kr',
  ...configuredCorsOrigins
]);

function isAllowedCorsOrigin(origin) {
  if (!origin || allowedCorsOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    const isLocalDevelopment = protocol === 'http:'
      && (hostname === 'localhost' || hostname === '127.0.0.1');
    const isVercelPreview = protocol === 'https:' && hostname.endsWith('.vercel.app');
    return isLocalDevelopment || isVercelPreview;
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password'],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', service: 'musicdrive-api' });
});

// Supabase 연결 설정
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Storage 업로드를 위해 service_role 키 권장

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('경고: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const safeNumber = (value) => Number.isFinite(value) ? value : 0;

function isAdminRequest(req) {
  const providedPassword = req.headers['x-admin-password'] || req.body?.adminPassword || req.query?.adminPassword;
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  return providedPassword === expectedPassword;
}

function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  res.status(403).json({ error: '관리자 인증이 필요합니다.' });
  return false;
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function getAuthenticatedUser(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) return null;

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}

async function canManageBoardRecord(ownerKey, user) {
  if (!user) return false;
  if (ownerKey === `owner:${user.id}`) return true;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return !error && profile?.role === 'admin';
}

function getGoogleAccountName(user) {
  const value = user?.user_metadata?.full_name || user?.user_metadata?.name;
  return String(value || '').normalize('NFKC').trim().slice(0, 100) || null;
}

async function getOrCreateChatProfile(user) {
  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, chat_nickname')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const existingNickname = validateChatNickname(existingProfile?.chat_nickname);
  if (existingNickname.allowed) return { nickname: existingNickname.nickname };

  const fallbackNickname = createFallbackChatNickname(user.id);
  const { data: savedProfile, error: saveError } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      email: user.email,
      google_name: getGoogleAccountName(user),
      chat_nickname: fallbackNickname,
      nickname_updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    .select('chat_nickname')
    .single();
  if (saveError) throw saveError;
  return { nickname: savedProfile.chat_nickname };
}

function toDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function makeRecentDayBuckets(days = 7) {
  return Array.from({ length: days }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: `${date.getMonth() + 1}/${date.getDate()}`, count: 0 };
  });
}

function getTopEntry(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0] || null;
}

function normalizeActivityType(type) {
  return String(type || 'unknown').toLowerCase().replace(/[^a-z0-9_:-]/g, '_').slice(0, 40);
}

function getStorageFileName(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const [, encodedPath] = String(url).split(marker);
  if (!encodedPath) return null;
  return decodeURIComponent(encodedPath.split('?')[0]);
}

function getLocalAssetPath(bucket, fileName) {
  if (!fileName) return null;
  const baseDirectory = path.resolve(__dirname, '..', 'frontend', 'public', bucket);
  const resolvedPath = path.resolve(baseDirectory, fileName);
  return resolvedPath.startsWith(`${baseDirectory}${path.sep}`) ? resolvedPath : null;
}

const assetSync = createAssetSyncService({
  supabase,
  getStorageFileName
});
const lyricsSync = createLyricsSyncService({ supabase });

async function recordActivity({ eventType, userId = null, sessionId = null, songId = null, metadata = {} }) {
  try {
    const { error } = await supabase
      .from('user_activity')
      .insert([{
        event_type: normalizeActivityType(eventType),
        user_id: userId || null,
        session_id: sessionId || null,
        song_id: songId || null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {}
      }]);
    if (error) console.warn('[analytics] activity skipped:', error.message);
  } catch (err) {
    console.warn('[analytics] activity skipped:', err.message);
  }
}

async function safeFetch(label, queryPromise, fallback) {
  try {
    const result = await queryPromise;
    if (result.error) {
      console.warn(`[analytics] ${label} skipped:`, result.error.message);
      return fallback;
    }
    if (Object.prototype.hasOwnProperty.call(result, 'count') && result.count !== null) {
      return result.count;
    }
    return result.data ?? fallback;
  } catch (err) {
    console.warn(`[analytics] ${label} skipped:`, err.message);
    return fallback;
  }
}

async function fetchPlayHistoryRows(limit = 5000) {
  const detailed = await supabase
    .from('play_history')
    .select('id, user_id, session_id, song_id, source, delivery_source, estimated_bytes, played_at')
    .order('played_at', { ascending: false })
    .limit(limit);

  if (!detailed.error) return detailed.data || [];

  const fallback = await supabase
    .from('play_history')
    .select('id, user_id, session_id, song_id, source, played_at')
    .order('played_at', { ascending: false })
    .limit(limit);

  if (fallback.error) {
    console.warn('[analytics] play history skipped:', fallback.error.message);
    return [];
  }
  return fallback.data || [];
}

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

// 2.6. 사용자 활동 이벤트 수집 (POST /api/activity)
app.post('/api/activity', async (req, res) => {
  try {
    const { eventType, userId, sessionId, songId, metadata } = req.body || {};
    if (!eventType) {
      return res.status(400).json({ error: 'eventType은 필수입니다.' });
    }

    await recordActivity({ eventType, userId, sessionId, songId, metadata });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('활동 이벤트 저장 오류:', err.message);
    res.status(500).json({ error: '활동 이벤트를 저장할 수 없습니다.' });
  }
});

// Personal listening dashboard for the authenticated user.
app.get('/api/users/me/dashboard', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: '로그인이 필요한 서비스입니다.' });
    }

    const [plays, songs, listenActivities] = await Promise.all([
      safeFetch(
        'personal play history',
        supabase
          .from('play_history')
          .select('id, song_id, played_at')
          .eq('user_id', user.id)
          .order('played_at', { ascending: false })
          .limit(10000),
        []
      ),
      safeFetch(
        'personal dashboard songs',
        supabase
          .from('songs')
          .select('id, title, artist, category, cover_url, created_at')
          .order('created_at', { ascending: false })
          .limit(5000),
        []
      ),
      safeFetch(
        'personal listening time',
        supabase
          .from('user_activity')
          .select('event_type, metadata, created_at')
          .eq('user_id', user.id)
          .eq('event_type', 'listen_time')
          .order('created_at', { ascending: false })
          .limit(10000),
        []
      )
    ]);

    res.set('Cache-Control', 'private, no-store');
    res.json({
      ...buildUserDashboard({ plays, songs, activities: listenActivities }),
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('개인 현황판 조회 오류:', err.message);
    res.status(500).json({ error: '개인 현황판을 불러올 수 없습니다.' });
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
    let coverPath = null;
    if (coverFile) {
      coverPath = `${timestamp}_${cleanFileName(coverFile.originalname)}`;
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
    const songPayload = {
      title,
      artist,
      audio_url: audioUrl,
      cover_url: coverUrl,
      lyrics: lyrics || '',
      category: category || '일반',
      audio_size_bytes: audioFile.size
    };
    let { data: newSong, error: dbErr } = await supabase
      .from('songs')
      .insert([songPayload])
      .select()
      .single();

    if (dbErr && dbErr.message?.includes('audio_size_bytes')) {
      const { audio_size_bytes, ...legacyPayload } = songPayload;
      const legacyResult = await supabase.from('songs').insert([legacyPayload]).select().single();
      newSong = legacyResult.data;
      dbErr = legacyResult.error;
    }

    if (dbErr) throw dbErr;

    const syncStatus = assetSync.getStatus();
    let autoSync = {
      state: syncStatus.publishingConfigured ? 'queued' : 'configuration_required',
      message: syncStatus.publishingConfigured
        ? '정적 자산 자동 게시를 준비하고 있습니다.'
        : 'GITHUB_ASSET_SYNC_TOKEN 설정 후 자동 게시가 시작됩니다.'
    };

    if (syncStatus.publishingConfigured) {
      const filesToPublish = [
        { path: `frontend/public/songs/${audioPath}`, buffer: audioFile.buffer },
        coverFile && coverPath
          ? { path: `frontend/public/covers/${coverPath}`, buffer: coverFile.buffer }
          : null
      ].filter(Boolean);

      try {
        const publishResult = await assetSync.publishFiles(
          filesToPublish,
          `sync: publish assets for ${title}`
        );
        assetSync.scheduleSoon();
        autoSync = {
          state: 'deploying',
          message: publishResult.changed
            ? 'GitHub 반영이 완료되어 배포 및 공개 확인을 기다리고 있습니다.'
            : '정적 파일이 이미 반영되어 공개 확인을 기다리고 있습니다.',
          commitSha: publishResult.commitSha
        };
      } catch (syncError) {
        console.warn('[asset-sync] 업로드 직후 게시 실패, 정기 재시도 예정:', syncError.message);
        autoSync = {
          state: 'retrying',
          message: '음원 등록은 완료되었으며 자동 동기화를 다시 시도합니다.'
        };
        assetSync.scheduleSoon(10_000);
      }
    }

    const sourceLyrics = String(newSong.lyrics || '').trim();
    let lyricsAutoSync = {
      state: 'not_requested',
      message: 'No lyrics were provided for automatic timing.'
    };
    if (sourceLyrics && hasTimedLyrics(sourceLyrics)) {
      lyricsAutoSync = {
        state: 'already_synced',
        message: 'The uploaded lyrics already contain timing.'
      };
    } else if (sourceLyrics) {
      const lyricsSyncStatus = lyricsSync.getStatus();
      lyricsAutoSync = {
        state: syncStatus.publishingConfigured && lyricsSyncStatus.enabled
          ? 'queued'
          : 'configuration_required',
        message: syncStatus.publishingConfigured && lyricsSyncStatus.enabled
          ? 'Automatic lyric timing has been queued.'
          : 'Automatic lyric timing requires the GitHub asset sync configuration.'
      };
      if (lyricsAutoSync.state === 'queued') lyricsSync.scheduleSoon(60_000);
    }

    res.status(201).json({ ...newSong, autoSync, lyricsAutoSync });
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
    const { userId, sessionId, source } = req.body || {};
    
    // 먼저 현재 조회수 조회
    const { data: song, error: getErr } = await supabase
      .from('songs')
      .select('play_count, audio_url')
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

    const assetRows = await safeFetch(
      'song asset size',
      supabase.from('songs').select('audio_size_bytes').eq('id', id).maybeSingle(),
      null
    );
    const deliverySource = song.audio_url?.includes('/storage/v1/object/') ? 'supabase_storage' : 'local_asset';
    const playPayload = {
      user_id: userId || null,
      session_id: sessionId || null,
      song_id: id,
      source: source || 'player',
      delivery_source: deliverySource,
      estimated_bytes: deliverySource === 'supabase_storage' ? safeNumber(Number(assetRows?.audio_size_bytes)) : 0
    };
    let playHistoryResult = await supabase
      .from('play_history')
      .insert([playPayload]);

    if (playHistoryResult.error && /delivery_source|estimated_bytes/.test(playHistoryResult.error.message || '')) {
      const { delivery_source, estimated_bytes, ...legacyPlayPayload } = playPayload;
      playHistoryResult = await supabase.from('play_history').insert([legacyPlayPayload]);
    }
    if (playHistoryResult.error) console.warn('[analytics] play history skipped:', playHistoryResult.error.message);

    await recordActivity({
      eventType: 'play',
      userId,
      sessionId,
      songId: id,
      metadata: { source: source || 'player' }
    });

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
    const { sessionId, userId } = req.body; // 클라이언트 식별용 고유 키

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
      const likePayload = { song_id: id, session_id: sessionId };
      if (userId) likePayload.user_id = userId;
      let { error: insertErr } = await supabase
        .from('likes')
        .insert([likePayload]);

      if (insertErr && userId && /user_id/i.test(insertErr.message || '')) {
        const retry = await supabase
          .from('likes')
          .insert([{ song_id: id, session_id: sessionId }]);
        insertErr = retry.error;
      }

      if (insertErr) throw insertErr;
      liked = true;
    }

    await recordActivity({
      eventType: liked ? 'like' : 'unlike',
      userId,
      sessionId,
      songId: id
    });

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
    await recordActivity({
      eventType: 'playlist_create',
      userId,
      metadata: { playlistId: newPlaylist.id, name }
    });
    res.status(201).json(newPlaylist);
  } catch (err) {
    console.error('플레이리스트 생성 오류:', err.message);
    res.status(500).json({ error: '플레이리스트를 생성할 수 없습니다.' });
  }
});

// Delete a playlist owned by the authenticated user. Songs remain untouched.
app.delete('/api/playlists/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: '로그인이 필요한 서비스입니다.' });
    }

    const { id } = req.params;
    const { data: playlist, error: lookupError } = await supabase
      .from('playlists')
      .select('id, name, user_id')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!playlist) return res.status(404).json({ error: '플레이리스트를 찾을 수 없습니다.' });
    if (playlist.user_id !== user.id) {
      return res.status(403).json({ error: '이 플레이리스트를 삭제할 권한이 없습니다.' });
    }

    const { data: deletedRows, error: deleteError } = await supabase
      .from('playlists')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');

    if (deleteError) throw deleteError;
    if (!deletedRows?.length) {
      return res.status(404).json({ error: '플레이리스트를 찾을 수 없습니다.' });
    }

    await recordActivity({
      eventType: 'playlist_delete',
      userId: user.id,
      metadata: { playlistId: id, name: playlist.name }
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('플레이리스트 삭제 오류:', err.message);
    res.status(500).json({ error: '플레이리스트를 삭제할 수 없습니다.' });
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
    const { songId, userId, sessionId } = req.body;

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

    await recordActivity({
      eventType: 'playlist_add',
      userId,
      sessionId,
      songId,
      metadata: { playlistId: id }
    });

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
    const { userId, sessionId } = req.body || req.query || {};

    const { error } = await supabase
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', id)
      .eq('song_id', songId);

    if (error) throw error;
    await recordActivity({
      eventType: 'playlist_remove',
      userId,
      sessionId,
      songId,
      metadata: { playlistId: id }
    });
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
    const { userId } = req.query;

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
      if (userId) {
        const { data: userVote, error: voteErr } = await supabase
          .from('vs_votes')
          .select('song_id')
          .eq('match_id', match.id)
          .eq('user_id', userId)
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

    const weeklyMatch = selectWeeklyMatch(matchesWithVotes);
    res.json(matchesWithVotes.map(match => ({
      ...match,
      is_weekly_featured: match.id === weeklyMatch.matchId,
      weekly_starts_at: weeklyMatch.startAt,
      weekly_ends_at: weeklyMatch.endAt
    })));
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
    const { songId, userId } = req.body;

    if (!songId || !userId) {
      return res.status(400).json({ error: 'songId 및 userId는 필수입니다.' });
    }

    // 이미 투표했는지 확인
    const { data: existingVote, error: checkErr } = await supabase
      .from('vs_votes')
      .select('*')
      .eq('match_id', id)
      .eq('user_id', userId)
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
          .eq('user_id', userId);

        if (deleteErr) throw deleteErr;
        await recordActivity({ eventType: 'vote_cancel', userId, songId, metadata: { matchId: id } });
        return res.json({ success: true, voted: false, songId: null });
      } else {
        // 다른 곡으로 투표 변경
        const { data: updatedVote, error: updateErr } = await supabase
          .from('vs_votes')
          .update({ song_id: songId })
          .eq('match_id', id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateErr) throw updateErr;
        await recordActivity({ eventType: 'vote_change', userId, songId, metadata: { matchId: id } });
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
            user_id: userId
          }
        ])
        .select()
        .single();

      if (insertErr) throw insertErr;
      await recordActivity({ eventType: 'vote', userId, songId, metadata: { matchId: id } });
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

// ==========================================
// 실시간 대화(Chat) API 엔드포인트
// ==========================================

const CHAT_SLOW_MODE_MS = 3_000;
const CHAT_RATE_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT = 12;
const CHAT_DUPLICATE_WINDOW_MS = 30_000;
const CHAT_TOPIC = 'room:musicdrive:lobby';
const chatRateState = new Map();

function hashChatContent(content) {
  return crypto.createHash('sha256').update(normalizeForMatching(content)).digest('hex');
}

function getRecentChatAttempts(userId, now) {
  const recent = (chatRateState.get(userId) || [])
    .filter((attempt) => now - attempt.timestamp <= CHAT_RATE_WINDOW_MS);
  if (recent.length > 0) chatRateState.set(userId, recent);
  else chatRateState.delete(userId);
  return recent;
}

async function broadcastTransientChatMessage(message) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: supabaseServiceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{
          topic: CHAT_TOPIC,
          event: 'chat_message',
          payload: message,
          private: true
        }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Realtime Broadcast rejected with status ${response.status}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/api/chat/profile', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const profile = await getOrCreateChatProfile(user);
    res.set('Cache-Control', 'no-store');
    return res.json(profile);
  } catch (err) {
    console.error('채팅 프로필 조회 오류:', err);
    return res.status(500).json({ error: '채팅 닉네임을 불러올 수 없습니다.' });
  }
});

app.patch('/api/chat/profile', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const validation = validateChatNickname(req.body?.nickname);
    if (!validation.allowed) {
      return res.status(422).json({
        error: validation.message,
        blocked: true,
        reason: validation.code
      });
    }

    await getOrCreateChatProfile(user);

    const { data, error } = await supabase
      .from('profiles')
      .update({
        chat_nickname: validation.nickname,
        google_name: getGoogleAccountName(user),
        nickname_updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select('chat_nickname')
      .single();

    if (error?.code === '23505') {
      return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
    }
    if (error) throw error;

    return res.json({ nickname: data.chat_nickname });
  } catch (err) {
    console.error('채팅 닉네임 변경 오류:', err);
    return res.status(500).json({ error: '채팅 닉네임을 변경할 수 없습니다.' });
  }
});

app.post('/api/chat/messages', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '로그인 후 메시지를 보낼 수 있습니다.' });

    const moderation = moderateChatMessage(req.body?.content);
    if (!moderation.allowed) {
      return res.status(422).json({
        error: moderation.message,
        blocked: true,
        reason: moderation.code
      });
    }

    const now = Date.now();
    const recentAttempts = getRecentChatAttempts(user.id, now);
    const latestAttempt = recentAttempts[recentAttempts.length - 1];
    if (latestAttempt && now - latestAttempt.timestamp < CHAT_SLOW_MODE_MS) {
      return res.status(429).json({ error: '느린 채팅이 적용 중입니다. 3초 후 다시 보내주세요.' });
    }
    if (recentAttempts.length >= CHAT_RATE_LIMIT) {
      return res.status(429).json({ error: '메시지를 너무 자주 보내고 있습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const contentHash = hashChatContent(moderation.content);
    const repeatedMessage = recentAttempts.find((attempt) => (
      now - attempt.timestamp <= CHAT_DUPLICATE_WINDOW_MS && attempt.contentHash === contentHash
    ));
    if (repeatedMessage) {
      return res.status(422).json({
        error: '같은 메시지를 반복해서 보낼 수 없습니다.',
        blocked: true,
        reason: 'duplicate'
      });
    }

    const chatProfile = await getOrCreateChatProfile(user);
    const message = {
      id: crypto.randomUUID(),
      user_id: user.id,
      nickname: chatProfile.nickname,
      device_type: detectChatDeviceType(req.get('user-agent')),
      content: moderation.content,
      mentions: extractChatMentionKeys(moderation.content),
      created_at: new Date(now).toISOString()
    };
    // Realtime REST Broadcast는 DB 행을 만들지 않고 현재 접속자에게만 전달됩니다.
    await broadcastTransientChatMessage(message);

    chatRateState.set(user.id, [...recentAttempts, { timestamp: now, contentHash }]);
    return res.status(201).json(message);
  } catch (err) {
    console.error('실시간 대화 전송 오류:', err);
    return res.status(500).json({ error: '메시지를 전송할 수 없습니다.' });
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
    const user = await getAuthenticatedUser(req);
    
    const { data: post, error: getErr } = await supabase
      .from('board_posts')
      .select('id, title, content, author, password, views, created_at')
      .eq('id', id)
      .single();

    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    // 조회수 + 1 업데이트 로직
    await supabase.from('board_posts').update({ views: (post.views || 0) + 1 }).eq('id', id);
    post.views = (post.views || 0) + 1;

    const canManage = await canManageBoardRecord(post.password, user);
    res.json({
      id: post.id,
      title: post.title,
      content: post.content,
      author: post.author,
      views: post.views,
      created_at: post.created_at,
      can_manage: canManage
    });
  } catch (err) {
    console.error('게시글 상세 조회 오류:', err);
    res.status(500).json({ error: '게시글을 불러올 수 없습니다.' });
  }
});

// 3. 게시글 작성
app.post('/api/board', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '글을 작성하려면 로그인이 필요합니다.' });

    const { title, content, author } = req.body;
    if (!title || !content || !author) {
      return res.status(400).json({ error: '필수 정보를 모두 입력해주세요.' });
    }

    const { data: newPost, error } = await supabase
      .from('board_posts')
      .insert([{ title, content, author, password: `owner:${user.id}` }])
      .select('id, title, author, created_at, views')
      .single();

    if (error) throw error;
    await recordActivity({ eventType: 'board_create', userId: user.id, metadata: { postId: newPost.id } });
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
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const { title, content } = req.body;

    const { data: post, error: getErr } = await supabase.from('board_posts').select('password').eq('id', id).single();
    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    if (!(await canManageBoardRecord(post.password, user))) {
      return res.status(403).json({ error: '이 게시글을 수정할 권한이 없습니다.' });
    }

    const { data: updated, error: updateErr } = await supabase
      .from('board_posts')
      .update({ title, content })
      .eq('id', id)
      .select('id, title, content, author, views, created_at')
      .single();

    if (updateErr) throw updateErr;
    res.json({ ...updated, can_manage: true });
  } catch (err) {
    console.error('게시글 수정 오류:', err);
    res.status(500).json({ error: '게시글을 수정할 수 없습니다.' });
  }
});

// 5. 게시글 삭제
app.delete('/api/board/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const { data: post, error: getErr } = await supabase.from('board_posts').select('password').eq('id', id).single();
    if (getErr || !post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    if (!(await canManageBoardRecord(post.password, user))) {
      return res.status(403).json({ error: '이 게시글을 삭제할 권한이 없습니다.' });
    }

    const { error: deleteErr } = await supabase.from('board_posts').delete().eq('id', id);
    if (deleteErr) throw deleteErr;

    await recordActivity({ eventType: 'board_delete', userId: user.id, metadata: { postId: id } });
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


// 15. 어드민 통계 (GET /api/admin/stats)
app.get('/api/admin/stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const [totalUsersCount, totalSongsCount, profiles, songs, songAssetRows, storageFiles, plays, activities, likes, votes] = await Promise.all([
      safeFetch('profile count', supabase.from('profiles').select('*', { count: 'exact', head: true }), 0),
      safeFetch('song count', supabase.from('songs').select('*', { count: 'exact', head: true }), 0),
      safeFetch('profiles', supabase.from('profiles').select('id, email, google_name, chat_nickname, role, created_at').limit(5000), []),
      safeFetch('songs', supabase.from('songs').select('id, title, artist, category, audio_url, play_count, likes_count').limit(5000), []),
      safeFetch('song asset metadata', supabase.from('songs').select('id, audio_size_bytes').limit(5000), []),
      safeFetch('storage files', supabase.storage.from('songs').list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } }), []),
      fetchPlayHistoryRows(5000),
      safeFetch('user activity', supabase.from('user_activity').select('id, event_type, user_id, session_id, song_id, metadata, created_at').order('created_at', { ascending: false }).limit(5000), []),
      safeFetch('likes', supabase.from('likes').select('id, user_id, session_id, song_id, created_at').order('created_at', { ascending: false }).limit(5000), []),
      safeFetch('votes', supabase.from('vs_votes').select('id, user_id, song_id, match_id, created_at').order('created_at', { ascending: false }).limit(5000), [])
    ]);

    const songById = Object.fromEntries(songs.map(song => [song.id, song]));
    const profileById = Object.fromEntries(profiles.map(profile => [profile.id, profile]));
    const storageSizeByName = Object.fromEntries(storageFiles.map(file => [file.name, safeNumber(Number(file.metadata?.size))]));
    const assetSizeBySong = Object.fromEntries(songAssetRows.map(row => [row.id, safeNumber(Number(row.audio_size_bytes))]));
    songs.forEach(song => {
      if (assetSizeBySong[song.id]) return;
      const fileName = getStorageFileName(song.audio_url, 'songs');
      if (fileName && storageSizeByName[fileName]) assetSizeBySong[song.id] = storageSizeByName[fileName];
    });
    const dailyBuckets = makeRecentDayBuckets(14).map(day => ({ ...day, plays: 0, visits: 0, activities: 0, trafficBytes: 0, activeActors: new Set() }));
    const dailyByDate = Object.fromEntries(dailyBuckets.map(day => [day.date, day]));
    const userData = new Map();
    const trafficBySong = {};
    let supabasePlayStarts14d = 0;
    let localPlayStarts14d = 0;

    const getUserData = (userId) => {
      if (!userId) return null;
      if (!userData.has(userId)) {
        userData.set(userId, {
          plays: 0,
          likes: 0,
          votes: 0,
          activities: 0,
          songCounts: {},
          categoryCounts: {},
          activityCounts: {},
          lastSeen: null
        });
      }
      return userData.get(userId);
    };

    const updateLastSeen = (target, value) => {
      if (!target || !value) return;
      if (!target.lastSeen || new Date(value) > new Date(target.lastSeen)) target.lastSeen = value;
    };

    plays.forEach(play => {
      const song = songById[play.song_id];
      const actor = play.user_id || play.session_id;
      const day = dailyByDate[toDateKey(play.played_at)];
      if (day) {
        day.plays += 1;
        const deliverySource = play.delivery_source || (song?.audio_url?.includes('/storage/v1/object/') ? 'supabase_storage' : 'local_asset');
        const estimatedBytes = deliverySource === 'supabase_storage'
          ? safeNumber(Number(play.estimated_bytes)) || safeNumber(Number(assetSizeBySong[play.song_id]))
          : 0;
        day.trafficBytes += estimatedBytes;
        if (deliverySource === 'supabase_storage') {
          supabasePlayStarts14d += 1;
          trafficBySong[play.song_id] = (trafficBySong[play.song_id] || 0) + estimatedBytes;
        } else {
          localPlayStarts14d += 1;
        }
        if (actor) day.activeActors.add(actor);
      }

      const target = getUserData(play.user_id);
      if (!target) return;
      target.plays += 1;
      target.songCounts[play.song_id] = (target.songCounts[play.song_id] || 0) + 1;
      if (song?.category) target.categoryCounts[song.category] = (target.categoryCounts[song.category] || 0) + 1;
      updateLastSeen(target, play.played_at);
    });

    activities.forEach(activity => {
      const actor = activity.user_id || activity.session_id;
      const day = dailyByDate[toDateKey(activity.created_at)];
      if (day) {
        day.activities += 1;
        if (activity.event_type === 'page_view') day.visits += 1;
        if (actor) day.activeActors.add(actor);
      }

      const target = getUserData(activity.user_id);
      if (!target) return;
      target.activities += 1;
      target.activityCounts[activity.event_type] = (target.activityCounts[activity.event_type] || 0) + 1;
      updateLastSeen(target, activity.created_at);
    });

    likes.forEach(like => {
      const target = getUserData(like.user_id);
      if (!target) return;
      target.likes += 1;
      updateLastSeen(target, like.created_at);
    });

    votes.forEach(vote => {
      const target = getUserData(vote.user_id);
      if (!target) return;
      target.votes += 1;
      updateLastSeen(target, vote.created_at);
    });

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentActivities = activities.filter(item => new Date(item.created_at).getTime() >= sevenDaysAgo);
    const recentPlays7d = plays.filter(item => new Date(item.played_at).getTime() >= sevenDaysAgo);
    const activeUsers7d = new Set([
      ...recentActivities.map(item => item.user_id || item.session_id),
      ...recentPlays7d.map(item => item.user_id || item.session_id)
    ].filter(Boolean)).size;

    const topSongs = [...songs]
      .sort((a, b) => safeNumber(Number(b.play_count)) - safeNumber(Number(a.play_count)))
      .slice(0, 8)
      .map(song => ({ ...song, play_count: safeNumber(Number(song.play_count)), likes_count: safeNumber(Number(song.likes_count)) }));

    const categoryMap = {};
    songs.forEach(song => {
      const category = song.category || '기타';
      categoryMap[category] = (categoryMap[category] || 0) + safeNumber(Number(song.play_count));
    });

    const categoryStats = Object.entries(categoryMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const userInsights = profiles.map(profile => {
      const target = userData.get(profile.id) || {
        plays: 0,
        likes: 0,
        votes: 0,
        activities: 0,
        songCounts: {},
        categoryCounts: {},
        activityCounts: {},
        lastSeen: null
      };
      const favoriteSongEntry = getTopEntry(target.songCounts);
      const favoriteCategoryEntry = getTopEntry(target.categoryCounts);
      const primaryActivityEntry = getTopEntry(target.activityCounts);

      return {
        id: profile.id,
        email: profile.email,
        google_name: profile.google_name,
        chat_nickname: profile.chat_nickname,
        role: profile.role,
        createdAt: profile.created_at,
        plays: target.plays,
        likes: target.likes,
        votes: target.votes,
        activities: target.activities,
        favoriteSong: favoriteSongEntry ? songById[favoriteSongEntry[0]] || null : null,
        favoriteSongPlays: favoriteSongEntry?.[1] || 0,
        favoriteCategory: favoriteCategoryEntry?.[0] || null,
        primaryActivity: primaryActivityEntry?.[0] || null,
        lastSeen: target.lastSeen
      };
    }).sort((a, b) => (b.plays + b.activities) - (a.plays + a.activities));

    const totalPlays = songs.reduce((sum, song) => sum + safeNumber(Number(song.play_count)), 0);
    const totalLikes = songs.reduce((sum, song) => sum + safeNumber(Number(song.likes_count)), 0);
    const storageBytes = storageFiles.reduce((sum, file) => sum + safeNumber(Number(file.metadata?.size)), 0);
    const estimatedEgress14dBytes = dailyBuckets.reduce((sum, day) => sum + day.trafficBytes, 0);
    const deliveryStarts14d = supabasePlayStarts14d + localPlayStarts14d;
    const topTrafficSongs = Object.entries(trafficBySong)
      .map(([songId, bytes]) => ({
        id: songId,
        title: songById[songId]?.title || '삭제된 음원',
        artist: songById[songId]?.artist || '',
        bytes,
        estimatedGb: bytes / (1024 ** 3)
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8);

    res.json({
      generatedAt: new Date().toISOString(),
      totalUsers: totalUsersCount || profiles.length,
      totalSongs: totalSongsCount || songs.length,
      totalPlays,
      totalLikes,
      activeUsers7d,
      accessStats: {
        visits7d: recentActivities.filter(item => item.event_type === 'page_view').length,
        searches7d: recentActivities.filter(item => item.event_type === 'search').length,
        uniqueSessions7d: new Set(recentActivities.map(item => item.session_id).filter(Boolean)).size
      },
      trafficStats: {
        storageBytes,
        storageGb: storageBytes / (1024 ** 3),
        estimatedEgress14dBytes,
        estimatedEgress14dGb: estimatedEgress14dBytes / (1024 ** 3),
        supabasePlayStarts14d,
        localPlayStarts14d,
        localDeliveryRate: deliveryStarts14d > 0 ? (localPlayStarts14d / deliveryStarts14d) * 100 : 0,
        topTrafficSongs,
        estimateBasis: '재생 시작 횟수와 음원 파일 크기를 곱한 최대 전송량 추정치'
      },
      dailyActivity: dailyBuckets.map(day => ({
        date: day.date,
        label: day.label,
        plays: day.plays,
        visits: day.visits,
        activities: day.activities,
        trafficBytes: day.trafficBytes,
        trafficMb: day.trafficBytes / (1024 ** 2),
        activeUsers: day.activeActors.size
      })),
      topSongs,
      categoryStats,
      userInsights,
      recentActivities: activities.slice(0, 30).map(activity => ({
        ...activity,
        profile: profileById[activity.user_id] || null,
        song: songById[activity.song_id] || null
      })),
      recentPlays: plays.slice(0, 30).map(play => ({
        ...play,
        profile: profileById[play.user_id] || null,
        song: songById[play.song_id] || null
      })),
      dataCoverage: {
        playHistoryRows: plays.length,
        activityRows: activities.length,
        likeRows: likes.length,
        voteRows: votes.length
      }
    });
  } catch (err) {
    console.error('통계 조회 오류:', err.message);
    res.status(500).json({ error: '통계를 불러올 수 없습니다.' });
  }
});

// 15.1. 어드민 투표 통계 (GET /api/admin/vs-stats)
app.get('/api/admin/vs-stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const [matches, votes, songs, profiles] = await Promise.all([
      safeFetch('vs matches', supabase.from('vs_matches').select('id, title, description, song1_id, song2_id, created_at').order('created_at', { ascending: false }).limit(1000), []),
      safeFetch('vs votes', supabase.from('vs_votes').select('id, match_id, song_id, user_id, created_at').order('created_at', { ascending: false }).limit(5000), []),
      safeFetch('vs songs', supabase.from('songs').select('id, title, artist, cover_url').limit(5000), []),
      safeFetch('vs profiles', supabase.from('profiles').select('id, email').limit(5000), [])
    ]);

    const songById = Object.fromEntries(songs.map(song => [song.id, song]));
    const profileById = Object.fromEntries(profiles.map(profile => [profile.id, profile]));
    const matchById = Object.fromEntries(matches.map(match => [match.id, match]));
    const votesByMatch = {};

    votes.forEach(vote => {
      if (!votesByMatch[vote.match_id]) votesByMatch[vote.match_id] = {};
      votesByMatch[vote.match_id][vote.song_id] = (votesByMatch[vote.match_id][vote.song_id] || 0) + 1;
    });

    const matchStats = matches.map(match => {
      const song1Votes = votesByMatch[match.id]?.[match.song1_id] || 0;
      const song2Votes = votesByMatch[match.id]?.[match.song2_id] || 0;
      return {
        ...match,
        song1: songById[match.song1_id] || null,
        song2: songById[match.song2_id] || null,
        song1Votes,
        song2Votes,
        totalVotes: song1Votes + song2Votes
      };
    });

    res.json({
      totalVotes: votes.length,
      uniqueVoters: new Set(votes.map(vote => vote.user_id).filter(Boolean)).size,
      matches: matchStats,
      recentVotes: votes.slice(0, 50).map(vote => ({
        ...vote,
        profile: profileById[vote.user_id] || null,
        song: songById[vote.song_id] || null,
        match: matchById[vote.match_id] || null
      }))
    });
  } catch (err) {
    console.error('투표 통계 조회 오류:', err.message);
    res.status(500).json({ error: '투표 통계를 불러올 수 없습니다.' });
  }
});

// 15.2. 어드민 회원 관리
app.get('/api/admin/members', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, google_name, chat_nickname, role, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('회원 목록 조회 오류:', err.message);
    res.status(500).json({ error: '회원 목록을 불러올 수 없습니다.' });
  }
});

app.patch('/api/admin/members/:id/role', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '유효하지 않은 회원 권한입니다.' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', req.params.id)
      .select('id, email, google_name, chat_nickname, role, created_at')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('회원 권한 변경 오류:', err.message);
    res.status(500).json({ error: '회원 권한을 변경할 수 없습니다.' });
  }
});

// 15.3. 로그인 공지 관리
app.get('/api/notices/current', async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

  try {
    const { data, error } = await supabase
      .from('login_notices')
      .select('id, title, content, notice_type, published_at, updated_at')
      .eq('is_active', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json(data || null);
  } catch (err) {
    console.error('로그인 공지 조회 오류:', err.message);
    res.status(500).json({ error: '공지사항을 불러올 수 없습니다.' });
  }
});

app.get('/api/admin/notices', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { data, error } = await supabase
      .from('login_notices')
      .select('id, title, content, notice_type, is_active, published_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json(data || []);
  } catch (err) {
    console.error('관리자 공지 목록 조회 오류:', err.message);
    res.status(500).json({ error: '공지사항 목록을 불러올 수 없습니다.' });
  }
});

app.post('/api/admin/notices', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const validation = validateNoticePayload(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const { title, content, noticeType } = validation.value;

  try {
    const now = new Date().toISOString();
    const { data: created, error: createError } = await supabase
      .from('login_notices')
      .insert({
        title,
        content,
        notice_type: noticeType,
        is_active: false,
        published_at: now,
        updated_at: now
      })
      .select('id, title, content, notice_type, is_active, published_at, created_at, updated_at')
      .single();
    if (createError) throw createError;

    const { error: deactivateError } = await supabase
      .from('login_notices')
      .update({ is_active: false, updated_at: now })
      .neq('id', created.id)
      .eq('is_active', true);
    if (deactivateError) throw deactivateError;

    const { data, error: activateError } = await supabase
      .from('login_notices')
      .update({ is_active: true, published_at: now, updated_at: now })
      .eq('id', created.id)
      .select('id, title, content, notice_type, is_active, published_at, created_at, updated_at')
      .single();
    if (activateError) throw activateError;

    res.status(201).json(data);
  } catch (err) {
    console.error('공지 게시 오류:', err.message);
    res.status(500).json({ error: '공지사항을 게시할 수 없습니다.' });
  }
});

app.patch('/api/admin/notices/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const validation = validateNoticePayload(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const { title, content, noticeType } = validation.value;

  try {
    const { data, error } = await supabase
      .from('login_notices')
      .update({
        title,
        content,
        notice_type: noticeType,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select('id, title, content, notice_type, is_active, published_at, created_at, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: '공지사항을 찾을 수 없습니다.' });
    res.json(data);
  } catch (err) {
    console.error('공지 수정 오류:', err.message);
    res.status(500).json({ error: '공지사항을 수정할 수 없습니다.' });
  }
});

app.patch('/api/admin/notices/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ error: '게시 상태가 올바르지 않습니다.' });
  }

  try {
    const now = new Date().toISOString();
    if (req.body.isActive) {
      const { error: deactivateError } = await supabase
        .from('login_notices')
        .update({ is_active: false, updated_at: now })
        .neq('id', req.params.id)
        .eq('is_active', true);
      if (deactivateError) throw deactivateError;
    }

    const updates = {
      is_active: req.body.isActive,
      updated_at: now,
      ...(req.body.isActive ? { published_at: now } : {})
    };
    const { data, error } = await supabase
      .from('login_notices')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, title, content, notice_type, is_active, published_at, created_at, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: '공지사항을 찾을 수 없습니다.' });
    res.json(data);
  } catch (err) {
    console.error('공지 상태 변경 오류:', err.message);
    res.status(500).json({ error: '공지사항 상태를 변경할 수 없습니다.' });
  }
});

// 15.4. 사용자별 상세 청취 및 선호 분석
app.get('/api/admin/users/:id/insights', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const userId = req.params.id;
    const [profile, allPlays, activities, likes, votes, songs] = await Promise.all([
      safeFetch('user profile', supabase.from('profiles').select('id, email, google_name, chat_nickname, role, created_at').eq('id', userId).maybeSingle(), null),
      fetchPlayHistoryRows(10000),
      safeFetch('user activities', supabase.from('user_activity').select('id, event_type, song_id, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500), []),
      safeFetch('user likes', supabase.from('likes').select('id, song_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000), []),
      safeFetch('user votes', supabase.from('vs_votes').select('id, match_id, song_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000), []),
      safeFetch('insight songs', supabase.from('songs').select('id, title, artist, category, cover_url').limit(5000), [])
    ]);

    if (!profile) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });

    const plays = allPlays.filter(play => play.user_id === userId);
    const songById = Object.fromEntries(songs.map(song => [song.id, song]));
    const likedSongIds = new Set(likes.map(like => like.song_id));
    const songCounts = {};
    const categoryCounts = {};

    plays.forEach(play => {
      const song = songById[play.song_id];
      songCounts[play.song_id] = (songCounts[play.song_id] || 0) + 1;
      if (song?.category) categoryCounts[song.category] = (categoryCounts[song.category] || 0) + 1;
    });

    const topSongs = Object.entries(songCounts)
      .map(([songId, count]) => ({ ...songById[songId], id: songId, plays: count, liked: likedSongIds.has(songId) }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 12);
    const categoryStats = Object.entries(categoryCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    const timeline = [
      ...plays.slice(0, 100).map(play => ({ id: `play-${play.id}`, type: 'play', song: songById[play.song_id] || null, created_at: play.played_at })),
      ...activities.slice(0, 100).map(activity => ({ id: `activity-${activity.id}`, type: activity.event_type, song: songById[activity.song_id] || null, metadata: activity.metadata, created_at: activity.created_at })),
      ...likes.slice(0, 50).map(like => ({ id: `like-${like.id}`, type: 'like', song: songById[like.song_id] || null, created_at: like.created_at })),
      ...votes.slice(0, 50).map(vote => ({ id: `vote-${vote.id}`, type: 'vote', song: songById[vote.song_id] || null, created_at: vote.created_at }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 60);

    res.json({
      profile,
      summary: {
        plays: plays.length,
        likes: likes.length,
        votes: votes.length,
        activities: activities.length,
        favoriteSong: topSongs[0] || null,
        favoriteCategory: categoryStats[0]?.category || null,
        lastSeen: timeline[0]?.created_at || null
      },
      topSongs,
      categoryStats,
      timeline
    });
  } catch (err) {
    console.error('사용자 상세 분석 조회 오류:', err.message);
    res.status(500).json({ error: '사용자 상세 분석을 불러올 수 없습니다.' });
  }
});


// ==========================================
// 노래 만들기 (Song Requests) API
// ==========================================

// 1. 요청 목록 조회 (내용 제외, 제목만 반환)
app.get('/api/song-requests', async (req, res) => {
  try {
    const { data: requests, error } = await supabase
      .from('song_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    let result = requests;
    if (requests.length > 0) {
      const userIds = [...new Set(requests.map(r => r.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('id, email, role').in('id', userIds);
      const profileMap = {};
      if (profiles) profiles.forEach(p => profileMap[p.id] = p);
      result = requests.map(r => ({ ...r, profiles: profileMap[r.user_id] || null }));
    }
    res.json(result);
  } catch (err) {
    console.error('요청 목록 조회 오류:', err.message);
    res.status(500).json({ error: '목록을 불러올 수 없습니다.' });
  }
});

// 2. 요청 상세 조회 (작성자 또는 관리자만 내용 열람 가능)
app.get('/api/song-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    if (!userId) return res.status(403).json({ error: '로그인이 필요합니다.' });

    // 유저 권한 확인
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    const isAdmin = profile?.role === 'admin';

    // 게시글 조회
    const { data: request, error: reqErr } = await supabase
      .from('song_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (reqErr || !request) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

    // 권한 체크
    if (request.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: '내용을 볼 수 있는 권한이 없습니다.' });
    }

    // 댓글 조회
    const { data: comments, error: comErr } = await supabase
      .from('song_request_comments')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true });

    if (comErr) throw comErr;

    // 수동 Join
    const userIds = new Set([request.user_id]);
    if (comments) comments.forEach(c => userIds.add(c.user_id));
    
    const { data: profiles } = await supabase.from('profiles').select('id, email, role').in('id', Array.from(userIds));
    const profileMap = {};
    if (profiles) profiles.forEach(p => profileMap[p.id] = p);
    
    request.profiles = profileMap[request.user_id] || null;
    let mappedComments = [];
    if (comments) {
      mappedComments = comments.map(c => ({ ...c, profiles: profileMap[c.user_id] || null }));
    }

    res.json({ ...request, comments: mappedComments });
  } catch (err) {
    console.error('요청 상세 조회 오류:', err.message);
    res.status(500).json({ error: '상세 내용을 불러올 수 없습니다.' });
  }
});

// 3. 새 요청 작성
app.post('/api/song-requests', async (req, res) => {
  try {
    const { userId, title, content } = req.body;
    if (!userId || !title || !content) return res.status(400).json({ error: '모든 항목을 입력해주세요.' });

    const { data, error } = await supabase
      .from('song_requests')
      .insert([{ user_id: userId, title, content }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('요청 작성 오류:', err.message);
    res.status(500).json({ error: '글을 작성할 수 없습니다.' });
  }
});

// 4. 요청에 댓글 작성 (작성자 또는 관리자만)
app.post('/api/song-requests/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, content } = req.body;

    if (!userId || !content) return res.status(400).json({ error: '내용을 입력해주세요.' });

    // 유저 권한 및 게시글 확인
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    const isAdmin = profile?.role === 'admin';

    const { data: request } = await supabase.from('song_requests').select('user_id').eq('id', id).single();
    
    if (!request) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    if (request.user_id !== userId && !isAdmin) return res.status(403).json({ error: '댓글을 작성할 권한이 없습니다.' });

    const { data, error } = await supabase
      .from('song_request_comments')
      .insert([{ request_id: id, user_id: userId, content }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('댓글 작성 오류:', err.message);
    res.status(500).json({ error: '댓글을 작성할 수 없습니다.' });
  }
});


// 5. 노래 만들기 요청글 수정
app.put('/api/song-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, title, content, status } = req.body;

    if (!userId) return res.status(400).json({ error: '권한이 없습니다.' });

    // 권한 확인
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    const isAdmin = profile?.role === 'admin';
    const { data: request } = await supabase.from('song_requests').select('user_id').eq('id', id).single();
    if (!request) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    if (request.user_id !== userId && !isAdmin) return res.status(403).json({ error: '권한이 없습니다.' });

    const updateData = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (isAdmin && status) updateData.status = status;

    const { data, error } = await supabase
      .from('song_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('요청글 수정 오류:', err.message);
    res.status(500).json({ error: '게시글을 수정할 수 없습니다.' });
  }
});

// 6. 노래 만들기 요청글 삭제
app.delete('/api/song-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    if (!userId) return res.status(403).json({ error: '로그인이 필요합니다.' });

    // 권한 확인
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    const isAdmin = profile?.role === 'admin';
    const { data: request } = await supabase.from('song_requests').select('user_id').eq('id', id).single();
    if (!request) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    if (request.user_id !== userId && !isAdmin) return res.status(403).json({ error: '권한이 없습니다.' });

    const { error } = await supabase.from('song_requests').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: '삭제되었습니다.' });
  } catch (err) {
    console.error('요청글 삭제 오류:', err.message);
    res.status(500).json({ error: '게시글을 삭제할 수 없습니다.' });
  }
});

// ==========================================
// 음원 동기화 관리 API
// ==========================================

// 1. 미동기화 음원 감지 (GET /api/admin/unsynced-songs)
app.get('/api/admin/unsynced-songs', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    // DB에서 전체 곡 조회
    const { data: songs, error } = await supabase
      .from('songs')
      .select('id, title, artist, audio_url, cover_url, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Supabase Storage URL을 포함하는 곡 필터링
    const unsyncedSongs = [];
    const syncedSongs = [];
    const automation = assetSync.getStatus();

    for (const song of songs) {
      const audioFileName = getStorageFileName(song.audio_url, 'songs');
      const coverFileName = getStorageFileName(song.cover_url, 'covers');
      const audioUnsynced = Boolean(audioFileName);
      const coverUnsynced = Boolean(coverFileName);
      const localAudioPath = getLocalAssetPath('songs', audioFileName);
      const localCoverPath = getLocalAssetPath('covers', coverFileName);
      const localAudioReady = !audioUnsynced || Boolean(localAudioPath && fs.existsSync(localAudioPath));
      const localCoverReady = !coverUnsynced || Boolean(localCoverPath && fs.existsSync(localCoverPath));

      if (audioUnsynced || coverUnsynced) {
        unsyncedSongs.push({
          ...song,
          audioUnsynced,
          coverUnsynced,
          audioFileName,
          coverFileName,
          localAudioReady,
          localCoverReady,
          readyToApply: localAudioReady && localCoverReady,
          syncState: automation.enabled
            ? 'automatic_pending'
            : (localAudioReady && localCoverReady ? 'ready' : 'configuration_required')
        });
      } else {
        syncedSongs.push(song);
      }
    }

    // Supabase Storage 버킷의 파일 목록 조회하여 용량 추정
    let estimatedSizeMB = 0;
    try {
      const { data: storageFiles } = await supabase.storage.from('songs').list('', { limit: 1000 });
      if (storageFiles) {
        estimatedSizeMB = storageFiles.reduce((sum, f) => sum + (f.metadata?.size || 0), 0) / (1024 * 1024);
      }
    } catch (e) {
      console.warn('Storage 용량 조회 실패:', e.message);
    }

    res.json({
      unsyncedCount: unsyncedSongs.length,
      readyCount: unsyncedSongs.filter(song => song.readyToApply).length,
      syncedCount: syncedSongs.length,
      totalCount: songs.length,
      estimatedSizeMB: Math.round(estimatedSizeMB * 10) / 10,
      automation,
      unsyncedSongs,
      syncedSongs
    });
  } catch (err) {
    console.error('미동기화 음원 감지 오류:', err.message);
    res.status(500).json({ error: '미동기화 음원을 확인할 수 없습니다.' });
  }
});

// 2. 자동 동기화 즉시 재시도 - SSE 스트리밍 (POST /api/admin/sync)
app.post('/api/admin/sync', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendEvent = (type, message, data = {}) => {
    const event = JSON.stringify({ type, message, ...data, timestamp: new Date().toISOString() });
    res.write(`data: ${event}\n\n`);
  };

  try {
    const result = await assetSync.runOnce({
      publishMissing: true,
      onEvent: sendEvent
    });
    const success = result.waitingCount === 0 || Boolean(result.publishResult);
    sendEvent(
      'done',
      result.waitingCount > 0
        ? `자동 게시를 확인했습니다. 반영 ${result.finalizedCount}곡, 배포 대기 ${result.waitingCount}곡`
        : `자동 동기화가 완료되었습니다. 반영 ${result.finalizedCount}곡`,
      { success, ...result }
    );
  } catch (error) {
    console.error('자동 동기화 오류:', error);
    sendEvent('done', `자동 동기화 재시도 실패: ${error.message}`, { success: false });
  } finally {
    res.end();
  }
});

// 3. 개별 음원 파일 프록시 다운로드 (GET /api/admin/download-song/:bucket/:filename)
app.get('/api/admin/download-song/:bucket/:filename', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { bucket, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);

    // 유효한 버킷인지 확인
    if (!['songs', 'covers'].includes(bucket)) {
      return res.status(400).json({ error: '유효하지 않은 버킷입니다.' });
    }

    // Supabase Storage에서 파일 다운로드
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(decodedFilename);

    if (error) {
      return res.status(404).json({ error: `파일을 찾을 수 없습니다: ${error.message}` });
    }

    // 파일 전송
    const buffer = Buffer.from(await data.arrayBuffer());
    const contentType = bucket === 'songs' ? 'audio/mpeg' : 'image/png';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(decodedFilename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('파일 다운로드 오류:', err.message);
    res.status(500).json({ error: '파일을 다운로드할 수 없습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  const syncStatus = assetSync.getStatus();
  console.log(
    syncStatus.enabled
      ? `[asset-sync] 자동 동기화 활성화: ${syncStatus.repository}@${syncStatus.branch}`
      : '[asset-sync] 자동 게시 비활성화: GITHUB_ASSET_SYNC_TOKEN 환경변수를 확인해 주세요.'
  );
  assetSync.start();
  const lyricsSyncStatus = lyricsSync.getStatus();
  console.log(
    lyricsSyncStatus.enabled
      ? `[lyrics-sync] Automatic lyric result checks enabled: ${lyricsSyncStatus.repository}@${lyricsSyncStatus.branch}`
      : '[lyrics-sync] Automatic lyric result checks disabled.'
  );
  lyricsSync.start();
});
