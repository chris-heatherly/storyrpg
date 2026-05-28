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
      // Block NEW `@ts-nocheck` (whole-file type suppression) — the existing
      // 21 files are allowlisted in the override block below. `@ts-ignore` /
      // `@ts-expect-error` are intentionally left allowed for now; tighten
      // later. With the --max-warnings ratchet, any new @ts-nocheck fails lint.
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-nocheck': true,
          'ts-ignore': false,
          'ts-expect-error': false,
          'ts-check': false,
        },
      ],
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
        'error',
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
    // Allowlist of files that already carry `@ts-nocheck` as of 2026-05-28.
    // The ban-ts-comment rule above blocks NEW `@ts-nocheck`; these are
    // grandfathered until typed (see docs/PROJECT_AUDIT_2026-05-28.md, Track A).
    // To pay down debt: remove a file here once its @ts-nocheck is gone.
    files: [
      'src/ai-agents/agents/SceneWriter.ts',
      'src/ai-agents/agents/image-team/CharacterReferenceSheetAgent.ts',
      'src/ai-agents/agents/image-team/ImageAgentTeam.ts',
      'src/ai-agents/agents/image-team/StoryboardAgent.ts',
      'src/ai-agents/pipeline/EpisodePipeline.ts',
      'src/ai-agents/pipeline/FullStoryPipeline.ts',
      'src/ai-agents/pipeline/FullStoryPipeline.microEpisodeRepair.test.ts',
      'src/ai-agents/pipeline/FullStoryPipeline.references.test.ts',
      'src/ai-agents/pipeline/FullStoryPipeline.spotImageBackfill.test.ts',
      'src/ai-agents/pipeline/phases/index.ts',
      'src/ai-agents/server/worker-runner.ts',
      'src/ai-agents/utils/pipelineOutputWriter.ts',
      'src/components/EncounterView.tsx',
      'src/data/stories/bladesOfValoria.ts',
      'src/data/stories/savageNightsInParadise.ts',
      'src/data/stories/theVelvetJob.ts',
      'src/screens/GeneratorScreen.tsx',
      'src/services/narrationService.ts',
      'src/stores/gameStore.ts',
      'src/stores/seasonPlanStore.ts',
      'src/visualizer/storyGraphTransformer.ts',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
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
