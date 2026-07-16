import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CloudDownload,
  Database,
  FileAudio,
  Headphones,
  ListMusic,
  Lock,
  Megaphone,
  Music,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
  UserCog,
  Users,
  Vote,
  X
} from 'lucide-react';
import './AdminWorkspace.css';

const numberFormatter = new Intl.NumberFormat('ko-KR');

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function formatDate(value, includeTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return includeTime ? date.toLocaleString('ko-KR') : date.toLocaleDateString('ko-KR');
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${formatNumber(bytes)} B`;
}

function activityLabel(type) {
  const labels = {
    page_view: '페이지 방문',
    play: '음원 재생',
    like: '좋아요',
    unlike: '좋아요 취소',
    search: '검색',
    vote: '투표',
    vote_change: '투표 변경',
    vote_cancel: '투표 취소',
    playlist_create: '플레이리스트 생성',
    playlist_add: '플레이리스트 추가',
    playlist_remove: '플레이리스트 제거',
    login: '로그인',
    logout: '로그아웃'
  };
  return labels[type] || type || '기타 활동';
}

function LoadingState({ label }) {
  return (
    <div className="admin-loading" role="status">
      <RefreshCw size={22} className="admin-spin" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ label }) {
  return <div className="admin-empty">{label}</div>;
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'teal' }) {
  return (
    <article className={`admin-metric admin-tone-${tone}`}>
      <div className="admin-metric-icon"><Icon size={18} /></div>
      <div className="admin-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  );
}

function DailyChart({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.flatMap(row => [row.plays || 0, row.visits || 0]));

  return (
    <div className="admin-chart-wrap">
      <div className="admin-chart-legend">
        <span><i className="admin-legend-play" />재생</span>
        <span><i className="admin-legend-visit" />접속</span>
      </div>
      <div className="admin-daily-chart" aria-label="최근 14일 접속 및 재생 추이">
        {rows.map(row => (
          <div className="admin-chart-column" key={row.date} title={`${row.date} 재생 ${row.plays || 0}회, 접속 ${row.visits || 0}회`}>
            <div className="admin-chart-bars">
              <span className="admin-chart-bar admin-chart-play" style={{ height: `${Math.max(3, ((row.plays || 0) / maxValue) * 100)}%` }} />
              <span className="admin-chart-bar admin-chart-visit" style={{ height: `${Math.max(3, ((row.visits || 0) / maxValue) * 100)}%` }} />
            </div>
            <span className="admin-chart-label">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrafficChart({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.map(row => Number(row.trafficBytes) || 0));
  return (
    <div className="admin-traffic-chart" aria-label="최근 14일 Supabase 음원 트래픽 추정량">
      {rows.map(row => (
        <div className="admin-traffic-column" key={row.date} title={`${row.date} ${formatBytes(row.trafficBytes)}`}>
          <strong>{row.trafficBytes ? formatBytes(row.trafficBytes) : '0'}</strong>
          <div><span style={{ height: `${Math.max(3, ((row.trafficBytes || 0) / maxValue) * 100)}%` }} /></div>
          <small>{row.label}</small>
        </div>
      ))}
    </div>
  );
}

function TrafficBars({ rows = [] }) {
  const maxValue = Math.max(1, ...rows.map(row => Number(row.bytes) || 0));
  if (rows.length === 0) return <EmptyState label="Supabase Storage 전송 추정 데이터가 없습니다." />;
  return <div className="admin-ranked-bars">{rows.map((row, index) => <div className="admin-ranked-row" key={row.id}><span className="admin-rank">{String(index + 1).padStart(2, '0')}</span><div className="admin-ranked-main"><div className="admin-ranked-label"><span>{row.title}</span><small>{row.artist}</small><strong>{formatBytes(row.bytes)}</strong></div><div className="admin-ranked-track admin-ranked-track-traffic"><span style={{ width: `${(row.bytes / maxValue) * 100}%` }} /></div></div></div>)}</div>;
}

function RankedBars({ rows = [], valueKey, labelKey, suffix = '회' }) {
  const maxValue = Math.max(1, ...rows.map(row => Number(row[valueKey]) || 0));
  if (rows.length === 0) return <EmptyState label="표시할 데이터가 없습니다." />;

  return (
    <div className="admin-ranked-bars">
      {rows.map((row, index) => (
        <div className="admin-ranked-row" key={row.id || row[labelKey]}>
          <span className="admin-rank">{String(index + 1).padStart(2, '0')}</span>
          <div className="admin-ranked-main">
            <div className="admin-ranked-label">
              <span>{row[labelKey]}</span>
              {row.artist && <small>{row.artist}</small>}
              <strong>{formatNumber(row[valueKey])}{suffix}</strong>
            </div>
            <div className="admin-ranked-track">
              <span style={{ width: `${((Number(row[valueKey]) || 0) / maxValue) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardPanel({ stats, onSelectUser }) {
  if (!stats) return <LoadingState label="통계 데이터를 불러오는 중입니다." />;

  return (
    <div className="admin-panel-stack">
      <section className="admin-metric-grid admin-metric-grid-compact" aria-label="Supabase 트래픽 지표">
        <MetricCard icon={CloudDownload} label="14일 예상 Egress" value={formatBytes(stats.trafficStats?.estimatedEgress14dBytes)} detail="전체 파일 전송 가정" tone="rose" />
        <MetricCard icon={Database} label="Storage 음원 용량" value={formatBytes(stats.trafficStats?.storageBytes)} detail="songs 버킷 기준" tone="amber" />
        <MetricCard icon={Headphones} label="Supabase 재생 시작" value={`${formatNumber(stats.trafficStats?.supabasePlayStarts14d)}회`} detail="최근 14일" tone="blue" />
        <MetricCard icon={CheckCircle2} label="로컬 전달 비율" value={`${(Number(stats.trafficStats?.localDeliveryRate) || 0).toFixed(1)}%`} detail="Storage Egress 절감 지표" tone="green" />
      </section>

      <section className="admin-section admin-traffic-section">
        <div className="admin-section-heading">
          <div><span>Supabase egress control</span><h2>음원 트래픽 추정 흐름</h2></div>
          <small>{stats.trafficStats?.estimateBasis || '재생 이력과 파일 크기를 기준으로 추정합니다.'}</small>
        </div>
        <TrafficChart rows={stats.dailyActivity || []} />
      </section>

      <div className="admin-split-grid">
        <section className="admin-section">
          <div className="admin-section-heading"><div><span>Traffic drivers</span><h2>트래픽 상위 음원</h2></div></div>
          <TrafficBars rows={stats.trafficStats?.topTrafficSongs || []} />
        </section>
        <section className="admin-section admin-traffic-guide">
          <div className="admin-section-heading"><div><span>Control signals</span><h2>운영 판단 지표</h2></div></div>
          <dl><div><dt>Supabase 전달</dt><dd>{formatNumber(stats.trafficStats?.supabasePlayStarts14d)}회</dd></div><div><dt>로컬 전달</dt><dd>{formatNumber(stats.trafficStats?.localPlayStarts14d)}회</dd></div><div><dt>전환 대기</dt><dd>{formatNumber((stats.topSongs || []).filter(song => song.audio_url?.includes('supabase.co')).length)}곡</dd></div></dl>
          <p>이 화면은 앱 재생 로그 기반 추정치입니다. 청구 기준의 정확한 통합 Egress는 Supabase 조직 Usage 화면의 수치와 함께 판단하세요.</p>
        </section>
      </div>

      <section className="admin-metric-grid" aria-label="핵심 운영 지표">
        <MetricCard icon={Users} label="전체 회원" value={`${formatNumber(stats.totalUsers)}명`} detail={`최근 7일 활동 ${formatNumber(stats.activeUsers7d)}명`} tone="teal" />
        <MetricCard icon={Music} label="등록 음원" value={`${formatNumber(stats.totalSongs)}곡`} detail={`누적 좋아요 ${formatNumber(stats.totalLikes)}개`} tone="amber" />
        <MetricCard icon={Headphones} label="누적 재생" value={`${formatNumber(stats.totalPlays)}회`} detail={`수집 이력 ${formatNumber(stats.dataCoverage?.playHistoryRows)}건`} tone="rose" />
        <MetricCard icon={Activity} label="7일 접속" value={`${formatNumber(stats.accessStats?.visits7d)}회`} detail={`고유 세션 ${formatNumber(stats.accessStats?.uniqueSessions7d)}개`} tone="blue" />
        <MetricCard icon={Search} label="7일 검색" value={`${formatNumber(stats.accessStats?.searches7d)}회`} detail="사용자 탐색 활동" tone="violet" />
        <MetricCard icon={Database} label="활동 로그" value={`${formatNumber(stats.dataCoverage?.activityRows)}건`} detail={`집계 ${formatDate(stats.generatedAt, true)}`} tone="green" />
      </section>

      {(stats.dataCoverage?.activityRows || 0) === 0 && (
        <div className="admin-notice admin-notice-warning">
          <Database size={18} />
          <span>활동 로그가 아직 없습니다. 분석 스키마 적용 후 사용자 행동부터 순차적으로 집계됩니다.</span>
        </div>
      )}

      <section className="admin-section">
        <div className="admin-section-heading">
          <div><span>Traffic</span><h2>최근 14일 이용 흐름</h2></div>
          <small>접속과 재생량을 같은 시간축에서 비교합니다.</small>
        </div>
        <DailyChart rows={stats.dailyActivity || []} />
      </section>

      <div className="admin-split-grid">
        <section className="admin-section">
          <div className="admin-section-heading">
            <div><span>Top tracks</span><h2>인기 음원</h2></div>
          </div>
          <RankedBars rows={stats.topSongs || []} valueKey="play_count" labelKey="title" />
        </section>
        <section className="admin-section">
          <div className="admin-section-heading">
            <div><span>Preference</span><h2>장르 선호 분포</h2></div>
          </div>
          <RankedBars rows={stats.categoryStats || []} valueKey="count" labelKey="category" />
        </section>
      </div>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div><span>User intelligence</span><h2>사용자별 선호와 활동</h2></div>
          <small>재생 이력을 기준으로 선호 음원과 장르를 계산합니다.</small>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>사용자</th><th>선호 음원</th><th>선호 장르</th><th>재생</th><th>좋아요</th><th>주요 활동</th><th>최근 활동</th></tr></thead>
            <tbody>
              {(stats.userInsights || []).map(user => (
                <tr key={user.id}>
                  <td><button type="button" className="admin-user-link" onClick={() => onSelectUser(user)}><strong>{user.email || '이메일 없음'}</strong><small>{user.role === 'admin' ? '관리자' : '일반 회원'} · 상세 보기</small></button></td>
                  <td>{user.favoriteSong ? <><strong>{user.favoriteSong.title}</strong><small>{user.favoriteSong.artist} · {formatNumber(user.favoriteSongPlays)}회</small></> : '-'}</td>
                  <td><span className="admin-chip">{user.favoriteCategory || '-'}</span></td>
                  <td>{formatNumber(user.plays)}</td>
                  <td>{formatNumber(user.likes)}</td>
                  <td>{activityLabel(user.primaryActivity)}</td>
                  <td>{formatDate(user.lastSeen, true)}</td>
                </tr>
              ))}
              {(stats.userInsights || []).length === 0 && <tr><td colSpan="7"><EmptyState label="회원 분석 데이터가 없습니다." /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div><span>Live activity</span><h2>최근 사용자 활동</h2></div>
        </div>
        <div className="admin-activity-list">
          {(stats.recentActivities || []).slice(0, 12).map(item => (
            <div className="admin-activity-row" key={item.id}>
              <span className="admin-activity-icon"><Activity size={15} /></span>
              <div><strong>{item.profile?.email || item.session_id || '비회원 세션'}</strong><small>{activityLabel(item.event_type)}{item.song ? ` · ${item.song.title}` : ''}</small></div>
              <time>{formatDate(item.created_at, true)}</time>
            </div>
          ))}
          {(stats.recentActivities || []).length === 0 && <EmptyState label="최근 활동이 없습니다." />}
        </div>
      </section>
    </div>
  );
}

function VotePanel({ data }) {
  if (!data) return <LoadingState label="투표 통계를 불러오는 중입니다." />;
  const matches = Array.isArray(data) ? [] : data.matches || [];
  const recentVotes = Array.isArray(data) ? data : data.recentVotes || [];

  return (
    <div className="admin-panel-stack">
      <section className="admin-metric-grid admin-metric-grid-compact">
        <MetricCard icon={Vote} label="누적 투표" value={`${formatNumber(data.totalVotes || recentVotes.length)}표`} tone="rose" />
        <MetricCard icon={Users} label="참여 회원" value={`${formatNumber(data.uniqueVoters)}명`} tone="teal" />
        <MetricCard icon={BarChart3} label="진행 대결" value={`${formatNumber(matches.length)}개`} tone="amber" />
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><span>Match results</span><h2>대결별 득표 현황</h2></div></div>
        <div className="admin-match-list">
          {matches.map(match => {
            const total = Math.max(1, match.totalVotes || 0);
            return (
              <article className="admin-match-row" key={match.id}>
                <div className="admin-match-title"><strong>{match.title}</strong><span>{formatNumber(match.totalVotes)}표</span></div>
                <div className="admin-match-labels"><span>{match.song1?.title || '곡 정보 없음'} · {formatNumber(match.song1Votes)}</span><span>{match.song2?.title || '곡 정보 없음'} · {formatNumber(match.song2Votes)}</span></div>
                <div className="admin-vote-track"><span style={{ width: `${((match.song1Votes || 0) / total) * 100}%` }} /><i style={{ width: `${((match.song2Votes || 0) / total) * 100}%` }} /></div>
              </article>
            );
          })}
          {matches.length === 0 && <EmptyState label="집계할 대결이 없습니다." />}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><span>Vote log</span><h2>최근 투표 내역</h2></div></div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>사용자</th><th>대결</th><th>선택 음원</th><th>투표 일시</th></tr></thead><tbody>
          {recentVotes.map(vote => <tr key={vote.id}><td>{vote.profile?.email || vote.profiles?.email || '알 수 없음'}</td><td>{vote.match?.title || vote.vs_matches?.title || '-'}</td><td><strong>{vote.song?.title || vote.songs?.title || '-'}</strong><small>{vote.song?.artist || vote.songs?.artist || ''}</small></td><td>{formatDate(vote.created_at, true)}</td></tr>)}
          {recentVotes.length === 0 && <tr><td colSpan="4"><EmptyState label="투표 이력이 없습니다." /></td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function UploadPanel(props) {
  return (
    <section className="admin-section">
      <div className="admin-section-heading"><div><span>Catalog</span><h2>음원 신규 등록</h2></div><small>MP3 형식, 최대 25MB까지 등록할 수 있습니다.</small></div>
      <form className="admin-upload-form" onSubmit={props.onSubmit}>
        <div className="admin-form-grid">
          <label><span>곡 제목 *</span><input className="form-control" value={props.title} onChange={event => props.setTitle(event.target.value)} placeholder="곡 제목" required /></label>
          <label><span>아티스트 *</span><input className="form-control" value={props.artist} onChange={event => props.setArtist(event.target.value)} placeholder="아티스트 또는 작곡가" required /></label>
          <label><span>장르</span><select className="form-control" value={props.category} onChange={event => props.setCategory(event.target.value)}>{props.categories.filter(item => item !== '전체').map(item => <option key={item}>{item}</option>)}</select></label>
          <label className="admin-form-wide"><span>가사</span><textarea className="form-control admin-lyrics-input" value={props.lyrics} onChange={event => props.setLyrics(event.target.value)} placeholder="가사 또는 타임코드 가사를 입력하세요." /></label>
        </div>
        <div className="admin-file-grid">
          <button type="button" className="admin-file-picker" onClick={() => document.getElementById('audio-input')?.click()}><FileAudio size={24} /><span><strong>{props.audioFile?.name || '음원 파일 선택'}</strong><small>MP3, M4A · 최대 25MB</small></span></button>
          <input id="audio-input" type="file" accept="audio/*" hidden onChange={event => props.setAudioFile(event.target.files?.[0] || null)} />
          <button type="button" className="admin-file-picker" onClick={() => document.getElementById('cover-input')?.click()}><UploadCloud size={24} /><span><strong>{props.coverFile?.name || '앨범 이미지 선택'}</strong><small>JPG, PNG, WEBP</small></span></button>
          <input id="cover-input" type="file" accept="image/*" hidden onChange={event => props.setCoverFile(event.target.files?.[0] || null)} />
        </div>
        <div className="admin-actions"><button type="submit" className="admin-primary-button" disabled={props.isUploading}><UploadCloud size={17} />{props.isUploading ? '업로드 중' : '음원 등록'}</button></div>
      </form>
    </section>
  );
}

const noticeTypeLabels = {
  update: '업데이트',
  maintenance: '점검 안내',
  announcement: '일반 공지',
};

function NoticePanel({ apiBaseUrl, adminPassword }) {
  const [notices, setNotices] = useState([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [noticeType, setNoticeType] = useState('update');
  const [editingNoticeId, setEditingNoticeId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const editorRef = useRef(null);

  const loadNotices = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/notices`, {
        headers: { 'x-admin-password': adminPassword }
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || '공지 목록을 불러오지 못했습니다.');
      setNotices(Array.isArray(data) ? data : []);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/admin/notices`, {
      headers: { 'x-admin-password': adminPassword }
    })
      .then(async (response) => {
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.error || '공지 목록을 불러오지 못했습니다.');
        return data;
      })
      .then((data) => {
        if (active) setNotices(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (active) setFeedback(error.message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [adminPassword, apiBaseUrl]);

  const resetEditor = () => {
    setTitle('');
    setContent('');
    setNoticeType('update');
    setEditingNoticeId(null);
  };

  const startEditing = (notice) => {
    setTitle(notice.title);
    setContent(notice.content);
    setNoticeType(notice.notice_type);
    setEditingNoticeId(notice.id);
    setFeedback('선택한 공지를 수정 중입니다.');
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEditing = () => {
    resetEditor();
    setFeedback('공지 수정을 취소했습니다.');
  };

  const saveNotice = async (event) => {
    event.preventDefault();
    if (!title.trim() || !content.trim() || isSaving) return;
    setIsSaving(true);
    setFeedback('');
    try {
      const isEditing = Boolean(editingNoticeId);
      const response = await fetch(
        isEditing
          ? `${apiBaseUrl}/api/admin/notices/${editingNoticeId}`
          : `${apiBaseUrl}/api/admin/notices`,
        {
        method: isEditing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ title, content, noticeType })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || (isEditing ? '공지사항을 수정하지 못했습니다.' : '공지사항을 게시하지 못했습니다.'));
      }
      resetEditor();
      setFeedback(
        isEditing
          ? '공지 내용이 수정되었습니다.'
          : '새 공지가 게시되었습니다. 다음 로그인부터 회원에게 표시됩니다.'
      );
      await loadNotices();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const changeNoticeStatus = async (notice) => {
    setFeedback('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/notices/${notice.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ isActive: !notice.is_active })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '게시 상태를 변경하지 못했습니다.');
      setFeedback(data.is_active ? '선택한 공지를 다시 게시했습니다.' : '로그인 공지 노출을 중지했습니다.');
      await loadNotices();
    } catch (error) {
      setFeedback(error.message);
    }
  };

  return (
    <div className="admin-panel-stack admin-notice-workspace">
      <section className="admin-section admin-notice-editor" ref={editorRef}>
        <div className="admin-section-heading">
          <div><span>Login announcement</span><h2>{editingNoticeId ? '로그인 공지 수정' : '로그인 공지 작성'}</h2></div>
          <small>{editingNoticeId ? '내용을 저장하면 기존 게시 상태는 그대로 유지됩니다.' : '게시하면 기존 공지는 자동으로 내려가고 최신 공지만 로그인 직후 한 번 표시됩니다.'}</small>
        </div>
        <form onSubmit={saveNotice}>
          <div className="admin-notice-type-tabs" role="radiogroup" aria-label="공지 유형">
            {Object.entries(noticeTypeLabels).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={noticeType === value ? 'active' : ''}
                onClick={() => setNoticeType(value)}
                role="radio"
                aria-checked={noticeType === value}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="admin-notice-field">
            <span>공지 제목</span>
            <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 100))} placeholder="예: Musicdrive 새 기능 업데이트 안내" required />
            <small>{title.length}/100</small>
          </label>
          <label className="admin-notice-field">
            <span>공지 내용</span>
            <textarea value={content} onChange={(event) => setContent(event.target.value.slice(0, 4000))} placeholder="수정 내용이나 업그레이드 내용을 작성하세요." required />
            <small>{content.length}/4,000</small>
          </label>
          <div className="admin-notice-submit-row">
            <span className={feedback.includes('못') || feedback.includes('수 없') ? 'error' : ''}>{feedback}</span>
            <div className="admin-notice-editor-actions">
              {editingNoticeId && (
                <button type="button" className="admin-secondary-button" onClick={cancelEditing} disabled={isSaving}>
                  <X size={16} /> 수정 취소
                </button>
              )}
              <button type="submit" className="admin-primary-button" disabled={isSaving || !title.trim() || !content.trim()}>
                {editingNoticeId ? <Pencil size={17} /> : <Megaphone size={17} />}
                {isSaving ? '저장 중' : (editingNoticeId ? '수정 내용 저장' : '공지 게시하기')}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><span>Notice history</span><h2>공지 이력</h2></div></div>
        {isLoading ? <LoadingState label="공지 이력을 불러오는 중입니다." /> : (
          <div className="admin-notice-history">
            {notices.map((notice) => (
              <article className={notice.is_active ? 'active' : ''} key={notice.id}>
                <header>
                  <div><span>{noticeTypeLabels[notice.notice_type] || '공지'}</span>{notice.is_active && <em>현재 게시 중</em>}</div>
                  <time>{formatDate(notice.published_at, true)}</time>
                </header>
                <h3>{notice.title}</h3>
                <p>{notice.content}</p>
                <div className="admin-notice-history-actions">
                  <button type="button" onClick={() => startEditing(notice)}>
                    <Pencil size={13} /> 수정
                  </button>
                  <button type="button" onClick={() => changeNoticeStatus(notice)}>
                    {notice.is_active ? '게시 중지' : '다시 게시'}
                  </button>
                </div>
              </article>
            ))}
            {notices.length === 0 && <EmptyState label="작성된 공지사항이 없습니다." />}
          </div>
        )}
      </section>
    </div>
  );
}

function MembersPanel({ members, stats, onToggleRole, onSelectUser }) {
  const insightById = Object.fromEntries((stats?.userInsights || []).map(item => [item.id, item]));
  const adminCount = members.filter(member => member.role === 'admin').length;

  return (
    <div className="admin-panel-stack">
      <section className="admin-metric-grid admin-metric-grid-compact">
        <MetricCard icon={Users} label="전체 회원" value={`${formatNumber(members.length)}명`} tone="teal" />
        <MetricCard icon={ShieldCheck} label="관리자" value={`${formatNumber(adminCount)}명`} tone="violet" />
        <MetricCard icon={Activity} label="7일 활동" value={`${formatNumber(stats?.activeUsers7d)}명`} tone="green" />
      </section>
      <section className="admin-section">
        <div className="admin-section-heading"><div><span>Member directory</span><h2>회원 관리</h2></div></div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>회원</th><th>권한</th><th>가입일</th><th>재생</th><th>선호 장르</th><th>최근 활동</th><th>관리</th></tr></thead><tbody>
          {members.map(member => {
            const insight = insightById[member.id];
            return <tr key={member.id}><td><button type="button" className="admin-user-link" onClick={() => onSelectUser(member)}><strong>{member.email}</strong><small>{member.id.slice(0, 8)} · 상세 보기</small></button></td><td><span className={`admin-role admin-role-${member.role}`}>{member.role === 'admin' ? '관리자' : '일반 회원'}</span></td><td>{formatDate(member.created_at)}</td><td>{formatNumber(insight?.plays)}</td><td>{insight?.favoriteCategory || '-'}</td><td>{formatDate(insight?.lastSeen, true)}</td><td><button type="button" className="admin-table-button" onClick={() => onToggleRole(member.id, member.role)}><UserCog size={15} />{member.role === 'admin' ? '일반 전환' : '관리자 지정'}</button></td></tr>;
          })}
          {members.length === 0 && <tr><td colSpan="7"><EmptyState label="회원 정보가 없습니다." /></td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function SyncPanel({ data, isSyncing, logs, syncComplete, onRefresh, onRun, apiBaseUrl, adminPassword }) {
  if (!data) return <LoadingState label="스토리지와 로컬 자산을 진단하는 중입니다." />;
  const automationEnabled = Boolean(data.automation?.enabled);
  const downloadAsset = async (bucket, fileName) => {
    const response = await fetch(`${apiBaseUrl}/api/admin/download-song/${bucket}/${encodeURIComponent(fileName)}`, {
      headers: { 'x-admin-password': adminPassword }
    });
    if (!response.ok) return;

    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName.split('/').pop() || fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="admin-panel-stack">
      <div className={`admin-notice ${data.unsyncedCount > 0 ? 'admin-notice-warning' : 'admin-notice-success'}`}>
        {data.unsyncedCount > 0 ? <Database size={19} /> : <CheckCircle2 size={19} />}
        <div>
          <strong>{data.unsyncedCount > 0 ? `${automationEnabled ? '자동 동기화 진행 중' : '전환 대기 음원'} ${data.unsyncedCount}곡` : '모든 음원이 동기화되었습니다.'}</strong>
          <span>{data.unsyncedCount === 0 ? '정적 자산 전환과 Storage 정리가 완료되었습니다.' : (automationEnabled ? 'GitHub 배포와 운영 파일 확인 후 DB 전환 및 Storage 정리가 자동으로 완료됩니다.' : '서버의 GITHUB_ASSET_SYNC_TOKEN 설정이 필요합니다.')}</span>
        </div>
      </div>
      <section className="admin-metric-grid admin-metric-grid-compact">
        <MetricCard icon={ListMusic} label="전체 음원" value={`${formatNumber(data.totalCount)}곡`} tone="blue" />
        <MetricCard icon={CheckCircle2} label="동기화 완료" value={`${formatNumber(data.syncedCount)}곡`} tone="green" />
        <MetricCard icon={CloudDownload} label="자동 처리 대기" value={`${formatNumber(data.unsyncedCount)}곡`} tone="teal" />
        <MetricCard icon={Database} label="Storage 추정" value={`${formatNumber(data.estimatedSizeMB)}MB`} tone="amber" />
      </section>
      <section className="admin-section">
        <div className="admin-section-heading"><div><span>Asset integrity</span><h2>자동 동기화 상태</h2></div><div className="admin-inline-actions"><button type="button" className="admin-icon-button" onClick={onRefresh} disabled={isSyncing} title="다시 검사"><RefreshCw size={17} /></button><button type="button" className="admin-primary-button" onClick={onRun} disabled={isSyncing || data.unsyncedCount === 0}><Database size={17} />{isSyncing ? '재시도 중' : '지금 재시도'}</button></div></div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>음원</th><th>오디오</th><th>커버</th><th>동기화 상태</th><th>등록일</th></tr></thead><tbody>
          {(data.unsyncedSongs || []).map(song => <tr key={song.id}><td><strong>{song.title}</strong><small>{song.artist}</small></td><td>{song.audioFileName ? <button type="button" className="admin-download-link" onClick={() => downloadAsset('songs', song.audioFileName)}><CloudDownload size={14} />오디오</button> : '-'}</td><td>{song.coverFileName ? <button type="button" className="admin-download-link" onClick={() => downloadAsset('covers', song.coverFileName)}><CloudDownload size={14} />커버</button> : '-'}</td><td><span className={`admin-role ${song.syncState === 'ready' ? 'admin-role-ready' : 'admin-role-wait'}`}>{song.syncState === 'automatic_pending' ? '자동 배포 대기' : (song.syncState === 'ready' ? '자동 반영 대기' : '자동화 설정 필요')}</span></td><td>{formatDate(song.created_at)}</td></tr>)}
          {(data.unsyncedSongs || []).length === 0 && <tr><td colSpan="5"><EmptyState label="동기화 대기 음원이 없습니다." /></td></tr>}
        </tbody></table></div>
      </section>
      {logs.length > 0 && <section className="admin-section"><div className="admin-section-heading"><div><span>Process log</span><h2>동기화 로그</h2></div></div><div className="admin-log" role="log">{logs.map((log, index) => <div className={`admin-log-${log.type}`} key={`${log.timestamp}-${index}`}><time>{formatDate(log.timestamp, true)}</time><span>{log.message}</span></div>)}</div>{syncComplete && <div className="admin-notice admin-notice-success"><CheckCircle2 size={18} /><span>자동 게시 요청이 정상적으로 처리되었습니다.</span></div>}</section>}
    </div>
  );
}

function UserInsightDrawer({ user, data, isLoading, onClose }) {
  if (!user) return null;
  return (
    <div className="admin-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="admin-user-drawer" role="dialog" aria-modal="true" aria-label={`${user.email} 사용자 분석`}>
        <header><div><span className="admin-eyebrow">Listener profile</span><h2>{user.email}</h2><p>개별 청취 이력과 선호 패턴</p></div><button type="button" className="admin-icon-button" onClick={onClose} title="닫기"><X size={18} /></button></header>
        {isLoading || !data ? <LoadingState label="사용자 활동을 분석하는 중입니다." /> : <div className="admin-drawer-body">
          <section className="admin-drawer-summary">
            <div><span>재생</span><strong>{formatNumber(data.summary?.plays)}</strong></div>
            <div><span>좋아요</span><strong>{formatNumber(data.summary?.likes)}</strong></div>
            <div><span>투표</span><strong>{formatNumber(data.summary?.votes)}</strong></div>
            <div><span>최근 활동</span><strong className="admin-drawer-date">{formatDate(data.summary?.lastSeen)}</strong></div>
          </section>
          <section className="admin-section"><div className="admin-section-heading"><div><span>Listening preference</span><h2>많이 들은 음원</h2></div><small>좋아요한 곡은 함께 표시됩니다.</small></div><div className="admin-user-song-list">{(data.topSongs || []).map((song, index) => <div key={song.id}><span>{String(index + 1).padStart(2, '0')}</span>{song.cover_url ? <img src={song.cover_url} alt="" /> : <div className="admin-song-placeholder"><Music size={16} /></div>}<p><strong>{song.title || '삭제된 음원'}</strong><small>{song.artist || '-'} · {song.category || '기타'}{song.liked ? ' · 좋아요' : ''}</small></p><b>{formatNumber(song.plays)}회</b></div>)}{(data.topSongs || []).length === 0 && <EmptyState label="재생 이력이 없습니다." />}</div></section>
          <section className="admin-section"><div className="admin-section-heading"><div><span>Genre affinity</span><h2>선호 장르</h2></div></div><RankedBars rows={data.categoryStats || []} valueKey="count" labelKey="category" /></section>
          <section className="admin-section"><div className="admin-section-heading"><div><span>Activity timeline</span><h2>최근 행동</h2></div></div><div className="admin-user-timeline">{(data.timeline || []).slice(0, 30).map(item => <div key={item.id}><span className="admin-activity-icon"><Activity size={14} /></span><p><strong>{activityLabel(item.type)}</strong><small>{item.song ? `${item.song.title} · ${item.song.artist}` : '서비스 활동'}</small></p><time>{formatDate(item.created_at, true)}</time></div>)}{(data.timeline || []).length === 0 && <EmptyState label="최근 행동이 없습니다." />}</div></section>
        </div>}
      </aside>
    </div>
  );
}

export function AdminWorkspace(props) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserData, setSelectedUserData] = useState(null);
  const [isUserLoading, setIsUserLoading] = useState(false);

  const openUserInsight = async user => {
    setSelectedUser(user);
    setSelectedUserData(null);
    setIsUserLoading(true);
    try {
      const response = await fetch(`${props.apiBaseUrl}/api/admin/users/${user.id}/insights`, {
        headers: { 'x-admin-password': props.adminPassword }
      });
      if (!response.ok) throw new Error('사용자 분석 조회 실패');
      setSelectedUserData(await response.json());
    } catch {
      setSelectedUserData({ summary: {}, topSongs: [], categoryStats: [], timeline: [] });
    } finally {
      setIsUserLoading(false);
    }
  };

  if (!props.isAuthenticated) {
    return (
      <div className="admin-auth-layout">
        <section className="admin-auth-panel">
          <div className="admin-auth-icon"><ShieldCheck size={28} /></div>
          <span className="admin-eyebrow">Musicdrive Operations</span>
          <h1>관리자 인증</h1>
          <p>운영 데이터와 회원 관리 기능에 접근하려면 관리자 비밀번호를 입력하세요.</p>
          <form onSubmit={props.onAuthenticate}>
            <label><span>관리자 비밀번호</span><div className="admin-password-field"><Lock size={17} /><input type="password" value={props.adminPassword} onChange={event => props.setAdminPassword(event.target.value)} placeholder="비밀번호 입력" autoComplete="current-password" /></div></label>
            <button type="submit" className="admin-primary-button"><ShieldCheck size={17} />인증하기</button>
          </form>
        </section>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: '대시보드', icon: BarChart3, refresh: props.fetchStats },
    { id: 'vsstats', label: '투표 통계', icon: Vote, refresh: props.fetchVsStats },
    { id: 'upload', label: '음원 등록', icon: UploadCloud },
    { id: 'notices', label: '공지사항', icon: Megaphone },
    { id: 'sync', label: '동기화', icon: Database, refresh: props.fetchUnsynced },
    { id: 'members', label: '회원 관리', icon: Users, refresh: props.fetchMembers }
  ];
  const activeTab = tabs.find(tab => tab.id === props.adminTab) || tabs[0];

  const selectTab = tab => {
    props.setAdminTab(tab.id);
    tab.refresh?.();
  };

  return (
    <div className="admin-workspace">
      <header className="admin-workspace-header">
        <div><span className="admin-eyebrow">Operations center</span><h1>관리자 콘솔</h1><p>사용자 행동, 콘텐츠 성과와 서비스 운영 상태를 한곳에서 관리합니다.</p></div>
        <div className="admin-header-actions"><button type="button" className="admin-icon-button" title="현재 탭 새로고침" onClick={() => activeTab.refresh?.()} disabled={!activeTab.refresh}><RefreshCw size={18} /></button><button type="button" className="admin-secondary-button" onClick={props.onLock}><Lock size={16} />인증 해제</button></div>
      </header>
      <nav className="admin-tabs" aria-label="관리자 메뉴">
        {tabs.map(tab => { const Icon = tab.icon; return <button type="button" key={tab.id} className={props.adminTab === tab.id ? 'active' : ''} onClick={() => selectTab(tab)}><Icon size={17} /><span>{tab.label}</span>{tab.id === 'sync' && props.unsyncedData?.unsyncedCount > 0 && <i>{props.unsyncedData.unsyncedCount}</i>}</button>; })}
      </nav>
      <main className="admin-content">
        {props.adminTab === 'dashboard' && <DashboardPanel stats={props.adminStats} onSelectUser={openUserInsight} />}
        {props.adminTab === 'vsstats' && <VotePanel data={props.adminVsStats} />}
        {props.adminTab === 'upload' && <UploadPanel {...props.uploadProps} />}
        {props.adminTab === 'notices' && <NoticePanel apiBaseUrl={props.apiBaseUrl} adminPassword={props.adminPassword} />}
        {props.adminTab === 'members' && <MembersPanel members={props.memberList} stats={props.adminStats} onToggleRole={props.toggleMemberRole} onSelectUser={openUserInsight} />}
        {props.adminTab === 'sync' && <SyncPanel data={props.unsyncedData} isSyncing={props.isSyncing} logs={props.syncLogs} syncComplete={props.syncComplete} onRefresh={props.fetchUnsynced} onRun={props.runSync} apiBaseUrl={props.apiBaseUrl} adminPassword={props.adminPassword} />}
      </main>
      <UserInsightDrawer user={selectedUser} data={selectedUserData} isLoading={isUserLoading} onClose={() => setSelectedUser(null)} />
    </div>
  );
}
