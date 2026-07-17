const crypto = require('crypto');

const DEFAULT_INTERVAL_MS = 30_000;
const RESULT_RECHECK_MS = 60_000;
const LRC_TIMESTAMP_PATTERN = /^\[\d{1,2}:\d{2}(?:\.\d{2,3})?\]/;

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function getPlainLyricsLines(value) {
  return normalizeLineEndings(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function hasTimedLyrics(value) {
  return getPlainLyricsLines(value).some(line => LRC_TIMESTAMP_PATTERN.test(line));
}

function hashLyrics(value) {
  return crypto.createHash('sha256').update(normalizeLineEndings(value), 'utf8').digest('hex');
}

function countTimedLines(value) {
  return getPlainLyricsLines(value).filter(line => LRC_TIMESTAMP_PATTERN.test(line)).length;
}

function encodeRepositoryPath(value) {
  return String(value || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function createLyricsSyncService({
  supabase,
  fetchImpl = global.fetch,
  env = process.env,
  logger = console
}) {
  const githubToken = env.GITHUB_ASSET_SYNC_TOKEN || env.GITHUB_TOKEN || '';
  const githubRepository = env.GITHUB_REPOSITORY || 'dbstjql1-hue/musicdrive';
  const githubBranch = env.GITHUB_BRANCH || 'main';
  const intervalMs = Math.max(Number(env.LYRICS_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS, 15_000);
  const [githubOwner, githubRepo] = githubRepository.split('/');
  const configured = Boolean(githubOwner && githubRepo && fetchImpl);
  const resultRecheckAt = new Map();

  let intervalHandle = null;
  let retryHandle = null;
  let runPromise = null;
  const state = {
    isRunning: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastAppliedSongId: null
  };

  function getStatus() {
    return {
      enabled: configured,
      repository: githubRepository,
      branch: githubBranch,
      intervalMs,
      ...state
    };
  }

  async function fetchResult(songId) {
    const repositoryPath = encodeRepositoryPath(`frontend/public/lyrics-sync-results/${songId}.json`);
    const response = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/contents/${repositoryPath}?ref=${encodeURIComponent(githubBranch)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          'User-Agent': 'musicdrive-lyrics-sync'
        }
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub lyric result request failed (${response.status})`);

    const payload = await response.json();
    if (!payload?.content || payload.encoding !== 'base64') {
      throw new Error('GitHub lyric result has an invalid format.');
    }

    return JSON.parse(Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  }

  function validateResult(song, result) {
    const expectedLineCount = getPlainLyricsLines(song.lyrics).length;
    return Boolean(
      result
      && result.state === 'completed'
      && result.songId === song.id
      && result.sourceLyricsHash === hashLyrics(song.lyrics)
      && Number(result.lineCount) === expectedLineCount
      && countTimedLines(result.lrc) === expectedLineCount
      && Number(result.confidence) >= 0.6
    );
  }

  async function executeRun() {
    if (!configured) return { checkedCount: 0, appliedCount: 0, configured: false };

    state.isRunning = true;
    state.lastRunAt = new Date().toISOString();
    state.lastError = null;

    try {
      const { data: songs, error } = await supabase
        .from('songs')
        .select('id, title, lyrics, created_at');
      if (error) throw error;

      const pendingSongs = (songs || []).filter(song => {
        const lyrics = normalizeLineEndings(song.lyrics);
        return lyrics && !hasTimedLyrics(lyrics);
      });

      let checkedCount = 0;
      let appliedCount = 0;
      const now = Date.now();

      for (const song of pendingSongs) {
        if ((resultRecheckAt.get(song.id) || 0) > now) continue;
        checkedCount += 1;

        const result = await fetchResult(song.id);
        if (!result || !validateResult(song, result)) {
          resultRecheckAt.set(song.id, now + RESULT_RECHECK_MS);
          continue;
        }

        const originalLyrics = song.lyrics;
        const { data: updatedRows, error: updateError } = await supabase
          .from('songs')
          .update({ lyrics: result.lrc })
          .eq('id', song.id)
          .eq('lyrics', originalLyrics)
          .select('id');
        if (updateError) throw updateError;

        if ((updatedRows || []).length > 0) {
          appliedCount += 1;
          state.lastAppliedSongId = song.id;
          resultRecheckAt.delete(song.id);
          logger.info(`[lyrics-sync] Applied automatic timing to [${song.title}]`);
        }
      }

      state.lastSuccessAt = new Date().toISOString();
      return { checkedCount, appliedCount, configured: true };
    } catch (error) {
      state.lastError = error.message;
      throw error;
    } finally {
      state.isRunning = false;
    }
  }

  function runOnce() {
    if (!runPromise) {
      runPromise = executeRun().finally(() => {
        runPromise = null;
      });
    }
    return runPromise;
  }

  function scheduleSoon(delayMs = 30_000) {
    if (retryHandle) clearTimeout(retryHandle);
    retryHandle = setTimeout(() => {
      retryHandle = null;
      runOnce().catch(error => logger.warn('[lyrics-sync] Result check failed:', error.message));
    }, delayMs);
    retryHandle.unref?.();
  }

  function start() {
    if (intervalHandle) return;
    scheduleSoon(5_000);
    intervalHandle = setInterval(() => {
      runOnce().catch(error => logger.warn('[lyrics-sync] Scheduled check failed:', error.message));
    }, intervalMs);
    intervalHandle.unref?.();
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    if (retryHandle) clearTimeout(retryHandle);
    intervalHandle = null;
    retryHandle = null;
  }

  return { getStatus, runOnce, scheduleSoon, start, stop };
}

module.exports = {
  countTimedLines,
  createLyricsSyncService,
  getPlainLyricsLines,
  hasTimedLyrics,
  hashLyrics,
  normalizeLineEndings
};
