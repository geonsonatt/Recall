const IPC_CHANNELS = {
  LIBRARY_LIST_DOCUMENTS: 'library:list-documents',
  LIBRARY_IMPORT_PDF: 'library:import-pdf',
  LIBRARY_IMPORT_PDF_PATHS: 'library:import-pdf-paths',
  LIBRARY_UPDATE_DOCUMENT_META: 'library:update-document-meta',
  LIBRARY_DELETE_DOCUMENT: 'library:delete-document',
  LIBRARY_RESET_READING_STATE: 'library:reset-reading-state',

  DOCUMENT_GET: 'document:get',
  DOCUMENT_UPDATE_READING_STATE: 'document:update-reading-state',
  DOCUMENT_READ_PDF_BYTES: 'document:read-pdf-bytes',

  HIGHLIGHT_LIST: 'highlight:list',
  HIGHLIGHT_LIST_ALL: 'highlight:list-all',
  HIGHLIGHT_ADD: 'highlight:add',
  HIGHLIGHT_UPDATE: 'highlight:update',
  HIGHLIGHT_DELETE: 'highlight:delete',
  HIGHLIGHT_DELETE_MANY: 'highlight:delete-many',

  BOOKMARK_LIST: 'bookmark:list',
  BOOKMARK_ADD: 'bookmark:add',
  BOOKMARK_UPDATE: 'bookmark:update',
  BOOKMARK_DELETE: 'bookmark:delete',
  BOOKMARK_DELETE_MANY: 'bookmark:delete-many',

  COLLECTION_LIST: 'collection:list',
  COLLECTION_CREATE: 'collection:create',
  COLLECTION_UPDATE: 'collection:update',
  COLLECTION_DELETE: 'collection:delete',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  READING_GET_OVERVIEW: 'reading:get-overview',

  EXPORT_MARKDOWN: 'export:markdown',
  EXPORT_MARKDOWN_CUSTOM: 'export:markdown-custom',
  EXPORT_ANNOTATED_PDF: 'export:annotated-pdf',
  EXPORT_OBSIDIAN_BUNDLE: 'export:obsidian-bundle',
  EXPORT_NOTION_BUNDLE: 'export:notion-bundle',

  INSIGHTS_GENERATE_SRS: 'insights:generate-srs',
  INSIGHTS_BUILD_DIGEST: 'insights:build-digest',
  INSIGHTS_BUILD_GRAPH: 'insights:build-graph',
  INSIGHTS_ASK_LIBRARY: 'insights:ask-library',
  INSIGHTS_SUMMARIZE_HIGHLIGHTS: 'insights:summarize-highlights',
  INSIGHTS_REVIEW_HIGHLIGHT: 'insights:review-highlight',
  INSIGHTS_AI_ASSISTANT: 'insights:ai-assistant',

  APP_GET_STORAGE_PATHS: 'app:get-storage-paths',
  APP_BACKUP_DATA: 'app:backup-data',
  APP_RESTORE_DATA: 'app:restore-data',
  APP_REVEAL_USER_DATA: 'app:reveal-user-data',

  DIAGNOSTICS_SET_TRAY_CAPTURE: 'diagnostics:set-tray-capture',
  DIAGNOSTICS_PUSH_EVENTS: 'diagnostics:push-events',
};

const IPC_EVENTS = {
  APP_DEEP_LINK: 'app:deep-link',
};

const ERROR_CODE_PATTERN = /^\[([A-Z0-9_]+)\]\s*(.*)$/;

function createAppError(code, message, details) {
  const normalizedCode = String(code || 'E_UNKNOWN').trim() || 'E_UNKNOWN';
  const normalizedMessage = String(message || 'Неизвестная ошибка').trim() || 'Неизвестная ошибка';
  const error = new Error(`[${normalizedCode}] ${normalizedMessage}`);
  error.code = normalizedCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function parseAppError(error, fallbackCode = 'E_UNKNOWN') {
  if (!error) {
    return {
      code: fallbackCode,
      message: 'Неизвестная ошибка',
    };
  }

  const rawCode = String(error.code || '').trim();
  const rawMessage = String(error.message || '').trim();
  if (rawCode && rawMessage) {
    return {
      code: rawCode,
      message: rawMessage.replace(/^\[[A-Z0-9_]+\]\s*/, ''),
    };
  }

  const parsed = ERROR_CODE_PATTERN.exec(rawMessage);
  if (parsed) {
    return {
      code: parsed[1],
      message: parsed[2] || 'Неизвестная ошибка',
    };
  }

  return {
    code: fallbackCode,
    message: rawMessage || 'Неизвестная ошибка',
  };
}

function ensureAppError(error, fallbackCode = 'E_UNKNOWN') {
  const parsed = parseAppError(error, fallbackCode);
  if (error && typeof error === 'object') {
    error.code = parsed.code;
    error.message = `[${parsed.code}] ${parsed.message}`;
    return error;
  }
  return createAppError(parsed.code, parsed.message);
}

function ensureObjectPayload(payload, code, context = 'payload') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createAppError(code, `Некорректный формат ${context}.`);
  }
  return payload;
}

function ensureNonEmptyString(value, code, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw createAppError(code, `Не передано поле "${fieldName}".`);
  }
  return normalized;
}

function ensureOptionalString(value, code, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw createAppError(code, `Поле "${fieldName}" должно быть строкой.`);
  }
  return value;
}

function ensureOptionalBoolean(value, code, fieldName) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw createAppError(code, `Поле "${fieldName}" должно быть boolean.`);
  }
  return value;
}

function ensureOptionalNumber(value, code, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw createAppError(code, `Поле "${fieldName}" должно быть числом.`);
  }
  return number;
}

function ensureOptionalInt(value, code, fieldName, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = ensureOptionalNumber(value, code, fieldName);
  if (number === undefined) {
    return undefined;
  }

  const normalized = Math.trunc(number);
  if (normalized < min || normalized > max) {
    throw createAppError(
      code,
      `Поле "${fieldName}" должно быть целым числом в диапазоне ${min}..${max}.`,
    );
  }
  return normalized;
}

function ensureOptionalEnum(value, allowed, code, fieldName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = String(value);
  if (!allowed.includes(normalized)) {
    throw createAppError(code, `Поле "${fieldName}" имеет недопустимое значение.`);
  }
  return normalized;
}

function ensureOptionalStringArray(value, code, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw createAppError(code, `Поле "${fieldName}" должно быть массивом строк.`);
  }
  const result = value.map((item) => String(item));
  return result;
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

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function setOptionalField(target, source, key, validateValue) {
  if (!hasOwn(source, key)) {
    return;
  }
  target[key] = validateValue(source[key]);
}

function validateChannelPayload(channel, payload) {
  switch (channel) {
    case IPC_CHANNELS.LIBRARY_IMPORT_PDF_PATHS: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_IMPORT_PATHS', 'payload import-pdf-paths');
      return {
        paths: ensureOptionalStringArray(input.paths, 'E_CONTRACT_IMPORT_PATHS', 'paths') || [],
      };
    }

    case IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_DOC_META', 'payload update-document-meta');
      const result = {
        documentId: ensureNonEmptyString(input.documentId, 'E_CONTRACT_DOC_META', 'documentId'),
      };
      setOptionalField(result, input, 'isPinned', (value) =>
        ensureOptionalBoolean(value, 'E_CONTRACT_DOC_META', 'isPinned'),
      );
      setOptionalField(result, input, 'collectionId', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_DOC_META', 'collectionId'),
      );
      return result;
    }

    case IPC_CHANNELS.LIBRARY_RESET_READING_STATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_READING_RESET', 'payload reset-reading-state');
      return {
        documentId: ensureNonEmptyString(input.documentId, 'E_CONTRACT_READING_RESET', 'documentId'),
      };
    }

    case IPC_CHANNELS.DOCUMENT_UPDATE_READING_STATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_READING_STATE', 'payload update-reading-state');
      const result = {
        documentId: ensureNonEmptyString(input.documentId, 'E_CONTRACT_READING_STATE', 'documentId'),
      };
      setOptionalField(result, input, 'pageIndex', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_READING_STATE', 'pageIndex'),
      );
      setOptionalField(result, input, 'totalPages', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_READING_STATE', 'totalPages'),
      );
      setOptionalField(result, input, 'scale', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_READING_STATE', 'scale'),
      );
      setOptionalField(result, input, 'lastOpenedAt', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_READING_STATE', 'lastOpenedAt'),
      );
      setOptionalField(result, input, 'readingSeconds', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_READING_STATE', 'readingSeconds'),
      );
      setOptionalField(result, input, 'pagesDelta', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_READING_STATE', 'pagesDelta'),
      );
      setOptionalField(result, input, 'allowFirstPage', (value) =>
        ensureOptionalBoolean(value, 'E_CONTRACT_READING_STATE', 'allowFirstPage'),
      );
      return result;
    }

    case IPC_CHANNELS.HIGHLIGHT_UPDATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'payload highlight:update');
      const result = {
        id: ensureNonEmptyString(input.id, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'id'),
      };
      setOptionalField(result, input, 'pageIndex', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'pageIndex'),
      );
      if (hasOwn(input, 'rects')) {
        result.rects = input.rects;
      }
      setOptionalField(result, input, 'selectedText', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'selectedText'),
      );
      setOptionalField(result, input, 'selectedRichText', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'selectedRichText'),
      );
      setOptionalField(result, input, 'color', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'color'),
      );
      setOptionalField(result, input, 'note', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'note'),
      );
      setOptionalField(result, input, 'tags', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_HIGHLIGHT_UPDATE', 'tags'),
      );
      return result;
    }

    case IPC_CHANNELS.HIGHLIGHT_DELETE_MANY:
    case IPC_CHANNELS.BOOKMARK_DELETE_MANY: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_IDS', 'payload ids');
      return {
        ids: ensureOptionalStringArray(input.ids, 'E_CONTRACT_IDS', 'ids') || [],
      };
    }

    case IPC_CHANNELS.BOOKMARK_UPDATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_BOOKMARK_UPDATE', 'payload bookmark:update');
      const result = {
        id: ensureNonEmptyString(input.id, 'E_CONTRACT_BOOKMARK_UPDATE', 'id'),
      };
      setOptionalField(result, input, 'pageIndex', (value) =>
        ensureOptionalNumber(value, 'E_CONTRACT_BOOKMARK_UPDATE', 'pageIndex'),
      );
      setOptionalField(result, input, 'label', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_BOOKMARK_UPDATE', 'label'),
      );
      return result;
    }

    case IPC_CHANNELS.COLLECTION_CREATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_COLLECTION_CREATE', 'payload collection:create');
      return {
        id: ensureOptionalString(input.id, 'E_CONTRACT_COLLECTION_CREATE', 'id'),
        name: ensureNonEmptyString(input.name, 'E_CONTRACT_COLLECTION_CREATE', 'name'),
      };
    }

    case IPC_CHANNELS.COLLECTION_UPDATE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_COLLECTION_UPDATE', 'payload collection:update');
      return {
        id: ensureNonEmptyString(input.id, 'E_CONTRACT_COLLECTION_UPDATE', 'id'),
        name: ensureNonEmptyString(input.name, 'E_CONTRACT_COLLECTION_UPDATE', 'name'),
      };
    }

    case IPC_CHANNELS.EXPORT_MARKDOWN_CUSTOM: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM',
        'payload export-markdown-custom',
      );
      const result = {
        documentId: ensureNonEmptyString(
          input.documentId,
          'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM',
          'documentId',
        ),
      };
      setOptionalField(result, input, 'title', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM', 'title'),
      );
      setOptionalField(result, input, 'suffix', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM', 'suffix'),
      );
      setOptionalField(result, input, 'since', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM', 'since'),
      );
      setOptionalField(result, input, 'tags', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM', 'tags'),
      );
      setOptionalField(result, input, 'highlightIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_EXPORT_MARKDOWN_CUSTOM', 'highlightIds'),
      );
      return result;
    }

    case IPC_CHANNELS.EXPORT_OBSIDIAN_BUNDLE:
    case IPC_CHANNELS.EXPORT_NOTION_BUNDLE: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_EXPORT_BUNDLE', 'payload export bundle');
      const result = {};
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_EXPORT_BUNDLE', 'documentIds'),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_GENERATE_SRS: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_INSIGHTS_SRS', 'payload insights:srs');
      const result = {};
      setOptionalField(result, input, 'documentId', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_SRS', 'documentId'),
      );
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_SRS', 'documentIds'),
      );
      setOptionalField(result, input, 'highlightIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_SRS', 'highlightIds'),
      );
      setOptionalField(result, input, 'dueOnly', (value) =>
        ensureOptionalBoolean(value, 'E_CONTRACT_INSIGHTS_SRS', 'dueOnly'),
      );
      setOptionalField(result, input, 'limit', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_SRS', 'limit', 1, 1000),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_BUILD_DIGEST: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_INSIGHTS_DIGEST', 'payload insights:digest');
      const result = {
        period:
          ensureOptionalEnum(
            input.period,
            ['daily', 'weekly'],
            'E_CONTRACT_INSIGHTS_DIGEST',
            'period',
          ) || 'daily',
      };
      setOptionalField(result, input, 'anchorDate', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_DIGEST', 'anchorDate'),
      );
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_DIGEST', 'documentIds'),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_BUILD_GRAPH: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_INSIGHTS_GRAPH', 'payload insights:graph');
      const result = {};
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_GRAPH', 'documentIds'),
      );
      setOptionalField(result, input, 'topConcepts', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_GRAPH', 'topConcepts', 10, 220),
      );
      setOptionalField(result, input, 'minEdgeWeight', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_GRAPH', 'minEdgeWeight', 1, 100),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_ASK_LIBRARY: {
      const input = ensureObjectPayload(payload, 'E_CONTRACT_INSIGHTS_ASK', 'payload insights:ask-library');
      const result = {
        query: ensureNonEmptyString(input.query, 'E_CONTRACT_INSIGHTS_ASK', 'query'),
      };
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_ASK', 'documentIds'),
      );
      setOptionalField(result, input, 'limit', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_ASK', 'limit', 1, 20),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_SUMMARIZE_HIGHLIGHTS: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_INSIGHTS_SUMMARY',
        'payload insights:summarize-highlights',
      );
      const result = {};
      setOptionalField(result, input, 'documentId', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_SUMMARY', 'documentId'),
      );
      setOptionalField(result, input, 'highlightIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_SUMMARY', 'highlightIds'),
      );
      setOptionalField(result, input, 'pageStart', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_SUMMARY', 'pageStart', 1, 100000),
      );
      setOptionalField(result, input, 'pageEnd', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_SUMMARY', 'pageEnd', 1, 100000),
      );
      setOptionalField(result, input, 'maxSentences', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_SUMMARY', 'maxSentences', 2, 24),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_INSIGHTS_REVIEW',
        'payload insights:review-highlight',
      );
      const result = {
        highlightId: ensureNonEmptyString(
          input.highlightId,
          'E_CONTRACT_INSIGHTS_REVIEW',
          'highlightId',
        ),
        grade:
          ensureOptionalEnum(
            input.grade,
            ['hard', 'good', 'easy'],
            'E_CONTRACT_INSIGHTS_REVIEW',
            'grade',
          ) || 'good',
      };
      setOptionalField(result, input, 'nowIso', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_REVIEW', 'nowIso'),
      );
      return result;
    }

    case IPC_CHANNELS.INSIGHTS_AI_ASSISTANT: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_INSIGHTS_AI',
        'payload insights:ai-assistant',
      );
      const result = {};
      setOptionalField(result, input, 'documentId', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_AI', 'documentId'),
      );
      setOptionalField(result, input, 'documentIds', (value) =>
        ensureOptionalStringArray(value, 'E_CONTRACT_INSIGHTS_AI', 'documentIds'),
      );
      setOptionalField(result, input, 'question', (value) =>
        ensureOptionalString(value, 'E_CONTRACT_INSIGHTS_AI', 'question'),
      );
      setOptionalField(result, input, 'mode', (value) =>
        ensureOptionalEnum(
          value,
          ['focus', 'research', 'review'],
          'E_CONTRACT_INSIGHTS_AI',
          'mode',
        ),
      );
      setOptionalField(result, input, 'provider', (value) =>
        ensureOptionalEnum(
          value,
          ['auto', 'local', 'ollama', 'openai'],
          'E_CONTRACT_INSIGHTS_AI',
          'provider',
        ),
      );
      setOptionalField(result, input, 'maxActions', (value) =>
        ensureOptionalInt(value, 'E_CONTRACT_INSIGHTS_AI', 'maxActions', 3, 20),
      );
      return result;
    }

    case IPC_CHANNELS.DIAGNOSTICS_SET_TRAY_CAPTURE: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_DIAGNOSTICS_CAPTURE',
        'payload diagnostics:set-tray-capture',
      );
      return {
        enabled: Boolean(input.enabled),
      };
    }

    case IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS: {
      const input = ensureObjectPayload(
        payload,
        'E_CONTRACT_DIAGNOSTICS_EVENTS',
        'payload diagnostics:push-events',
      );
      if (!Array.isArray(input.events)) {
        throw createAppError(
          'E_CONTRACT_DIAGNOSTICS_EVENTS',
          'Поле "events" должно быть массивом объектов.',
        );
      }

      const events = input.events.slice(0, 300).map((item, index) => {
        const event = ensureObjectPayload(
          item,
          'E_CONTRACT_DIAGNOSTICS_EVENTS',
          `diagnostics event #${index + 1}`,
        );
        const result = {
          id: ensureOptionalString(event.id, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'id') || '',
          ts: ensureOptionalString(event.ts, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'ts') || '',
          scope: ensureOptionalString(event.scope, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'scope') || 'system',
          level:
            ensureOptionalEnum(
              event.level,
              ['info', 'warn', 'error'],
              'E_CONTRACT_DIAGNOSTICS_EVENTS',
              'level',
            ) || 'info',
          type:
            ensureOptionalEnum(
              event.type,
              ['event', 'metric'],
              'E_CONTRACT_DIAGNOSTICS_EVENTS',
              'type',
            ) || 'event',
          name: ensureOptionalString(event.name, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'name') || 'unknown',
        };
        setOptionalField(result, event, 'actionId', (value) =>
          ensureOptionalString(value, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'actionId'),
        );
        setOptionalField(result, event, 'documentId', (value) =>
          ensureOptionalString(value, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'documentId'),
        );
        setOptionalField(result, event, 'highlightId', (value) =>
          ensureOptionalString(value, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'highlightId'),
        );
        setOptionalField(result, event, 'durationMs', (value) =>
          ensureOptionalNumber(value, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'durationMs'),
        );
        setOptionalField(result, event, 'details', (value) =>
          ensureOptionalString(value, 'E_CONTRACT_DIAGNOSTICS_EVENTS', 'details'),
        );
        if (Object.prototype.hasOwnProperty.call(event, 'data')) {
          result.data = event.data;
        }
        return result;
      });

      return { events };
    }

    default:
      return payload;
  }
}

module.exports = {
  IPC_CHANNELS,
  IPC_EVENTS,
  createAppError,
  ensureAppError,
  parseAppError,
  pickOwnProps,
  validateChannelPayload,
};
