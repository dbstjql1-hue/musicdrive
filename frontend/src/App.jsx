import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Home,
  Search,
  Music,
  PlusCircle,
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
  Menu,
  ChevronDown,
  Maximize2,
  MessageSquare,
  MessageCircle,
  Eye,
  User
} from 'lucide-react';
import { PoemAnimation } from './components/ui/3d-animation';
import './App.css';
import mascotImg from './assets/mascot.png';

// API Base URL (Vercel 배포 시 환경 변수 설정 권장)
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

// 브라우저 로컬 저장소 세션 ID 로드 또는 생성 (좋아요 중복 방지용)
let sessionId = localStorage.getItem('musicdrive_session_id');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  localStorage.setItem('musicdrive_session_id', sessionId);
}

function App() {
  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home', 'search', 'playlists', 'admin'
  const [selectedPlaylist, setSelectedPlaylist] = useState(null); // 특정 플레이리스트 선택 시 저장
  const [showIntro, setShowIntro] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Data State
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [likedSongIds, setLikedSongIds] = useState([]);
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
  
  // Fullscreen Modal Player States
  const [isFullscreenPlayerOpen, setIsFullscreenPlayerOpen] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState('cover'); // 'cover' or 'lyrics'
  const [isPlaylistDrawerOpen, setIsPlaylistDrawerOpen] = useState(false);
  const [isFullscreenClosing, setIsFullscreenClosing] = useState(false);
  
  // Playlist Modal State
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  
  // Popover State (플레이리스트 추가 팝업)
  const [activePopoverSongId, setActivePopoverSongId] = useState(null);

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
  const [boardPassword, setBoardPassword] = useState('');
  const [boardContent, setBoardContent] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentPassword, setCommentPassword] = useState('');
  const [commentContent, setCommentContent] = useState('');
  
  // Toast UI
  const [toastMessage, setToastMessage] = useState('');
  
  // HTML Audio Ref
  const audioRef = useRef(new Audio());
  const lyricsBodyRef = useRef(null);
  const sleepPopoverRef = useRef(null);
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



  // 외부 클릭 시 자동 종료 타이머 팝오버 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sleepPopoverRef.current && !sleepPopoverRef.current.contains(e.target)) {
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
      const res = await fetch(`${API_BASE_URL}/api/songs/${activeSong.id}`, {
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
      const res = await fetch(`${API_BASE_URL}/api/admin/verify`, {
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
    fetchSongs();
    fetchPlaylists();
    fetchLikedSongs();
    fetchVSMatches();
    fetchBoardPosts();
  }, []);

  async function fetchBoardPosts() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/board`);
      if (res.ok) {
        const data = await res.json();
        setBoardPosts(data);
      }
    } catch (err) {
      console.error('게시글 가져오기 오류:', err);
    }
  }

  async function fetchVSMatches() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/vs-matches?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setVsMatches(data);
      }
    } catch (err) {
      console.error('VS 대결 가져오기 오류:', err);
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
      const res = await fetch(`${API_BASE_URL}/api/vs-matches`, {
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
    try {
      const res = await fetch(`${API_BASE_URL}/api/vs-matches/${matchId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ songId, sessionId })
      });

      if (res.ok) {
        showToast('투표가 반영되었습니다!');
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
      const res = await fetch(`${API_BASE_URL}/api/vs-matches/${matchId}`, {
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
      const res = await fetch(`${API_BASE_URL}/api/vs-matches/${editingVsMatch.id}`, {
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
    try {
      let url = `${API_BASE_URL}/api/songs`;
      const params = [];
      if (query) params.push(`query=${encodeURIComponent(query)}`);
      if (category && category !== '전체') params.push(`category=${encodeURIComponent(category)}`);
      if (params.length > 0) url += `?${params.join('&')}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSongs(data);
      }
    } catch (err) {
      console.error('음원 가져오기 오류:', err);
    }
  }

  // --- Board Handlers ---
  const handleBoardSubmit = async (e) => {
    e.preventDefault();
    if (!boardTitle || !boardContent || !boardAuthor || !boardPassword) {
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

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: boardTitle,
          content: boardContent,
          author: boardAuthor,
          password: boardPassword
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
      const res = await fetch(`${API_BASE_URL}/api/board/${post.id}`);
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
    const pwd = window.prompt("게시글 비밀번호를 입력하세요:");
    if (!pwd) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/board/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok) {
        showToast('게시글이 삭제되었습니다.');
        setBoardView('list');
        fetchBoardPosts();
      } else {
        const data = await res.json();
        showToast(data.error || '비밀번호가 일치하지 않습니다.');
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
    setBoardPassword('');
    setBoardView('edit');
  };

  async function fetchBoardComments(postId) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/board/${postId}/comments`);
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
      const res = await fetch(`${API_BASE_URL}/api/board/${activePost.id}/comments`, {
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
      const res = await fetch(`${API_BASE_URL}/api/board/comments/${commentId}`, {
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
    try {
      const res = await fetch(`${API_BASE_URL}/api/playlists`);
      if (res.ok) {
        const data = await res.json();
        setPlaylists(data);
      }
    } catch (err) {
      console.error('플레이리스트 가져오기 오류:', err);
    }
  };

  async function fetchLikedSongs() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/songs/liked/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setLikedSongIds(data);
      }
    } catch (err) {
      console.error('좋아요 목록 가져오기 오류:', err);
    }
  };

  // 카테고리 또는 검색 쿼리가 변경되면 음원을 다시 로드
  useEffect(() => {
    fetchSongs(searchQuery, selectedCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
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
      fetch(`${API_BASE_URL}/api/songs/${songId}/play`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  }, []);

  // 3. 재생기 제어 함수들
  const playSingleSong = (song) => {
    // 큐를 현재 보여지는 곡 목록으로 업데이트하고 현재 곡을 큐에 설정
    const index = songs.findIndex(s => s.id === song.id);
    setQueue(songs);
    setQueueIndex(index);
    setActiveSong(song);
    setIsPlaying(true);
    incrementPlayCount(song.id);
  };

  const playRandomSong = () => {
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
    if (!activeSong && songs.length > 0) {
      playSingleSong(songs[0]);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleNextSong = useCallback(() => {
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

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isLooping, handleNextSong]);

  const toggleLike = async (e, songId) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE_URL}/api/songs/${songId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
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
      const res = await fetch(`${API_BASE_URL}/api/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlaylistName, description: newPlaylistDesc })
      });
      if (res.ok) {
        showToast(`플레이리스트 '${newPlaylistName}'이(가) 생성되었습니다.`);
        setNewPlaylistName('');
        setNewPlaylistDesc('');
        setIsPlaylistModalOpen(false);
        fetchPlaylists();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectPlaylistToView = async (playlist) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/playlists/${playlist.id}/songs`);
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
      const res = await fetch(`${API_BASE_URL}/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('플레이리스트에 곡이 추가되었습니다.');
      } else {
        showToast(data.error || '추가할 수 없습니다.');
      }
      setActivePopoverSongId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const removeSongFromPlaylist = async (e, playlistId, songId) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE_URL}/api/playlists/${playlistId}/songs/${songId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('플레이리스트에서 곡을 제거했습니다.');
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

  // 6. 어드민 음원 업로드 처리
  const handleAdminAuth = async (e) => {
    e.preventDefault();
    if (!adminPassword) {
      showToast('비밀번호를 입력하세요.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminPassword })
      });
      
      const data = await res.json();
      if (res.ok) {
        setIsAdminAuthenticated(true);
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
      const res = await fetch(`${API_BASE_URL}/api/songs`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        showToast('새 음원이 성공적으로 등록되었습니다!');
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
      const res = await fetch(`${API_BASE_URL}/api/admin/verify`, {
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
      const res = await fetch(`${API_BASE_URL}/api/songs/${editingSong.id}`, {
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
      const res = await fetch(`${API_BASE_URL}/api/songs/${song.id}`, {
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
              className={`nav-item ${currentView === 'admin' ? 'active' : ''}`}
              onClick={() => { setCurrentView('admin'); setSelectedPlaylist(null); closeMobileMenu(); }}
            >
              <PlusCircle className="icon" />
              <span>음원 업로드</span>
            </div>
          </li>
        </ul>
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
                        className="icon-btn edit-btn" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(song);
                        }}
                        title="음원 수정"
                      >
                        <Edit2 size={16} />
                      </button>
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
                  <div className="hero-mascot-bg" style={{ backgroundImage: `url(${mascotImg})` }}></div>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePopoverSongId(activePopoverSongId === song.id ? null : song.id);
                          }}
                          title="플레이리스트에 추가"
                        >
                          <FolderPlus size={16} />
                        </button>

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
                        {isAdminAuthenticated && (
                          <button 
                            className="icon-btn delete-btn" 
                            onClick={(e) => handleDeleteSong(e, song)}
                            title="음원 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}

                        {/* 플레이리스트 추가 팝오버 */}
                        {activePopoverSongId === song.id && (
                          <div className="playlist-select-popover">
                            <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--text-muted)' }}>플레이리스트 선택</div>
                            {playlists.map(pl => (
                              <div 
                                className="popover-item" 
                                key={pl.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addSongToPlaylist(pl.id, song.id);
                                }}
                              >
                                {pl.name}
                              </div>
                            ))}
                            {playlists.length === 0 && (
                              <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>플레이리스트가 없습니다.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 최근 등록 음원 그리드 */}
                <div className="section-header">
                  <h2>최신 등록 음원</h2>
                </div>
                <div className="song-grid">
                  {songs.map(song => (
                    <div className="song-card" key={song.id} onClick={() => playSingleSong(song)}>
                      <div className="card-img-container">
                        <img className="card-img" src={song.cover_url} alt={song.title} />
                        <div className="card-play-overlay">
                          <div className="play-icon-glow">
                            <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />
                          </div>
                        </div>
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
                      </div>
                      <div className="card-info">
                        <div className="card-title">{song.title}</div>
                        <div className="card-artist">{song.artist}</div>
                      </div>
                    </div>
                  ))}
                  {songs.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                      해당 카테고리에 등록된 음원이 없습니다.
                    </div>
                  )}
                </div>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePopoverSongId(activePopoverSongId === song.id ? null : song.id);
                          }}
                          title="플레이리스트에 추가"
                        >
                          <FolderPlus size={16} />
                        </button>

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
                        {isAdminAuthenticated && (
                          <button 
                            className="icon-btn delete-btn" 
                            onClick={(e) => handleDeleteSong(e, song)}
                            title="음원 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}

                        {activePopoverSongId === song.id && (
                          <div className="playlist-select-popover">
                            <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--text-muted)' }}>플레이리스트 선택</div>
                            {playlists.map(pl => (
                              <div 
                                className="popover-item" 
                                key={pl.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addSongToPlaylist(pl.id, song.id);
                                }}
                              >
                                {pl.name}
                              </div>
                            ))}
                          </div>
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
              <div>
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
                      <ListMusic className="playlist-folder-icon" />
                      <div>
                        <div className="playlist-name">{pl.name}</div>
                        <div className="playlist-desc">{pl.description || '추가된 상세 설명 없음'}</div>
                      </div>
                    </div>
                  ))}
                  {playlists.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
                      생성된 플레이리스트가 없습니다. 나만의 재생 목록을 생성하여 관리해 보세요!
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. 관리자 음원 업로드 화면 */}
            {currentView === 'admin' && (
              <div>
                {!isAdminAuthenticated ? (
                  <div className="admin-card" style={{ maxWidth: '400px' }}>
                    <h2 style={{ marginBottom: '16px', textAlign: 'center' }}>어드민 인증</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px', textAlign: 'center' }}>
                      음원을 새로 등록하고 관리하기 위해 패스워드를 입력해 주세요.
                    </p>
                    <form onSubmit={handleAdminAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group">
                        <label>비밀번호</label>
                        <input 
                          type="password" 
                          className="form-control" 
                          placeholder="어드민 비밀번호 입력"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn-primary-glow">인증하기</button>
                    </form>
                  </div>
                ) : (
                  <>
                    <div className="admin-card">
                    <h2 style={{ marginBottom: '24px', textAlign: 'left' }}>음원 신규 등록</h2>
                    <form onSubmit={handleUploadSubmit}>
                      <div className="form-group">
                        <label>곡 제목 *</label>
                        <input 
                          className="form-control" 
                          placeholder="곡 제목을 입력하세요"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>아티스트 *</label>
                        <input 
                          className="form-control" 
                          placeholder="아티스트명 또는 작곡가명을 입력하세요"
                          value={uploadArtist}
                          onChange={(e) => setUploadArtist(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>장르 카테고리</label>
                        <select 
                          className="form-control"
                          value={uploadCategory}
                          onChange={(e) => setUploadCategory(e.target.value)}
                        >
                          {categories.filter(c => c !== '전체').map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>가사</label>
                        <textarea 
                          className="form-control" 
                          style={{ minHeight: '120px', resize: 'vertical' }}
                          placeholder="가사를 입력해 주세요. (예: [00:15.20] 동해물과 백두산이 [00:20.00] 마르고 닳도록...)\n* 시간 정보를 입력하지 않으면 전체 재생 시간에 맞춰 가사가 자동 스크롤됩니다."
                          value={uploadLyrics}
                          onChange={(e) => setUploadLyrics(e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                        <div className="form-group">
                          <label>음원 파일 * (.mp3, .wav, .m4a)</label>
                          <div className="file-upload-box" onClick={() => document.getElementById('audio-input').click()}>
                            <UploadCloud className="icon" />
                            <span style={{ fontSize: '13px' }}>
                              {audioFile ? audioFile.name : '음원 오디오 파일 선택'}
                            </span>
                            <input 
                              type="file" 
                              id="audio-input" 
                              accept="audio/*" 
                              style={{ display: 'none' }}
                              onChange={(e) => setAudioFile(e.target.files[0])}
                            />
                          </div>
                        </div>

                        <div className="form-group">
                          <label>앨범 아트 / 이미지</label>
                          <div className="file-upload-box" onClick={() => document.getElementById('cover-input').click()}>
                            <UploadCloud className="icon" />
                            <span style={{ fontSize: '13px' }}>
                              {coverFile ? coverFile.name : '앨범 아트 선택 (선택 사항)'}
                            </span>
                            <input 
                              type="file" 
                              id="cover-input" 
                              accept="image/*" 
                              style={{ display: 'none' }}
                              onChange={(e) => setCoverFile(e.target.files[0])}
                            />
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                        <button 
                          type="button" 
                          className="btn-secondary"
                          onClick={() => setIsAdminAuthenticated(false)}
                        >
                          인증 해제
                        </button>
                        <button 
                          type="submit" 
                          className="btn-primary-glow"
                          disabled={isUploading}
                        >
                          {isUploading ? '업로드 중...' : '음원 등록하기'}
                        </button>
                      </div>
                    </form>
                  </div>
                  {/* Removed local sync card to prevent confusion on production */}
                </>
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
                            setBoardTitle('');
                            setBoardContent('');
                            setBoardAuthor('');
                            setBoardPassword('');
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="form-group">
                          <label>작성자 (닉네임) *</label>
                          <input className="form-control" value={boardAuthor} onChange={e => setBoardAuthor(e.target.value)} required placeholder="닉네임" />
                        </div>
                        <div className="form-group">
                          <label>비밀번호 *</label>
                          <input type="password" className="form-control" value={boardPassword} onChange={e => setBoardPassword(e.target.value)} required placeholder="수정/삭제용 비밀번호" />
                        </div>
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
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button className="btn-secondary" onClick={handleEditPostClick}><Edit2 size={16}/> 수정</button>
                        <button className="btn-secondary" style={{ color: '#ff6b6b' }} onClick={() => handleDeletePost(activePost.id)}><Trash2 size={16}/> 삭제</button>
                      </div>
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
              className={`control-btn ${isShuffled ? 'active' : ''}`}
              onClick={() => setIsShuffled(!isShuffled)}
              title="셔플"
            >
              <Shuffle size={16} />
            </button>
            <button className="control-btn" onClick={handlePrevSong} title="이전 곡">
              <SkipBack size={20} />
            </button>
            <button className="play-pause-btn" onClick={handlePlayPause}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="control-btn" onClick={handleNextSong} title="다음 곡">
              <SkipForward size={20} />
            </button>
            <button 
              className={`control-btn ${isLooping ? 'active' : ''}`}
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

          <div className="sleep-timer-container" ref={sleepPopoverRef} style={{ position: 'relative' }}>
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

export default App;
