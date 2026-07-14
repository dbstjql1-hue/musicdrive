const MAX_GITHUB_BLOB_BYTES = 100 * 1024 * 1024;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 1000;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function encodePath(value) {
  return String(value || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function createAssetSyncService({
  supabase,
  getStorageFileName,
  fetchImpl = global.fetch,
  env = process.env,
  logger = console
}) {
  const githubToken = env.GITHUB_ASSET_SYNC_TOKEN || env.GITHUB_TOKEN || '';
  const githubRepository = env.GITHUB_REPOSITORY || 'dbstjql1-hue/musicdrive';
  const githubBranch = env.GITHUB_BRANCH || 'main';
  const githubApiVersion = env.GITHUB_API_VERSION || '2026-03-10';
  const publicSiteUrl = normalizeBaseUrl(env.PUBLIC_SITE_URL || 'https://musicdrive.kro.kr');
  const syncIntervalMs = Math.max(Number(env.ASSET_SYNC_INTERVAL_MS) || DEFAULT_SYNC_INTERVAL_MS, 15_000);
  const [githubOwner, githubRepo] = githubRepository.split('/');
  const publishingConfigured = Boolean(githubToken && githubOwner && githubRepo);
  const verificationConfigured = Boolean(publicSiteUrl);

  let publishQueue = Promise.resolve();
  let runPromise = null;
  let intervalHandle = null;
  let retryHandle = null;
  const state = {
    isRunning: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null
  };

  function getStatus() {
    return {
      enabled: publishingConfigured && verificationConfigured,
      publishingConfigured,
      verificationConfigured,
      repository: githubRepository,
      branch: githubBranch,
      publicSiteUrl,
      isRunning: state.isRunning,
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError
    };
  }

  async function githubRequest(pathname, options = {}) {
    if (!publishingConfigured) {
      throw new Error('GITHUB_ASSET_SYNC_TOKEN 환경변수가 설정되지 않았습니다.');
    }

    const response = await fetchImpl(`https://api.github.com${pathname}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'musicdrive-asset-sync',
        'X-GitHub-Api-Version': githubApiVersion,
        ...options.headers
      }
    });

    const responseText = await response.text();
    let payload = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { message: responseText };
      }
    }

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${payload.message || '요청 실패'}`);
    }

    return payload;
  }

  function validatePublishFile(file) {
    const normalizedPath = String(file.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const allowedPath = /^frontend\/public\/(songs|covers)\/[a-zA-Z0-9._/-]+$/.test(normalizedPath)
      && !normalizedPath.split('/').includes('..');
    if (!allowedPath) throw new Error(`허용되지 않은 게시 경로입니다: ${normalizedPath}`);

    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || []);
    if (!buffer.length) throw new Error(`빈 파일은 게시할 수 없습니다: ${normalizedPath}`);
    if (buffer.length > MAX_GITHUB_BLOB_BYTES) {
      throw new Error(`GitHub 파일 제한(100MB)을 초과했습니다: ${normalizedPath}`);
    }

    return { path: normalizedPath, buffer };
  }

  async function publishFilesNow(files, message) {
    const uniqueFiles = Array.from(new Map(files.map(validatePublishFile).map(file => [file.path, file])).values());
    if (uniqueFiles.length === 0) return { changed: false, commitSha: null, fileCount: 0 };

    const repoBase = `/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}`;
    const branchRef = `heads/${encodePath(githubBranch)}`;
    const reference = await githubRequest(`${repoBase}/git/ref/${branchRef}`);
    const parentSha = reference.object?.sha;
    if (!parentSha) throw new Error('GitHub 브랜치의 최신 커밋을 확인하지 못했습니다.');

    const parentCommit = await githubRequest(`${repoBase}/git/commits/${encodeURIComponent(parentSha)}`);
    const baseTreeSha = parentCommit.tree?.sha;
    if (!baseTreeSha) throw new Error('GitHub 기준 트리를 확인하지 못했습니다.');

    const treeEntries = [];
    for (const file of uniqueFiles) {
      const blob = await githubRequest(`${repoBase}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: file.buffer.toString('base64'), encoding: 'base64' })
      });
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const tree = await githubRequest(`${repoBase}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
    });

    if (tree.sha === baseTreeSha) {
      return { changed: false, commitSha: parentSha, fileCount: uniqueFiles.length };
    }

    const commit = await githubRequest(`${repoBase}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: message || `sync: publish ${uniqueFiles.length} music asset(s)`,
        tree: tree.sha,
        parents: [parentSha]
      })
    });

    await githubRequest(`${repoBase}/git/refs/${branchRef}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });

    return { changed: true, commitSha: commit.sha, fileCount: uniqueFiles.length };
  }

  function publishFiles(files, message) {
    const task = publishQueue.then(() => publishFilesNow(files, message));
    publishQueue = task.catch(() => undefined);
    return task;
  }

  function getSongAssets(song) {
    const audioFileName = getStorageFileName(song.audio_url, 'songs');
    const coverFileName = getStorageFileName(song.cover_url, 'covers');
    return [
      audioFileName && { bucket: 'songs', fileName: audioFileName, dbField: 'audio_url' },
      coverFileName && { bucket: 'covers', fileName: coverFileName, dbField: 'cover_url' }
    ].filter(Boolean);
  }

  function getPublicAssetUrl(bucket, fileName) {
    return `${publicSiteUrl}/${encodePath(bucket)}/${encodePath(fileName)}`;
  }

  async function isPublicAssetReady(bucket, fileName) {
    if (!verificationConfigured) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(getPublicAssetUrl(bucket, fileName), {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function downloadStorageAsset(asset) {
    const { data, error } = await supabase.storage.from(asset.bucket).download(asset.fileName);
    if (error) throw new Error(`${asset.bucket}/${asset.fileName} 다운로드 실패: ${error.message}`);
    return {
      path: `frontend/public/${asset.bucket}/${asset.fileName}`,
      buffer: Buffer.from(await data.arrayBuffer())
    };
  }

  async function finalizeSong(song, assets, onEvent) {
    const updatePayload = {};
    for (const asset of assets) updatePayload[asset.dbField] = `/${asset.bucket}/${asset.fileName}`;

    const { error: updateError } = await supabase
      .from('songs')
      .update(updatePayload)
      .eq('id', song.id);
    if (updateError) throw new Error(`[${song.title}] DB URL 전환 실패: ${updateError.message}`);

    onEvent?.('step', `[${song.title}] 공개 파일 확인 및 DB URL 전환 완료`);
    for (const asset of assets) {
      const { error: removeError } = await supabase.storage.from(asset.bucket).remove([asset.fileName]);
      if (removeError) {
        onEvent?.('warning', `[${song.title}] ${asset.bucket} Storage 원본 정리 실패: ${removeError.message}`);
      }
    }
    onEvent?.('success', `[${song.title}] 자동 동기화 완료`);
  }

  async function executeRun({ publishMissing = true, onEvent } = {}) {
    state.isRunning = true;
    state.lastRunAt = new Date().toISOString();
    state.lastError = null;
    onEvent?.('start', '자동 동기화 검사를 시작합니다.');

    try {
      const { data: songs, error } = await supabase
        .from('songs')
        .select('id, title, audio_url, cover_url');
      if (error) throw error;

      const pendingSongs = (songs || []).filter(song => getSongAssets(song).length > 0);
      const filesToPublish = [];
      let finalizedCount = 0;
      let waitingCount = 0;

      for (const song of pendingSongs) {
        const assets = getSongAssets(song);
        const readiness = await Promise.all(assets.map(asset => isPublicAssetReady(asset.bucket, asset.fileName)));

        if (readiness.every(Boolean)) {
          try {
            await finalizeSong(song, assets, onEvent);
            finalizedCount += 1;
          } catch (songError) {
            waitingCount += 1;
            onEvent?.('error', songError.message);
          }
          continue;
        }

        waitingCount += 1;
        if (!publishMissing || !publishingConfigured) continue;

        for (let index = 0; index < assets.length; index += 1) {
          if (readiness[index]) continue;
          try {
            filesToPublish.push(await downloadStorageAsset(assets[index]));
          } catch (downloadError) {
            onEvent?.('error', `[${song.title}] ${downloadError.message}`);
          }
        }
      }

      let publishResult = null;
      if (filesToPublish.length > 0) {
        publishResult = await publishFiles(
          filesToPublish,
          `sync: automatically publish ${pendingSongs.length} music item(s)`
        );
        onEvent?.(
          'step',
          publishResult.changed
            ? `GitHub에 자산 ${publishResult.fileCount}개를 반영했습니다. 배포 확인 후 자동 전환됩니다.`
            : 'GitHub 자산 반영은 완료되어 있으며 배포를 기다리는 중입니다.'
        );
      }

      state.lastSuccessAt = new Date().toISOString();
      return { pendingCount: pendingSongs.length, finalizedCount, waitingCount, publishResult };
    } catch (error) {
      state.lastError = error.message;
      onEvent?.('error', `자동 동기화 오류: ${error.message}`);
      throw error;
    } finally {
      state.isRunning = false;
    }
  }

  function runOnce(options = {}) {
    if (!runPromise) {
      runPromise = executeRun(options).finally(() => {
        runPromise = null;
      });
    }
    return runPromise;
  }

  function scheduleSoon(delayMs = 20_000) {
    if (retryHandle) clearTimeout(retryHandle);
    retryHandle = setTimeout(() => {
      retryHandle = null;
      runOnce().catch(error => logger.warn('[asset-sync] 자동 재시도 실패:', error.message));
    }, delayMs);
    retryHandle.unref?.();
  }

  function start() {
    if (intervalHandle) return;
    scheduleSoon(5_000);
    intervalHandle = setInterval(() => {
      runOnce().catch(error => logger.warn('[asset-sync] 정기 동기화 실패:', error.message));
    }, syncIntervalMs);
    intervalHandle.unref?.();
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    if (retryHandle) clearTimeout(retryHandle);
    intervalHandle = null;
    retryHandle = null;
  }

  return {
    getStatus,
    getSongAssets,
    publishFiles,
    runOnce,
    scheduleSoon,
    start,
    stop
  };
}

module.exports = { createAssetSyncService, encodePath, normalizeBaseUrl };
