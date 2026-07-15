import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock3,
  Headphones,
  Music2,
  RefreshCw,
} from 'lucide-react';
import './PersonalDashboard.css';

function formatListeningTime(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) return `${hours}시간 ${remainingMinutes}분`;
  return `${minutes}분`;
}

function MetricCard({ icon: Icon, label, value, tone }) {
  return (
    <div className={`personal-metric ${tone}`}>
      <span className="personal-metric-icon"><Icon size={21} /></span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function SongMiniRow({ song, rank, trailing, onPlaySong }) {
  return (
    <button
      type="button"
      className="personal-song-row"
      onClick={() => onPlaySong?.(song)}
      disabled={!onPlaySong}
    >
      {rank ? <span className="personal-song-rank">{rank}</span> : null}
      <img src={song.cover_url} alt="" />
      <span className="personal-song-copy">
        <strong>{song.title}</strong>
        <small>{song.artist}</small>
      </span>
      {trailing ? <span className="personal-song-trailing">{trailing}</span> : null}
    </button>
  );
}

export function PersonalDashboard({ data, loading, error, onRetry, onPlaySong }) {
  if (loading && !data) {
    return (
      <section className="personal-dashboard" aria-label="내 현황판 불러오는 중">
        <div className="personal-dashboard-heading skeleton-heading" />
        <div className="personal-metrics-grid">
          {Array.from({ length: 4 }).map((_, index) => <div className="dashboard-skeleton" key={index} />)}
        </div>
        <div className="personal-dashboard-body">
          <div className="dashboard-skeleton dashboard-skeleton-tall" />
          <div className="dashboard-skeleton dashboard-skeleton-tall" />
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="personal-dashboard dashboard-error-card">
        <Headphones size={28} />
        <h3>현황판을 불러오지 못했습니다.</h3>
        <p>{error}</p>
        <button type="button" className="dashboard-refresh" onClick={onRetry}>
          <RefreshCw size={15} /> 다시 불러오기
        </button>
      </section>
    );
  }

  const summary = data?.summary || {};
  const topSongs = data?.topSongs || [];
  const unplayedSongs = data?.unplayedSongs || [];
  const categoryStats = data?.categoryStats || [];
  const recent = data?.recent || {};

  return (
    <section className="personal-dashboard" aria-labelledby="personal-dashboard-title">
      <div className="personal-dashboard-heading">
        <div>
          <span>My listening</span>
          <h2 id="personal-dashboard-title">내 현황판</h2>
          <p>나의 MusicDrive 감상 기록</p>
        </div>
        <button type="button" className="dashboard-refresh icon-only" onClick={onRetry} aria-label="현황판 새로고침">
          <RefreshCw size={17} className={loading ? 'is-spinning' : ''} />
        </button>
      </div>

      <div className="personal-metrics-grid">
        <MetricCard icon={Music2} label="총 감상 곡" value={`${summary.totalSongsListened || 0}곡`} tone="purple" />
        <MetricCard icon={Clock3} label="총 감상 시간" value={formatListeningTime(summary.totalListeningSeconds)} tone="cyan" />
        <MetricCard icon={BarChart3} label="이번 주 재생" value={`${summary.weekPlays || 0}회`} tone="violet" />
        <MetricCard icon={Headphones} label="아직 안 들은 곡" value={`${summary.unplayedSongs || 0}곡`} tone="teal" />
      </div>

      <div className="personal-dashboard-body">
        <div className="personal-dashboard-column">
          <article className="personal-insight-card personal-top-songs">
            <div className="personal-card-title">
              <h3>가장 많이 들은 노래</h3>
              <small>총 {summary.totalPlays || 0}회 재생</small>
            </div>
            {topSongs.length > 0 ? topSongs.map((song, index) => (
              <SongMiniRow
                key={song.id}
                song={song}
                rank={index + 1}
                trailing={`${song.plays}회`}
                onPlaySong={onPlaySong}
              />
            )) : (
              <div className="personal-empty-state">노래를 들으면 자주 듣는 곡이 여기에 표시됩니다.</div>
            )}
          </article>

          <article className="personal-insight-card personal-genre-card">
            <div className="personal-card-title"><h3>내가 좋아하는 장르</h3></div>
            {categoryStats.length > 0 ? (
              <>
                <div className="personal-genre-bar">
                  {categoryStats.map((item, index) => (
                    <span key={item.category} className={`genre-tone-${index + 1}`} style={{ width: `${item.percentage}%` }} />
                  ))}
                </div>
                <div className="personal-genre-labels">
                  {categoryStats.map((item, index) => (
                    <span key={item.category} className={`genre-text-${index + 1}`}>
                      <small>{item.category}</small><strong>{item.percentage}%</strong>
                    </span>
                  ))}
                </div>
              </>
            ) : <div className="personal-empty-state compact">장르 취향을 분석할 감상 기록이 아직 없습니다.</div>}
          </article>
        </div>

        <div className="personal-dashboard-column">
          <article className="personal-insight-card personal-unplayed-card">
            <div className="personal-card-title">
              <h3>아직 안 들은 노래</h3>
              <span className="personal-more-label">새로운 곡 발견 <ChevronRight size={14} /></span>
            </div>
            {unplayedSongs.length > 0 ? unplayedSongs.map(song => (
              <SongMiniRow key={song.id} song={song} onPlaySong={onPlaySong} />
            )) : (
              <div className="personal-empty-state">모든 곡을 한 번 이상 들었습니다!</div>
            )}
          </article>

          <article className="personal-insight-card personal-recent-card">
            <div className="personal-card-title"><h3>최근 감상</h3></div>
            <div className="recent-listening-row">
              <CalendarDays size={18} />
              <span><strong>오늘</strong><small>나의 하루 감상 기록</small></span>
              <b>{recent.today || 0}곡</b>
            </div>
            <div className="recent-listening-row">
              <BarChart3 size={18} />
              <span><strong>이번 주</strong><small>월요일부터 지금까지</small></span>
              <b>{recent.week || 0}곡</b>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
