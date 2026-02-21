import { describe, expect, it } from 'vitest';
import models from '../app/shared/models.js';

describe('shared models', () => {
  it('exports allowed highlight colors list', () => {
    expect(models.HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'pink', 'blue', 'orange', 'purple']);
  });
});
