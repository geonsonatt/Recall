function sanitizeFileName(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDefaultExportBaseName(document) {
  return sanitizeFileName(document.title) || `документ-${document.id.slice(0, 8)}`;
}

function timestampForFile() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function normalizeIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set(values.map((value) => String(value)).filter(Boolean));
  return [...unique];
}

function pickOwnProps(source, keys = []) {
  if (!source || typeof source !== 'object') {
    return {};
  }

  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

function isTrustedIpcSender(event, devServerUrl = process.env.VITE_DEV_SERVER_URL) {
  const senderUrl = String(event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? '');
  if (!senderUrl) {
    return false;
  }

  if (senderUrl.startsWith('file://')) {
    return true;
  }

  if (!devServerUrl) {
    return false;
  }

  try {
    const senderOrigin = new URL(senderUrl).origin;
    const allowedOrigin = new URL(devServerUrl).origin;
    return senderOrigin === allowedOrigin;
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event, channel, devServerUrl = process.env.VITE_DEV_SERVER_URL) {
  if (isTrustedIpcSender(event, devServerUrl)) {
    return;
  }

  const senderUrl = String(event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? 'unknown');
  throw new Error(`Недоверенный IPC источник для "${channel}": ${senderUrl}`);
}

module.exports = {
  sanitizeFileName,
  getDefaultExportBaseName,
  timestampForFile,
  normalizeIds,
  pickOwnProps,
  isTrustedIpcSender,
  assertTrustedIpcSender,
};
