const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssetSyncService, encodePath } = require('./asset-sync');

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(payload)
  };
}

test('encodePath encodes every path segment', () => {
  assert.equal(encodePath('songs/demo track.mp3'), 'songs/demo%20track.mp3');
});

test('publishFiles creates blobs, one tree, one commit, and advances the branch', async () => {
  const calls = [];
  let blobIndex = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/git/ref/heads/main')) return jsonResponse(200, { object: { sha: 'parent-sha' } });
    if (url.endsWith('/git/commits/parent-sha') && method === 'GET') return jsonResponse(200, { tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs')) return jsonResponse(201, { sha: `blob-${++blobIndex}` });
    if (url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'new-tree' });
    if (url.endsWith('/git/commits') && method === 'POST') return jsonResponse(201, { sha: 'new-commit' });
    if (url.endsWith('/git/refs/heads/main')) return jsonResponse(200, { object: { sha: 'new-commit' } });
    return jsonResponse(404, { message: 'not found' });
  };

  const service = createAssetSyncService({
    supabase: {},
    getStorageFileName: () => null,
    fetchImpl,
    env: {
      GITHUB_ASSET_SYNC_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_BRANCH: 'main',
      PUBLIC_SITE_URL: 'https://music.example.com'
    }
  });

  const result = await service.publishFiles([
    { path: 'frontend/public/songs/song.mp3', buffer: Buffer.from('audio') },
    { path: 'frontend/public/covers/cover.png', buffer: Buffer.from('cover') }
  ], 'sync: test assets');

  assert.deepEqual(result, { changed: true, commitSha: 'new-commit', fileCount: 2 });
  assert.equal(calls.filter(call => call.url.endsWith('/git/blobs')).length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/git/trees')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/git/commits') && call.method === 'POST').length, 1);
  const refUpdate = calls.find(call => call.url.endsWith('/git/refs/heads/main'));
  assert.deepEqual(refUpdate.body, { sha: 'new-commit', force: false });
});

test('runOnce changes DB URLs before removing verified Storage originals', async () => {
  const operations = [];
  const song = {
    id: 'song-1',
    title: '테스트 곡',
    audio_url: 'https://project.supabase.co/storage/v1/object/public/songs/song.mp3',
    cover_url: 'https://project.supabase.co/storage/v1/object/public/covers/cover.png'
  };

  const supabase = {
    from(table) {
      assert.equal(table, 'songs');
      return {
        select: async () => ({ data: [song], error: null }),
        update(payload) {
          return {
            async eq(column, value) {
              operations.push({ type: 'update', payload, column, value });
              return { error: null };
            }
          };
        }
      };
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            operations.push({ type: 'remove', bucket, paths });
            return { error: null };
          }
        };
      }
    }
  };

  const getStorageFileName = (url, bucket) => {
    const marker = `/storage/v1/object/public/${bucket}/`;
    return url.includes(marker) ? url.split(marker)[1] : null;
  };
  const fetchImpl = async () => jsonResponse(200, {}, { 'content-type': 'application/octet-stream' });
  const service = createAssetSyncService({
    supabase,
    getStorageFileName,
    fetchImpl,
    env: { PUBLIC_SITE_URL: 'https://music.example.com' }
  });

  const result = await service.runOnce({ publishMissing: false });

  assert.equal(result.finalizedCount, 1);
  assert.deepEqual(operations[0], {
    type: 'update',
    payload: { audio_url: '/songs/song.mp3', cover_url: '/covers/cover.png' },
    column: 'id',
    value: 'song-1'
  });
  assert.deepEqual(operations.slice(1), [
    { type: 'remove', bucket: 'songs', paths: ['song.mp3'] },
    { type: 'remove', bucket: 'covers', paths: ['cover.png'] }
  ]);
});
