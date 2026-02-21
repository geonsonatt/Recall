import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bundles from '../app/export/bundles.js';

const {
  buildObsidianBundleFiles,
  buildNotionBundleFiles,
  writeBundleFiles,
} = bundles;

function samplePayload() {
  return {
    documents: [
      { id: 'doc-1', title: 'Симулякры и симуляции' },
      { id: 'doc-2', title: 'Апокалипсис сегодня' },
    ],
    highlights: [
      {
        id: 'hl-1',
        documentId: 'doc-1',
        pageIndex: 6,
        selectedText: 'Современные симуляторы пытаются совместить реальность и модель.',
        note: 'Главный тезис главы.',
        tags: ['симуляция'],
        createdAt: '2026-02-20T10:00:00.000Z',
      },
      {
        id: 'hl-2',
        documentId: 'doc-2',
        pageIndex: 83,
        selectedText: 'Война становится медиасценарием.',
        tags: ['медиа'],
        createdAt: '2026-02-21T10:00:00.000Z',
      },
    ],
    srsDeck: {
      markdown: '# SRS',
      ankiTsv: 'front\tback\ttags',
    },
    dailyDigest: {
      markdown: '# Daily',
    },
    weeklyDigest: {
      markdown: '# Weekly',
    },
    graph: {
      mermaid: 'graph LR\nA-->B',
    },
  };
}

describe('export bundles', () => {
  it('builds obsidian and notion file sets', () => {
    const payload = samplePayload();

    const obsidianFiles = buildObsidianBundleFiles(payload);
    const notionFiles = buildNotionBundleFiles(payload);

    expect(obsidianFiles.some((file) => file.relativePath === 'SRS/anki_cards.tsv')).toBe(true);
    expect(obsidianFiles.some((file) => file.relativePath.startsWith('Books/'))).toBe(true);
    expect(notionFiles.some((file) => file.relativePath === 'notion/highlights.csv')).toBe(true);
    expect(notionFiles.some((file) => file.relativePath.startsWith('notion/books/'))).toBe(true);
  });

  it('writes bundle files to target directory', async () => {
    const payload = samplePayload();
    const files = buildObsidianBundleFiles(payload);

    const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-bundle-test-'));
    const result = await writeBundleFiles(targetRoot, 'bundle-sample', files);

    const stat = await fs.stat(result.bundlePath);
    expect(stat.isDirectory()).toBe(true);
    expect(result.fileCount).toBeGreaterThan(4);

    const readme = await fs.readFile(path.join(result.bundlePath, 'README.md'), 'utf8');
    expect(readme).toContain('Recall Obsidian Bundle');

    await fs.rm(targetRoot, { recursive: true, force: true });
  });
});
