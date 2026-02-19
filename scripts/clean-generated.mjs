#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const TARGETS = ['dist', 'release', '.vite', 'coverage'];

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = process.cwd();
  for (const target of TARGETS) {
    const fullPath = path.join(root, target);
    await removeIfExists(fullPath);
  }

  console.log('Удалены сгенерированные папки: dist, release, .vite, coverage');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
