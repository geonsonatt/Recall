#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SNAP_PORT = String(process.env.RECALL_UI_SNAP_PORT || '5191');
const VITE_URL = process.env.RECALL_UI_SNAP_URL || `http://localhost:${SNAP_PORT}/`;
const SERVER_TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stampForDir(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(400);
  }

  throw new Error(`Vite-сервер не ответил за ${Math.round(timeoutMs / 1000)}с: ${url}`);
}

function spawnCommand(args, env) {
  const child = spawn(NPM_CMD, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: false,
  });

  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code: code ?? 0, signal: signal ?? null });
    });
  });
}

async function stopProcess(child, label) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const graceful = await Promise.race([
    waitForExit(child),
    sleep(2500).then(() => null),
  ]);

  if (graceful) {
    return;
  }

  child.kill('SIGKILL');
  await Promise.race([
    waitForExit(child),
    sleep(1200),
  ]);
  console.warn(`[ui:snap] Процесс ${label} остановлен принудительно.`);
}

async function main() {
  const outDir = process.env.RECALL_UI_SNAP_OUT_DIR
    ? path.resolve(ROOT, process.env.RECALL_UI_SNAP_OUT_DIR)
    : path.join(ROOT, 'artifacts', 'ui', stampForDir());

  await fs.mkdir(outDir, { recursive: true });
  console.log(`[ui:snap] Папка скриншотов: ${outDir}`);

  const rendererEnv = {
    ...process.env,
    RECALL_UI_SNAP_PORT: SNAP_PORT,
  };

  const renderer = spawnCommand(['run', 'dev:renderer', '--', '--port', SNAP_PORT, '--strictPort'], rendererEnv);
  let rendererExitedUnexpectedly = false;

  renderer.once('exit', (code) => {
    if (code !== 0) {
      rendererExitedUnexpectedly = true;
    }
  });

  try {
    await waitForServer(VITE_URL, SERVER_TIMEOUT_MS);

    if (rendererExitedUnexpectedly) {
      console.warn('[ui:snap] dev:renderer завершился неуспешно, но сервер доступен. Продолжаю.');
    }

    const electronEnv = {
      ...process.env,
      RECALL_UI_SNAP_PORT: SNAP_PORT,
      VITE_DEV_SERVER_URL: VITE_URL,
      RECALL_UI_SNAP_OUT_DIR: outDir,
    };

    const electron = spawnCommand(['run', 'dev:electron:snap'], electronEnv);
    const result = await waitForExit(electron);

    if (result.code !== 0) {
      throw new Error(`dev:electron:snap завершился с кодом ${result.code}`);
    }

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifestExists = await fs
      .access(manifestPath)
      .then(() => true)
      .catch(() => false);
    if (!manifestExists) {
      throw new Error(`UI snap завершился без manifest.json: ${manifestPath}`);
    }

    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const fatalNote = Array.isArray(manifest?.notes)
      ? manifest.notes.find((note) => String(note || '').startsWith('UI snap error:'))
      : null;
    if (fatalNote) {
      throw new Error(String(fatalNote));
    }

    console.log(`[ui:snap] Готово. Скриншоты сохранены в ${outDir}`);
  } finally {
    await stopProcess(renderer, 'dev:renderer');
  }
}

main().catch((error) => {
  console.error(`[ui:snap] Ошибка: ${error?.message || error}`);
  process.exitCode = 1;
});
