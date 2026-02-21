import type { DocumentRecord } from '../types';

export function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function repairPdfSelectionArtifacts(value: string): string {
  return value
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\ufb00/g, 'ff')
    .replace(/\ufb01/g, 'fi')
    .replace(/\ufb02/g, 'fl')
    .replace(/\ufb03/g, 'ffi')
    .replace(/\ufb04/g, 'ffl')
    .replace(/([\p{L}\p{N}])\u00ad\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒−]/g, '-')
    .replace(/([\p{L}\p{N}])[-‐‑]\s*\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/([\p{L}\p{N}])[-‐‑]\s+([\p{L}\p{N}])/gu, '$1$2')
    .replace(/([\p{L}\p{N}])\s+\|\s+([\p{L}\p{N}])/gu, '$1 $2')
    .replace(/[|¦]{2,}/g, ' ')
    .replace(/([!?.,;:]){2,}/g, '$1')
    .replace(/([([{«])\s+([,.;:!?])/g, '$1$2')
    .replace(/\s+([,.;:!?»)\]}\u2026])/g, '$1')
    .replace(/([«([{])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function collapseSpacedLetterRuns(value: string): string {
  return value.replace(
    /(^|[\s([{«"'])((?:[\p{L}\p{N}][ \t]){3,}[\p{L}\p{N}])(?=$|[\s,.;:!?»)\]}\u2026])/gu,
    (_match, prefix, word) => `${prefix}${word.replace(/[ \t]/g, '')}`,
  );
}

function normalizeLineBreaks(value: string): string {
  const lines = value.split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
  const merged: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (merged.length > 0 && merged[merged.length - 1] !== '') {
        merged.push('');
      }
      continue;
    }

    const last = merged[merged.length - 1];
    if (!last || last === '') {
      merged.push(line);
      continue;
    }

    const looksLikeHeading = /^[\p{Lu}\d][\p{Lu}\d .,:;!?"'()/-]{6,}$/u.test(line);
    const shouldJoin =
      !/[.!?;:»”"')\]]$/.test(last) &&
      !/^[\u2022*#>]/.test(line) &&
      !/^\d+[.)]\s/.test(line) &&
      !looksLikeHeading;

    if (shouldJoin) {
      merged[merged.length - 1] = `${last} ${line}`;
      continue;
    }

    merged.push(line);
  }

  return merged.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function normalizeSelectionText(value: unknown): string {
  const raw = collapseSpacedLetterRuns(
    String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r/g, ''),
  )
    .replace(/(^|[\s([{«"'])([А-ЯЁA-Z])\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,})/gu, '$1$2$3');

  return normalizeLineBreaks(repairPdfSelectionArtifacts(raw))
    .trim();
}

export function normalizeHttpUrl(value: unknown): string {
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

export function formatDateTime(iso?: string | null): string {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getDocumentProgress(documentInfo?: DocumentRecord | null): {
  progress: number;
  pageNumber: number;
  totalPages: number;
  pageIndex: number;
} {
  const totalPages = Math.max(0, Number(documentInfo?.lastReadTotalPages ?? 0));
  if (totalPages <= 0) {
    return {
      progress: 0,
      pageNumber: 1,
      totalPages: 0,
      pageIndex: 0,
    };
  }

  const maxReadPageIndex = Number.isFinite(Number(documentInfo?.maxReadPageIndex))
    ? Number(documentInfo?.maxReadPageIndex)
    : Number(documentInfo?.lastReadPageIndex ?? 0);
  const safePageIndex = clamp(Math.trunc(maxReadPageIndex), 0, totalPages - 1);

  return {
    progress: clamp((safePageIndex + 1) / totalPages, 0, 1),
    pageNumber: safePageIndex + 1,
    totalPages,
    pageIndex: safePageIndex,
  };
}

export function truncate(value: unknown, max = 140): string {
  const text = normalizeText(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function truncateSelectionText(value: unknown, max = 140): string {
  const text = normalizeSelectionText(value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
