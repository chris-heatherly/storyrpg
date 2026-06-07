import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  seedEncounterOutcomeFlags,
  findEncounterOutcomeDesyncs,
  encounterOutcomeFlag,
} from './encounterOutcomeFlags';

function storyWithEncounter(opts: {
  outcomes: Record<string, { nextSceneId: string; consequences?: unknown[] }>;
  reconvScene?: { id: string; variants?: Array<Record<string, unknown>> };
}): Story {
  const scenes: unknown[] = [
    {
      id: 'enc-scene', name: 'Breach', startingBeatId: 'b1', beats: [{ id: 'b1', text: 'fight' }],
      encounter: {
        id: 'enc-1', type: 'combat', name: 'Breach', description: '',
        goalClock: {}, threatClock: {}, stakes: { victory: '', defeat: '' },
        phases: [], startingPhaseId: 'p1',
        outcomes: Object.fromEntries(
          Object.entries(opts.outcomes).map(([k, v]) => [k, { nextSceneId: v.nextSceneId, outcomeText: 'x', consequences: v.consequences || [] }]),
        ),
      },
    },
  ];
  if (opts.reconvScene) {
    scenes.push({
      id: opts.reconvScene.id, name: opts.reconvScene.id, startingBeatId: 'rb1',
      beats: [{ id: 'rb1', text: 'after', textVariants: opts.reconvScene.variants || [] }],
    });
  }
  return {
    id: 's', title: 't', genre: 'g', synopsis: '', coverImage: '',
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: [],
    episodes: [{ id: 'ep1', number: 1, title: '', synopsis: '', coverImage: '', startingSceneId: 'enc-scene', scenes }],
  } as unknown as Story;
}

describe('seedEncounterOutcomeFlags', () => {
  it('adds a setFlag for each present outcome, idempotently', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
    });
    const r1 = seedEncounterOutcomeFlags(story);
    expect(r1).toEqual({ encountersSeeded: 1, flagsAdded: 2 });
    const enc = (story.episodes[0].scenes[0] as any).encounter;
    const flags = enc.outcomes.victory.consequences.map((c: any) => c.flag);
    expect(flags).toContain(encounterOutcomeFlag('enc-1', 'victory'));
    // Idempotent: second pass adds nothing.
    expect(seedEncounterOutcomeFlags(story).flagsAdded).toBe(0);
  });
});

describe('findEncounterOutcomeDesyncs', () => {
  it('flags a reconvergence scene with no outcome-conditioned variant', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
      reconvScene: { id: 's5', variants: [] },
    });
    const desyncs = findEncounterOutcomeDesyncs(story);
    expect(desyncs).toHaveLength(1);
    expect(desyncs[0]).toMatchObject({ encounterId: 'enc-1', reconvergenceSceneId: 's5' });
    expect(desyncs[0].outcomes.sort()).toEqual(['partialVictory', 'victory']);
  });

  it('does NOT flag when the reconvergence scene has an outcome-conditioned variant', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
      reconvScene: {
        id: 's5',
        variants: [{ condition: { type: 'flag', flag: 'encounter_enc-1_partialVictory', value: true }, text: 'She is favoring her ribs.' }],
      },
    });
    expect(findEncounterOutcomeDesyncs(story)).toHaveLength(0);
  });

  it('does NOT flag when outcomes route to different scenes (no reconvergence)', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, defeat: { nextSceneId: 's6' } },
      reconvScene: { id: 's5', variants: [] },
    });
    expect(findEncounterOutcomeDesyncs(story)).toHaveLength(0);
  });
});
