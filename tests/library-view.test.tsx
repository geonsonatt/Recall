// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryView } from '../app/renderer/src/app/features/library/LibraryView';
import type { AppSettings, CollectionRecord, DocumentRecord } from '../app/renderer/src/app/types';

function makeDocument(patch: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    title: 'Симулякры и симуляции',
    filePath: '/tmp/doc-1.pdf',
    createdAt: '2026-02-19T12:00:00.000Z',
    highlightsCount: 2,
    lastReadPageIndex: 4,
    maxReadPageIndex: 7,
    lastReadTotalPages: 100,
    ...patch,
  };
}

const settings: AppSettings = {
  theme: 'white',
  focusMode: false,
  goals: {
    pagesPerDay: 20,
    pagesPerWeek: 140,
  },
  savedHighlightQueries: [],
};

const collections: CollectionRecord[] = [
  { id: 'col-1', name: 'Философия', createdAt: '2026-02-19T12:00:00.000Z' },
];

describe('LibraryView', () => {
  it('renders white-theme UI and handles primary actions', () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onImportPaths = vi.fn().mockResolvedValue(undefined);
    const onOpenReader = vi.fn();
    const onOpenHighlights = vi.fn();
    const onDeleteDocument = vi.fn().mockResolvedValue(undefined);
    const onExportPdf = vi.fn().mockResolvedValue(undefined);
    const onExportMarkdown = vi.fn().mockResolvedValue(undefined);
    const onExportObsidianBundle = vi.fn().mockResolvedValue(undefined);
    const onExportNotionBundle = vi.fn().mockResolvedValue(undefined);
    const onTogglePin = vi.fn().mockResolvedValue(undefined);
    const onAssignCollection = vi.fn().mockResolvedValue(undefined);
    const onCreateCollection = vi.fn().mockResolvedValue(undefined);
    const onSaveFocusMode = vi.fn().mockResolvedValue(undefined);
    const onRevealDataFolder = vi.fn().mockResolvedValue(undefined);
    const onBackup = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onResetProgress = vi.fn().mockResolvedValue(undefined);

    const document = makeDocument();
    render(
      <LibraryView
        workspacePreset="research"
        documents={[document]}
        collections={collections}
        settings={settings}
        loading={false}
        onImport={onImport}
        onImportPaths={onImportPaths}
        onOpenReader={onOpenReader}
        onOpenHighlights={onOpenHighlights}
        onDeleteDocument={onDeleteDocument}
        onExportPdf={onExportPdf}
        onExportMarkdown={onExportMarkdown}
        onExportObsidianBundle={onExportObsidianBundle}
        onExportNotionBundle={onExportNotionBundle}
        onTogglePin={onTogglePin}
        onAssignCollection={onAssignCollection}
        onCreateCollection={onCreateCollection}
        onSaveFocusMode={onSaveFocusMode}
        onRevealDataFolder={onRevealDataFolder}
        onBackup={onBackup}
        onRestore={onRestore}
        onResetProgress={onResetProgress}
        onCopyDeepLink={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByLabelText('Тема')).toBeNull();
    expect(screen.getByText('Тема приложения фиксирована: белая.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Импорт PDF' }));
    expect(onImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onOpenReader).toHaveBeenCalledWith(document.id);

    fireEvent.click(screen.getByRole('button', { name: 'Хайлайты' }));
    expect(onOpenHighlights).toHaveBeenCalledWith(document.id);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт PDF' }));
    expect(onExportPdf).toHaveBeenCalledWith(document.id);

    fireEvent.change(screen.getByLabelText('Коллекция'), { target: { value: 'col-1' } });
    expect(onAssignCollection).toHaveBeenCalledWith(document.id, 'col-1');

    fireEvent.change(screen.getByLabelText('Новая коллекция'), {
      target: { value: '  Новая полка  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать коллекцию' }));
    expect(onCreateCollection).toHaveBeenCalledWith('Новая полка');

    fireEvent.click(screen.getByTitle('Закрепить книгу'));
    expect(onTogglePin).toHaveBeenCalledWith(document);

    const dropZone = screen.getByText('Библиотека книг').closest('.library-table');
    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [{ path: '/tmp/from-drop.pdf' }],
      },
    });
    expect(onImportPaths).toHaveBeenCalledWith(['/tmp/from-drop.pdf']);
  });

  it('filters books by title and reading progress status', () => {
    const docs = [
      makeDocument({
        id: 'doc-a',
        title: 'Не начато',
        maxReadPageIndex: 0,
        lastReadPageIndex: 0,
        lastReadTotalPages: 0,
      }),
      makeDocument({
        id: 'doc-b',
        title: 'В процессе',
        maxReadPageIndex: 4,
        lastReadPageIndex: 2,
        lastReadTotalPages: 20,
      }),
      makeDocument({
        id: 'doc-c',
        title: 'Завершено',
        maxReadPageIndex: 99,
        lastReadPageIndex: 99,
        lastReadTotalPages: 100,
      }),
    ];

    render(
      <LibraryView
        workspacePreset="research"
        documents={docs}
        collections={collections}
        settings={settings}
        loading={false}
        onImport={vi.fn().mockResolvedValue(undefined)}
        onImportPaths={vi.fn().mockResolvedValue(undefined)}
        onOpenReader={vi.fn()}
        onOpenHighlights={vi.fn()}
        onDeleteDocument={vi.fn().mockResolvedValue(undefined)}
        onExportPdf={vi.fn().mockResolvedValue(undefined)}
        onExportMarkdown={vi.fn().mockResolvedValue(undefined)}
        onExportObsidianBundle={vi.fn().mockResolvedValue(undefined)}
        onExportNotionBundle={vi.fn().mockResolvedValue(undefined)}
        onTogglePin={vi.fn().mockResolvedValue(undefined)}
        onAssignCollection={vi.fn().mockResolvedValue(undefined)}
        onCreateCollection={vi.fn().mockResolvedValue(undefined)}
        onSaveFocusMode={vi.fn().mockResolvedValue(undefined)}
        onRevealDataFolder={vi.fn().mockResolvedValue(undefined)}
        onBackup={vi.fn().mockResolvedValue(undefined)}
        onRestore={vi.fn().mockResolvedValue(undefined)}
        onResetProgress={vi.fn().mockResolvedValue(undefined)}
        onCopyDeepLink={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getAllByPlaceholderText('Название книги…')[0], {
      target: { value: 'процессе' },
    });
    expect(screen.getByRole('heading', { name: 'В процессе' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Не начато' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Статус чтения'), {
      target: { value: 'completed' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Название книги…')[0], {
      target: { value: '' },
    });
    expect(screen.getByRole('heading', { name: 'Завершено' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'В процессе' })).toBeNull();
  });
});
