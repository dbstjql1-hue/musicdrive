const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countTimedLines,
  createLyricsSyncService,
  getPlainLyricsLines,
  hasTimedLyrics,
  hashLyrics
} = require('./lyrics-sync');

function createSupabaseMock(initialSongs) {
  const songs = initialSongs.map(song => ({ ...song }));
  const updates = [];

  return {
    songs,
    updates,
    from(table) {
      assert.equal(table, 'songs');
      return {
        select() {
          return Promise.resolve({ data: songs.map(song => ({ ...song })), error: null });
        },
        update(payload) {
          const filters = [];
          const chain = {
            eq(column, value) {
              filters.push([column, value]);
              return chain;
            },
            async select() {
              const matching = songs.filter(song => filters.every(([column, value]) => song[column] === value));
              matching.forEach(song => Object.assign(song, payload));
              updates.push({ payload, filters, count: matching.length });
              return { data: matching.map(song => ({ id: song.id })), error: null };
            }
          };
          return chain;
        }
      };
    }
  };
}

function createJsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    }
  };
}

test('lyric helpers normalize line endings and recognize timed lyrics', () => {
  const lyrics = 'First line\r\n\r\n Second line ';
  assert.deepEqual(getPlainLyricsLines(lyrics), ['First line', 'Second line']);
  assert.equal(hashLyrics(lyrics), hashLyrics('First line\n\n Second line'));
  assert.equal(hasTimedLyrics(lyrics), false);
  assert.equal(hasTimedLyrics('[00:01.00]First line\nSecond line'), true);
  assert.equal(countTimedLines('[00:01.00]First line\n[00:05.20]Second line'), 2);
});

test('only a validated result for the unchanged source lyrics is applied', async () => {
  const originalLyrics = 'First line\nSecond line';
  const lrc = '[00:10.00]First line\n[00:14.20]Second line';
  const supabase = createSupabaseMock([
    { id: 'song-1', title: 'New song', lyrics: originalLyrics, created_at: '2026-07-18T00:00:00Z' }
  ]);
  const result = {
    state: 'completed',
    songId: 'song-1',
    sourceLyricsHash: hashLyrics(originalLyrics),
    lineCount: 2,
    confidence: 0.94,
    lrc
  };
  const fetchImpl = async () => createJsonResponse(200, {
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(result)).toString('base64')
  });
  const service = createLyricsSyncService({ supabase, fetchImpl });

  const outcome = await service.runOnce();

  assert.equal(outcome.appliedCount, 1);
  assert.equal(supabase.songs[0].lyrics, lrc);
  assert.equal(supabase.updates.length, 1);
  assert.deepEqual(supabase.updates[0].filters, [['id', 'song-1'], ['lyrics', originalLyrics]]);
});

test('stale results and songs that already have timing are never overwritten', async () => {
  const currentLyrics = 'Lyrics edited by user';
  const supabase = createSupabaseMock([
    { id: 'song-1', title: 'Edited song', lyrics: currentLyrics, created_at: '2026-07-18T00:00:00Z' },
    { id: 'song-2', title: 'Existing song', lyrics: '[00:03.20]Existing timing', created_at: '2026-07-01T00:00:00Z' }
  ]);
  const staleResult = {
    state: 'completed',
    songId: 'song-1',
    sourceLyricsHash: hashLyrics('Old lyrics'),
    lineCount: 1,
    confidence: 0.99,
    lrc: '[00:10.00]Old lyrics'
  };
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return createJsonResponse(200, {
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(staleResult)).toString('base64')
    });
  };
  const service = createLyricsSyncService({ supabase, fetchImpl });

  const outcome = await service.runOnce();

  assert.equal(outcome.appliedCount, 0);
  assert.equal(fetchCount, 1);
  assert.equal(supabase.updates.length, 0);
  assert.equal(hasTimedLyrics(supabase.songs[1].lyrics), true);
});
