#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

async function walk(dirPath, onFile) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, onFile);
      continue;
    }
    if (entry.isFile()) {
      await onFile(fullPath);
    }
  }
}

async function main() {
  const distRoot = path.resolve(process.cwd(), 'dist/renderer/webviewer');

  try {
    await fs.access(distRoot);
  } catch {
    console.log('prune-dist: webviewer dist не найден, пропускаю.');
    return;
  }

  let removedCount = 0;
  let removedBytes = 0;

  await walk(distRoot, async (filePath) => {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.map')) {
      return;
    }

    try {
      const stats = await fs.stat(filePath);
      await fs.unlink(filePath);
      removedCount += 1;
      removedBytes += stats.size;
    } catch {
      // Ignore transient fs errors.
    }
  });

  const removedMb = (removedBytes / (1024 * 1024)).toFixed(1);
  console.log(`prune-dist: удалено ${removedCount} map-файлов (${removedMb} MB).`);
}

main().catch((error) => {
  console.error(`prune-dist: ошибка: ${error?.message || error}`);
  process.exitCode = 1;
});
