import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import type { StructuredJsonSchema } from '../agents/BaseAgent';

/**
 * Exhaustive output-budget ratchet (P0, 2026-07-06).
 *
 * The silent-truncation bug class: a structured schema that declares no
 * `maxOutputTokens` gets clamped to the provider default (8192) by
 * `structuredMaxTokens()`, regardless of the agent's configured budget. The
 * old guard (`structuredMaxTokens.test.ts`) enumerated heavy schemas BY HAND,
 * which is exactly how `buildEncounterStructureJsonSchema` — the largest
 * structured output in the pipeline — shipped uncapped and killed the bite-me
 * 2026-07-06 run with an unrecoverable max_tokens ladder.
 *
 * This test walks EVERY schema module in this directory and asserts every
 * exported `build*JsonSchema*` factory declares an explicit positive
 * `maxOutputTokens`. New schema builders are covered automatically; a builder
 * with novel required arguments must be registered in BUILDER_ARGS below
 * (loud failure, not silent omission).
 */

/** Sample arguments for builders whose factories require parameters. */
const BUILDER_ARGS: Record<string, unknown[]> = {
  buildSceneContentJsonSchema: [6],
  buildCharacterBibleJsonSchema: [4],
  buildBranchAnnotationJsonSchema: [{ pathCount: 3, reconvergenceCount: 2 }],
};

const SCHEMA_DIR = __dirname;

function schemaModuleFiles(): string[] {
  return fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .sort();
}

describe('every structured schema declares an explicit output budget', () => {
  it('covers at least the known schema modules (directory walk sanity check)', () => {
    const files = schemaModuleFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain('encounterSchemas.ts');
    expect(files).toContain('sceneContentSchema.ts');
  });

  for (const file of schemaModuleFiles()) {
    it(`${file}: all build*JsonSchema exports declare maxOutputTokens`, async () => {
      const mod = await import(path.join(SCHEMA_DIR, file));
      const builders = Object.entries(mod).filter(
        ([name, value]) => /^build\w*JsonSchema/.test(name) && typeof value === 'function',
      ) as Array<[string, (...args: unknown[]) => StructuredJsonSchema]>;

      for (const [name, builder] of builders) {
        const args = BUILDER_ARGS[name] ?? [];
        let schema: StructuredJsonSchema;
        try {
          schema = builder(...args);
        } catch (err) {
          throw new Error(
            `${name} threw when called with ${JSON.stringify(args)} — register sample arguments in BUILDER_ARGS so the output-budget ratchet can cover it. Original error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        expect(
          schema.maxOutputTokens,
          `${name} must declare an explicit maxOutputTokens — without it, structuredMaxTokens() silently clamps the call to the 8192 provider default (the silent-truncation bug class; see the 2026-07-06 encounter abort).`,
        ).toBeTypeOf('number');
        expect(schema.maxOutputTokens!).toBeGreaterThanOrEqual(256);
      }
    });
  }
});
