import { describe, expect, it } from 'vitest';

import { resolveStructuredCallBudget, structuredMaxTokens } from '../agents/BaseAgent';
import { buildSceneContentJsonSchema } from './sceneContentSchema';
import { buildWorldBibleJsonSchema, buildWorldLocationsJsonSchema } from './worldBibleSchema';
import { buildCharacterBibleJsonSchema } from './characterBibleSchema';
import { buildEpisodeBlueprintJsonSchema } from './episodeBlueprintSchema';
import { buildSeasonPlanJsonSchema } from './seasonPlanSchema';

// The default cap used by every provider path when a schema declares no
// maxOutputTokens. Keep this in sync with BaseAgent's callLLM sites (8192).
const DEFAULT_CAP = 8192;

describe('structuredMaxTokens clamp', () => {
  it('clamps a structured call to the default cap when the schema declares no maxOutputTokens', () => {
    // Regression: this is the exact silent-truncation bug — a 16384-configured
    // agent (SceneWriter) was clamped to 8192 because its schema had no cap.
    expect(structuredMaxTokens(16384, { name: 's', schema: {} }, DEFAULT_CAP)).toBe(DEFAULT_CAP);
  });

  it('honors the schema maxOutputTokens above the default cap', () => {
    expect(
      structuredMaxTokens(16384, { name: 's', maxOutputTokens: 16384, schema: {} }, DEFAULT_CAP),
    ).toBe(16384);
    expect(
      structuredMaxTokens(32000, { name: 's', maxOutputTokens: 32000, schema: {} }, DEFAULT_CAP),
    ).toBe(32000);
  });

  it('never exceeds the configured agent budget', () => {
    expect(
      structuredMaxTokens(4096, { name: 's', maxOutputTokens: 32000, schema: {} }, DEFAULT_CAP),
    ).toBe(4096);
  });

  it('floors at 256', () => {
    expect(structuredMaxTokens(0, { name: 's', schema: {} }, 0)).toBe(256);
  });
});

describe('provider-aware structured call budgets', () => {
  const semanticPatchSchema = {
    name: 'scene_semantic_patch',
    outputBudget: {
      visibleTokens: 1536,
      reasoningProfile: 'minimal' as const,
      safetyTokens: 256,
      totalCeiling: 4096,
    },
    schema: {},
  };

  it('reserves Gemini thinking separately from visible JSON', () => {
    expect(resolveStructuredCallBudget({
      configured: 16384,
      schema: semanticPatchSchema,
      defaultCap: DEFAULT_CAP,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    })).toEqual({
      maxOutputTokens: 2304,
      visibleTokens: 1536,
      reasoningTokens: 512,
      safetyTokens: 256,
    });
  });

  it('rejects an impossible budget before making a provider call', () => {
    expect(() => resolveStructuredCallBudget({
      configured: 2048,
      schema: semanticPatchSchema,
      defaultCap: DEFAULT_CAP,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    })).toThrow(/requires 2304, but the available cap is 2048/);
  });

  it('preserves complete planning JSON capacity on Gemini 2.5 and Gemini 3', () => {
    const fullBlueprint = buildEpisodeBlueprintJsonSchema({ targetSceneCount: 8 });
    const compactBlueprint = buildEpisodeBlueprintJsonSchema({ targetSceneCount: 8, compact: true });
    const fullSeason = buildSeasonPlanJsonSchema();

    expect(resolveStructuredCallBudget({
      configured: 32768,
      schema: fullBlueprint,
      defaultCap: DEFAULT_CAP,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    })).toMatchObject({ visibleTokens: 22000, reasoningTokens: 2048, maxOutputTokens: 24560 });
    expect(resolveStructuredCallBudget({
      configured: 32768,
      schema: fullSeason,
      defaultCap: DEFAULT_CAP,
      provider: 'gemini',
      model: 'gemini-3-pro',
    })).toMatchObject({ visibleTokens: 22000, reasoningTokens: 4096, maxOutputTokens: 26608 });
    expect(resolveStructuredCallBudget({
      configured: 32768,
      schema: compactBlueprint,
      defaultCap: DEFAULT_CAP,
      provider: 'gemini',
      model: 'gemini-3-pro',
    })).toMatchObject({ visibleTokens: 14000, reasoningTokens: 2048, maxOutputTokens: 16560 });
  });
});

describe('heavy structured schemas declare an adequate maxOutputTokens', () => {
  // These schemas back the heaviest structured agents. Without a cap they get
  // silently clamped to DEFAULT_CAP (8192), which the config comments document
  // as insufficient — reintroducing the mid-JSON truncation abort class. This
  // guard fails loudly if a future edit drops the cap.
  it('scene_content is capped at the SceneWriter budget (>= 16384)', () => {
    const schema = buildSceneContentJsonSchema(6);
    expect(schema.maxOutputTokens ?? 0).toBeGreaterThanOrEqual(16384);
    // And the clamp actually preserves the configured SceneWriter budget.
    expect(structuredMaxTokens(16384, schema, DEFAULT_CAP)).toBe(16384);
  });

  it('world_bible / world_locations are capped at the planning budget (>= 32000)', () => {
    expect(buildWorldBibleJsonSchema().maxOutputTokens ?? 0).toBeGreaterThanOrEqual(32000);
    expect(buildWorldLocationsJsonSchema().maxOutputTokens ?? 0).toBeGreaterThanOrEqual(32000);
    expect(structuredMaxTokens(32000, buildWorldBibleJsonSchema(), DEFAULT_CAP)).toBe(32000);
  });

  it('character_bible is capped at the planning budget (>= 32000)', () => {
    const schema = buildCharacterBibleJsonSchema(4);
    expect(schema.maxOutputTokens ?? 0).toBeGreaterThanOrEqual(32000);
    expect(structuredMaxTokens(32000, schema, DEFAULT_CAP)).toBe(32000);
  });
});
