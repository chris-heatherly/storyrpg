import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat ESLint config.
 *
 * Phase 1 tech-debt guardrails:
 *   - `no-restricted-imports`  enforces that all URLs/endpoints funnel through
 *     `src/config/endpoints.ts` rather than being hardcoded in screens/services.
 *   - `no-console`             warns against stray console.* in production code;
 *     tests, scripts, proxy, and the logger itself are whitelisted.
 *
 * These start as warnings and should be ratcheted up to errors as tech debt
 * is paid down in subsequent phases.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'generated-stories/**',
      'web-build/**',
      'dist/**',
      'build/**',
      '.expo/**',
      'proxy/**',
      'proxy-server.js',
      'scripts/**',
      'test/stubs/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/*.config.ts',
      'metro.config.js',
      'babel.config.js',
      'index.ts',
      'App.tsx',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Narrow TS strictness for Phase 1 to avoid drowning in legacy debt.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-namespace': 'off',
      'no-empty': 'off',
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'off',
      'no-constant-condition': 'off',
      'no-async-promise-executor': 'off',
      'no-self-assign': 'off',
      'no-fallthrough': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      // Downgrade tech-debt errors to warnings; ratchet up in future phases.
      'prefer-const': 'warn',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-var': 'warn',
      // Tech-debt guardrails.
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error', 'info'],
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/hardcoded-urls*'],
              message:
                'All URLs/endpoints must come from src/config/endpoints.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests and fixtures can log freely.
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/__tests__/**',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // The logger wraps console.* on purpose.
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
