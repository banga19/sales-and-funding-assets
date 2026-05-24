/**
 * vitest.config.ts
 *
 * Vitest configuration for agent tests.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals:      true,
    environment:  'node',
    include:      ['tests/**/*.test.ts'],
    setupFiles:   ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude:  ['node_modules/', 'dist/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      // Allow tests to import from 'src/...' without relative path gymnastics
      '@': path.resolve(__dirname, 'src'),
    },
  },
});

// Made with Bob
