import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'app/**/*.js',
        'app/**/*.mjs',
        'app/**/*.ts',
        'app/**/*.tsx',
      ],
      exclude: [
        '**/*.d.ts',
        'app/renderer/src/app/types.ts',
        'app/renderer/src/main.tsx',
      ],
    },
  },
});
