// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightsView } from '../app/renderer/src/app/features/highlights/HighlightsView';
import type { DocumentRecord, HighlightRecord } from '../app/renderer/src/app/types';

const documents: DocumentRecord[] = [
  {
    id: 'doc-1',
    title: 'Книга 1',
    filePath: '/tmp/1.pdf',
    createdAt: '2026-02-19T10:00:00.000Z',
    highlightsCount: 2,
  },
  {
    id: 'doc-2',
    title: 'Книга 2',
    filePath: '/tmp/2.pdf',
    createdAt: '2026-02-19T10:00:00.000Z',
    highlightsCount: 1,
  },
];

const highlights: HighlightRecord[] = [
  {
    id: 'hl-1',
    documentId: 'doc-1',
    pageIndex: 5,
    rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
    selectedText: 'Первый текст',
    color: 'yellow',
    tags: ['философия'],
    createdAt: '2026-02-19T11:00:00.000Z',
  },
  {
    id: 'hl-2',
    documentId: 'doc-1',
    pageIndex: 8,
    rects: [{ x: 0.2, y: 0.3, w: 0.2, h: 0.03 }],
    selectedText: 'Второй текст',
    color: 'green',
    note: 'Важная заметка',
    createdAt: '2026-02-19T12:00:00.000Z',
  },
  {
    id: 'hl-3',
    documentId: 'doc-2',
    pageIndex: 1,
    rects: [{ x: 0.15, y: 0.25, w: 0.2, h: 0.04 }],
    selectedText: 'Третий текст',
    color: 'pink',
    tags: ['история'],
    createdAt: '2026-02-19T13:00:00.000Z',
  },
];

describe('HighlightsView', () => {
  it('filters by query, context and document; supports open/delete actions', () => {
    const onChangeSearch = vi.fn();
    const onChangeContextOnly = vi.fn();
    const onChangeDocumentFilter = vi.fn();
    const onOpenReaderHighlight = vi.fn();
    const onDeleteHighlight = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <HighlightsView
        workspacePreset="research"
        documents={documents}
        highlights={highlights}
        activeDocumentId="doc-1"
        currentPageIndex={6}
        search=""
        contextOnly={false}
        documentFilter="all"
        onChangeSearch={onChangeSearch}
        onChangeContextOnly={onChangeContextOnly}
        onChangeDocumentFilter={onChangeDocumentFilter}
        onOpenReaderHighlight={onOpenReaderHighlight}
        onCopyHighlightLink={vi.fn()}
        onNotify={vi.fn()}
        onDeleteHighlight={onDeleteHighlight}
        onDeleteHighlightsBatch={vi.fn().mockResolvedValue(undefined)}
        onUpdateHighlight={vi.fn().mockResolvedValue(undefined)}
        savedSmartViews={[]}
        onSaveSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onDeleteSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTouchSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTogglePinSmartFilter={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Книга 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Книга 2' })).toBeInTheDocument();
    expect(screen.getByText('3 результатов')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Текст, заметка или тег'), {
      target: { value: 'заметка' },
    });
    expect(onChangeSearch).toHaveBeenCalledWith('заметка');

    fireEvent.click(screen.getByLabelText('Только рядом с текущей страницей (±3)'));
    expect(onChangeContextOnly).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByLabelText('Книга'), { target: { value: 'doc-2' } });
    expect(onChangeDocumentFilter).toHaveBeenCalledWith('doc-2');

    rerender(
      <HighlightsView
        workspacePreset="research"
        documents={documents}
        highlights={highlights}
        activeDocumentId="doc-1"
        currentPageIndex={6}
        search="история"
        contextOnly={false}
        documentFilter="all"
        onChangeSearch={onChangeSearch}
        onChangeContextOnly={onChangeContextOnly}
        onChangeDocumentFilter={onChangeDocumentFilter}
        onOpenReaderHighlight={onOpenReaderHighlight}
        onCopyHighlightLink={vi.fn()}
        onNotify={vi.fn()}
        onDeleteHighlight={onDeleteHighlight}
        onDeleteHighlightsBatch={vi.fn().mockResolvedValue(undefined)}
        onUpdateHighlight={vi.fn().mockResolvedValue(undefined)}
        savedSmartViews={[]}
        onSaveSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onDeleteSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTouchSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTogglePinSmartFilter={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('1 результатов')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Книга 2' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Книга 1' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }));
    expect(onOpenReaderHighlight).toHaveBeenCalledWith('doc-2', 1, 'hl-3');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDeleteHighlight).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no highlights match current filters', () => {
    render(
      <HighlightsView
        workspacePreset="research"
        documents={documents}
        highlights={highlights}
        activeDocumentId="doc-1"
        currentPageIndex={20}
        search="нет такого текста"
        contextOnly={true}
        documentFilter="doc-1"
        onChangeSearch={vi.fn()}
        onChangeContextOnly={vi.fn()}
        onChangeDocumentFilter={vi.fn()}
        onOpenReaderHighlight={vi.fn()}
        onCopyHighlightLink={vi.fn()}
        onNotify={vi.fn()}
        onDeleteHighlight={vi.fn().mockResolvedValue(undefined)}
        onDeleteHighlightsBatch={vi.fn().mockResolvedValue(undefined)}
        onUpdateHighlight={vi.fn().mockResolvedValue(undefined)}
        savedSmartViews={[]}
        onSaveSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onDeleteSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTouchSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTogglePinSmartFilter={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('Ничего не найдено по текущему фильтру.')).toBeInTheDocument();
  });

  it('supports inbox filter and bulk tag update', async () => {
    const highlightsForInbox: HighlightRecord[] = [
      ...highlights,
      {
        id: 'hl-4',
        documentId: 'doc-1',
        pageIndex: 9,
        rects: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.04 }],
        selectedText: 'Текст без заметки и тегов',
        color: 'blue',
        createdAt: '2026-02-19T14:00:00.000Z',
      },
    ];

    const onUpdateHighlight = vi.fn().mockResolvedValue({
      ...highlightsForInbox[3],
      tags: ['новый'],
    });

    render(
      <HighlightsView
        workspacePreset="research"
        documents={documents}
        highlights={highlightsForInbox}
        activeDocumentId="doc-1"
        currentPageIndex={6}
        search=""
        contextOnly={false}
        documentFilter="all"
        onChangeSearch={vi.fn()}
        onChangeContextOnly={vi.fn()}
        onChangeDocumentFilter={vi.fn()}
        onOpenReaderHighlight={vi.fn()}
        onCopyHighlightLink={vi.fn()}
        onNotify={vi.fn()}
        onDeleteHighlight={vi.fn().mockResolvedValue(undefined)}
        onDeleteHighlightsBatch={vi.fn().mockResolvedValue(undefined)}
        onUpdateHighlight={onUpdateHighlight}
        savedSmartViews={[]}
        onSaveSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onDeleteSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTouchSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTogglePinSmartFilter={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByLabelText('Inbox: без заметки и тегов'));
    expect(screen.getByText('1 результатов')).toBeInTheDocument();

    const checks = screen.getAllByLabelText('Выбрать выделение');
    fireEvent.click(checks[0]);
    fireEvent.change(screen.getByPlaceholderText('Теги через запятую'), {
      target: { value: 'новый,тег' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить теги' }));

    expect(onUpdateHighlight).toHaveBeenCalledTimes(1);
    expect(onUpdateHighlight).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'hl-4',
      }),
    );
  });

  it('applies saved smart filter presets', () => {
    const onChangeSearch = vi.fn();
    const onChangeContextOnly = vi.fn();
    const onChangeDocumentFilter = vi.fn();

    render(
      <HighlightsView
        workspacePreset="research"
        documents={documents}
        highlights={highlights}
        activeDocumentId="doc-1"
        currentPageIndex={6}
        search=""
        contextOnly={false}
        documentFilter="all"
        onChangeSearch={onChangeSearch}
        onChangeContextOnly={onChangeContextOnly}
        onChangeDocumentFilter={onChangeDocumentFilter}
        onOpenReaderHighlight={vi.fn()}
        onCopyHighlightLink={vi.fn()}
        onNotify={vi.fn()}
        onDeleteHighlight={vi.fn().mockResolvedValue(undefined)}
        onDeleteHighlightsBatch={vi.fn().mockResolvedValue(undefined)}
        onUpdateHighlight={vi.fn().mockResolvedValue(undefined)}
        savedSmartViews={[
          {
            id: 'preset-1',
            name: 'Inbox',
            filter: {
              search: 'история',
              documentFilter: 'doc-2',
              contextOnly: true,
              colorFilter: 'pink',
              notesOnly: false,
              inboxOnly: true,
              groupMode: 'timeline',
            },
            createdAt: '2026-02-20T10:00:00.000Z',
            updatedAt: '2026-02-20T10:00:00.000Z',
            isPinned: false,
          },
        ]}
        onSaveSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onDeleteSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTouchSmartFilter={vi.fn().mockResolvedValue(undefined)}
        onTogglePinSmartFilter={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));

    expect(onChangeSearch).toHaveBeenCalledWith('история');
    expect(onChangeDocumentFilter).toHaveBeenCalledWith('doc-2');
    expect(onChangeContextOnly).toHaveBeenCalledWith(true);
  });
});
