import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'react-native': path.resolve(__dirname, 'test/stubs/react-native.ts'),
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'test/stubs/async-storage.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'test/**',
        'scripts/**',
        'proxy/**',
        'proxy-server.js',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'src/data/stories/**',
        'coverage/**',
      ],
      // Baseline thresholds captured at Phase 9 landing
      // (statements 33 %, branches 28 %, functions 37 %, lines 34 %).
      // Thresholds sit just under the measured values so small refactors
      // don't block CI; ratchet them up whenever coverage grows.
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 35,
        lines: 32,
      },
    },
  },
});
