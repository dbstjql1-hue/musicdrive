import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Home,
  Search,
  Music,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Heart,
  ListMusic,
  BookOpen,
  FolderPlus,
  Repeat,
  Shuffle,
  UploadCloud,
  Plus,
  Trash2,
  X,
  FolderHeart,
  Edit2,
  Trophy,
  Clock,
  Lock,
  Menu,
  ChevronDown,
  Maximize2,
  MessageSquare,
  MessageCircle,
  Eye,
  User,
  LogIn,
  LogOut,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { PoemAnimation } from './components/ui/3d-animation';
import { AdminWorkspace } from './components/AdminWorkspace';
import { GenreHeroVideo } from './components/GenreHeroVideo';
import { PersonalDashboard } from './components/PersonalDashboard';
import { LiveChatPanel } from './components/LiveChatPanel';
import { LoginNoticeModal } from './components/LoginNoticeModal';
import './App.css';
import mascotImg from './assets/mascot.png';
import { getGenreHeroVideo } from './config/genreHeroVideos';
import { supabase } from './supabaseClient';
import { trackActivity } from './analytics';
import {
  API_BASE_URL,
  apiFetch,
  getApiRetryDelay,
  isApiUnavailableError,
} from './apiClient';

// API Base URL (Vercel 배포 시 환경 변수 설정 권장)

const SONG_REQUEST_TEMPLATE = `곡 주제 및 제목 
( 예시 : 꿈 , 드라이브 , 새벽 , 바다 , 사랑 , 이별 등등 )

곡의 용도는 ?
( 예시 : BGM , 공연음악 , 게임음악 , 릴스 등등 )

곡의 길이는 ?

장르는 ? 
( 예시 : 발라드 , 힙합 , 디스코 , 레게 , 재즈 등등 )

보컬은 ?
( 예시 : 남자 , 여자 , 듀엣 등등 좋아하는 가수의 목소리 예시등 )

노랫말은 ?

( 넣고싶은  가사나 이야기들을 써주시면 됩니다 )`;

const NEW_RELEASE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DAILY_AUTH_EXPIRY_KEY = 'musicdrive_daily_auth_expires_at';
const LOGIN_NOTICE_SEEN_PREFIX = 'musicdrive_login_notice_seen_';

function getNextLocalMidnight(now = new Date()) {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  ).getTime();
}

function getOrCreateDailyAuthExpiry() {
  const savedExpiry = Number(localStorage.getItem(DAILY_AUTH_EXPIRY_KEY));
  if (Number.isFinite(savedExpiry) && savedExpiry > 0) return savedExpiry;

  const nextMidnight = getNextLocalMidnight();
  localStorage.setItem(DAILY_AUTH_EXPIRY_KEY, String(nextMidnight));
  return nextMidnight;
}

function clearDailyAuthExpiry() {
  localStorage.removeItem(DAILY_AUTH_EXPIRY_KEY);
}

function clearLoginNoticeSeenState() {
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith(LOGIN_NOTICE_SEEN_PREFIX))
    .forEach((key) => sessionStorage.removeItem(key));
}

// 브라우저 로컬 저장소 세션 ID 로드 또는 생성 (좋아요 중복 방지용)
let sessionId = localStorage.getItem('musicdrive_session_id');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  localStorage.setItem('musicdrive_session_id', sessionId);
}

function clearAuthCallbackUrl() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const hasAuthHash = hashParams.has('access_token') || hashParams.has('error');
  const authQueryParams = ['code', 'error', 'error_code', 'error_description'];
  const hasAuthQuery = authQueryParams.some((name) => url.searchParams.has(name));

  if (hasAuthHash || hasAuthQuery) {
    authQueryParams.forEach((name) => url.searchParams.delete(name));
    url.hash = '';
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }
}

function formatWeeklyMatchPeriod(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(new Date(endAt).getTime() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric'
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function MainApp() {
  const [userSession, setUserSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loginNotice, setLoginNotice] = useState(null);

  const requireLogin = () => {
    if (!userSession) {
      showToast('로그인이 필요한 서비스입니다. 구글 로그인을 진행해 주세요.');
      return false;
    }
    return true;
  };


  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home', 'search', 'playlists', 'admin'
  const [selectedPlaylist, setSelectedPlaylist] = useState(null); // 특정 플레이리스트 선택 시 저장
  const [showIntro, setShowIntro] = useState(
    !window.location.hash.includes('access_token')
      && !new URLSearchParams(window.location.search).has('code')
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Data State
  const [songs, setSongs] = useState([]);
  const songFallbackNoticeShownRef = useRef(false);
  const songRecoveryTimerRef = useRef(null);
  const [playlists, setPlaylists] = useState([]);
  const [likedSongIds, setLikedSongIds] = useState([]);
  const [userDashboard, setUserDashboard] = useState(null);
  const [isUserDashboardLoading, setIsUserDashboardLoading] = useState(false);
  const [userDashboardError, setUserDashboardError] = useState('');
  const [categories] = useState(['전체', '발라드', '댄스', '힙합', '케이팝', '펑크', '트로트', '재즈', '레트로', '레게', '디스코', '팝', 'EDM', 'OST', '기타']);
  
  // Active Filter / Search
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Audio Player State
  const [activeSong, setActiveSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  
  // 가사 싱크 편집 모드 관련 상태
  const [isSyncEditing, setIsSyncEditing] = useState(false);
  const [syncIndex, setSyncIndex] = useState(0);
  const [recordedTimes, setRecordedTimes] = useState([]);
  
  // 자동 종료 타이머 관련 상태
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState(null);
  const [sleepTimeLeft, setSleepTimeLeft] = useState(0);
  const [isSleepPopoverOpen, setIsSleepPopoverOpen] = useState(false);
  
  // Audio Queue
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  
  // Admin Form State
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtist, setUploadArtist] = useState('');
  const [uploadCategory, setUploadCategory] = useState('발라드');
  const [uploadLyrics, setUploadLyrics] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [adminTab, setAdminTab] = useState('dashboard'); // 'dashboard', 'upload', 'members'
  const [adminStats, setAdminStats] = useState(null);
  const [adminVsStats, setAdminVsStats] = useState(null);
  const [memberList, setMemberList] = useState([]);

  // Sync Management State
  const [unsyncedData, setUnsyncedData] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncComplete, setSyncComplete] = useState(false);
  
  // Fullscreen Modal Player States
  const [isFullscreenPlayerOpen, setIsFullscreenPlayerOpen] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState('cover'); // 'cover' or 'lyrics'
  const [isPlaylistDrawerOpen, setIsPlaylistDrawerOpen] = useState(false);
  const [isFullscreenClosing, setIsFullscreenClosing] = useState(false);
  
  // Playlist Modal State
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [playlistPendingDelete, setPlaylistPendingDelete] = useState(null);
  const [isDeletingPlaylist, setIsDeletingPlaylist] = useState(false);
  
  // Playlist picker state
  const [playlistTargetSong, setPlaylistTargetSong] = useState(null);

  // Edit Song State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editCategory, setEditCategory] = useState('발라드');
  const [editLyrics, setEditLyrics] = useState('');
  const [editCoverFile, setEditCoverFile] = useState(null);
  const [isUpdatingSong, setIsUpdatingSong] = useState(false);

  // Admin Password Verification Modal State for Edits
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [pendingEditSong, setPendingEditSong] = useState(null);

  // VS Match states
  const [vsMatches, setVsMatches] = useState([]);
  const [vsTitle, setVsTitle] = useState('');
  const [vsSongAId, setVsSongAId] = useState('');
  const [vsSongBId, setVsSongBId] = useState('');
  const [isCreatingVS, setIsCreatingVS] = useState(false);

  // VS Match edit states
  const [isVsEditModalOpen, setIsVsEditModalOpen] = useState(false);
  const [editingVsMatch, setEditingVsMatch] = useState(null);
  const [vsEditTitle, setVsEditTitle] = useState('');
  const [vsEditSongAId, setVsEditSongAId] = useState('');
  const [vsEditSongBId, setVsEditSongBId] = useState('');
  const [isUpdatingVS, setIsUpdatingVS] = useState(false);

  // Board states
  const [boardPosts, setBoardPosts] = useState([]);
  const [boardView, setBoardView] = useState('list'); // list, write, read, edit
  const [activePost, setActivePost] = useState(null);
  const [boardComments, setBoardComments] = useState([]);
  const [boardTitle, setBoardTitle] = useState('');
  const [boardAuthor, setBoardAuthor] = useState('');
  
  // 노래 만들기 게시판 상태
  const [songRequests, setSongRequests] = useState([]);
  const [songRequestView, setSongRequestView] = useState('list'); // list, write, detail
  const [selectedSongRequest, setSelectedSongRequest] = useState(null);
  const [songRequestForm, setSongRequestForm] = useState({ title: '', content: SONG_REQUEST_TEMPLATE });
  const [songRequestComment, setSongRequestComment] = useState('');
  const [boardContent, setBoardContent] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentPassword, setCommentPassword] = useState('');
  const [commentContent, setCommentContent] = useState('');
  
  // Toast UI
  const [toastMessage, setToastMessage] = useState('');
  const [isLiveChatOpen, setIsLiveChatOpen] = useState(
    () => !window.matchMedia('(max-width: 768px)').matches
  );

  // Supabase Auth (하이브리드 모드 - Auth 기능 복구)

  useEffect(() => {
    if (userSession?.user?.id) {
      fetchPlaylists();
      fetchVSMatches();
    } else {
      setPlaylists([]);
    }
  }, [userSession]);

  useEffect(() => {
    let isMounted = true;
    let expiryTimerId = null;
    let isExpirySignOutRunning = false;

    const clearExpiryTimer = () => {
      if (expiryTimerId !== null) {
        window.clearTimeout(expiryTimerId);
        expiryTimerId = null;
      }
    };

    const signOutExpiredSession = async () => {
      if (isExpirySignOutRunning) return;
      isExpirySignOutRunning = true;
      clearExpiryTimer();
      try {
        // 자정 만료는 현재 기기의 세션만 종료합니다.
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        clearDailyAuthExpiry();
        clearLoginNoticeSeenState();
      } catch (error) {
        // 실패 시 만료 시각을 남겨 두어 다음 포커스/새로고침 때 다시 종료합니다.
        if (import.meta.env.DEV) console.debug('Daily auth expiry sign-out retry scheduled:', error);
        expiryTimerId = window.setTimeout(signOutExpiredSession, 30_000);
      } finally {
        if (isMounted) {
          setUserSession(null);
          setUserProfile(null);
        }
        isExpirySignOutRunning = false;
      }
    };

    const scheduleDailySessionExpiry = (session) => {
      clearExpiryTimer();
      if (!session) {
        clearDailyAuthExpiry();
        return false;
      }

      const expiresAt = getOrCreateDailyAuthExpiry();
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        window.setTimeout(signOutExpiredSession, 0);
        return false;
      }

      expiryTimerId = window.setTimeout(signOutExpiredSession, remainingMs + 100);
      return true;
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      const isSessionValidToday = scheduleDailySessionExpiry(session);
      setUserSession(isSessionValidToday ? session : null);
      if (session && isSessionValidToday) {
        fetchUserProfile(session.user.id);
        // 확실한 타이밍에 해시(토큰) 정리
        clearAuthCallbackUrl();
      }
    }).catch((error) => {
      if (import.meta.env.DEV) console.debug('Auth session restore skipped:', error);
    }).finally(() => {
      clearAuthCallbackUrl();
      if (isMounted) setIsAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const isSessionValidToday = scheduleDailySessionExpiry(session);
      setUserSession(isSessionValidToday ? session : null);
      if (session && isSessionValidToday) {
        fetchUserProfile(session.user.id);
        // 로그인 성공 후 주소창에 남은 지저분한 해시(토큰) 값 정리
        clearAuthCallbackUrl();
      } else {
        setUserProfile(null);
      }
    });

    const validateSessionDate = () => {
      if (document.visibilityState !== 'visible') return;
      const savedExpiry = Number(localStorage.getItem(DAILY_AUTH_EXPIRY_KEY));
      if (Number.isFinite(savedExpiry) && savedExpiry > 0 && Date.now() >= savedExpiry) {
        signOutExpiredSession();
      }
    };
    window.addEventListener('focus', validateSessionDate);
    document.addEventListener('visibilitychange', validateSessionDate);

    return () => {
      isMounted = false;
      clearExpiryTimer();
      window.removeEventListener('focus', validateSessionDate);
      document.removeEventListener('visibilitychange', validateSessionDate);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userSession?.access_token || !userSession?.user?.id) {
      setLoginNotice(null);
      return undefined;
    }

    let active = true;
    const fetchLoginNotice = async () => {
      try {
        const response = await apiFetch(`${API_BASE_URL}/api/notices/current`, {
          headers: { Authorization: `Bearer ${userSession.access_token}` }
        });
        if (!response.ok) return;
        const notice = await response.json();
        if (!active || !notice?.id) return;
        const seenKey = `${LOGIN_NOTICE_SEEN_PREFIX}${userSession.user.id}_${notice.id}`;
        if (sessionStorage.getItem(seenKey) !== '1') setLoginNotice(notice);
      } catch (error) {
        if (import.meta.env.DEV) console.debug('Login notice fetch skipped:', error);
      }
    };

    fetchLoginNotice();
    return () => { active = false; };
  }, [userSession?.access_token, userSession?.user?.id]);

  const closeLoginNotice = () => {
    if (loginNotice?.id && userSession?.user?.id) {
      sessionStorage.setItem(
        `${LOGIN_NOTICE_SEEN_PREFIX}${userSession.user.id}_${loginNotice.id}`,
        '1'
      );
    }
    setLoginNotice(null);
  };

  const fetchUserProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) setUserProfile(data);
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (err) {
      showToast('로그인 중 오류가 발생했습니다: ' + err.message);
    }
  };

  const handleLogout = async () => {
    trackActivity('logout', {
      userId: userSession?.user?.id,
      sessionId
    });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      showToast('로그아웃 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    clearDailyAuthExpiry();
    clearLoginNoticeSeenState();
    setUserSession(null);
    setUserProfile(null);
  };
  
  // HTML Audio Ref
  const audioRef = useRef(new Audio());
  const lyricsBodyRef = useRef(null);
  const mobileLyricsListRef = useRef(null);

  // Fullscreen player helpers
  const openFullscreenPlayer = () => {
    if (activeSong) {
      setIsFullscreenPlayerOpen(true);
      setIsFullscreenClosing(false);
    }
  };

  const closeFullscreenPlayer = () => {
    setIsFullscreenClosing(true);
    setTimeout(() => {
      setIsFullscreenPlayerOpen(false);
      setIsFullscreenClosing(false);
      setIsPlaylistDrawerOpen(false);
    }, 400);
  };

  useEffect(() => {
    trackActivity('page_view', {
      userId: userSession?.user?.id,
      sessionId,
      metadata: { view: currentView }
    });
  }, [currentView, userSession?.user?.id]);



  // 외부 클릭 시 자동 종료 타이머 팝오버 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.sleep-timer-container')) {
        setIsSleepPopoverOpen(false);
      }
    };
    if (isSleepPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSleepPopoverOpen]);

  // 파싱된 가사 목록
  const parsedLyrics = useMemo(() => {
    if (!activeSong || !activeSong.lyrics) return [];
    
    const lines = activeSong.lyrics.split('\n');
    const parsed = [];
    const lrcRegex = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
    let hasTimestamps = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(lrcRegex);
      if (match) {
        hasTimestamps = true;
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3), 10) : 0;
        const time = minutes * 60 + seconds + ms / 1000;
        const text = match[4].trim();
        parsed.push({ time, text });
      } else {
        parsed.push({ time: null, text: trimmed });
      }
    }
    
    if (hasTimestamps) {
      return parsed.filter(line => line.time !== null).sort((a, b) => a.time - b.time);
    } else {
      const cleanLines = parsed.filter(line => line.text !== '');
      const totalLines = cleanLines.length;
      if (totalLines === 0) return [];
      
      const songDuration = duration || 180;
      const startTime = Math.max(5, songDuration * 0.06);
      const endTime = Math.min(songDuration - 10, songDuration * 0.90);
      const activeDuration = endTime - startTime;
      
      return cleanLines.map((line, idx) => {
        const time = startTime + idx * (activeDuration / (totalLines - 1 || 1));
        return { time, text: line.text };
      });
    }
  }, [activeSong, duration]);

  // 현재 재생 시간에 맞는 가사 인덱스
  const currentLyricIndex = useMemo(() => {
    if (parsedLyrics.length === 0) return -1;
    
    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (currentTime >= parsedLyrics[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }
    return activeIdx;
  }, [parsedLyrics, currentTime]);

  // 화면에 3~4줄 단위로 콤팩트하게 노출할 가사 목록 (현재 인덱스 중심 슬라이싱)
  const displayedLyrics = useMemo(() => {
    if (parsedLyrics.length === 0) return [];
    
    const activeIdx = currentLyricIndex === -1 ? 0 : currentLyricIndex;
    
    // 현재 줄이 위에서 2번째에 위치하도록 계산 (이전 1줄, 현재 1줄, 이후 2줄)
    let startIdx = activeIdx - 1;
    if (startIdx < 0) startIdx = 0;
    
    let endIdx = startIdx + 4;
    if (endIdx > parsedLyrics.length) {
      endIdx = parsedLyrics.length;
      startIdx = Math.max(0, endIdx - 4);
    }
    
    return parsedLyrics.slice(startIdx, endIdx).map((line, idx) => ({
      ...line,
      absIdx: startIdx + idx
    }));
  }, [parsedLyrics, currentLyricIndex]);

  // Fullscreen lyrics auto scroll effect
  useEffect(() => {
    if (isFullscreenPlayerOpen && fullscreenTab === 'lyrics' && mobileLyricsListRef.current) {
      const activeEl = mobileLyricsListRef.current.querySelector('.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentLyricIndex, isFullscreenPlayerOpen, fullscreenTab]);

  const startSyncEditing = () => {
    if (!activeSong || !activeSong.lyrics) return;
    
    const rawLines = activeSong.lyrics.split('\n')
      .map(line => {
        const trimmed = line.trim();
        const lrcRegex = /^\[\d{2}:\d{2}(?:\.\d{2,3})?\](.*)/;
        const match = trimmed.match(lrcRegex);
        return match ? match[1].trim() : trimmed;
      })
      .filter(line => line !== '');
      
    if (rawLines.length === 0) {
      showToast('싱크를 맞출 가사 텍스트가 존재하지 않습니다.');
      return;
    }
    
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    
    setRecordedTimes(new Array(rawLines.length).fill(null));
    setSyncIndex(0);
    setIsSyncEditing(true);
  };

  const recordSyncTimestamp = useCallback(() => {
    if (!isSyncEditing) return;
    if (syncIndex >= recordedTimes.length) return;
    
    const currentAudioTime = audioRef.current.currentTime;
    
    if (!isPlaying) {
      audioRef.current.play().catch(err => console.log(err));
      setIsPlaying(true);
    }
    
    const nextTimes = [...recordedTimes];
    nextTimes[syncIndex] = currentAudioTime;
    setRecordedTimes(nextTimes);
    
    if (syncIndex < recordedTimes.length - 1) {
      setSyncIndex(syncIndex + 1);
    } else {
      showToast('모든 가사의 싱크 기록이 완료되었습니다! 저장 버튼을 눌러주세요.');
      setSyncIndex(syncIndex + 1);
    }
  }, [isSyncEditing, syncIndex, recordedTimes, isPlaying]);

  // 가사 싱크 실시간 레코딩을 위한 키 입력 리스너 (Spacebar)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isSyncEditing) return;
      if (e.code === 'Space') {
        e.preventDefault();
        recordSyncTimestamp();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSyncEditing, recordSyncTimestamp]);

  const saveSyncedLyrics = async () => {
    if (!activeSong) return;
    
    const hasUnrecorded = recordedTimes.some(t => t === null);
    if (hasUnrecorded) {
      if (!window.confirm('아직 싱크가 기록되지 않은 가사 라인이 있습니다. 그대로 저장하시겠습니까?')) {
        return;
      }
    }
    
    const rawLines = activeSong.lyrics.split('\n')
      .map(line => {
        const trimmed = line.trim();
        const lrcRegex = /^\[\d{2}:\d{2}(?:\.\d{2,3})?\](.*)/;
        const match = trimmed.match(lrcRegex);
        return match ? match[1].trim() : trimmed;
      })
      .filter(line => line !== '');
      
    const lrcLines = rawLines.map((line, idx) => {
      let time = recordedTimes[idx];
      if (time === null) {
        time = idx * (duration / rawLines.length);
      }
      
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      const ms = Math.floor((time % 1) * 100);
      const timestamp = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}]`;
      return `${timestamp} ${line}`;
    });
    
    const newLrcText = lrcLines.join('\n');
    
    const formData = new FormData();
    formData.append('title', activeSong.title);
    formData.append('artist', activeSong.artist);
    formData.append('category', activeSong.category || '일반');
    formData.append('lyrics', newLrcText);
    formData.append('adminPassword', adminPassword || 'admin1234');
    
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/${activeSong.id}`, {
        method: 'PUT',
        body: formData
      });
      
      const data = await res.json();
      if (res.ok) {
        showToast('성공적으로 가사 싱크를 저장했습니다!');
        setIsSyncEditing(false);
        setActiveSong(data);
        setSongs(songs.map(s => s.id === activeSong.id ? data : s));
      } else {
        showToast(data.error || '싱크 저장 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 가사 싱크를 저장하지 못했습니다.');
    }
  };

  const cancelSyncEditing = () => {
    setIsSyncEditing(false);
    setSyncIndex(0);
    audioRef.current.pause();
    setIsPlaying(false);
  };

  const verifyAdminForSync = async (passwordInput) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/admin/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword: passwordInput })
      });
      
      const data = await res.json();
      if (res.ok) {
        setIsAdminAuthenticated(true);
        setAdminPassword(passwordInput);
        showToast('관리자 인증에 성공했습니다.');
        
        setTimeout(() => {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          setCurrentTime(0);
          setIsPlaying(false);
          
          const rawLines = activeSong.lyrics.split('\n')
            .map(line => {
              const trimmed = line.trim();
              const lrcRegex = /^\[\d{2}:\d{2}(?:\.\d{2,3})?\](.*)/;
              const match = trimmed.match(lrcRegex);
              return match ? match[1].trim() : trimmed;
            })
            .filter(line => line !== '');
            
          setRecordedTimes(new Array(rawLines.length).fill(null));
          setSyncIndex(0);
          setIsSyncEditing(true);
        }, 100);
      } else {
        showToast(data.error || '비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결에 실패했습니다.');
    }
  };



  const handleSetSleepTimer = (minutes) => {
    if (minutes === null) {
      setSleepTimerMinutes(null);
      setSleepTimeLeft(0);
      showToast('자동 종료 타이머가 해제되었습니다.');
    } else {
      setSleepTimerMinutes(minutes);
      setSleepTimeLeft(minutes * 60);
      showToast(`${minutes >= 60 ? Math.floor(minutes / 60) + '시간 ' + (minutes % 60 ? (minutes % 60) + '분' : '') : minutes + '분'} 뒤 자동 종료 타이머가 설정되었습니다.`);
    }
    setIsSleepPopoverOpen(false);
  };

  const formatSleepTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // 자동 종료 타이머 카운트다운 로직
  useEffect(() => {
    if (sleepTimerMinutes === null || sleepTimeLeft <= 0) return;

    const interval = setInterval(() => {
      setSleepTimeLeft((prev) => {
        if (prev <= 1) {
          audioRef.current.pause();
          setIsPlaying(false);
          setSleepTimerMinutes(null);
          showToast('⏰ 자동 종료 타이머가 만료되어 재생을 중단했습니다.');
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimerMinutes, sleepTimeLeft]);

  // Toast 알림 헬퍼
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3000);
  };

  // 1. 초기 데이터 가져오기
  useEffect(() => {
    if (!isAuthReady) return undefined;

    fetchSongs();
    fetchPlaylists();
    fetchLikedSongs();
    fetchVSMatches();
    fetchBoardPosts();
    fetchSongRequests();

    return () => {
      if (songRecoveryTimerRef.current) {
        window.clearTimeout(songRecoveryTimerRef.current);
      }
    };
  }, [isAuthReady]);


  // 노래 만들기 관련 API
  const fetchSongRequests = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/song-requests`);
      if (res.ok) {
        const data = await res.json();
        setSongRequests(data);
      }
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error(err);
    }
  };

  const fetchSongRequestDetail = async (id) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/song-requests/${id}?userId=${userSession?.user?.id || ''}`);
      const data = await res.json();
      if (res.ok) {
        setSelectedSongRequest(data);
        setSongRequestView('detail');
      } else {
        showToast(data.error || '권한이 없습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('글을 불러오지 못했습니다.');
    }
  };

  
  const getStatusStyle = (status) => {
    switch (status) {
      case '노래 만드는중': return { bg: 'rgba(255, 165, 0, 0.2)', color: '#ffa500' };
      case '노래 완성': return { bg: 'rgba(0, 200, 255, 0.2)', color: '#00c8ff' };
      case '노래등록완료': return { bg: 'rgba(50, 255, 100, 0.2)', color: '#32ff64' };
      default: return { bg: 'rgba(255, 255, 255, 0.1)', color: '#ccc' }; // 대기중
    }
  };

  const handleSongRequestSubmit = async (e) => {
    e.preventDefault();
    if (!songRequestForm.title || !songRequestForm.content) return;
    try {
      const isEdit = songRequestView === 'edit';
      const url = isEdit ? `${API_BASE_URL}/api/song-requests/${selectedSongRequest.id}` : `${API_BASE_URL}/api/song-requests`;
      const res = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userSession?.user?.id, title: songRequestForm.title, content: songRequestForm.content })
      });
      if (res.ok) {
        showToast(isEdit ? '요청글이 수정되었습니다.' : '요청글이 등록되었습니다.');
        setSongRequestView('list');
        fetchSongRequests();
      } else {
        const data = await res.json();
        showToast(data.error || '처리 실패');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSongRequest = async (id) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/song-requests/${id}?userId=${userSession?.user?.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('삭제되었습니다.');
        setSongRequestView('list');
        fetchSongRequests();
      } else {
        const data = await res.json();
        showToast(data.error || '삭제 실패');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSongRequestCommentSubmit = async (e) => {
    e.preventDefault();
    if (!songRequestComment || !selectedSongRequest) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/song-requests/${selectedSongRequest.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userSession?.user?.id, content: songRequestComment })
      });
      if (res.ok) {
        setSongRequestComment('');
        fetchSongRequestDetail(selectedSongRequest.id);
      } else {
        const data = await res.json();
        showToast(data.error || '댓글 등록 실패');
      }
    } catch (err) {
      console.error(err);
    }
  };

  async function fetchBoardPosts() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/board`);
      if (res.ok) {
        const data = await res.json();
        setBoardPosts(data);
      }
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error('게시글 가져오기 오류:', err);
    }
  }

  async function fetchVSMatches() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vs-matches?userId=${userSession?.user?.id || ''}`);
      if (res.ok) {
        const data = await res.json();
        setVsMatches(data);
      }
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error('VS 대결 가져오기 오류:', err);
    }
  };

  const handleCreateVSMatch = async (e) => {
    e.preventDefault();
    if (!vsTitle || !vsSongAId || !vsSongBId) {
      showToast('대결 제목과 두 곡을 모두 선택해 주세요.');
      return;
    }
    if (vsSongAId === vsSongBId) {
      showToast('서로 다른 두 곡을 선택해야 합니다.');
      return;
    }

    setIsCreatingVS(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vs-matches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: vsTitle,
          song1_id: vsSongAId,
          song2_id: vsSongBId,
          adminPassword: adminPassword || 'admin1234'
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast('성공적으로 대결이 생성되었습니다!');
        setVsTitle('');
        setVsSongAId('');
        setVsSongBId('');
        fetchVSMatches();
      } else {
        showToast(data.error || '대결 생성 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 대결을 생성하지 못했습니다.');
    } finally {
      setIsCreatingVS(false);
    }
  };

  const handleVSVote = async (matchId, songId) => {
    if (!requireLogin()) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vs-matches/${matchId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ songId, userId: userSession?.user?.id })
      });

      if (res.ok) {
        showToast('투표가 반영되었습니다!');
        trackActivity('vote', {
          userId: userSession?.user?.id,
          sessionId,
          songId,
          metadata: { matchId }
        });
        fetchVSMatches();
      } else {
        const data = await res.json();
        showToast(data.error || '투표 처리 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 투표하지 못했습니다.');
    }
  };

  const handleDeleteVSMatch = async (matchId) => {
    if (!window.confirm('정말로 이 대결을 삭제하시겠습니까?')) return;

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vs-matches/${matchId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword: adminPassword || 'admin1234' })
      });

      if (res.ok) {
        showToast('대결이 삭제되었습니다.');
        fetchVSMatches();
      } else {
        const data = await res.json();
        showToast(data.error || '삭제 실패');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openVsEditModal = (match) => {
    setEditingVsMatch(match);
    setVsEditTitle(match.title);
    setVsEditSongAId(match.song1_id);
    setVsEditSongBId(match.song2_id);
    setIsVsEditModalOpen(true);
  };

  const handleVsEditSubmit = async (e) => {
    e.preventDefault();
    if (!vsEditTitle || !vsEditSongAId || !vsEditSongBId) {
      showToast('대결 제목과 두 곡을 모두 선택해 주세요.');
      return;
    }
    if (vsEditSongAId === vsEditSongBId) {
      showToast('서로 다른 두 곡을 선택해야 합니다.');
      return;
    }

    setIsUpdatingVS(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vs-matches/${editingVsMatch.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: vsEditTitle,
          song1_id: vsEditSongAId,
          song2_id: vsEditSongBId,
          adminPassword: adminPassword || 'admin1234'
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast('성공적으로 대결이 수정되었습니다!');
        setIsVsEditModalOpen(false);
        setEditingVsMatch(null);
        fetchVSMatches();
      } else {
        showToast(data.error || '대결 수정 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 대결을 수정하지 못했습니다.');
    } finally {
      setIsUpdatingVS(false);
    }
  };

  async function fetchSongs(query = '', category = '') {
    const baseUrl = import.meta.env.BASE_URL;
    const clearRecoveryTimer = () => {
      if (songRecoveryTimerRef.current) {
        window.clearTimeout(songRecoveryTimerRef.current);
        songRecoveryTimerRef.current = null;
      }
    };
    const scheduleRecovery = () => {
      clearRecoveryTimer();
      const retryDelay = Math.max(
        getApiRetryDelay(),
        document.visibilityState === 'hidden' ? 30_000 : 5_000
      );
      songRecoveryTimerRef.current = window.setTimeout(() => {
        fetchSongs(query, category);
      }, retryDelay);
    };
    const normalizeSongUrls = (songList) => songList.map(song => {
      const processUrl = (path) => {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        if (path.startsWith('/')) {
          const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          return normalizedBase + path;
        }
        return path;
      };

      return {
        ...song,
        audio_url: processUrl(song.audio_url),
        cover_url: processUrl(song.cover_url)
      };
    });

    const filterSongs = (songList) => {
      const normalizedQuery = query.trim().toLowerCase();
      return songList.filter(song => {
        const matchesQuery = !normalizedQuery
          || song.title?.toLowerCase().includes(normalizedQuery)
          || song.artist?.toLowerCase().includes(normalizedQuery);
        const matchesCategory = !category || category === '전체' || song.category === category;
        return matchesQuery && matchesCategory;
      });
    };

    try {
      const url = `${API_BASE_URL}/api/songs?query=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`;
      const response = await apiFetch(url, {}, { timeoutMs: 5_000 });
      if (!response.ok) throw new Error(`음원 API 응답 오류: ${response.status}`);

      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('음원 API 응답 형식이 올바르지 않습니다.');

      setSongs(normalizeSongUrls(data));
      songFallbackNoticeShownRef.current = false;
      clearRecoveryTimer();
    } catch (apiError) {
      if (import.meta.env.DEV && !isApiUnavailableError(apiError)) {
        console.debug('Song API request failed; using static data.', apiError);
      }

      try {
        const staticDataUrl = `${baseUrl}data/songs.json`;
        const fallbackResponse = await fetch(staticDataUrl, { cache: 'no-cache' });
        if (!fallbackResponse.ok) {
          throw new Error(`정적 음원 데이터 응답 오류: ${fallbackResponse.status}`, { cause: apiError });
        }

        const fallbackData = await fallbackResponse.json();
        if (!Array.isArray(fallbackData)) {
          throw new Error('정적 음원 데이터 형식이 올바르지 않습니다.', { cause: apiError });
        }

        setSongs(normalizeSongUrls(filterSongs(fallbackData)));
        if (!songFallbackNoticeShownRef.current) {
          showToast('서버 연결이 원활하지 않아 저장된 음원 목록을 표시합니다.');
          songFallbackNoticeShownRef.current = true;
        }
        scheduleRecovery();
      } catch (fallbackError) {
        console.error('음원 목록과 정적 데이터 모두 불러오지 못했습니다:', fallbackError);
        setSongs([]);
        showToast('음원 목록을 불러오지 못했습니다. 백엔드 서버 상태를 확인해 주세요.');
        scheduleRecovery();
      }
    }
  }

  // --- Board Handlers ---
  const handleBoardSubmit = async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    if (!boardTitle || !boardContent || !boardAuthor) {
      showToast('모든 항목을 입력해주세요.');
      return;
    }
    try {
      let url = `${API_BASE_URL}/api/board`;
      let method = 'POST';
      if (boardView === 'edit' && activePost) {
        url = `${API_BASE_URL}/api/board/${activePost.id}`;
        method = 'PUT';
      }

      const res = await apiFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userSession?.access_token || ''}`
        },
        body: JSON.stringify({
          title: boardTitle,
          content: boardContent,
          author: boardAuthor
        })
      });

      if (res.ok) {
        showToast(boardView === 'edit' ? '게시글이 수정되었습니다.' : '게시글이 작성되었습니다.');
        setBoardView('list');
        fetchBoardPosts();
      } else {
        const data = await res.json();
        showToast(data.error || '처리 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류');
    }
  };

  const handleReadPost = async (post) => {
    try {
      const headers = userSession?.access_token
        ? { Authorization: `Bearer ${userSession.access_token}` }
        : {};
      const res = await apiFetch(`${API_BASE_URL}/api/board/${post.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setActivePost(data);
        setBoardView('read');
        fetchBoardComments(post.id);
        fetchBoardPosts(); // 조회수 업데이트를 위해 목록 리프레시
      }
    } catch (err) {
      console.error(err);
      showToast('게시글을 불러올 수 없습니다.');
    }
  };

  const handleDeletePost = async (id) => {
    if (!window.confirm('이 게시글을 삭제할까요?')) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/board/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userSession?.access_token || ''}` }
      });
      if (res.ok) {
        showToast('게시글이 삭제되었습니다.');
        setBoardView('list');
        fetchBoardPosts();
      } else {
        const data = await res.json();
        showToast(data.error || '게시글을 삭제할 수 없습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류');
    }
  };

  const handleEditPostClick = () => {
    setBoardTitle(activePost.title);
    setBoardContent(activePost.content);
    setBoardAuthor(activePost.author);
    setBoardView('edit');
  };

  async function fetchBoardComments(postId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/board/${postId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setBoardComments(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentAuthor || !commentPassword || !commentContent) {
      showToast('댓글 항목을 모두 입력해주세요.');
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/board/${activePost.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor,
          password: commentPassword,
          content: commentContent
        })
      });
      if (res.ok) {
        showToast('댓글이 작성되었습니다.');
        setCommentAuthor('');
        setCommentPassword('');
        setCommentContent('');
        fetchBoardComments(activePost.id);
      } else {
        const data = await res.json();
        showToast(data.error || '오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류');
    }
  };

  const handleDeleteComment = async (commentId) => {
    const pwd = window.prompt("댓글 비밀번호를 입력하세요:");
    if (!pwd) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/board/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok) {
        showToast('댓글이 삭제되었습니다.');
        fetchBoardComments(activePost.id);
      } else {
        const data = await res.json();
        showToast(data.error || '비밀번호가 일치하지 않습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류');
    }
  };
  // -----------------------

  async function fetchPlaylists() {
    if (!userSession?.user?.id) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists?userId=${userSession.user.id}`);
      if (res.ok) {
        const data = await res.json();
        setPlaylists(data);
      }
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error('플레이리스트 가져오기 오류:', err);
    }
  };

  const fetchUserDashboard = useCallback(async () => {
    const accessToken = userSession?.access_token;
    if (!accessToken) {
      setUserDashboard(null);
      return;
    }

    setIsUserDashboardLoading(true);
    setUserDashboardError('');

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/users/me/dashboard`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '현황판을 불러오지 못했습니다.');
      setUserDashboard(data);
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error('개인 현황판 조회 오류:', err);
      setUserDashboardError('잠시 후 다시 시도해 주세요.');
    } finally {
      setIsUserDashboardLoading(false);
    }
  }, [userSession?.access_token]);

  useEffect(() => {
    if (currentView === 'playlists' && userSession?.access_token) {
      fetchUserDashboard();
    }
  }, [currentView, fetchUserDashboard, userSession?.access_token]);

  async function fetchLikedSongs() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/liked/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setLikedSongIds(data);
      }
    } catch (err) {
      if (!isApiUnavailableError(err)) console.error('좋아요 목록 가져오기 오류:', err);
    }
  };

  // 카테고리 또는 검색 쿼리가 변경되면 음원을 다시 로드
  useEffect(() => {
    fetchSongs(searchQuery, selectedCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    trackActivity('search', {
      userId: userSession?.user?.id,
      sessionId,
      metadata: { query: searchQuery, category: selectedCategory }
    });
    fetchSongs(searchQuery, selectedCategory);
  };

  // 2. 오디오 코어 동기화 설정
  useEffect(() => {
    const audio = audioRef.current;

    if (activeSong) {
      audio.src = activeSong.audio_url;
      audio.load();
      if (isPlaying) {
        audio.play().catch(err => console.log('재생 시작 오류:', err));
      }
    } else {
      audio.pause();
      audio.src = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong]);

  useEffect(() => {
    if (isPlaying) {
      if (audioRef.current.src) {
        audioRef.current.play().catch(err => console.log('재생 오류:', err));
      }
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // 4. API 인터랙션 함수들
  const incrementPlayCount = useCallback(async (songId) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/${songId}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userSession?.user?.id,
          sessionId,
          source: currentView
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.play_count === 'number') {
          setSongs(prevSongs => prevSongs.map(song => (
            song.id === songId ? { ...song, play_count: data.play_count } : song
          )));
          setActiveSong(prevSong => (
            prevSong?.id === songId ? { ...prevSong, play_count: data.play_count } : prevSong
          ));
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [currentView, userSession?.user?.id]);

  // 3. 재생기 제어 함수들
  const playSingleSong = (song) => {
    if (!requireLogin()) return;
    // 큐를 현재 보여지는 곡 목록으로 업데이트하고 현재 곡을 큐에 설정
    const index = songs.findIndex(s => s.id === song.id);
    setQueue(songs);
    setQueueIndex(index);
    setActiveSong(song);
    setIsPlaying(true);
    incrementPlayCount(song.id);
  };

  const playRandomSong = () => {
    if (!requireLogin()) return;
    if (songs.length === 0) return;
    const randomIndex = Math.floor(Math.random() * songs.length);
    const randomSong = songs[randomIndex];
    setQueue(songs);
    setQueueIndex(randomIndex);
    setActiveSong(randomSong);
    setIsPlaying(true);
    setIsShuffled(true);
    incrementPlayCount(randomSong.id);
  };

  const handlePlayPause = () => {
    if (!requireLogin()) return;
    if (!activeSong && songs.length > 0) {
      playSingleSong(songs[0]);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleNextSong = useCallback(() => {
    if (!requireLogin()) return;
    if (queue.length === 0) return;
    
    let nextIndex = queueIndex + 1;
    if (isShuffled) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      nextIndex = 0; // 루프해서 처음으로
    }
    
    setQueueIndex(nextIndex);
    setActiveSong(queue[nextIndex]);
    setIsPlaying(true);
    incrementPlayCount(queue[nextIndex].id);
  }, [queue, queueIndex, isShuffled, incrementPlayCount]);

  const handlePrevSong = useCallback(() => {
    if (!requireLogin()) return;
    if (queue.length === 0) return;

    let prevIndex = queueIndex - 1;
    if (prevIndex < 0) {
      prevIndex = queue.length - 1; // 마지막 곡으로
    }

    setQueueIndex(prevIndex);
    setActiveSong(queue[prevIndex]);
    setIsPlaying(true);
    incrementPlayCount(queue[prevIndex].id);
  }, [queue, queueIndex, incrementPlayCount]);

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = pos * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newVol = Math.max(0, Math.min(1, pos));
    setVolume(newVol);
    setIsMuted(false);
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        const mediaDuration = audio.duration;
        if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
          try {
            navigator.mediaSession.setPositionState({
              duration: mediaDuration,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(Math.max(audio.currentTime, 0), mediaDuration),
            });
          } catch {
            // Some browsers expose Media Session without position-state support.
          }
        }
      }
    };
    
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };
    
    const handleEnded = () => {
      if (isLooping) {
        audio.currentTime = 0;
        audio.play().catch(err => console.log(err));
      } else {
        handleNextSong();
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [isLooping, handleNextSong]);

  useEffect(() => {
    if (!isPlaying || !activeSong?.id || !userSession?.user?.id) return undefined;

    const intervalId = window.setInterval(() => {
      trackActivity('listen_time', {
        userId: userSession.user.id,
        sessionId,
        songId: activeSong.id,
        metadata: { seconds: 30, source: currentView }
      });

      setUserDashboard(prev => prev ? {
        ...prev,
        summary: {
          ...prev.summary,
          totalListeningSeconds: (prev.summary?.totalListeningSeconds || 0) + 30
        }
      } : prev);
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [activeSong?.id, currentView, isPlaying, userSession?.user?.id]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (!activeSong) {
      navigator.mediaSession.metadata = null;
      return;
    }

    if (!('MediaMetadata' in window)) return;

    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: activeSong.title || 'MusicDrive',
        artist: activeSong.artist || '',
        album: 'MusicDrive',
        artwork: activeSong.cover_url ? [{ src: activeSong.cover_url }] : [],
      });
    } catch {
      // Ignore invalid artwork URLs and partial Media Session implementations.
    }
  }, [activeSong]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.playbackState = activeSong
        ? (isPlaying ? 'playing' : 'paused')
        : 'none';
    } catch {
      // Ignore partial Media Session implementations.
    }
  }, [activeSong, isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const audio = audioRef.current;
    const actionHandlers = {
      play: () => {
        if (!audio.src) return;
        audio.play().catch((error) => console.debug('Media Session play failed:', error));
      },
      pause: () => audio.pause(),
      stop: () => {
        audio.pause();
        audio.currentTime = 0;
      },
      previoustrack: handlePrevSong,
      nexttrack: handleNextSong,
      seekbackward: ({ seekOffset } = {}) => {
        audio.currentTime = Math.max(0, audio.currentTime - (seekOffset || 10));
      },
      seekforward: ({ seekOffset } = {}) => {
        const end = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 10;
        audio.currentTime = Math.min(end, audio.currentTime + (seekOffset || 10));
      },
      seekto: ({ seekTime } = {}) => {
        if (Number.isFinite(seekTime)) audio.currentTime = seekTime;
      },
    };

    Object.entries(actionHandlers).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported actions differ between browsers and connected devices.
      }
    });

    return () => {
      Object.keys(actionHandlers).forEach((action) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore unsupported cleanup actions.
        }
      });
    };
  }, [handleNextSong, handlePrevSong]);

  const toggleLike = async (e, songId) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/${songId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: userSession?.user?.id })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.liked) {
          setLikedSongIds([...likedSongIds, songId]);
          showToast('좋아요 목록에 추가되었습니다.');
        } else {
          setLikedSongIds(likedSongIds.filter(id => id !== songId));
          showToast('좋아요가 취소되었습니다.');
        }
        
        // 메인 리스트 및 재생 중인 곡 좋아요 수 갱신
        setSongs(songs.map(s => s.id === songId ? { ...s, likes_count: data.likes_count } : s));
        if (activeSong && activeSong.id === songId) {
          setActiveSong({ ...activeSong, likes_count: data.likes_count });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 5. 플레이리스트 관련 API 함수들
  const handleCreatePlaylist = async (e) => {
    e.preventDefault();
    if (!newPlaylistName) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlaylistName, description: newPlaylistDesc, userId: userSession?.user?.id })
      });
      if (res.ok) {
        showToast(`플레이리스트 '${newPlaylistName}'이(가) 생성되었습니다.`);
        trackActivity('playlist_create', {
          userId: userSession?.user?.id,
          sessionId,
          metadata: { name: newPlaylistName }
        });
        setNewPlaylistName('');
        setNewPlaylistDesc('');
        setIsPlaylistModalOpen(false);
        fetchPlaylists();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openDeletePlaylist = (e, playlist) => {
    e.stopPropagation();
    setPlaylistPendingDelete(playlist);
  };

  const handleDeletePlaylist = async () => {
    if (!playlistPendingDelete || !userSession?.access_token || isDeletingPlaylist) return;

    setIsDeletingPlaylist(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists/${playlistPendingDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userSession.access_token}` }
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || '플레이리스트를 삭제하지 못했습니다.');
        return;
      }

      setPlaylists(prev => prev.filter(playlist => playlist.id !== playlistPendingDelete.id));
      if (selectedPlaylist?.id === playlistPendingDelete.id) setSelectedPlaylist(null);
      showToast(`플레이리스트 '${playlistPendingDelete.name}'이(가) 삭제되었습니다.`);
      setPlaylistPendingDelete(null);
    } catch (err) {
      console.error(err);
      showToast('서버 연결 문제로 플레이리스트를 삭제하지 못했습니다.');
    } finally {
      setIsDeletingPlaylist(false);
    }
  };

  const selectPlaylistToView = async (playlist) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists/${playlist.id}/songs`);
      if (res.ok) {
        const playlistSongs = await res.json();
        setSelectedPlaylist({ ...playlist, songs: playlistSongs });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addSongToPlaylist = async (playlistId, songId) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, userId: userSession?.user?.id, sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('플레이리스트에 곡이 추가되었습니다.');
        trackActivity('playlist_add', {
          userId: userSession?.user?.id,
          sessionId,
          songId,
          metadata: { playlistId }
        });
        setPlaylistTargetSong(null);
      } else {
        showToast(data.error || '추가할 수 없습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 문제로 플레이리스트에 추가하지 못했습니다.');
    }
  };

  const openPlaylistSelector = (e, song) => {
    e.stopPropagation();
    if (!requireLogin()) return;
    fetchPlaylists();
    setPlaylistTargetSong(song);
  };

  const removeSongFromPlaylist = async (e, playlistId, songId) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/playlists/${playlistId}/songs/${songId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('플레이리스트에서 곡을 제거했습니다.');
        trackActivity('playlist_remove', {
          userId: userSession?.user?.id,
          sessionId,
          songId,
          metadata: { playlistId }
        });
        // 상세 보기 새로고침
        if (selectedPlaylist && selectedPlaylist.id === playlistId) {
          const updatedSongs = selectedPlaylist.songs.filter(s => s.id !== songId);
          setSelectedPlaylist({ ...selectedPlaylist, songs: updatedSongs });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAdminStats = async () => {
    try {
      setAdminStats(null);
      const res = await apiFetch(`${API_BASE_URL}/api/admin/stats`, {
        headers: { 'x-admin-password': adminPassword }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminStats(data);
      } else {
        showToast('대시보드 통계를 불러오지 못했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('대시보드 통계를 불러오지 못했습니다.');
    }
  };



  const fetchAdminVsStats = async () => {
    try {
      setAdminVsStats(null);
      const res = await apiFetch(`${API_BASE_URL}/api/admin/vs-stats`, {
        headers: { 'x-admin-password': adminPassword }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminVsStats(data);
      } else {
        showToast('투표 통계를 불러오지 못했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('투표 통계를 불러오지 못했습니다.');
    }
  };

  const fetchMembers = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/admin/members`, {
        headers: { 'x-admin-password': adminPassword }
      });
      if (!response.ok) throw new Error('회원 목록 조회 실패');
      setMemberList(await response.json());
    } catch (error) {
      console.error(error);
      showToast('회원 목록을 불러오지 못했습니다.');
    }
  };

  const toggleMemberRole = async (memberId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/admin/members/${memberId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
        body: JSON.stringify({ role: newRole })
      });
      if (!response.ok) throw new Error('회원 권한 변경 실패');
      const updatedMember = await response.json();
      setMemberList(memberList.map(member => member.id === memberId ? updatedMember : member));
      showToast('권한이 변경되었습니다.');
    } catch (error) {
      console.error(error);
      showToast('권한 변경에 실패했습니다.');
    }
  };

  // 미동기화 음원 조회
  const fetchUnsyncedSongs = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/admin/unsynced-songs`, {
        headers: { 'x-admin-password': adminPassword }
      });
      if (res.ok) {
        const data = await res.json();
        setUnsyncedData(data);
      } else {
        console.warn('미동기화 음원 조회 실패');
      }
    } catch (err) {
      console.error('미동기화 음원 조회 오류:', err);
    }
  };

  // SSE 기반 동기화 실행
  const runSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncLogs([]);
    setSyncComplete(false);

    try {
      const response = await apiFetch(`${API_BASE_URL}/api/admin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword })
      });

      if (!response.ok) {
        const errData = await response.json();
        showToast(errData.error || '동기화 실행에 실패했습니다.');
        setIsSyncing(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              setSyncLogs(prev => [...prev, event]);

              if (event.type === 'done') {
                setSyncComplete(Boolean(event.success));
                setIsSyncing(false);
                fetchUnsyncedSongs();
              }
            } catch {
              // JSON 파싱 실패 무시
            }
          }
        }
      }
    } catch (err) {
      console.error('동기화 오류:', err);
      setSyncLogs(prev => [...prev, { type: 'error', message: `❌ 연결 오류: ${err.message}`, timestamp: new Date().toISOString() }]);
      showToast('동기화 중 연결 오류가 발생했습니다.');
    } finally {
      setIsSyncing(false);
    }
  };

  // 6. 어드민 인증 처리업로드 처리
  const handleAdminAuth = async (e) => {
    e.preventDefault();
    if (!adminPassword) {
      showToast('비밀번호를 입력하세요.');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/admin/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword })
      });
      
      const data = await res.json();
      if (res.ok) {
        setIsAdminAuthenticated(true);
        fetchAdminStats();
        fetchAdminVsStats();
        fetchMembers();
        fetchUnsyncedSongs();
        showToast('관리자 인증에 성공했습니다.');
      } else {
        showToast(data.error || '비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      console.error('어드민 인증 오류:', err);
      showToast('서버 연결에 실패하여 인증을 진행할 수 없습니다.');
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadTitle || !uploadArtist || !audioFile) {
      showToast('필수 정보를 입력해 주세요.');
      return;
    }

    // 파일 용량 체크 (25MB 제한) - Cloudtype 메모리 및 대역폭 제한 대비
    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    if (audioFile.size > MAX_FILE_SIZE) {
      showToast('음원 파일 용량이 너무 큽니다 (25MB 초과). 원활한 스트리밍을 위해 용량을 줄여주세요.');
      return;
    }

    // WAV 파일 차단 (대역폭 초과 및 메모리 부족 방지)
    if (audioFile.name.toLowerCase().endsWith('.wav') || audioFile.type === 'audio/wav') {
      showToast('WAV 파일은 용량이 너무 커서 수파베이스 트래픽(Egress) 요금이 폭탄으로 나올 수 있습니다. 반드시 .mp3 형식으로 변환해서 올려주세요!');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('title', uploadTitle);
    formData.append('artist', uploadArtist);
    formData.append('category', uploadCategory);
    formData.append('lyrics', uploadLyrics);
    formData.append('adminPassword', adminPassword || 'admin1234');
    formData.append('audio', audioFile);
    if (coverFile) {
      formData.append('cover', coverFile);
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        if (data.autoSync?.state === 'configuration_required') {
          showToast('음원은 등록되었지만 자동 동기화 서버 설정이 필요합니다.');
        } else if (data.autoSync?.state === 'retrying') {
          showToast('음원이 등록되었습니다. 자동 동기화를 다시 시도합니다.');
        } else {
          showToast('음원이 등록되었으며 자동 동기화가 시작되었습니다!');
        }
        setUploadTitle('');
        setUploadArtist('');
        setUploadLyrics('');
        setAudioFile(null);
        setCoverFile(null);
        fetchSongs(); // 목록 리프레시
        setCurrentView('home');
      } else {
        showToast(data.error || '음원 등록 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 문제로 음원을 업로드하지 못했습니다.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleEditClick = (song) => {
    if (isAdminAuthenticated) {
      openEditModal(song);
    } else {
      setPendingEditSong(song);
      setAuthPasswordInput('');
      setIsAuthModalOpen(true);
    }
  };

  const handleAuthModalSubmit = async (e) => {
    e.preventDefault();
    if (!authPasswordInput) {
      showToast('비밀번호를 입력하세요.');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/admin/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword: authPasswordInput })
      });
      
      const data = await res.json();
      if (res.ok) {
        setIsAdminAuthenticated(true);
        setAdminPassword(authPasswordInput);
        setIsAuthModalOpen(false);
        showToast('관리자 인증에 성공했습니다.');
        
        if (pendingEditSong) {
          openEditModal(pendingEditSong);
          setPendingEditSong(null);
        }
      } else {
        showToast(data.error || '비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      console.error('어드민 인증 오류:', err);
      showToast('서버 연결에 실패하여 인증을 진행할 수 없습니다.');
    }
  };

  const openEditModal = (song) => {
    setEditingSong(song);
    setEditTitle(song.title);
    setEditArtist(song.artist);
    setEditCategory(song.category || '발라드');
    setEditLyrics(song.lyrics || '');
    setEditCoverFile(null);
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingSong || !editTitle || !editArtist) {
      showToast('필수 정보를 입력해 주세요.');
      return;
    }

    setIsUpdatingSong(true);
    const formData = new FormData();
    formData.append('title', editTitle);
    formData.append('artist', editArtist);
    formData.append('category', editCategory);
    formData.append('lyrics', editLyrics);
    formData.append('adminPassword', adminPassword || 'admin1234');
    if (editCoverFile) {
      formData.append('cover', editCoverFile);
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/${editingSong.id}`, {
        method: 'PUT',
        body: formData
      });
      
      const data = await res.json();
      if (res.ok) {
        showToast('음원이 성공적으로 수정되었습니다.');
        setIsEditModalOpen(false);
        setEditingSong(null);
        setEditCoverFile(null);
        fetchSongs(); // 목록 새로고침
        
        if (activeSong && activeSong.id === editingSong.id) {
          setActiveSong(data);
        }
      } else {
        showToast(data.error || '음원 수정에 실패했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 음원을 수정하지 못했습니다.');
    } finally {
      setIsUpdatingSong(false);
    }
  };

  const handleDeleteSong = async (e, song) => {
    e.stopPropagation();
    
    if (!window.confirm(`정말로 '${song.title}' 음원을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 플레이리스트와 좋아요 목록에서도 삭제됩니다.`)) {
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/songs/${song.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword: adminPassword || 'admin1234' })
      });
      
      const data = await res.json();
      if (res.ok) {
        showToast('음원이 성공적으로 삭제되었습니다.');
        
        if (activeSong && activeSong.id === song.id) {
          audioRef.current.pause();
          audioRef.current.src = '';
          setActiveSong(null);
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
        }
        
        fetchSongs(); // 목록 새로고침
        fetchPlaylists(); // 플레이리스트 동기화
      } else {
        showToast(data.error || '음원 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 오류로 음원을 삭제하지 못했습니다.');
    }
  };

  const introPoemHTML = `
    <p>Welcome to <span>MusicDrive</span>, your ultimate destination for boundless melodies and rhythm. Dive into a world where every <span>beat</span> sparks a memory, every lyric tells a story, and every song brings us closer together. Feel the <span>harmony</span> flow through your veins. Press <span>Play</span>.&nbsp;&nbsp;&nbsp;&nbsp;Welcome to <span>MusicDrive</span>, your ultimate destination for boundless melodies and rhythm. Dive into a world where every <span>beat</span> sparks a memory, every lyric tells a story, and every song brings us closer together. Feel the <span>harmony</span> flow through your veins. Press <span>Play</span>.&nbsp;&nbsp;&nbsp;&nbsp;Welcome to <span>MusicDrive</span>, your ultimate destination for boundless melodies and rhythm. Dive into a world where every <span>beat</span> sparks a memory, every lyric tells a story, and every song brings us closer together. Feel the <span>harmony</span> flow through your veins. Press <span>Play</span>.&nbsp;&nbsp;&nbsp;&nbsp;Welcome to <span>MusicDrive</span>, your ultimate destination for boundless melodies and rhythm. Dive into a world where every <span>beat</span> sparks a memory, every lyric tells a story, and every song brings us closer together. Feel the <span>harmony</span> flow through your veins. Press <span>Play</span>.</p>
  `;

  const songsByRegistrationDate = songs
    .filter(song => Number.isFinite(Date.parse(song.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const releasesFromLastTwoWeeks = songsByRegistrationDate.filter(song => (
    Date.now() - Date.parse(song.created_at) <= NEW_RELEASE_WINDOW_MS
  ));
  const newReleaseSongs = songsByRegistrationDate.slice(
    0,
    Math.max(5, releasesFromLastTwoWeeks.length)
  );
  const weeklyMatch = vsMatches.find(match => match.is_weekly_featured) || vsMatches[0] || null;
  const weeklyTotalVotes = weeklyMatch
    ? (weeklyMatch.song1_votes || 0) + (weeklyMatch.song2_votes || 0)
    : 0;
  const weeklySong1Pct = weeklyTotalVotes > 0
    ? Math.round(((weeklyMatch?.song1_votes || 0) / weeklyTotalVotes) * 100)
    : 50;
  const weeklySong2Pct = 100 - weeklySong1Pct;
  const weeklyPeriod = weeklyMatch
    ? formatWeeklyMatchPeriod(weeklyMatch.weekly_starts_at, weeklyMatch.weekly_ends_at)
    : '';

  if (showIntro) {
    return (
      <PoemAnimation 
        poemHTML={introPoemHTML}
        backgroundImageUrl="/intro_bg.jpg"
        boyImageUrl="/intro_character.png"
        onEnter={() => setShowIntro(false)}
      />
    );
  }

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const activeGenreHeroVideo = getGenreHeroVideo(activeSong?.category);

  return (
    <div className="app-container">
      {/* Toast 알림 표시 */}
      {toastMessage && <div className="toast-msg">{toastMessage}</div>}

      {/* Mobile Header */}
      <div className="mobile-header" style={{ display: window.innerWidth > 768 ? 'none' : 'flex' }}>
        <div className="logo-section">
          <Music className="logo-icon" size={24} />
          <h1 style={{ fontSize: '18px', margin: 0 }}>musicdrive</h1>
        </div>
        <button className="hamburger-btn" onClick={() => setIsMobileMenuOpen(true)}>
          <Menu size={24} />
        </button>
      </div>

      {/* Mobile Overlay */}
      <div 
        className={`mobile-overlay ${isMobileMenuOpen ? 'active' : ''}`}
        onClick={closeMobileMenu}
      ></div>

      {/* Sidebar Navigation */}
      <nav className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="logo-section" style={{ display: window.innerWidth <= 768 ? 'none' : 'flex' }}>
          <Music className="logo-icon" size={28} />
          <h1>musicdrive</h1>
        </div>
        <ul className="nav-links">
          <li>
            <div 
              className={`nav-item ${currentView === 'home' && !selectedPlaylist ? 'active' : ''}`}
              onClick={() => { setCurrentView('home'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <Home className="icon" />
              <span>홈</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'search' ? 'active' : ''}`}
              onClick={() => { setCurrentView('search'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <Search className="icon" />
              <span>검색</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'playlists' || selectedPlaylist ? 'active' : ''}`}
              onClick={() => { setCurrentView('playlists'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <FolderHeart className="icon" />
              <span>플레이리스트</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'vs' ? 'active' : ''}`}
              onClick={() => { setCurrentView('vs'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <Trophy className="icon" />
              <span>곡 대결 투표</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'board' ? 'active' : ''}`}
              onClick={() => { setCurrentView('board'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <MessageSquare className="icon" />
              <span>자유게시판</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'song-requests' ? 'active' : ''}`}
              onClick={() => { if (requireLogin()) { setCurrentView('song-requests'); setSelectedPlaylist(null); closeMobileMenu(); } }}
            >
              <Music className="icon" />
              <span>노래 만들기</span>
            </div>
          </li>
          <li className="live-chat-nav-entry">
            <button
              type="button"
              className={`live-chat-nav-button ${isLiveChatOpen ? 'active' : ''}`}
              onClick={() => { setIsLiveChatOpen((open) => !open); closeMobileMenu(); }}
              aria-expanded={isLiveChatOpen}
              aria-controls="musicdrive-live-chat"
            >
              <span className="live-chat-nav-icon"><MessageCircle size={19} /></span>
              <span className="live-chat-nav-copy">
                <strong>실시간 대화</strong>
                <small><i /> 접속자들과 이야기하기</small>
              </span>
              <span className="live-chat-nav-state">{isLiveChatOpen ? '열림' : '열기'}</span>
            </button>
          </li>
          
        </ul>

        {/* Auth Section */}
        <div className="auth-section" style={{ marginTop: 'auto', padding: '1rem' }}>
          {userSession ? (
            <div className="user-profile">
              <div className="user-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <div className="user-avatar" style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {userSession.user.user_metadata?.avatar_url ? (
                    <img src={userSession.user.user_metadata.avatar_url} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <div style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                  {userSession.user.user_metadata?.full_name || userSession.user.user_metadata?.name || userSession.user.email.split('@')[0]}
                </div>
              </div>
              
              {userProfile?.role === 'admin' && (
                <button 
                  className="btn-secondary" 
                  style={{ width: '100%', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  onClick={() => { setCurrentView('admin'); closeMobileMenu(); }}
                >
                  <Settings size={16} />
                  어드민 설정
                </button>
              )}
              
              <button 
                className="btn-secondary" 
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                onClick={handleLogout}
              >
                <LogOut size={16} />
                로그아웃
              </button>
            </div>
          ) : (
            <button 
              className="play-btn-premium" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
              onClick={handleGoogleLogin}
            >
              <LogIn size={16} />
              구글 로그인
            </button>
          )}
        </div>
      </nav>

      {/* Main Panel Content */}
      <main className="main-content">
        
        {/* 플레이리스트 상세 조회 화면 */}
        {selectedPlaylist ? (
          <div>
            <div className="hero-banner" style={{ background: 'linear-gradient(135deg, rgba(58, 134, 200, 0.3) 0%, rgba(15, 15, 25, 0.4) 100%)' }}>
              <span className="hero-tag">Playlist</span>
              <h1 className="hero-title">{selectedPlaylist.name}</h1>
              <p className="hero-desc">{selectedPlaylist.description || '작성된 설명이 없습니다.'}</p>
              {selectedPlaylist.songs && selectedPlaylist.songs.length > 0 && (
                <button 
                  className="play-btn-premium"
                  onClick={() => {
                    setQueue(selectedPlaylist.songs);
                    setQueueIndex(0);
                    setActiveSong(selectedPlaylist.songs[0]);
                    setIsPlaying(true);
                    incrementPlayCount(selectedPlaylist.songs[0].id);
                  }}
                >
                  <Play size={18} fill="currentColor" />
                  전체 재생
                </button>
              )}
            </div>

            <div className="section-header">
              <h2>수록된 곡 ({selectedPlaylist.songs ? selectedPlaylist.songs.length : 0}곡)</h2>
              <button className="btn-secondary" onClick={() => setSelectedPlaylist(null)}>목록으로 돌아가기</button>
            </div>

            <div className="song-list-premium">
              {selectedPlaylist.songs && selectedPlaylist.songs.length > 0 ? (
                selectedPlaylist.songs.map((song, idx) => (
                  <div className="song-row" key={song.id} onClick={() => playSingleSong(song)}>
                    <div className="row-index">{idx + 1}</div>
                    <img className="row-img" src={song.cover_url} alt={song.title} />
                    <div className="row-details">
                      <div className="row-title">{song.title}</div>
                      <div className="row-artist">{song.artist}</div>
                    </div>
                    <div className="row-meta">
                      <button 
                        className={`icon-btn ${likedSongIds.includes(song.id) ? 'liked' : ''}`}
                        onClick={(e) => toggleLike(e, song.id)}
                      >
                        <Heart size={16} fill={likedSongIds.includes(song.id) ? "currentColor" : "none"} />
                      </button>
                      {userProfile?.role === 'admin' && (
                        <button
                          className="icon-btn edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditClick(song);
                          }}
                          title="음원 수정"
                        >
                          <Edit2 size={16} />
                        </button>
                      )}
                      <button 
                        className="icon-btn"
                        onClick={(e) => removeSongFromPlaylist(e, selectedPlaylist.id, song.id)}
                        title="플레이리스트에서 제거"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                  플레이리스트가 비어 있습니다. 검색 창에서 곡을 찾아 등록해 보세요!
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 1. 홈 화면 */}
            {currentView === 'home' && (
              <div>
                <div className="hero-banner home-hero">
                  <div className="hero-content">
                    <span className="hero-tag">Original Tracks</span>
                    <h1 className="hero-title">나만의 창작곡 보관함</h1>
                    <p className="hero-desc">
                      직접 작사, 작곡하고 녹음한 노래들이 담겨 있는 공간입니다. 
                      마음껏 들으시고 좋은 음악이 있다면 플레이리스트에 담아가세요!
                    </p>
                    {songs.length > 0 && (
                      <button className="play-btn-premium" onClick={playRandomSong}>
                        <Shuffle size={18} />
                        랜덤 듣기
                      </button>
                    )}
                  </div>
                  {activeGenreHeroVideo ? (
                    <GenreHeroVideo
                      key={activeGenreHeroVideo.src}
                      media={activeGenreHeroVideo}
                      isPlaying={isPlaying}
                    />
                  ) : (
                    <div className="hero-mascot-bg" style={{ backgroundImage: `url(${mascotImg})` }}></div>
                  )}
                </div>

                {/* 카테고리 필터 */}
                <div className="category-container">
                  {categories.map(cat => (
                    <button 
                      key={cat} 
                      className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* 실시간 인기 트랙 */}
                <div className="section-header">
                  <h2>인기 곡 목록</h2>
                  <button
                    type="button"
                    className={`mobile-live-chat-launch ${isLiveChatOpen ? 'active' : ''}`}
                    onClick={() => setIsLiveChatOpen(true)}
                    aria-controls="musicdrive-live-chat"
                    aria-expanded={isLiveChatOpen}
                  >
                    <MessageCircle size={15} />
                    <span>{isLiveChatOpen ? '대화창 열림' : '실시간 대화'}</span>
                  </button>
                </div>
                <div className="song-list-premium" style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: '6px' }}>
                  {songs.slice().sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).map((song, idx) => (
                    <div className="song-row" key={song.id} onClick={() => playSingleSong(song)}>
                      <div className="row-index">{idx + 1}</div>
                      <img className="row-img" src={song.cover_url} alt={song.title} />
                      <div className="row-details">
                        <div className="row-title">{song.title}</div>
                        <div className="row-artist">{song.artist}</div>
                      </div>
                      <div className="row-meta">
                        <div className="meta-item">
                          <Play size={13} />
                          {song.play_count || 0}
                        </div>
                        <button 
                          className={`icon-btn ${likedSongIds.includes(song.id) ? 'liked' : ''}`}
                          onClick={(e) => toggleLike(e, song.id)}
                        >
                          <Heart size={16} fill={likedSongIds.includes(song.id) ? "currentColor" : "none"} />
                        </button>
                        <button 
                          className="icon-btn" 
                          onClick={(e) => openPlaylistSelector(e, song)}
                          title="플레이리스트에 추가"
                        >
                          <FolderPlus size={16} />
                        </button>

                        {userProfile?.role === 'admin' && (
                          <button
                            className="icon-btn edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick(song);
                            }}
                            title="음원 수정"
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        {isAdminAuthenticated && (
                          <button 
                            className="icon-btn delete-btn" 
                            onClick={(e) => handleDeleteSong(e, song)}
                            title="음원 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}

                      </div>
                    </div>
                  ))}
                </div>

                {/* 최근 2주 이내 신곡 그리드 */}
                <div className="section-header">
                  <h2>최근 등록 신곡</h2>
                </div>
                <div className="song-grid">
                  {newReleaseSongs.map(song => (
                    <div className="song-card" key={song.id} onClick={() => playSingleSong(song)}>
                      <div className="card-img-container">
                        <img className="card-img" src={song.cover_url} alt={song.title} />
                        <div className="card-play-overlay">
                          <div className="play-icon-glow">
                            <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />
                          </div>
                        </div>
                        {userProfile?.role === 'admin' && (
                          <div className="card-admin-overlay" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="icon-btn edit-btn"
                              onClick={() => handleEditClick(song)}
                              title="음원 수정"
                            >
                              <Edit2 size={14} />
                            </button>
                            {isAdminAuthenticated && (
                              <button
                                className="icon-btn delete-btn"
                                onClick={(e) => handleDeleteSong(e, song)}
                                title="음원 삭제"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="card-info">
                        <div className="card-title">{song.title}</div>
                        <div className="card-artist">{song.artist}</div>
                      </div>
                    </div>
                  ))}
                  {newReleaseSongs.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                      등록된 신곡이 없습니다.
                    </div>
                  )}
                </div>

                {weeklyMatch && (
                  <section className="home-weekly-vs" aria-labelledby="home-weekly-vs-title">
                    <div className="home-weekly-vs-header">
                      <div>
                        <span className="home-weekly-vs-kicker"><Trophy size={15} /> Weekly music battle</span>
                        <h2 id="home-weekly-vs-title">이번 주 곡 대결</h2>
                        <p>{weeklyMatch.title}</p>
                      </div>
                      <div className="home-weekly-vs-actions">
                        <span className="home-weekly-vs-period"><Clock size={14} />{weeklyPeriod}</span>
                        <button type="button" onClick={() => setCurrentView('vs')}>전체 대결 보기</button>
                      </div>
                    </div>

                    <div className="home-weekly-vs-arena">
                      {[weeklyMatch.song1, weeklyMatch.song2].map((song, index) => {
                        const songId = index === 0 ? weeklyMatch.song1_id : weeklyMatch.song2_id;
                        const votes = index === 0 ? weeklyMatch.song1_votes : weeklyMatch.song2_votes;
                        const isVoted = weeklyMatch.user_voted_song_id === songId;
                        const isSongPlaying = activeSong?.id === songId && isPlaying;

                        return (
                          <div className={`home-weekly-vs-choice ${isVoted ? 'voted' : ''}`} key={songId}>
                            <button
                              type="button"
                              className="home-weekly-vs-cover"
                              onClick={() => playSingleSong(song)}
                              aria-label={`${song?.title || '곡'} ${isSongPlaying ? '일시정지' : '재생'}`}
                            >
                              <img src={song?.cover_url} alt="" />
                              <span>{isSongPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span>
                            </button>
                            <div className="home-weekly-vs-song-info">
                              <span className="home-weekly-vs-side">{index === 0 ? 'A SIDE' : 'B SIDE'} · {votes || 0}표</span>
                              <strong>{song?.title}</strong>
                              <small>{song?.artist}</small>
                              <button
                                type="button"
                                className={`home-weekly-vote-button ${isVoted ? 'active' : ''}`}
                                onClick={() => handleVSVote(weeklyMatch.id, songId)}
                              >
                                {!userSession ? '로그인 후 투표' : (isVoted ? '선택 취소' : '이 곡에 투표')}
                              </button>
                            </div>
                          </div>
                        );
                      }).reduce((items, choice, index) => {
                        if (index === 1) items.push(<div className="home-weekly-vs-mark" key="weekly-vs-mark">VS</div>);
                        items.push(choice);
                        return items;
                      }, [])}
                    </div>

                    <div className="home-weekly-vs-progress" aria-label={`A곡 ${weeklySong1Pct}%, B곡 ${weeklySong2Pct}%`}>
                      <span className="song-a" style={{ width: `${weeklySong1Pct}%` }}>{weeklySong1Pct}%</span>
                      <span className="song-b" style={{ width: `${weeklySong2Pct}%` }}>{weeklySong2Pct}%</span>
                    </div>
                    <div className="home-weekly-vs-summary">
                      <span>{weeklyMatch.song1?.title}</span>
                      <strong>총 {weeklyTotalVotes}표 참여</strong>
                      <span>{weeklyMatch.song2?.title}</span>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* 2. 검색 화면 */}
            {currentView === 'search' && (
              <div>
                <form className="search-wrapper" onSubmit={handleSearchSubmit}>
                  <Search className="search-icon-inside" size={22} />
                  <input 
                    className="search-input" 
                    placeholder="듣고 싶은 노래 제목이나 아티스트 명을 입력하세요"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      fetchSongs(e.target.value, selectedCategory);
                    }}
                  />
                </form>

                <div className="category-container">
                  {categories.map(cat => (
                    <button 
                      key={cat} 
                      className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="section-header">
                  <h2>검색 결과 ({songs.length}곡)</h2>
                </div>

                <div className="song-list-premium">
                  {songs.map((song, idx) => (
                    <div className="song-row" key={song.id} onClick={() => playSingleSong(song)}>
                      <div className="row-index">{idx + 1}</div>
                      <img className="row-img" src={song.cover_url} alt={song.title} />
                      <div className="row-details">
                        <div className="row-title">{song.title}</div>
                        <div className="row-artist">{song.artist}</div>
                      </div>
                      <div className="row-meta">
                        <button 
                          className={`icon-btn ${likedSongIds.includes(song.id) ? 'liked' : ''}`}
                          onClick={(e) => toggleLike(e, song.id)}
                        >
                          <Heart size={16} fill={likedSongIds.includes(song.id) ? "currentColor" : "none"} />
                        </button>
                        <button 
                          className="icon-btn"
                          onClick={(e) => openPlaylistSelector(e, song)}
                          title="플레이리스트에 추가"
                        >
                          <FolderPlus size={16} />
                        </button>

                        {userProfile?.role === 'admin' && (
                          <button
                            className="icon-btn edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick(song);
                            }}
                            title="음원 수정"
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        {isAdminAuthenticated && (
                          <button 
                            className="icon-btn delete-btn" 
                            onClick={(e) => handleDeleteSong(e, song)}
                            title="음원 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {songs.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                      검색어와 일치하는 노래가 없습니다. 다른 검색어를 입력해 보세요!
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3.5. VS 대결 투표 화면 */}
            {currentView === 'vs' && (
              <div>
                <div className="section-header">
                  <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Trophy style={{ color: 'var(--primary)' }} />
                      곡 대결 투표
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
                      같은 가사, 다른 리듬! 여러분의 마음에 더 와닿는 음원에 투표해 주세요.
                    </p>
                  </div>
                </div>

                {/* 관리자용 대결 생성 패널 */}
                {isAdminAuthenticated && (
                  <div className="admin-card" style={{ marginBottom: '32px', padding: '24px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>새로운 곡 대결 등록</h3>
                    <form onSubmit={handleCreateVSMatch} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>대결 제목 *</label>
                        <input 
                          className="form-control" 
                          placeholder="예: 행복예약 - 발라드 vs 댄스 버전"
                          value={vsTitle}
                          onChange={(e) => setVsTitle(e.target.value)}
                          required
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label>곡 A 선택 *</label>
                          <select 
                            className="form-control"
                            value={vsSongAId}
                            onChange={(e) => setVsSongAId(e.target.value)}
                            required
                          >
                            <option value="">곡을 선택해 주세요</option>
                            {songs.map(song => (
                              <option key={song.id} value={song.id}>{song.title} ({song.artist})</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label>곡 B 선택 *</label>
                          <select 
                            className="form-control"
                            value={vsSongBId}
                            onChange={(e) => setVsSongBId(e.target.value)}
                            required
                          >
                            <option value="">곡을 선택해 주세요</option>
                            {songs.map(song => (
                              <option key={song.id} value={song.id}>{song.title} ({song.artist})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button type="submit" className="btn-primary-glow" style={{ alignSelf: 'flex-end', padding: '10px 24px' }} disabled={isCreatingVS}>
                        {isCreatingVS ? '대결 생성 중...' : '대결 생성하기'}
                      </button>
                    </form>
                  </div>
                )}

                {/* 대결 목록 그리드 */}
                <div className="vs-grid">
                  {vsMatches.map(match => {
                    const totalVotes = (match.song1_votes || 0) + (match.song2_votes || 0);
                    const song1Pct = totalVotes > 0 ? Math.round((match.song1_votes / totalVotes) * 100) : 50;
                    const song2Pct = totalVotes > 0 ? 100 - song1Pct : 50;

                    const isSong1Playing = activeSong && activeSong.id === match.song1_id && isPlaying;
                    const isSong2Playing = activeSong && activeSong.id === match.song2_id && isPlaying;

                    return (
                      <div className="vs-card" key={match.id}>
                        {/* 관리자 제어 버튼 (삭제 및 수정) */}
                        {isAdminAuthenticated && (
                          <div className="vs-admin-actions">
                            <button 
                              className="vs-action-btn edit" 
                              onClick={() => openVsEditModal(match)}
                              title="대결 수정"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              className="vs-action-btn delete" 
                              onClick={() => handleDeleteVSMatch(match.id)}
                              title="대결 삭제"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}

                        <h3 className="vs-card-title">{match.title}</h3>

                        <div className="vs-layout-row">
                          {/* 곡 1 영역 */}
                          <div className={`vs-song-section ${match.user_voted_song_id === match.song1_id ? 'voted' : ''}`}>
                            <div className="vs-img-container" onClick={() => playSingleSong(match.song1)}>
                              <img className="vs-cover-img" src={match.song1?.cover_url} alt={match.song1?.title} />
                              <div className="vs-play-overlay">
                                <div className="vs-play-btn-glow">
                                  {isSong1Playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }} />}
                                </div>
                              </div>
                            </div>
                            <div className="vs-song-details">
                              <div className="vs-song-title">{match.song1?.title}</div>
                              <div className="vs-song-artist">{match.song1?.artist}</div>
                            </div>
                            <button 
                              className={`vs-vote-button ${match.user_voted_song_id === match.song1_id ? 'active' : ''}`}
                              onClick={() => handleVSVote(match.id, match.song1_id)}
                            >
                              {match.user_voted_song_id === match.song1_id ? 'A곡 선택 취소' : 'A곡 투표하기'}
                            </button>
                          </div>

                          {/* 중앙 VS 표시 영역 */}
                          <div className="vs-middle-section">
                            <span className="vs-badge">VS</span>
                          </div>

                          {/* 곡 2 영역 */}
                          <div className={`vs-song-section ${match.user_voted_song_id === match.song2_id ? 'voted' : ''}`}>
                            <div className="vs-img-container" onClick={() => playSingleSong(match.song2)}>
                              <img className="vs-cover-img" src={match.song2?.cover_url} alt={match.song2?.title} />
                              <div className="vs-play-overlay">
                                <div className="vs-play-btn-glow">
                                  {isSong2Playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }} />}
                                </div>
                              </div>
                            </div>
                            <div className="vs-song-details">
                              <div className="vs-song-title">{match.song2?.title}</div>
                              <div className="vs-song-artist">{match.song2?.artist}</div>
                            </div>
                            <button 
                              className={`vs-vote-button ${match.user_voted_song_id === match.song2_id ? 'active' : ''}`}
                              onClick={() => handleVSVote(match.id, match.song2_id)}
                            >
                              {match.user_voted_song_id === match.song2_id ? 'B곡 선택 취소' : 'B곡 투표하기'}
                            </button>
                          </div>
                        </div>

                        {/* 투표 현황 득표율 표시 바 */}
                        <div className="vs-progress-section">
                          <div className="vs-progress-bar-container">
                            <div className="vs-progress-fill song1-fill" style={{ width: `${song1Pct}%` }}>
                              <span className="pct-label">{song1Pct}%</span>
                            </div>
                            <div className="vs-progress-fill song2-fill" style={{ width: `${song2Pct}%` }}>
                              <span className="pct-label">{song2Pct}%</span>
                            </div>
                          </div>
                          <div className="vs-votes-summary">
                            <span>A곡: {match.song1_votes || 0}표</span>
                            <span style={{ color: 'var(--text-muted)' }}>총 {totalVotes}표 참여</span>
                            <span>B곡: {match.song2_votes || 0}표</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {vsMatches.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
                      등록된 대결이 없습니다.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. 플레이리스트 관리 화면 */}
            {currentView === 'playlists' && (
              <div className="playlist-hub-layout">
                <section className="playlist-library-panel">
                  <div className="section-header">
                    <h2>내 플레이리스트</h2>
                    <button className="btn-primary-glow" onClick={() => setIsPlaylistModalOpen(true)}>
                      <Plus size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      신규 생성
                    </button>
                  </div>

                  <div className="playlist-grid">
                    {playlists.map(pl => (
                      <div className="playlist-card" key={pl.id} onClick={() => selectPlaylistToView(pl)}>
                        <button
                          type="button"
                          className="playlist-delete-button"
                          onClick={(e) => openDeletePlaylist(e, pl)}
                          aria-label={`${pl.name} 플레이리스트 삭제`}
                          title="플레이리스트 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                        <ListMusic className="playlist-folder-icon" />
                        <div>
                          <div className="playlist-name">{pl.name}</div>
                          <div className="playlist-desc">{pl.description || '추가된 상세 설명 없음'}</div>
                        </div>
                      </div>
                    ))}
                    {playlists.length === 0 && (
                      <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
                        생성된 플레이리스트가 없습니다. 나만의 재생 목록을 생성하여 관리해 보세요!
                      </div>
                    )}
                  </div>
                </section>

                <PersonalDashboard
                  data={userDashboard}
                  loading={isUserDashboardLoading}
                  error={userDashboardError}
                  onRetry={fetchUserDashboard}
                  onPlaySong={playSingleSong}
                />
              </div>
            )}

            {/* 4. 관리자 운영 화면 */}
            {currentView === 'admin' && (
              <AdminWorkspace
                isAuthenticated={isAdminAuthenticated}
                adminPassword={adminPassword}
                setAdminPassword={setAdminPassword}
                onAuthenticate={handleAdminAuth}
                onLock={() => {
                  setIsAdminAuthenticated(false);
                  setAdminPassword('');
                }}
                adminTab={adminTab}
                setAdminTab={setAdminTab}
                adminStats={adminStats}
                adminVsStats={adminVsStats}
                memberList={memberList}
                fetchStats={fetchAdminStats}
                fetchVsStats={fetchAdminVsStats}
                fetchMembers={fetchMembers}
                toggleMemberRole={toggleMemberRole}
                unsyncedData={unsyncedData}
                fetchUnsynced={fetchUnsyncedSongs}
                runSync={runSync}
                isSyncing={isSyncing}
                syncLogs={syncLogs}
                syncComplete={syncComplete}
                apiBaseUrl={API_BASE_URL}
                uploadProps={{
                  title: uploadTitle,
                  setTitle: setUploadTitle,
                  artist: uploadArtist,
                  setArtist: setUploadArtist,
                  category: uploadCategory,
                  setCategory: setUploadCategory,
                  lyrics: uploadLyrics,
                  setLyrics: setUploadLyrics,
                  audioFile,
                  setAudioFile,
                  coverFile,
                  setCoverFile,
                  categories,
                  isUploading,
                  onSubmit: handleUploadSubmit
                }}
              />
            )}

            {/* 노래 만들기 화면 */}
            {currentView === 'song-requests' && (
              <div className="board-container">
                {songRequestView === 'list' && (
                  <>
                    <div className="hero-banner board-hero" style={{ background: 'linear-gradient(135deg, rgba(30, 200, 150, 0.3) 0%, rgba(15, 15, 25, 0.4) 100%)' }}>
                      <div className="hero-content">
                        <span className="hero-tag">Private Request</span>
                        <h1 className="hero-title">노래 만들기</h1>
                        <p className="hero-desc">나만의 곡을 요청하고 관리자와 1:1로 소통해보세요!</p>
                        <button 
                          className="play-btn-premium"
                          onClick={() => {
                            setSongRequestForm({ title: '', content: SONG_REQUEST_TEMPLATE });
                            setSongRequestView('write');
                          }}
                        >
                          <Plus size={18} />
                          작성하기
                        </button>
                      </div>
                    </div>
                    
                    <div className="requests-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', marginTop: '32px', paddingBottom: '40px' }}>
                      {songRequests.length === 0 ? (
                        <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '60px', background: 'rgba(25, 25, 35, 0.4)', borderRadius: '24px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                          <Music size={48} opacity={0.3} style={{ marginBottom: '16px' }} />
                          <p style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>첫 번째 노래 만들기 요청을 남겨보세요!</p>
                        </div>
                      ) : (
                        songRequests.map((req, idx) => {
                          const requestNumber = songRequests.length - idx;
                          return (
                            <div 
                              className="request-card" 
                              key={req.id}
                              onClick={() => fetchSongRequestDetail(req.id)}
                              style={{
                                background: 'rgba(25, 25, 35, 0.6)',
                                backdropFilter: 'blur(16px)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '20px',
                                padding: '24px',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                                animation: `fadeUp 0.4s ease ${idx * 0.05}s both`
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-4px)';
                                e.currentTarget.style.borderColor = 'var(--primary-color)';
                                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.boxShadow = 'none';
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ 
                                  fontSize: '13px', 
                                  fontWeight: '700', 
                                  background: 'linear-gradient(135deg, var(--primary-color), #8a2be2)', 
                                  color: '#fff', 
                                  padding: '6px 14px', 
                                  borderRadius: '20px',
                                  letterSpacing: '0.5px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                }}>
                                  ✨ {requestNumber}번째 노래 요청
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '20px' }}>
                                  <Lock size={12} style={{ color: 'var(--text-secondary)' }} />
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>비밀글</span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                                <span style={{
                                  fontSize: '11px', fontWeight: '600', padding: '4px 10px', borderRadius: '12px',
                                  background: getStatusStyle(req.status || '대기중').bg, color: getStatusStyle(req.status || '대기중').color
                                }}>{req.status || '대기중'}</span>
                              </div>
                              <h3 style={{ fontSize: '19px', fontWeight: '600', color: '#fff', margin: '16px 0', lineHeight: '1.5', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                {req.title}
                              </h3>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <div style={{ background: 'rgba(255,255,255,0.1)', padding: '4px', borderRadius: '50%' }}>
                                    <User size={12} />
                                  </div>
                                  {req.profiles?.email?.split('@')[0] || '익명'}
                                </span>
                                <span>{new Date(req.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}

                {['write', 'edit'].includes(songRequestView) && (
                  <div className="board-write-form" style={{
                    background: 'rgba(25, 25, 35, 0.6)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '24px',
                    padding: '40px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    animation: 'fadeUp 0.4s ease'
                  }}>
                    <h2 style={{ fontSize: '28px', marginBottom: '8px', fontWeight: '800', background: 'linear-gradient(90deg, #fff, #a0a0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>노래 만들기 요청 작성</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Lock size={14} style={{ color: 'var(--primary-color)' }} /> 작성하신 내용은 본인과 관리자만 볼 수 있는 1:1 비밀글입니다.
                    </p>
                    <form onSubmit={handleSongRequestSubmit}>
                      <div className="form-group" style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', marginBottom: '12px', fontSize: '15px', fontWeight: '600', color: '#eaeaea' }}>제목</label>
                        <input 
                          type="text" 
                          required 
                          value={songRequestForm.title}
                          onChange={e => setSongRequestForm({...songRequestForm, title: e.target.value})}
                          placeholder="원하시는 곡의 제목이나 주제를 적어주세요."
                          style={{
                            width: '100%',
                            padding: '16px 20px',
                            fontSize: '16px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            color: '#fff',
                            outline: 'none',
                            transition: 'all 0.3s ease',
                            boxSizing: 'border-box'
                          }}
                          onFocus={e => e.target.style.borderColor = 'var(--primary-color)'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '32px' }}>
                        <label style={{ display: 'block', marginBottom: '12px', fontSize: '15px', fontWeight: '600', color: '#eaeaea' }}>요청 내용</label>
                        <textarea 
                          required 
                          rows="20"
                          value={songRequestForm.content}
                          onChange={e => setSongRequestForm({...songRequestForm, content: e.target.value})}
                          style={{
                            width: '100%',
                            padding: '20px',
                            fontSize: '15px',
                            lineHeight: '1.8',
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            color: '#fff',
                            outline: 'none',
                            resize: 'vertical',
                            transition: 'all 0.3s ease',
                            boxSizing: 'border-box',
                            fontFamily: 'inherit'
                          }}
                          onFocus={e => e.target.style.borderColor = 'var(--primary-color)'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        ></textarea>
                      </div>
                      
                      <div className="form-actions" style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn-secondary" onClick={() => setSongRequestView('list')} style={{ padding: '14px 28px', fontSize: '15px', borderRadius: '12px' }}>취소</button>
                        <button type="submit" className="btn-primary-glow" style={{ padding: '14px 32px', fontSize: '15px', borderRadius: '12px', fontWeight: 'bold' }}>등록하기</button>
                      </div>
                    </form>
                  </div>
                )}

                {songRequestView === 'detail' && selectedSongRequest && (
                  <div className="board-detail-container">
                    <div className="board-detail-header" style={{
                      background: 'rgba(25, 25, 35, 0.6)',
                      backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '24px',
                      padding: '30px',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                      marginBottom: '20px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ 
                            fontSize: '13px', 
                            fontWeight: '700', 
                            background: 'linear-gradient(135deg, var(--primary-color), #8a2be2)', 
                            color: '#fff', 
                            padding: '6px 14px', 
                            borderRadius: '20px',
                            display: 'inline-block',
                            marginBottom: '16px'
                          }}>✨ PRIVATE REQUEST</span>
                          <h2 style={{ fontSize: '32px', marginBottom: '16px', fontWeight: '800', background: 'linear-gradient(90deg, #fff, #a0a0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{selectedSongRequest.title}</h2>
                          <div className="detail-meta" style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><User size={14} /> {selectedSongRequest.profiles?.email?.split('@')[0] || '익명'}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14} /> {new Date(selectedSongRequest.created_at).toLocaleString()}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary-color)' }}><Lock size={14} /> 비밀글</span>
                            <span style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              background: getStatusStyle(selectedSongRequest.status || '대기중').bg,
                              color: getStatusStyle(selectedSongRequest.status || '대기중').color,
                              padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold'
                            }}>{selectedSongRequest.status || '대기중'}</span>
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                            {userProfile?.role === 'admin' && (
                              <select 
                                value={selectedSongRequest.status || '대기중'}
                                onChange={async (e) => {
                                  const newStatus = e.target.value;
                                  try {
                                    const res = await apiFetch(`${API_BASE_URL}/api/song-requests/${selectedSongRequest.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ userId: userSession?.user?.id, status: newStatus })
                                    });
                                    if (res.ok) fetchSongRequestDetail(selectedSongRequest.id);
                                  } catch (err) { console.error(err); }
                                }}
                                style={{
                                  padding: '6px 12px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', outline: 'none'
                                }}
                              >
                                <option value="대기중">대기중</option>
                                <option value="노래 만드는중">노래 만드는중</option>
                                <option value="노래 완성">노래 완성</option>
                                <option value="노래등록완료">노래등록완료</option>
                              </select>
                            )}
                            {(userSession?.user?.id === selectedSongRequest.user_id || userProfile?.role === 'admin') && (
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button 
                              onClick={() => {
                                setSongRequestForm({ title: selectedSongRequest.title, content: selectedSongRequest.content });
                                setSongRequestView('edit');
                              }}
                              style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                            >
                              수정
                            </button>
                            <button 
                              onClick={() => handleDeleteSongRequest(selectedSongRequest.id)}
                              style={{ padding: '8px 16px', background: 'rgba(255, 60, 60, 0.2)', color: '#ff6b6b', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                            >
                              삭제
                            </button>
                              </div>
                            )}
                          </div>
                      </div>
                    </div>
                    
                    <div className="board-detail-content" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                      {selectedSongRequest.content}
                    </div>

                    <div className="comments-section" style={{ marginTop: '40px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px' }}>
                      <h3 style={{ marginBottom: '20px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MessageSquare size={16} /> 1:1 대화 ({selectedSongRequest.comments?.length || 0})
                      </h3>
                      
                      <div className="comments-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                        {selectedSongRequest.comments?.length === 0 ? (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>아직 대화 내역이 없습니다.</div>
                        ) : (
                          selectedSongRequest.comments?.map(comment => {
                            const isMe = comment.user_id === userSession?.user?.id;
                            const isAdminComment = comment.profiles?.role === 'admin';
                            
                            return (
                              <div key={comment.id} style={{ 
                                display: 'flex', 
                                flexDirection: 'column',
                                alignItems: isMe ? 'flex-end' : 'flex-start'
                              }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {isAdminComment ? <ShieldCheck size={12} style={{ color: 'var(--primary-color)' }} /> : <User size={12} />}
                                  {isAdminComment ? '관리자' : (comment.profiles?.email?.split('@')[0] || '작성자')}
                                </div>
                                <div style={{
                                  background: isMe ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                  color: '#fff',
                                  padding: '12px 16px',
                                  borderRadius: '16px',
                                  borderTopRightRadius: isMe ? '4px' : '16px',
                                  borderTopLeftRadius: isMe ? '16px' : '4px',
                                  maxWidth: '80%',
                                  lineHeight: '1.5',
                                  whiteSpace: 'pre-wrap'
                                }}>
                                  {comment.content}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                  {new Date(comment.created_at).toLocaleTimeString()}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <form onSubmit={handleSongRequestCommentSubmit} style={{ display: 'flex', gap: '12px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px' }}>
                        <textarea 
                          required
                          placeholder="메시지를 입력하세요..."
                          value={songRequestComment}
                          onChange={e => setSongRequestComment(e.target.value)}
                          style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', resize: 'none', height: '40px', outline: 'none' }}
                        ></textarea>
                        <button type="submit" className="btn-primary-glow" style={{ padding: '0 24px', borderRadius: '24px' }}>전송</button>
                      </form>
                    </div>

                    <div className="board-detail-actions" style={{ marginTop: '24px' }}>
                      <button className="btn-secondary" onClick={() => setSongRequestView('list')}>목록으로</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 자유게시판(Board) 화면 */}
            {currentView === 'board' && (
              <div className="board-container">
                {boardView === 'list' && (
                  <>
                    <div className="hero-banner board-hero" style={{ background: 'linear-gradient(135deg, rgba(80, 50, 150, 0.3) 0%, rgba(15, 15, 25, 0.4) 100%)' }}>
                      <div className="hero-content">
                        <span className="hero-tag">Community</span>
                        <h1 className="hero-title">자유게시판</h1>
                        <p className="hero-desc">자유롭게 음악 이야기나 일상을 나누어 보세요!</p>
                        <button 
                          className="play-btn-premium"
                          onClick={() => {
                            if (!requireLogin()) return;
                            setBoardTitle('');
                            setBoardContent('');
                            setBoardAuthor('');
                            setBoardView('write');
                          }}
                        >
                          <Plus size={18} />
                          글쓰기
                        </button>
                      </div>
                    </div>
                    
                    <div className="section-header">
                      <h2>게시글 목록</h2>
                    </div>
                    
                    <div className="board-list">
                      <table className="board-table">
                        <thead>
                          <tr>
                            <th>번호</th>
                            <th>제목</th>
                            <th>작성자</th>
                            <th>조회수</th>
                            <th>작성일</th>
                          </tr>
                        </thead>
                        <tbody>
                          {boardPosts.map((post, idx) => (
                            <tr key={post.id} onClick={() => handleReadPost(post)}>
                              <td className="board-id">{boardPosts.length - idx}</td>
                              <td className="board-title-cell">{post.title}</td>
                              <td className="board-author">{post.author}</td>
                              <td className="board-views">{post.views}</td>
                              <td className="board-date">{new Date(post.created_at).toLocaleDateString()}</td>
                            </tr>
                          ))}
                          {boardPosts.length === 0 && (
                            <tr>
                              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>등록된 게시글이 없습니다.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {(boardView === 'write' || boardView === 'edit') && (
                  <div className="board-write admin-card" style={{ maxWidth: '800px', margin: '0 auto' }}>
                    <h2 style={{ marginBottom: '24px' }}>{boardView === 'edit' ? '게시글 수정' : '게시글 작성'}</h2>
                    <form onSubmit={handleBoardSubmit}>
                      <div className="form-group">
                        <label>제목 *</label>
                        <input className="form-control" value={boardTitle} onChange={e => setBoardTitle(e.target.value)} required placeholder="제목을 입력하세요" />
                      </div>
                      <div className="form-group">
                        <label>작성자 (닉네임) *</label>
                        <input className="form-control" value={boardAuthor} onChange={e => setBoardAuthor(e.target.value)} required placeholder="닉네임" />
                      </div>
                      <div className="form-group">
                        <label>내용 *</label>
                        <textarea className="form-control board-textarea" style={{ minHeight: '300px', resize: 'vertical' }} value={boardContent} onChange={e => setBoardContent(e.target.value)} required placeholder="내용을 입력하세요" />
                      </div>
                      <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn-secondary" onClick={() => setBoardView('list')}>취소</button>
                        <button type="submit" className="btn-primary-glow">{boardView === 'edit' ? '수정 완료' : '등록하기'}</button>
                      </div>
                    </form>
                  </div>
                )}

                {boardView === 'read' && activePost && (
                  <div className="board-read admin-card" style={{ maxWidth: '900px', margin: '0 auto', padding: '40px' }}>
                    <div className="board-read-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '24px', marginBottom: '32px' }}>
                      <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>{activePost.title}</h2>
                      <div className="board-read-meta" style={{ display: 'flex', gap: '20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><User size={16}/> {activePost.author}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={16}/> {new Date(activePost.created_at).toLocaleString()}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Eye size={16}/> 조회수 {activePost.views}</span>
                      </div>
                    </div>
                    <div className="board-read-body" style={{ fontSize: '16px', lineHeight: '1.8', minHeight: '200px', whiteSpace: 'pre-wrap', marginBottom: '40px' }}>
                      {activePost.content}
                    </div>
                    
                    <div className="board-read-actions" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
                      <button className="btn-secondary" onClick={() => { setBoardView('list'); fetchBoardPosts(); }}>목록으로</button>
                      {activePost.can_manage && (
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button className="btn-secondary" onClick={handleEditPostClick}><Edit2 size={16}/> 수정</button>
                          <button className="btn-secondary" style={{ color: '#ff6b6b' }} onClick={() => handleDeletePost(activePost.id)}><Trash2 size={16}/> 삭제</button>
                        </div>
                      )}
                    </div>

                    <div className="board-comments" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '32px' }}>
                      <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><MessageCircle size={20}/> 댓글 {boardComments.length}개</h3>
                      
                      <div className="comments-list" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {boardComments.map(comment => (
                          <div className="comment-item" key={comment.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px' }}>
                            <div className="comment-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span className="comment-author" style={{ fontWeight: 'bold' }}>{comment.author}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span className="comment-date" style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{new Date(comment.created_at).toLocaleString()}</span>
                                <button className="icon-btn" style={{ padding: '4px' }} onClick={() => handleDeleteComment(comment.id)} title="댓글 삭제"><Trash2 size={14}/></button>
                              </div>
                            </div>
                            <div className="comment-body" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{comment.content}</div>
                          </div>
                        ))}
                        {boardComments.length === 0 && (
                          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>첫 댓글을 남겨보세요!</div>
                        )}
                      </div>

                      <form className="comment-form" onSubmit={handleCommentSubmit} style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px' }}>
                        <div className="comment-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <input className="form-control" value={commentAuthor} onChange={e => setCommentAuthor(e.target.value)} required placeholder="닉네임" />
                          <input type="password" className="form-control" value={commentPassword} onChange={e => setCommentPassword(e.target.value)} required placeholder="비밀번호" />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <input className="form-control" value={commentContent} onChange={e => setCommentContent(e.target.value)} required placeholder="댓글을 남겨보세요..." style={{ flex: 1 }} />
                          <button type="submit" className="btn-primary-glow" style={{ padding: '0 24px', whiteSpace: 'nowrap' }}>등록</button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <LiveChatPanel
        key={userSession?.user?.id || 'guest'}
        id="musicdrive-live-chat"
        isOpen={isLiveChatOpen}
        onClose={() => setIsLiveChatOpen(false)}
        session={userSession}
        onLoginRequest={handleGoogleLogin}
      />

      <LoginNoticeModal notice={loginNotice} onClose={closeLoginNotice} />

      {/* Floating Bottom Music Player */}
      <footer 
        className="bottom-player"
        style={{
          backgroundImage: activeSong ? `linear-gradient(rgba(10, 10, 15, 0.85), rgba(10, 10, 15, 0.85)), url(${activeSong.cover_url})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        
        {/* Left Section: Playing Track Info */}
        <div className="player-song-info" onClick={openFullscreenPlayer}>
          {activeSong ? (
            <>
              <img className="player-img" src={activeSong.cover_url} alt={activeSong.title} />
              <div className="player-details">
                <div className="player-title">{activeSong.title}</div>
                <div className="player-artist">{activeSong.artist}</div>
              </div>
              <button 
                className={`icon-btn ${likedSongIds.includes(activeSong.id) ? 'liked' : ''}`}
                onClick={(e) => toggleLike(e, activeSong.id)}
              >
                <Heart size={16} fill={likedSongIds.includes(activeSong.id) ? "currentColor" : "none"} />
              </button>
              <button 
                className="icon-btn expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  openFullscreenPlayer();
                }}
                title="플레이어 크게 보기"
                style={{ marginLeft: '12px' }}
              >
                <Maximize2 size={16} />
              </button>
            </>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              재생 중인 곡이 없습니다.
            </div>
          )}
        </div>

        {/* Center Section: Core Controls & Tracker */}
        <div className="player-controls-container">
          <div className="controls-row">
            <button 
              className={`control-btn shuffle-btn ${isShuffled ? 'active' : ''}`}
              onClick={() => setIsShuffled(!isShuffled)}
              title="셔플"
            >
              <Shuffle size={16} />
            </button>
            <button className="control-btn prev-btn" onClick={handlePrevSong} title="이전 곡">
              <SkipBack size={20} />
            </button>
            <button className="play-pause-btn" onClick={handlePlayPause} aria-label={isPlaying ? '일시정지' : '재생'}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="control-btn next-btn" onClick={handleNextSong} title="다음 곡">
              <SkipForward size={20} />
            </button>
            <div className="sleep-timer-container mobile-sleep-timer-container">
              <button
                className={`control-btn sleep-timer-btn ${sleepTimerMinutes !== null ? 'active' : ''}`}
                onClick={() => setIsSleepPopoverOpen(!isSleepPopoverOpen)}
                title="자동 종료 설정"
                aria-label="자동 종료 타이머 설정"
              >
                <Clock size={18} />
                {sleepTimerMinutes !== null && (
                  <span className="sleep-badge">{formatSleepTime(sleepTimeLeft)}</span>
                )}
              </button>

              {isSleepPopoverOpen && (
                <div className="sleep-timer-popover">
                  <div className="popover-title">자동 종료 설정</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(10)}>10분 뒤</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(30)}>30분 뒤</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(60)}>1시간 뒤</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(120)}>2시간 뒤</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(180)}>3시간 뒤</div>
                  <div className="popover-item" onClick={() => handleSetSleepTimer(240)}>4시간 뒤</div>
                  <div className="popover-divider"></div>
                  <div className="popover-item disable" onClick={() => handleSetSleepTimer(null)}>설정 안 함</div>
                </div>
              )}
            </div>
            <button 
              className={`control-btn repeat-btn ${isLooping ? 'active' : ''}`}
              onClick={() => setIsLooping(!isLooping)}
              title="반복"
            >
              <Repeat size={16} />
            </button>
          </div>

          <div className="progress-row">
            <span>{formatTime(currentTime)}</span>
            <div className="progress-track-bg" onClick={handleSeek}>
              <div 
                className="progress-track-fill" 
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              ></div>
              <div 
                className="progress-thumb"
                style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              ></div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right Section: Volume & Lyrics Trigger */}
        <div className="player-extras">
          <button 
            className={`control-btn ${isLyricsOpen ? 'active' : ''}`}
            onClick={() => setIsLyricsOpen(!isLyricsOpen)}
            title="가사 보기"
            disabled={!activeSong || !activeSong.lyrics}
          >
            <BookOpen size={18} />
          </button>

          <div className="sleep-timer-container" style={{ position: 'relative' }}>
            <button 
              className={`control-btn sleep-timer-btn ${sleepTimerMinutes !== null ? 'active' : ''}`}
              onClick={() => setIsSleepPopoverOpen(!isSleepPopoverOpen)}
              title="자동 종료 설정"
            >
              <Clock size={18} />
              {sleepTimerMinutes !== null && (
                <span className="sleep-badge">{formatSleepTime(sleepTimeLeft)}</span>
              )}
            </button>
            
            {isSleepPopoverOpen && (
              <div className="sleep-timer-popover">
                <div className="popover-title">자동 종료 설정</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(10)}>10분 뒤</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(30)}>30분 뒤</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(60)}>1시간 뒤</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(120)}>2시간 뒤</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(180)}>3시간 뒤</div>
                <div className="popover-item" onClick={() => handleSetSleepTimer(240)}>4시간 뒤</div>
                <div className="popover-divider"></div>
                <div className="popover-item disable" onClick={() => handleSetSleepTimer(null)}>설정 안 함</div>
              </div>
            )}
          </div>

          <div className="volume-container">
            <button className="icon-btn" onClick={() => setIsMuted(!isMuted)}>
              {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <div className="volume-track" onClick={handleVolumeSeek}>
              <div className="volume-fill" style={{ width: `${isMuted ? 0 : volume * 100}%` }}></div>
            </div>
          </div>
        </div>
      </footer>

      {/* Lyrics Slide-out Drawer */}
      <div className={`lyrics-drawer ${isLyricsOpen && activeSong && activeSong.lyrics ? 'open' : ''} ${isSyncEditing ? 'sync-editing' : ''}`}>
        <div className="lyrics-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
            <h3>가사</h3>
            {!isSyncEditing && (
              <button 
                type="button" 
                className="sync-edit-trigger-btn"
                onClick={() => {
                  if (isAdminAuthenticated) {
                    startSyncEditing();
                  } else {
                    const pass = window.prompt("가사 싱크를 편집하려면 관리자 비밀번호를 입력하세요:");
                    if (pass === null) return; // 취소
                    verifyAdminForSync(pass);
                  }
                }}
              >
                ⏱️ 싱크 맞추기 (관리자)
              </button>
            )}
            {isSyncEditing && (
              <span className="sync-badge-recording">🔴 싱크 녹음 중</span>
            )}
          </div>
          <button className="icon-btn" onClick={() => { setIsLyricsOpen(false); if (isSyncEditing) cancelSyncEditing(); }}>
            <X size={20} />
          </button>
        </div>
        
        {isSyncEditing ? (
          <div className="lyrics-body sync-edit-body">
            <div className="sync-editor-container">
              <p className="highlight-hint">노래를 들으며 각 가사 타이밍에 맞춰 아래 <strong>기록</strong> 버튼이나 <strong>스페이스바</strong>를 누르세요.</p>
              <div className="sync-timer">{formatTime(currentTime)} / {formatTime(duration)}</div>
              
              <div className="sync-lines-list">
                {activeSong.lyrics.split('\n')
                  .map(line => {
                    const trimmed = line.trim();
                    const lrcRegex = /^\[\d{2}:\d{2}(?:\.\d{2,3})?\](.*)/;
                    const match = trimmed.match(lrcRegex);
                    return match ? match[1].trim() : trimmed;
                  })
                  .filter(line => line !== '')
                  .map((lineText, idx) => {
                    let statusClass = '';
                    if (idx < syncIndex) statusClass = 'recorded';
                    else if (idx === syncIndex) statusClass = 'current';
                    
                    const timeRecord = recordedTimes[idx];
                    const timeStr = timeRecord !== null && timeRecord !== undefined
                      ? `[${formatTime(timeRecord)}]`
                      : '';
                      
                    return (
                      <div className={`sync-edit-line ${statusClass}`} key={idx} onClick={() => setSyncIndex(idx)}>
                        <span className="line-num">{idx + 1}</span>
                        <span className="line-text">{lineText}</span>
                        <span className="line-time">{timeStr}</span>
                      </div>
                    );
                  })
                }
              </div>
              
              <div className="sync-editor-actions">
                <button 
                  type="button" 
                  className="btn-sync-record"
                  onClick={recordSyncTimestamp}
                  disabled={syncIndex >= recordedTimes.length}
                >
                  {syncIndex >= recordedTimes.length ? '기록 완료' : '⏱️ 타이밍 기록 (Space)'}
                </button>
                <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                  <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={cancelSyncEditing}>취소</button>
                  <button type="button" className="btn-primary-glow" style={{ flex: 1 }} onClick={saveSyncedLyrics}>저장</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="lyrics-body" ref={lyricsBodyRef}>
            {activeSong && activeSong.lyrics ? (
              displayedLyrics.length > 0 ? (
                displayedLyrics.map((line) => (
                  <div 
                    className={`lyrics-line ${line.absIdx === currentLyricIndex ? 'active' : ''} clickable`} 
                    key={line.absIdx}
                    onClick={() => {
                      if (line.time !== null) {
                        audioRef.current.currentTime = line.time;
                        setCurrentTime(line.time);
                      }
                    }}
                  >
                    {line.text}
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>가사가 등록되어 있지 않습니다.</div>
              )
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>가사가 등록되어 있지 않습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* Playlist Song Picker Modal */}
      {playlistTargetSong && (
        <div className="modal-overlay" onClick={() => setPlaylistTargetSong(null)}>
          <div className="modal-content playlist-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>플레이리스트에 추가</h3>
                <p className="playlist-picker-song">{playlistTargetSong.title} · {playlistTargetSong.artist}</p>
              </div>
              <button className="icon-btn" onClick={() => setPlaylistTargetSong(null)} aria-label="닫기">
                <X size={20} />
              </button>
            </div>
            <div className="playlist-picker-list">
              {playlists.map((playlist) => (
                <button
                  type="button"
                  className="playlist-choice-button"
                  key={playlist.id}
                  onClick={() => addSongToPlaylist(playlist.id, playlistTargetSong.id)}
                >
                  <FolderHeart size={20} />
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>{playlist.description || '설명 없음'}</small>
                  </span>
                  <Plus size={18} />
                </button>
              ))}
              {playlists.length === 0 && (
                <div className="playlist-picker-empty">
                  <p>아직 플레이리스트가 없습니다.</p>
                  <button
                    type="button"
                    className="btn-primary-glow"
                    onClick={() => {
                      setPlaylistTargetSong(null);
                      setIsPlaylistModalOpen(true);
                    }}
                  >
                    새 플레이리스트 만들기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Playlist Creation Modal */}
      {isPlaylistModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>신규 플레이리스트 생성</h3>
              <button className="icon-btn" onClick={() => setIsPlaylistModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePlaylist}>
              <div className="form-group">
                <label>이름 *</label>
                <input 
                  className="form-control" 
                  placeholder="플레이리스트 이름을 입력하세요"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>설명</label>
                <textarea 
                  className="form-control" 
                  placeholder="플레이리스트 설명을 입력해 주세요"
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  style={{ minHeight: '80px', resize: 'vertical' }}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setIsPlaylistModalOpen(false)}>취소</button>
                <button type="submit" className="btn-primary-glow">생성</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Playlist Delete Confirmation Modal */}
      {playlistPendingDelete && (
        <div
          className="modal-overlay"
          onClick={() => { if (!isDeletingPlaylist) setPlaylistPendingDelete(null); }}
        >
          <div className="modal-content playlist-delete-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="playlist-delete-icon"><Trash2 size={24} /></div>
            <h3>플레이리스트를 삭제할까요?</h3>
            <p>
              <strong>{playlistPendingDelete.name}</strong> 플레이리스트가 삭제됩니다.
              <br />플레이리스트 안의 원본 음원은 삭제되지 않습니다.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={isDeletingPlaylist}
                onClick={() => setPlaylistPendingDelete(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="playlist-delete-confirm-button"
                disabled={isDeletingPlaylist}
                onClick={handleDeletePlaylist}
              >
                {isDeletingPlaylist ? '삭제 중...' : '삭제하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Song Modal */}
      {isEditModalOpen && editingSong && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
            <div className="modal-header">
              <h3>음원 정보 수정</h3>
              <button className="icon-btn" onClick={() => { setIsEditModalOpen(false); setEditingSong(null); }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="form-group">
                <label>곡 제목 *</label>
                <input 
                  className="form-control" 
                  placeholder="곡 제목을 입력하세요"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label>아티스트 *</label>
                <input 
                  className="form-control" 
                  placeholder="아티스트명 또는 작곡가명을 입력하세요"
                  value={editArtist}
                  onChange={(e) => setEditArtist(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label>장르 카테고리</label>
                <select 
                  className="form-control"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                >
                  {categories.filter(c => c !== '전체').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label>가사</label>
                <textarea 
                  className="form-control" 
                  style={{ minHeight: '120px', resize: 'vertical' }}
                  placeholder="가사를 입력해 주세요. (예: [00:15.20] 동해물과 백두산이 [00:20.00] 마르고 닳도록...)\n* 시간 정보를 입력하지 않으면 전체 재생 시간에 맞춰 가사가 자동 스크롤됩니다."
                  value={editLyrics}
                  onChange={(e) => setEditLyrics(e.target.value)}
                />
              </div>
              
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>앨범 아트 / 이미지 변경 (기존 이미지 유지하려면 비워두세요)</label>
                <div className="file-upload-box" onClick={() => document.getElementById('edit-cover-input').click()}>
                  <UploadCloud className="icon" />
                  <span style={{ fontSize: '13px' }}>
                    {editCoverFile ? editCoverFile.name : '새로운 앨범 아트 선택 (선택 사항)'}
                  </span>
                  <input 
                    type="file" 
                    id="edit-cover-input" 
                    accept="image/*" 
                    style={{ display: 'none' }}
                    onChange={(e) => setEditCoverFile(e.target.files[0])}
                  />
                </div>
              </div>
              
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => { setIsEditModalOpen(false); setEditingSong(null); }}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary-glow"
                  disabled={isUpdatingSong}
                >
                  {isUpdatingSong ? '수정 중...' : '저장하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Password Verification Modal */}
      {isAuthModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>관리자 인증</h3>
              <button className="icon-btn" onClick={() => { setIsAuthModalOpen(false); setPendingEditSong(null); }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
              음원을 수정하려면 관리자 비밀번호를 입력해 주세요.
            </p>
            <form onSubmit={handleAuthModalSubmit}>
              <div className="form-group">
                <label>비밀번호</label>
                <input 
                  type="password" 
                  className="form-control" 
                  placeholder="비밀번호 입력"
                  value={authPasswordInput}
                  onChange={(e) => setAuthPasswordInput(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => { setIsAuthModalOpen(false); setPendingEditSong(null); }}
                >
                  취소
                </button>
                <button type="submit" className="btn-primary-glow">인증 및 수정</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit VS Match Modal */}
      {isVsEditModalOpen && editingVsMatch && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
            <div className="modal-header">
              <h3>곡 대결 수정</h3>
              <button className="icon-btn" onClick={() => { setIsVsEditModalOpen(false); setEditingVsMatch(null); }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleVsEditSubmit}>
              <div className="form-group">
                <label>대결 제목 *</label>
                <input 
                  className="form-control" 
                  placeholder="대결 제목을 입력하세요"
                  value={vsEditTitle}
                  onChange={(e) => setVsEditTitle(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>곡 A 선택 *</label>
                  <select 
                    className="form-control"
                    value={vsEditSongAId}
                    onChange={(e) => setVsEditSongAId(e.target.value)}
                    required
                  >
                    <option value="">곡을 선택해 주세요</option>
                    {songs.map(song => (
                      <option key={song.id} value={song.id}>{song.title} ({song.artist})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>곡 B 선택 *</label>
                  <select 
                    className="form-control"
                    value={vsEditSongBId}
                    onChange={(e) => setVsEditSongBId(e.target.value)}
                    required
                  >
                    <option value="">곡을 선택해 주세요</option>
                    {songs.map(song => (
                      <option key={song.id} value={song.id}>{song.title} ({song.artist})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: '24px' }}>
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => { setIsVsEditModalOpen(false); setEditingVsMatch(null); }}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary-glow"
                  disabled={isUpdatingVS}
                >
                  {isUpdatingVS ? '수정 중...' : '수정하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. 프리미엄 지니 스타일 전체 화면 플레이어 모달 오버레이 */}
      {isFullscreenPlayerOpen && activeSong && (
        <div className={`fullscreen-player-overlay ${isFullscreenClosing ? 'closing' : ''}`}>
          {/* 동적 앰비언트 블러 배경 */}
          <div 
            className="fs-bg-ambient" 
            style={{ backgroundImage: `url(${activeSong.cover_url})` }}
          ></div>
          <div className="fs-bg-overlay"></div>

          <div className="fs-container">
            {/* A. 헤더 영역 */}
            <header className="fs-header">
              <button className="fs-close-btn" onClick={closeFullscreenPlayer} title="플레이어 닫기">
                <ChevronDown size={28} />
              </button>
              <div className="fs-header-title">
                <span>Now Playing</span>
              </div>
              <button 
                className="fs-option-btn" 
                onClick={() => setIsPlaylistDrawerOpen(!isPlaylistDrawerOpen)}
                title="재생목록 열기"
              >
                <ListMusic size={24} />
              </button>
            </header>

            {/* B. 메인 콘텐츠 영역 (커버 뷰 / 가사 뷰) */}
            <div className="fs-content">
              {fullscreenTab === 'cover' ? (
                <div className="fs-cover-view" onClick={() => setFullscreenTab('lyrics')}>
                  <div className="fs-cover-wrap">
                    <img className="fs-cover-img" src={activeSong.cover_url} alt={activeSong.title} />
                  </div>
                  {/* 지니 스타일 2줄 실시간 가사 */}
                  <div className="fs-lyrics-preview">
                    {parsedLyrics[currentLyricIndex] ? (
                      <>
                        <p className="fs-lyrics-active">{parsedLyrics[currentLyricIndex].text}</p>
                        <p className="fs-lyrics-next">
                          {parsedLyrics[currentLyricIndex + 1] ? parsedLyrics[currentLyricIndex + 1].text : ''}
                        </p>
                      </>
                    ) : (
                      <p className="fs-lyrics-placeholder">가사 데이터가 없습니다.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="fs-lyrics-view">
                  <div className="fs-lyrics-header-tabs">
                    <button className="fs-tab-btn" onClick={() => setFullscreenTab('cover')}>
                      앨범 커버 보기
                    </button>
                    {isAdminAuthenticated && !isSyncEditing && (
                      <button 
                        className="fs-sync-edit-btn"
                        onClick={() => {
                          closeFullscreenPlayer();
                          setIsLyricsOpen(true);
                          startSyncEditing();
                        }}
                      >
                        ⏱️ 실시간 가사 싱크 편집
                      </button>
                    )}
                  </div>
                  <div className="fs-lyrics-list" ref={mobileLyricsListRef}>
                    {parsedLyrics.length > 0 ? (
                      parsedLyrics.map((line, idx) => (
                        <div 
                          key={idx}
                          className={`fs-lyric-line ${idx === currentLyricIndex ? 'active' : ''}`}
                          onClick={() => {
                            if (line.time !== null) {
                              audioRef.current.currentTime = line.time;
                              setCurrentTime(line.time);
                            }
                          }}
                        >
                          {line.text}
                        </div>
                      ))
                    ) : (
                      <div className="fs-no-lyrics">등록된 가사가 없습니다.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* C. 하단 컨트롤 세션 */}
            <div className="fs-control-session">
              {/* 곡명 및 아티스트, 좋아요 */}
              <div className="fs-song-info">
                <div className="fs-details">
                  <h1 className="fs-title">{activeSong.title}</h1>
                  <p className="fs-artist">{activeSong.artist}</p>
                </div>
                <button 
                  className={`fs-like-btn ${likedSongIds.includes(activeSong.id) ? 'liked' : ''}`}
                  onClick={(e) => toggleLike(e, activeSong.id)}
                >
                  <Heart size={24} fill={likedSongIds.includes(activeSong.id) ? "currentColor" : "none"} />
                </button>
              </div>

              {/* 진행 슬라이더 */}
              <div className="fs-progress-row">
                <span className="fs-progress-time">{formatTime(currentTime)}</span>
                <div className="fs-progress-track-bg" onClick={handleSeek}>
                  <div 
                    className="fs-progress-track-fill" 
                    style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  ></div>
                  <div 
                    className="fs-progress-thumb"
                    style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="fs-progress-time">{formatTime(duration)}</span>
              </div>

              {/* 재생/일시정지, 이전/다음 곡, 루프, 셔플 */}
              <div className="fs-controls">
                <button 
                  className={`fs-control-btn ${isShuffled ? 'active' : ''}`}
                  onClick={() => setIsShuffled(!isShuffled)}
                  title="셔플 재생"
                >
                  <Shuffle size={20} />
                </button>
                <button className="fs-control-btn" onClick={handlePrevSong} title="이전 곡 재생">
                  <SkipBack size={26} />
                </button>
                <button className="fs-play-pause-btn" onClick={handlePlayPause} title={isPlaying ? '일시정지' : '재생'}>
                  {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: '4px' }} />}
                </button>
                <button className="fs-control-btn" onClick={handleNextSong} title="다음 곡 재생">
                  <SkipForward size={26} />
                </button>
                <button 
                  className={`fs-control-btn ${isLooping ? 'active' : ''}`}
                  onClick={() => setIsLooping(!isLooping)}
                  title="반복 재생"
                >
                  <Repeat size={20} />
                </button>
              </div>

              {/* 하단 서브바 (재생목록 토글, 가사 토글, 볼륨 조절) */}
              <div className="fs-bottom-bar">
                <button 
                  className={`fs-bottom-btn ${isPlaylistDrawerOpen ? 'active' : ''}`}
                  onClick={() => setIsPlaylistDrawerOpen(!isPlaylistDrawerOpen)}
                >
                  <ListMusic size={22} />
                  <span>재생대기열</span>
                </button>
                <button 
                  className={`fs-bottom-btn ${fullscreenTab === 'lyrics' ? 'active' : ''}`}
                  onClick={() => setFullscreenTab(fullscreenTab === 'lyrics' ? 'cover' : 'lyrics')}
                >
                  <BookOpen size={22} />
                  <span>전체 가사</span>
                </button>
                <div className="fs-volume-control">
                  <button className="fs-volume-icon" onClick={() => setIsMuted(!isMuted)}>
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="fs-volume-track" onClick={handleVolumeSeek}>
                    <div 
                      className="fs-volume-fill" 
                      style={{ width: `${isMuted ? 0 : volume * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* D. 내부 슬라이드 업 재생 대기열 드로어 */}
          {isPlaylistDrawerOpen && (
            <div className="fs-queue-drawer">
              <div className="fs-queue-header">
                <h4>현재 재생 대기열 ({queue.length}곡)</h4>
                <button className="fs-queue-close" onClick={() => setIsPlaylistDrawerOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="fs-queue-list">
                {queue.map((song, idx) => (
                  <div 
                    key={`${song.id}-${idx}`}
                    className={`fs-queue-item ${song.id === activeSong.id ? 'active' : ''}`}
                    onClick={() => {
                      setQueueIndex(idx);
                      setActiveSong(song);
                      setIsPlaying(true);
                      incrementPlayCount(song.id);
                    }}
                  >
                    <span className="fs-qi-index">{idx + 1}</span>
                    <img className="fs-qi-img" src={song.cover_url} alt={song.title} />
                    <div className="fs-qi-details">
                      <div className="fs-qi-title">{song.title}</div>
                      <div className="fs-qi-artist">{song.artist}</div>
                    </div>
                    {song.id === activeSong.id && isPlaying && (
                      <div className="fs-playing-wave">
                        <span></span><span></span><span></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Routes, Route } from 'react-router-dom';
import AdminPage from './components/AdminPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}

export default App;
