const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserDashboard, toKoreaDateKey } = require('./user-dashboard');

test('builds personal listening statistics from play history', () => {
  const now = new Date('2026-07-16T03:00:00.000Z');
  const songs = [
    { id: 'a', title: '알고리즘', artist: '서비', category: '힙합' },
    { id: 'b', title: '쉼', artist: '서비', category: '발라드' },
    { id: 'c', title: '괜찮은척', artist: '서비', category: '발라드' }
  ];
  const plays = [
    { song_id: 'a', played_at: '2026-07-16T01:00:00.000Z' },
    { song_id: 'a', played_at: '2026-07-15T01:00:00.000Z' },
    { song_id: 'b', played_at: '2026-06-01T01:00:00.000Z' }
  ];
  const activities = [
    { event_type: 'listen_time', metadata: { seconds: 30 } },
    { event_type: 'listen_time', metadata: { seconds: 45 } },
    { event_type: 'search', metadata: {} }
  ];

  const result = buildUserDashboard({ plays, songs, activities, now });

  assert.equal(result.summary.totalSongsListened, 2);
  assert.equal(result.summary.totalListeningSeconds, 75);
  assert.equal(result.summary.weekPlays, 2);
  assert.equal(result.summary.unplayedSongs, 1);
  assert.equal(result.topSongs[0].id, 'a');
  assert.equal(result.topSongs[0].plays, 2);
  assert.equal(result.unplayedSongs[0].id, 'c');
  assert.equal(result.recent.today, 1);
  assert.deepEqual(result.categoryStats.map(item => item.category), ['힙합', '발라드']);
});

test('uses Korea time for daily activity buckets', () => {
  assert.equal(toKoreaDateKey('2026-07-15T16:10:00.000Z'), '2026-07-16');
});
