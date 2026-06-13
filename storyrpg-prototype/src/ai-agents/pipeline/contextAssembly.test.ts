/**
 * Context-assembly tests (WS2.1). The five builders were pure-moved from
 * FullStoryPipeline behind thin delegators (goldens prove prompt parity);
 * these cover the non-trivial logic directly, with the encounter prior-state
 * contract — directive parsing, suggested-flag merge, default-relationship
 * synthesis via the injected upper-bound lookup — as the main subject.
 */

import { describe, it, expect } from 'vitest';
import {
  buildChoiceAuthorNpcs,
  buildCompactWorldContext,
  buildEncounterPriorStateContext,
  inferBranchType,
} from './contextAssembly';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import type { WorldBible } from '../agents/WorldBuilder';

const blueprint = {
  episodeId: 'episode-1',
  scenes: [],
  suggestedFlags: [{ name: 'door_open', description: 'The vault door was left open.' }],
} as unknown as EpisodeBlueprint;

function encounterScene(setupContext?: string[]): SceneBlueprint {
  return {
    id: 's1-3',
    mood: 'tense',
    purpose: 'development',
    encounterSetupContext: setupContext,
  } as unknown as SceneBlueprint;
}

describe('buildEncounterPriorStateContext', () => {
  it('parses flag: and relationship: directives and routes free text to significantChoices', () => {
    const ctx = buildEncounterPriorStateContext(
      encounterScene([
        'flag:stole_key — The player pocketed the cellar key.',
        'relationship:mara.trust < -20 — Mara saw the betrayal.',
        'The player promised to return by dawn.',
      ]),
      blueprint,
      [{ id: 'mara', name: 'Mara' }],
      new Set(['stole_key']),
      () => 35,
    );
    expect(ctx?.relevantFlags).toEqual([
      { name: 'stole_key', description: 'The player pocketed the cellar key.', alreadySet: true },
      { name: 'door_open', description: 'The vault door was left open.', alreadySet: false },
    ]);
    expect(ctx?.relevantRelationships).toEqual([
      {
        npcId: 'mara', npcName: 'Mara', dimension: 'trust', operator: '<', threshold: -20,
        description: 'Mara saw the betrayal.', authored: true, currentMaxValue: 35,
      },
    ]);
    expect(ctx?.significantChoices).toEqual(['The player promised to return by dawn.']);
  });

  it('synthesizes default relationship thresholds only when none were authored', () => {
    const ctx = buildEncounterPriorStateContext(
      encounterScene(),
      blueprint,
      [{ id: 'mara', name: 'Mara' }],
      undefined,
      (npcId, dim) => (dim === 'trust' ? 25 : 0),
    );
    expect(ctx?.relevantRelationships).toHaveLength(4); // trust/affection/respect/fear
    const trust = ctx?.relevantRelationships.find((r) => r.dimension === 'trust');
    expect(trust).toMatchObject({ authored: false, threshold: 20, currentMaxValue: 25 });
    const fear = ctx?.relevantRelationships.find((r) => r.dimension === 'fear');
    expect(fear).toMatchObject({ threshold: 40, currentMaxValue: 0 });
  });

  it('works without an upper-bound lookup (no incremental validator yet)', () => {
    const ctx = buildEncounterPriorStateContext(
      encounterScene(),
      blueprint,
      [{ id: 'mara', name: 'Mara' }],
      undefined,
      undefined,
    );
    expect(ctx?.relevantRelationships.every((r) => r.currentMaxValue === 0)).toBe(true);
  });

  it('returns undefined when nothing is relevant', () => {
    const bareBlueprint = { episodeId: 'episode-1', scenes: [], suggestedFlags: [] } as unknown as EpisodeBlueprint;
    expect(buildEncounterPriorStateContext(encounterScene(), bareBlueprint, [], undefined, undefined)).toBeUndefined();
  });
});

describe('buildChoiceAuthorNpcs', () => {
  it('falls back to the npc id when the bible has no profile', () => {
    const bible = { characters: [] } as unknown as CharacterBible;
    expect(buildChoiceAuthorNpcs(['ghost'], bible)).toEqual([
      { id: 'ghost', name: 'ghost', pronouns: 'he/him', description: '', voiceNotes: undefined, physicalDescription: undefined },
    ]);
  });
});

describe('buildCompactWorldContext', () => {
  it('summarizes capped slices of the bible sections', () => {
    const bible = {
      worldRules: ['Rule A', 'Rule B'],
      tensions: ['Tension X'],
      factions: [{ name: 'Guild', overview: 'Controls the docks' }],
      customs: ['No iron at the table'],
    } as unknown as WorldBible;
    const ctx = buildCompactWorldContext(bible, 'A rain-slick alley.');
    expect(ctx).toContain('A rain-slick alley.');
    expect(ctx).toContain('World rules: Rule A. Rule B');
    expect(ctx).toContain('Factions: Guild (Controls the docks)');
  });
});

describe('inferBranchType', () => {
  it('maps mood keywords to branch types', () => {
    const bp = { scenes: [], bottleneckScenes: [] } as unknown as EpisodeBlueprint;
    const scene = (mood: string) => ({ id: 's', mood, purpose: 'development' }) as unknown as SceneBlueprint;
    expect(inferBranchType(scene('grim and ominous'), bp)).toBe('dark');
    expect(inferBranchType(scene('warm and hopeful'), bp)).toBe('hopeful');
    expect(inferBranchType(scene('mournful grief'), bp)).toBe('tragic');
    expect(inferBranchType(scene('a second chance at healing'), bp)).toBe('redemption');
    expect(inferBranchType(scene('curious'), bp)).toBe('neutral');
  });
});
