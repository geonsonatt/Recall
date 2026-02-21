import type { HighlightColor } from '../types';

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  'yellow',
  'green',
  'pink',
  'blue',
  'orange',
  'purple',
];

export function highlightColorLabel(color: HighlightColor): string {
  if (color === 'green') {
    return 'Зелёный';
  }
  if (color === 'pink') {
    return 'Розовый';
  }
  if (color === 'blue') {
    return 'Синий';
  }
  if (color === 'orange') {
    return 'Оранжевый';
  }
  if (color === 'purple') {
    return 'Фиолетовый';
  }
  return 'Жёлтый';
}
