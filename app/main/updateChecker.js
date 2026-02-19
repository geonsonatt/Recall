const CHECK_TIMEOUT_MS = 9000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeHttpUrl(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function parseVersion(version) {
  const raw = normalizeText(version).replace(/^v/i, '');
  if (!raw) {
    return { parts: [0, 0, 0], prerelease: '' };
  }

  const [core = '', prerelease = ''] = raw.split('-', 2);
  const segments = core.split('.').map((value) => {
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  });

  while (segments.length < 3) {
    segments.push(0);
  }

  return {
    parts: segments.slice(0, 3),
    prerelease,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] > b.parts[index]) {
      return 1;
    }
    if (a.parts[index] < b.parts[index]) {
      return -1;
    }
  }

  if (!a.prerelease && b.prerelease) {
    return 1;
  }
  if (a.prerelease && !b.prerelease) {
    return -1;
  }

  return a.prerelease.localeCompare(b.prerelease, 'en', { sensitivity: 'base' });
}

function extractDownloadUrl(entry) {
  if (!entry) {
    return '';
  }

  if (typeof entry === 'string') {
    return normalizeHttpUrl(entry);
  }

  if (typeof entry === 'object') {
    return normalizeHttpUrl(entry.url || entry.href || entry.downloadUrl);
  }

  return '';
}

function pickPlatformDownload(manifest, platform) {
  const downloads = manifest?.downloads && typeof manifest.downloads === 'object'
    ? manifest.downloads
    : {};

  const keyMap = {
    win32: ['win32', 'windows', 'win'],
    darwin: ['darwin', 'mac', 'macos', 'osx'],
    linux: ['linux'],
  };

  const keys = keyMap[platform] || [platform];

  for (const key of keys) {
    const fromDownloads = extractDownloadUrl(downloads[key]);
    if (fromDownloads) {
      return fromDownloads;
    }

    const topLevel = extractDownloadUrl(manifest?.[key]);
    if (topLevel) {
      return topLevel;
    }
  }

  return extractDownloadUrl(manifest?.url);
}

async function fetchWithTimeout(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function toUpdateErrorResult({
  currentVersion,
  manifestUrl,
  checkedAt,
  error,
}) {
  return {
    status: 'error',
    updateAvailable: false,
    currentVersion,
    latestVersion: currentVersion,
    manifestUrl,
    checkedAt,
    error: normalizeText(error) || 'Неизвестная ошибка проверки обновлений.',
  };
}

async function checkForUpdates({
  manifestUrl,
  currentVersion,
  platform,
  timeoutMs = CHECK_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const checkedAt = new Date().toISOString();
  const safeCurrentVersion = normalizeText(currentVersion) || '0.0.0';
  const safeManifestUrl = normalizeHttpUrl(manifestUrl);
  const safePlatform = normalizeText(platform) || process.platform;

  if (!safeManifestUrl) {
    return {
      status: 'disabled',
      updateAvailable: false,
      currentVersion: safeCurrentVersion,
      latestVersion: safeCurrentVersion,
      manifestUrl: '',
      checkedAt,
      error: 'Не указан URL манифеста обновлений.',
    };
  }

  if (typeof fetchImpl !== 'function') {
    return toUpdateErrorResult({
      currentVersion: safeCurrentVersion,
      manifestUrl: safeManifestUrl,
      checkedAt,
      error: 'HTTP-клиент недоступен в текущем окружении.',
    });
  }

  try {
    const response = await fetchWithTimeout(safeManifestUrl, Math.max(1000, Number(timeoutMs) || CHECK_TIMEOUT_MS), fetchImpl);
    if (!response.ok) {
      return toUpdateErrorResult({
        currentVersion: safeCurrentVersion,
        manifestUrl: safeManifestUrl,
        checkedAt,
        error: `Сервер обновлений вернул HTTP ${response.status}.`,
      });
    }

    const manifest = await response.json();
    const latestVersion = normalizeText(manifest?.version || manifest?.latestVersion);
    if (!latestVersion) {
      return toUpdateErrorResult({
        currentVersion: safeCurrentVersion,
        manifestUrl: safeManifestUrl,
        checkedAt,
        error: 'В манифесте обновлений отсутствует поле version.',
      });
    }

    const compare = compareVersions(latestVersion, safeCurrentVersion);
    const downloadUrl = pickPlatformDownload(manifest, safePlatform);
    const notes = normalizeText(manifest?.notes || manifest?.releaseNotes);
    const publishedAt = normalizeText(manifest?.publishedAt);

    if (compare <= 0) {
      return {
        status: 'up-to-date',
        updateAvailable: false,
        currentVersion: safeCurrentVersion,
        latestVersion,
        manifestUrl: safeManifestUrl,
        checkedAt,
        downloadUrl: '',
        notes,
        publishedAt,
      };
    }

    if (!downloadUrl) {
      return toUpdateErrorResult({
        currentVersion: safeCurrentVersion,
        manifestUrl: safeManifestUrl,
        checkedAt,
        error: `Для платформы ${safePlatform} не найдена ссылка на скачивание в манифесте.`,
      });
    }

    return {
      status: 'update-available',
      updateAvailable: true,
      currentVersion: safeCurrentVersion,
      latestVersion,
      manifestUrl: safeManifestUrl,
      checkedAt,
      downloadUrl,
      notes,
      publishedAt,
    };
  } catch (error) {
    return toUpdateErrorResult({
      currentVersion: safeCurrentVersion,
      manifestUrl: safeManifestUrl,
      checkedAt,
      error: error?.name === 'AbortError'
        ? 'Таймаут проверки обновлений.'
        : error?.message,
    });
  }
}

module.exports = {
  checkForUpdates,
  compareVersions,
  normalizeHttpUrl,
};
