#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeHttpUrl(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeBaseUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return '';
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function buildDownloadUrl(baseUrl, fileName) {
  const safeFileName = normalizeText(fileName);
  if (!baseUrl || !safeFileName) {
    return '';
  }
  return new URL(encodeURI(safeFileName), baseUrl).toString();
}

async function listArtifacts(inputDir) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function pickByExtension(files, extensions = []) {
  const normalizedExtensions = extensions.map((item) => item.toLowerCase());
  return files.find((file) => normalizedExtensions.some((ext) => file.toLowerCase().endsWith(ext))) || '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const packageJsonPath = path.join(cwd, 'package.json');
  const packageRaw = await fs.readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageRaw);

  const inputDir = path.resolve(cwd, normalizeText(args['input-dir']) || 'release');
  const outputPath = path.resolve(
    cwd,
    normalizeText(args.output) || path.join('release', 'update-manifest.json'),
  );

  const version = normalizeText(args.version) || normalizeText(packageJson.version);
  if (!version) {
    throw new Error('Не удалось определить версию. Передайте --version.');
  }

  const baseUrl = normalizeBaseUrl(args['base-url'] || args.baseUrl);
  if (!baseUrl) {
    throw new Error('Передайте --base-url https://.../ для публикации артефактов.');
  }

  const files = await listArtifacts(inputDir);

  const linuxFile =
    normalizeText(args['linux-file']) ||
    pickByExtension(files, ['.AppImage', '.deb', '.rpm']);
  const winFile = normalizeText(args['win-file']) || pickByExtension(files, ['.exe']);
  const macFile = normalizeText(args['mac-file']) || pickByExtension(files, ['.dmg', '.pkg']);

  const downloads = {};
  const linuxUrl = buildDownloadUrl(baseUrl, linuxFile);
  if (linuxUrl) {
    downloads.linux = linuxUrl;
  }

  const winUrl = buildDownloadUrl(baseUrl, winFile);
  if (winUrl) {
    downloads.win32 = winUrl;
  }

  const macUrl = buildDownloadUrl(baseUrl, macFile);
  if (macUrl) {
    downloads.darwin = macUrl;
  }

  if (Object.keys(downloads).length === 0) {
    throw new Error('Не найдены файлы сборки для платформ. Укажите --linux-file/--win-file/--mac-file.');
  }

  const manifest = {
    version,
    notes: normalizeText(args.notes),
    publishedAt: new Date().toISOString(),
    downloads,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Сформирован манифест обновлений: ${outputPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(`Ошибка: ${error?.message || error}`);
  process.exitCode = 1;
});
