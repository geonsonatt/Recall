const fs = require('node:fs/promises');
const path = require('node:path');
const { Menu, Tray, clipboard, nativeImage, shell } = require('electron');

const MAX_BUFFERED_EVENTS = 280;
const MAX_MENU_EVENTS = 8;

let tray = null;
let trayCaptureEnabled = false;
let totalAcceptedEvents = 0;
let totalDroppedEvents = 0;
let lastEventAt = '';
let lastSyncAt = '';
let recentEvents = [];
let logFilePath = '';
let appDisplayName = 'Recall PDF';
let openWindowHandler = null;
let appendQueue = Promise.resolve();
let fallbackEventSeq = 0;

function nowIso() {
  return new Date().toISOString();
}

function shortTime(value) {
  try {
    return new Date(value || nowIso()).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return 'n/a';
  }
}

function normalizeText(value, max = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeDiagnosticsEvent(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const tsRaw = String(raw.ts || nowIso());
  const tsDate = new Date(tsRaw);
  const ts = Number.isNaN(tsDate.valueOf()) ? nowIso() : tsDate.toISOString();
  const incomingId = String(raw.id || '').trim();
  fallbackEventSeq += 1;
  const id = incomingId || `tray-${Date.now()}-${fallbackEventSeq}`;
  const scope = String(raw.scope || 'system');
  const name = String(raw.name || 'unknown');
  const levelRaw = String(raw.level || 'info');
  const typeRaw = String(raw.type || 'event');
  const level = levelRaw === 'warn' || levelRaw === 'error' ? levelRaw : 'info';
  const type = typeRaw === 'metric' ? 'metric' : 'event';

  const payload = {
    id,
    ts,
    scope,
    name,
    level,
    type,
    actionId: normalizeText(raw.actionId, 72),
    documentId: normalizeText(raw.documentId, 72),
    highlightId: normalizeText(raw.highlightId, 72),
    durationMs:
      Number.isFinite(Number(raw.durationMs)) && Number(raw.durationMs) >= 0
        ? Number(raw.durationMs)
        : undefined,
    details: normalizeText(raw.details, 220),
    data: raw.data,
  };

  const parts = [
    `[${shortTime(ts)}]`,
    level.toUpperCase(),
    `${scope}.${name}`,
  ];

  if (payload.actionId) {
    parts.push(`action=${payload.actionId}`);
  }
  if (payload.documentId) {
    parts.push(`doc=${payload.documentId}`);
  }
  if (payload.highlightId) {
    parts.push(`hl=${payload.highlightId}`);
  }
  if (Number.isFinite(payload.durationMs)) {
    parts.push(`${payload.durationMs.toFixed(1)}ms`);
  }
  if (payload.details) {
    parts.push(`:: ${payload.details}`);
  }

  const line = normalizeText(parts.join(' '), 520);
  return {
    ...payload,
    line,
    menuLabel: normalizeText(line, 120),
  };
}

function safeJsonStringify(value, max = 420) {
  try {
    return normalizeText(JSON.stringify(value), max);
  } catch {
    return '[unserializable]';
  }
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="8" y="8" width="48" height="48" rx="12" fill="#1d4f97" />
      <rect x="18" y="20" width="28" height="4" rx="2" fill="#ffffff" />
      <rect x="18" y="30" width="22" height="4" rx="2" fill="#d5e5ff" />
      <rect x="18" y="40" width="18" height="4" rx="2" fill="#9fc0f7" />
    </svg>
  `;

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const image = nativeImage.createFromDataURL(dataUrl);
  return image.resize({ width: 18, height: 18 });
}

function getTrayState() {
  return {
    enabled: trayCaptureEnabled,
    buffered: recentEvents.length,
    total: totalAcceptedEvents,
    dropped: totalDroppedEvents,
    lastEventAt,
    lastSyncAt,
    logFilePath: logFilePath || undefined,
  };
}

function appendLines(lines = []) {
  if (!logFilePath || lines.length === 0) {
    return Promise.resolve();
  }

  appendQueue = appendQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(logFilePath), { recursive: true });
      await fs.appendFile(logFilePath, `${lines.join('\n')}\n`, 'utf8');
    })
    .catch(() => undefined);

  return appendQueue;
}

function updateTrayUi() {
  if (!tray) {
    return;
  }

  const tooltipParts = [
    appDisplayName,
    `diag ${trayCaptureEnabled ? 'on' : 'off'}`,
    `events ${totalAcceptedEvents}`,
  ];

  const template = [
    {
      label: `Diagnostics: ${trayCaptureEnabled ? 'ON' : 'OFF'}`,
      enabled: false,
    },
    {
      label: `Всего событий: ${totalAcceptedEvents} · в буфере: ${recentEvents.length}`,
      enabled: false,
    },
    lastEventAt
      ? {
          label: `Последнее событие: ${shortTime(lastEventAt)}`,
          enabled: false,
        }
      : {
          label: 'События пока не поступали',
          enabled: false,
        },
    { type: 'separator' },
    {
      label: 'Лог в трее',
      type: 'checkbox',
      checked: trayCaptureEnabled,
      click: () => {
        setDiagnosticsTrayCapture(!trayCaptureEnabled);
      },
    },
    {
      label: 'Открыть приложение',
      click: () => {
        if (typeof openWindowHandler === 'function') {
          openWindowHandler();
        }
      },
    },
    logFilePath
      ? {
          label: 'Открыть файл логов',
          click: () => {
            shell.showItemInFolder(logFilePath);
          },
        }
      : {
          label: 'Файл логов не настроен',
          enabled: false,
        },
    {
      label: 'Очистить буфер событий',
      click: () => {
        recentEvents = [];
        updateTrayUi();
      },
    },
  ];

  if (recentEvents.length > 0) {
    template.push({ type: 'separator' });
    template.push({
      label: 'Последние события',
      submenu: recentEvents.slice(0, MAX_MENU_EVENTS).map((event) => ({
        label: event.menuLabel,
        click: () => {
          clipboard.writeText(event.line);
        },
      })),
    });
  }

  tray.setToolTip(tooltipParts.join(' · '));
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function ensureTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(createTrayIcon());
  tray.on('click', () => {
    if (typeof openWindowHandler === 'function') {
      openWindowHandler();
    }
  });

  updateTrayUi();
  return tray;
}

function tryEnsureTray() {
  try {
    return ensureTray();
  } catch {
    return null;
  }
}

function initializeDiagnosticsTray(options = {}) {
  appDisplayName = normalizeText(options.appName || appDisplayName, 60) || appDisplayName;
  openWindowHandler = typeof options.onOpenMainWindow === 'function' ? options.onOpenMainWindow : null;

  const userDataPath = String(options.userDataPath || '').trim();
  if (userDataPath) {
    logFilePath = path.join(userDataPath, 'logs', 'diagnostics-tray.log');
  }

  tryEnsureTray();
  updateTrayUi();
  return getTrayState();
}

function setDiagnosticsTrayCapture(enabled) {
  trayCaptureEnabled = Boolean(enabled);
  lastSyncAt = nowIso();
  if (trayCaptureEnabled || tray) {
    tryEnsureTray();
    updateTrayUi();
  }
  return {
    enabled: trayCaptureEnabled,
    buffered: recentEvents.length,
    total: totalAcceptedEvents,
  };
}

function appendDiagnosticsEvents(events = []) {
  if (!trayCaptureEnabled) {
    return {
      accepted: 0,
      buffered: recentEvents.length,
      total: totalAcceptedEvents,
    };
  }

  const normalized = [];
  for (const item of Array.isArray(events) ? events : []) {
    const event = normalizeDiagnosticsEvent(item);
    if (event) {
      normalized.push(event);
    }
  }

  if (normalized.length === 0) {
    return {
      accepted: 0,
      buffered: recentEvents.length,
      total: totalAcceptedEvents,
    };
  }

  totalAcceptedEvents += normalized.length;
  lastEventAt = normalized[normalized.length - 1].ts;
  recentEvents = [...normalized.reverse(), ...recentEvents];

  if (recentEvents.length > MAX_BUFFERED_EVENTS) {
    totalDroppedEvents += recentEvents.length - MAX_BUFFERED_EVENTS;
    recentEvents = recentEvents.slice(0, MAX_BUFFERED_EVENTS);
  }

  const serialized = normalized.map((event) => {
    const dataText = event.data !== undefined ? ` data=${safeJsonStringify(event.data, 420)}` : '';
    return `${event.line}${dataText}`;
  });
  void appendLines(serialized);

  tryEnsureTray();
  updateTrayUi();
  return {
    accepted: normalized.length,
    buffered: recentEvents.length,
    total: totalAcceptedEvents,
  };
}

function disposeDiagnosticsTray() {
  if (!tray) {
    return;
  }
  tray.destroy();
  tray = null;
}

module.exports = {
  initializeDiagnosticsTray,
  setDiagnosticsTrayCapture,
  appendDiagnosticsEvents,
  getDiagnosticsTrayState: getTrayState,
  disposeDiagnosticsTray,
};
