import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import storageModule from '../app/data/storage.js';

const {
  ensureStorage,
  loadDB,
  saveDB,
  upsertDocument,
  getSettings,
  updateSettings,
  importDocumentFromPath,
  importDocumentsFromPaths,
  listDocuments,
  getDocumentById,
  updateDocumentMeta,
  updateDocumentReadingState,
  resetDocumentReadingState,
  addHighlight,
  listHighlights,
  listAllHighlights,
  updateHighlight,
  deleteHighlight,
  deleteHighlightsByIds,
  addBookmark,
  listBookmarks,
  updateBookmark,
  deleteBookmark,
  deleteBookmarksByIds,
  createCollection,
  updateCollection,
  deleteCollection,
  getReadingOverview,
  getStoragePaths,
  deleteDocument,
} = storageModule;

function makeHighlight(documentId, patch = {}) {
  return {
    id: crypto.randomUUID(),
    documentId,
    pageIndex: 0,
    rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
    selectedText: 'Базовый текст',
    color: 'yellow',
    tags: ['важно'],
    createdAt: '2026-02-19T12:00:00.000Z',
    ...patch,
  };
}

function makeBookmark(documentId, patch = {}) {
  return {
    id: crypto.randomUUID(),
    documentId,
    pageIndex: 2,
    label: 'Точка',
    createdAt: '2026-02-19T12:00:00.000Z',
    ...patch,
  };
}

describe('storage module', () => {
  let tempRoot;
  let storagePaths;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-storage-test-'));
    storagePaths = await ensureStorage(tempRoot);
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates storage structure and forces white theme', async () => {
    const db = await loadDB(storagePaths);
    expect(db.documents).toEqual([]);
    expect(db.highlights).toEqual([]);
    expect(db.settings.theme).toBe('white');

    const updated = await updateSettings(storagePaths, {
      // old and forbidden values must always normalize to white
      theme: 'dark',
      goals: { pagesPerDay: 7, pagesPerWeek: 20 },
    });
    expect(updated.theme).toBe('white');
    expect(updated.goals.pagesPerDay).toBe(7);
    expect(updated.goals.pagesPerWeek).toBe(20);

    const fromGet = await getSettings(storagePaths);
    expect(fromGet.theme).toBe('white');
  });

  it('recovers from corrupted db.json and keeps backup', async () => {
    await fs.writeFile(storagePaths.dbPath, '{broken-json', 'utf8');
    const db = await loadDB(storagePaths);
    expect(db.documents).toEqual([]);
    expect(db.settings.theme).toBe('white');

    const files = await fs.readdir(tempRoot);
    expect(files.some((name) => name.startsWith('db.json.corrupt.'))).toBe(true);
  });

  it('imports documents, deduplicates by sha256 and sorts pinned first', async () => {
    const sourceA = path.join(tempRoot, 'Book A.pdf');
    const sourceB = path.join(tempRoot, 'Book B.pdf');
    await fs.writeFile(sourceA, 'pdf-a');
    await fs.writeFile(sourceB, 'pdf-b');

    const importA = await importDocumentFromPath(storagePaths, sourceA);
    const importB = await importDocumentFromPath(storagePaths, sourceB);
    expect(importA.alreadyExists).toBe(false);
    expect(importB.alreadyExists).toBe(false);

    const importADuplicate = await importDocumentFromPath(storagePaths, sourceA);
    expect(importADuplicate.alreadyExists).toBe(true);
    expect(importADuplicate.document.id).toBe(importA.document.id);

    await updateDocumentReadingState(storagePaths, importB.document.id, {
      pageIndex: 3,
      totalPages: 40,
      lastOpenedAt: '2026-02-20T10:00:00.000Z',
      allowFirstPage: true,
    });

    let docs = await listDocuments(storagePaths);
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe(importB.document.id);

    await updateDocumentMeta(storagePaths, importA.document.id, { isPinned: true });
    docs = await listDocuments(storagePaths);
    expect(docs[0].id).toBe(importA.document.id);

    const batch = await importDocumentsFromPaths(storagePaths, [
      sourceA,
      path.join(tempRoot, 'missing.pdf'),
    ]);
    expect(batch.duplicates).toHaveLength(1);
    expect(batch.errors).toHaveLength(1);
  });

  it('keeps progress from dropping to page 1 unless allowFirstPage=true', async () => {
    const source = path.join(tempRoot, 'Progress Book.pdf');
    await fs.writeFile(source, 'pdf-progress');
    const { document } = await importDocumentFromPath(storagePaths, source);

    const moved = await updateDocumentReadingState(storagePaths, document.id, {
      pageIndex: 5,
      totalPages: 10,
      allowFirstPage: true,
      lastOpenedAt: '2026-02-19T10:00:00.000Z',
    });
    expect(moved.lastReadPageIndex).toBe(5);
    expect(moved.maxReadPageIndex).toBe(5);

    const accidentalReset = await updateDocumentReadingState(storagePaths, document.id, {
      pageIndex: 0,
      totalPages: 10,
      lastOpenedAt: '2026-02-19T10:01:00.000Z',
    });
    expect(accidentalReset.lastReadPageIndex).toBe(5);
    expect(accidentalReset.maxReadPageIndex).toBe(5);

    const explicitReset = await updateDocumentReadingState(storagePaths, document.id, {
      pageIndex: 0,
      totalPages: 10,
      allowFirstPage: true,
      lastOpenedAt: '2026-02-19T10:02:00.000Z',
    });
    expect(explicitReset.lastReadPageIndex).toBe(0);
    expect(explicitReset.maxReadPageIndex).toBe(5);

    const hardReset = await resetDocumentReadingState(storagePaths, document.id);
    expect(hardReset.lastReadPageIndex).toBe(0);
    expect(hardReset.maxReadPageIndex).toBe(0);
    expect(hardReset.totalReadingSeconds).toBe(0);
  });

  it('supports highlights CRUD, filtering and safe updates', async () => {
    const source = path.join(tempRoot, 'Highlights Book.pdf');
    await fs.writeFile(source, 'pdf-highlights');
    const { document } = await importDocumentFromPath(storagePaths, source);

    const first = await addHighlight(
      storagePaths,
      makeHighlight(document.id, {
        pageIndex: 1,
        tags: ['важно', 'работа'],
        selectedText: 'Текст A',
        createdAt: '2026-02-19T10:00:00.000Z',
      }),
    );
    const second = await addHighlight(
      storagePaths,
      makeHighlight(document.id, {
        pageIndex: 0,
        tags: ['важно'],
        selectedText: 'Текст B',
        createdAt: '2026-02-19T09:00:00.000Z',
      }),
    );

    const byDocument = await listHighlights(storagePaths, document.id);
    expect(byDocument.map((item) => item.id)).toEqual([second.id, first.id]);

    const byTag = await listAllHighlights(storagePaths, { tags: ['важно', 'работа'] });
    expect(byTag).toHaveLength(1);
    expect(byTag[0].id).toBe(first.id);

    const byId = await listAllHighlights(storagePaths, { ids: [second.id] });
    expect(byId).toHaveLength(1);
    expect(byId[0].id).toBe(second.id);

    const sinceFuture = await listAllHighlights(storagePaths, { since: '2030-01-01T00:00:00.000Z' });
    expect(sinceFuture).toHaveLength(0);

    const updated = await updateHighlight(storagePaths, first.id, {
      selectedText: '',
      rects: [],
      note: 'Сохранённая заметка',
    });
    expect(updated.selectedText).toBe('Текст A');
    expect(updated.rects).toHaveLength(1);
    expect(updated.note).toBe('Сохранённая заметка');

    const deleted = await deleteHighlightsByIds(storagePaths, [second.id, 'missing']);
    expect(deleted.deleted).toBe(true);
    expect(deleted.deletedCount).toBe(1);

    const afterDelete = await listHighlights(storagePaths, document.id);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].id).toBe(first.id);

    const deletedSingle = await deleteHighlight(storagePaths, first.id);
    expect(deletedSingle.deleted).toBe(true);
    expect(deletedSingle.deletedCount).toBe(1);

    const noOpDelete = await deleteHighlightsByIds(storagePaths, []);
    expect(noOpDelete.deleted).toBe(false);
  });

  it('handles collections, bookmarks and cascading deleteDocument', async () => {
    const source = path.join(tempRoot, 'Cascade Book.pdf');
    await fs.writeFile(source, 'pdf-cascade');
    const { document } = await importDocumentFromPath(storagePaths, source);

    const collection = await createCollection(storagePaths, {
      id: crypto.randomUUID(),
      name: 'Философия',
    });

    await expect(
      createCollection(storagePaths, {
        id: crypto.randomUUID(),
        name: 'философия',
      }),
    ).rejects.toThrow('Коллекция с таким названием уже существует.');

    const assigned = await updateDocumentMeta(storagePaths, document.id, {
      collectionId: collection.id,
    });
    expect(assigned.collectionId).toBe(collection.id);

    await addHighlight(storagePaths, makeHighlight(document.id, { selectedText: 'Удалится' }));
    await addBookmark(storagePaths, makeBookmark(document.id));

    const bookmarksBefore = await listBookmarks(storagePaths, document.id);
    expect(bookmarksBefore).toHaveLength(1);

    const updatedBookmark = await updateBookmark(storagePaths, bookmarksBefore[0].id, {
      label: '  Новая точка  ',
      pageIndex: 5,
    });
    expect(updatedBookmark.label).toBe('Новая точка');
    expect(updatedBookmark.pageIndex).toBe(5);

    const deletedMissingBookmark = await deleteBookmark(storagePaths, 'missing-bookmark');
    expect(deletedMissingBookmark.deleted).toBe(false);

    const deleteManyBookmarks = await deleteBookmarksByIds(storagePaths, [bookmarksBefore[0].id]);
    expect(deleteManyBookmarks.deleted).toBe(true);
    expect(deleteManyBookmarks.deletedCount).toBe(1);

    await addBookmark(storagePaths, makeBookmark(document.id));

    const collectionDeleted = await deleteCollection(storagePaths, collection.id);
    expect(collectionDeleted.deleted).toBe(true);

    const afterCollectionDelete = await getDocumentById(storagePaths, document.id);
    expect(afterCollectionDelete.collectionId).toBeUndefined();

    const deleted = await deleteDocument(storagePaths, document.id);
    expect(deleted.deleted).toBe(true);
    expect(deleted.removedHighlightsCount).toBe(1);
    expect(deleted.removedBookmarksCount).toBe(1);

    const docAfterDelete = await getDocumentById(storagePaths, document.id);
    expect(docAfterDelete).toBeNull();

    const highlightsAfterDelete = await listHighlights(storagePaths, document.id);
    expect(highlightsAfterDelete).toHaveLength(0);

    const bookmarksAfterDelete = await listBookmarks(storagePaths, document.id);
    expect(bookmarksAfterDelete).toHaveLength(0);
  });

  it('updates collection names, reading overview and exposed paths', async () => {
    const source = path.join(tempRoot, 'Overview Book.pdf');
    await fs.writeFile(source, 'pdf-overview');
    const { document } = await importDocumentFromPath(storagePaths, source);

    const created = await createCollection(storagePaths, {
      id: crypto.randomUUID(),
      name: 'Первая',
    });
    const updatedCollection = await updateCollection(storagePaths, created.id, {
      name: '  Обновлённая  ',
    });
    expect(updatedCollection.name).toBe('Обновлённая');

    await expect(updateCollection(storagePaths, created.id, { name: '' })).rejects.toThrow(
      'Название коллекции не может быть пустым.',
    );
    await expect(updateCollection(storagePaths, 'missing', { name: 'X' })).rejects.toThrow(
      'Коллекция не найдена.',
    );

    const mergedDoc = await upsertDocument(storagePaths, {
      ...document,
      title: 'Обновлённый заголовок',
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    expect(mergedDoc.title).toBe('Обновлённый заголовок');
    expect(mergedDoc.createdAt).not.toBe('2000-01-01T00:00:00.000Z');

    await updateDocumentReadingState(storagePaths, document.id, {
      pageIndex: 10,
      totalPages: 300,
      lastOpenedAt: '2026-02-19T15:00:00.000Z',
      readingSeconds: 180,
      pagesDelta: 6,
      allowFirstPage: true,
    });

    const overview = await getReadingOverview(storagePaths);
    expect(overview.settings.theme).toBe('white');
    expect(overview.readingLog['2026-02-19']).toEqual({
      pages: 6,
      seconds: 180,
    });

    const paths = getStoragePaths(storagePaths);
    expect(paths.dbPath).toBe(storagePaths.dbPath);
    expect(paths.documentsDir).toBe(storagePaths.documentsDir);

    const db = await loadDB(storagePaths);
    db.settings = { ...db.settings, theme: 'dark' };
    await saveDB(storagePaths, db);
    const normalizedSettings = await getSettings(storagePaths);
    expect(normalizedSettings.theme).toBe('white');
  });
});
