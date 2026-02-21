import { describe, expect, it } from 'vitest';
import contracts from '../app/shared/contracts.js';

const {
  IPC_CHANNELS,
  createAppError,
  parseAppError,
  validateChannelPayload,
} = contracts;

describe('shared contracts', () => {
  it('parses and formats coded errors', () => {
    const error = createAppError('E_TEST', 'Ошибка проверки');
    expect(error.message).toContain('[E_TEST]');

    expect(parseAppError(error)).toEqual({
      code: 'E_TEST',
      message: 'Ошибка проверки',
    });

    expect(
      parseAppError(new Error('[E_OTHER] Ошибка другого типа'), 'E_FALLBACK'),
    ).toEqual({
      code: 'E_OTHER',
      message: 'Ошибка другого типа',
    });
  });

  it('validates update payloads and keeps only contract fields', () => {
    const documentMeta = validateChannelPayload(IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META, {
      documentId: 'doc-1',
      isPinned: true,
      collectionId: 'col-1',
      unknown: 1,
    });

    expect(documentMeta).toEqual({
      documentId: 'doc-1',
      isPinned: true,
      collectionId: 'col-1',
    });

    const highlightPatch = validateChannelPayload(IPC_CHANNELS.HIGHLIGHT_UPDATE, {
      id: 'hl-1',
      color: 'green',
      note: 'note',
      tags: ['a', 'b'],
      weird: 'drop-me',
    });

    expect(highlightPatch).toEqual({
      id: 'hl-1',
      color: 'green',
      note: 'note',
      tags: ['a', 'b'],
    });

    const documentMetaPatch = validateChannelPayload(IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META, {
      documentId: 'doc-2',
      isPinned: false,
    });

    expect(documentMetaPatch).toEqual({
      documentId: 'doc-2',
      isPinned: false,
    });
    expect(Object.prototype.hasOwnProperty.call(documentMetaPatch, 'collectionId')).toBe(false);

    const bookmarkPatch = validateChannelPayload(IPC_CHANNELS.BOOKMARK_UPDATE, {
      id: 'bm-1',
      pageIndex: 4,
    });

    expect(bookmarkPatch).toEqual({
      id: 'bm-1',
      pageIndex: 4,
    });
    expect(Object.prototype.hasOwnProperty.call(bookmarkPatch, 'label')).toBe(false);

    const trayCapture = validateChannelPayload(IPC_CHANNELS.DIAGNOSTICS_SET_TRAY_CAPTURE, {
      enabled: 1,
    });
    expect(trayCapture).toEqual({ enabled: true });

    const trayEvents = validateChannelPayload(IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS, {
      events: [
        {
          id: 'e-1',
          ts: '2026-02-21T10:00:00.000Z',
          scope: 'ui',
          level: 'info',
          type: 'event',
          name: 'ui.click',
          details: 'ok',
        },
      ],
    });
    expect(trayEvents.events).toHaveLength(1);
    expect(trayEvents.events[0]).toMatchObject({
      id: 'e-1',
      scope: 'ui',
      level: 'info',
      type: 'event',
      name: 'ui.click',
      details: 'ok',
    });

    const srsPayload = validateChannelPayload(IPC_CHANNELS.INSIGHTS_GENERATE_SRS, {
      documentId: 'doc-1',
      dueOnly: true,
      limit: 120,
    });
    expect(srsPayload).toEqual({
      documentId: 'doc-1',
      dueOnly: true,
      limit: 120,
    });

    const askPayload = validateChannelPayload(IPC_CHANNELS.INSIGHTS_ASK_LIBRARY, {
      query: 'симулякры и власть',
      documentIds: ['doc-1'],
      limit: 8,
    });
    expect(askPayload).toEqual({
      query: 'симулякры и власть',
      documentIds: ['doc-1'],
      limit: 8,
    });

    const reviewPayload = validateChannelPayload(IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT, {
      highlightId: 'hl-1',
      grade: 'easy',
    });
    expect(reviewPayload).toEqual({
      highlightId: 'hl-1',
      grade: 'easy',
    });

    const aiPayload = validateChannelPayload(IPC_CHANNELS.INSIGHTS_AI_ASSISTANT, {
      documentId: 'doc-1',
      mode: 'review',
      provider: 'api',
      question: 'Что повторять?',
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
      analysisDepth: 'deep',
      maxEvidence: 32,
      maxActions: 7,
    });
    expect(aiPayload).toEqual({
      documentId: 'doc-1',
      mode: 'review',
      provider: 'api',
      question: 'Что повторять?',
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
      analysisDepth: 'deep',
      maxEvidence: 32,
      maxActions: 7,
    });
  });

  it('throws coded errors for invalid payloads', () => {
    expect(() =>
      validateChannelPayload(IPC_CHANNELS.HIGHLIGHT_UPDATE, {
        id: '',
      }),
    ).toThrow('[E_CONTRACT_HIGHLIGHT_UPDATE]');

    expect(() =>
      validateChannelPayload(IPC_CHANNELS.DOCUMENT_UPDATE_READING_STATE, {
        documentId: 'doc-1',
        pageIndex: 'not-a-number',
      }),
    ).toThrow('[E_CONTRACT_READING_STATE]');

    expect(() =>
      validateChannelPayload(IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS, {
        events: [{ id: 'e-1', level: 'fatal' }],
      }),
    ).toThrow('[E_CONTRACT_DIAGNOSTICS_EVENTS]');

    expect(() =>
      validateChannelPayload(IPC_CHANNELS.INSIGHTS_ASK_LIBRARY, {
        query: '',
      }),
    ).toThrow('[E_CONTRACT_INSIGHTS_ASK]');

    expect(() =>
      validateChannelPayload(IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT, {
        highlightId: 'hl-1',
        grade: 'invalid-grade',
      }),
    ).toThrow('[E_CONTRACT_INSIGHTS_REVIEW]');

    expect(() =>
      validateChannelPayload(IPC_CHANNELS.INSIGHTS_AI_ASSISTANT, {
        mode: 'unknown',
      }),
    ).toThrow('[E_CONTRACT_INSIGHTS_AI]');
  });
});
