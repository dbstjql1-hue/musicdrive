import React, { useState, useEffect, useRef } from 'react';
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
  FolderHeart
} from 'lucide-react';
import './App.css';

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
  
  // Data State
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [likedSongIds, setLikedSongIds] = useState([]);
  const [categories, setCategories] = useState(['전체', '발라드', '댄스', '힙합', '케이팝', '펑크', '트로트', '재즈', '기타']);
  
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
  
  // Playlist Modal State
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  
  // Popover State (플레이리스트 추가 팝업)
  const [activePopoverSongId, setActivePopoverSongId] = useState(null);
  
  // Toast UI
  const [toastMessage, setToastMessage] = useState('');
  
  // HTML Audio Ref
  const audioRef = useRef(new Audio());
  
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
  }, []);

  const fetchSongs = async (query = '', category = '') => {
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
  };

  const fetchPlaylists = async () => {
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

  const fetchLikedSongs = async () => {
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
  }, [queue, queueIndex, isLooping, isShuffled]);

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

  const handlePlayPause = () => {
    if (!activeSong && songs.length > 0) {
      playSingleSong(songs[0]);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleNextSong = () => {
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
  };

  const handlePrevSong = () => {
    if (queue.length === 0) return;

    let prevIndex = queueIndex - 1;
    if (prevIndex < 0) {
      prevIndex = queue.length - 1; // 마지막 곡으로
    }

    setQueueIndex(prevIndex);
    setActiveSong(queue[prevIndex]);
    setIsPlaying(true);
    incrementPlayCount(queue[prevIndex].id);
  };

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

  // 4. API 인터랙션 함수들
  const incrementPlayCount = async (songId) => {
    try {
      fetch(`${API_BASE_URL}/api/songs/${songId}/play`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

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

  return (
    <div className="app-container">
      {/* Toast 알림 표시 */}
      {toastMessage && <div className="toast-msg">{toastMessage}</div>}

      {/* Sidebar Navigation */}
      <nav className="sidebar">
        <div className="logo-section">
          <Music className="logo-icon" size={28} />
          <h1>musicdrive</h1>
        </div>
        <ul className="nav-links">
          <li>
            <div 
              className={`nav-item ${currentView === 'home' && !selectedPlaylist ? 'active' : ''}`}
              onClick={() => { setCurrentView('home'); setSelectedPlaylist(null); }}
            >
              <Home className="icon" />
              <span>홈</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'search' ? 'active' : ''}`}
              onClick={() => { setCurrentView('search'); setSelectedPlaylist(null); }}
            >
              <Search className="icon" />
              <span>검색</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'playlists' || selectedPlaylist ? 'active' : ''}`}
              onClick={() => { setCurrentView('playlists'); setSelectedPlaylist(null); }}
            >
              <FolderHeart className="icon" />
              <span>플레이리스트</span>
            </div>
          </li>
          <li>
            <div 
              className={`nav-item ${currentView === 'admin' ? 'active' : ''}`}
              onClick={() => { setCurrentView('admin'); setSelectedPlaylist(null); }}
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
                <div className="hero-banner">
                  <span className="hero-tag">Original Tracks</span>
                  <h1 className="hero-title">나만의 창작곡 보관함</h1>
                  <p className="hero-desc">
                    직접 작사, 작곡하고 녹음한 노래들이 담겨 있는 공간입니다. 
                    마음껏 들으시고 좋은 음악이 있다면 플레이리스트에 담아가세요!
                  </p>
                  {songs.length > 0 && (
                    <button className="play-btn-premium" onClick={() => playSingleSong(songs[0])}>
                      <Play size={18} fill="currentColor" />
                      첫 번째 곡 듣기
                    </button>
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
                </div>
                <div className="song-list-premium">
                  {songs.slice().sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, 5).map((song, idx) => (
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
                        >
                          <FolderPlus size={16} />
                        </button>

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
                        >
                          <FolderPlus size={16} />
                        </button>

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
                          placeholder="가사를 입력해 주세요 (시간 정보를 함께 적어두면 유용합니다)"
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
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating Bottom Music Player */}
      <footer className="bottom-player">
        
        {/* Left Section: Playing Track Info */}
        <div className="player-song-info">
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
      <div className={`lyrics-drawer ${isLyricsOpen && activeSong && activeSong.lyrics ? 'open' : ''}`}>
        <div className="lyrics-header">
          <h3>가사</h3>
          <button className="icon-btn" onClick={() => setIsLyricsOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <div className="lyrics-body">
          {activeSong && activeSong.lyrics ? (
            activeSong.lyrics.split('\n').map((line, idx) => (
              <div className="lyrics-line" key={idx}>
                {line}
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-secondary)' }}>가사가 등록되어 있지 않습니다.</div>
          )}
        </div>
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
    </div>
  );
}

export default App;
