const KOREA_TIME_ZONE = 'Asia/Seoul';
const MAX_LISTEN_EVENT_SECONDS = 300;
const { getKstWeekWindow } = require('./weekly-match');

function toKoreaDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function buildUserDashboard({ plays = [], songs = [], activities = [], now = new Date() }) {
  const songById = Object.fromEntries(songs.map(song => [String(song.id), song]));
  const songCounts = new Map();
  const categoryCounts = new Map();
  const listenedSongIds = new Set();
  const todayKey = toKoreaDateKey(now);
  const weekWindow = getKstWeekWindow(now);
  const weekStart = new Date(weekWindow.startAt);
  const weekEnd = new Date(weekWindow.endAt);
  let todayPlays = 0;
  let weekPlays = 0;

  plays.forEach((play) => {
    const songId = String(play.song_id || '');
    if (!songId) return;

    listenedSongIds.add(songId);
    songCounts.set(songId, (songCounts.get(songId) || 0) + 1);

    const song = songById[songId];
    const category = song?.category || '기타';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

    const playedAt = new Date(play.played_at);
    if (!Number.isNaN(playedAt.getTime())) {
      if (toKoreaDateKey(playedAt) === todayKey) todayPlays += 1;
      if (playedAt >= weekStart && playedAt < weekEnd) weekPlays += 1;
    }
  });

  const totalListeningSeconds = Math.round(activities.reduce((sum, activity) => {
    if (activity.event_type !== 'listen_time') return sum;
    const seconds = Number(activity.metadata?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return sum;
    return sum + Math.min(seconds, MAX_LISTEN_EVENT_SECONDS);
  }, 0));

  const topSongs = [...songCounts.entries()]
    .map(([songId, count]) => ({
      ...(songById[songId] || { id: songId, title: '삭제된 음원', artist: '' }),
      plays: count
    }))
    .sort((a, b) => b.plays - a.plays || String(a.title).localeCompare(String(b.title), 'ko'))
    .slice(0, 3);

  const unplayedSongs = songs
    .filter(song => !listenedSongIds.has(String(song.id)))
    .slice(0, 3);

  const categoryTotal = [...categoryCounts.values()].reduce((sum, count) => sum + count, 0);
  const categoryStats = [...categoryCounts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      percentage: categoryTotal ? Math.round((count / categoryTotal) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    summary: {
      totalSongsListened: listenedSongIds.size,
      totalListeningSeconds,
      totalPlays: plays.length,
      weekPlays,
      unplayedSongs: Math.max(0, songs.length - listenedSongIds.size)
    },
    topSongs,
    unplayedSongs,
    categoryStats,
    recent: {
      today: todayPlays,
      week: weekPlays
    }
  };
}

module.exports = {
  buildUserDashboard,
  toKoreaDateKey
};
