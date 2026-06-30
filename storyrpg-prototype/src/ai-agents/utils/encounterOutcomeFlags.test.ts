import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  seedEncounterOutcomeFlags,
  findEncounterOutcomeDesyncs,
  encounterOutcomeFlag,
  firstProseBeatId,
  applyOutcomeVariants,
  canonicalEncounterFlagId,
  canonicalizeEncounterOutcomeFlagName,
  normalizeEncounterOutcomeFlags,
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

describe('canonical flag spelling (G12)', () => {
  it('strips the converter auto `-encounter` suffix from the id', () => {
    expect(canonicalEncounterFlagId('treatment-enc-1-1-encounter')).toBe('treatment-enc-1-1');
    expect(canonicalEncounterFlagId('enc-1')).toBe('enc-1');
    expect(encounterOutcomeFlag('treatment-enc-1-1-encounter', 'escape')).toBe('encounter_treatment-enc-1-1_escape');
  });

  it('canonicalizes outcome aliases (partial_victory, escaped, defeated)', () => {
    expect(canonicalizeEncounterOutcomeFlagName('encounter_s1-4_partial_victory')).toBe('encounter_s1-4_partialVictory');
    expect(canonicalizeEncounterOutcomeFlagName('encounter_s1-4_escaped')).toBe('encounter_s1-4_escape');
    expect(canonicalizeEncounterOutcomeFlagName('encounter_s1-4_defeated')).toBe('encounter_s1-4_defeat');
    // Non-encounter flags pass through untouched.
    expect(canonicalizeEncounterOutcomeFlagName('kylie_drank_the_dark_wine')).toBe('kylie_drank_the_dark_wine');
    expect(canonicalizeEncounterOutcomeFlagName('blog_post_held_overnight')).toBe('blog_post_held_overnight');
  });

  it('normalizeEncounterOutcomeFlags rewrites variant conditions AND setters across the story', () => {
    const story = storyWithEncounter({
      outcomes: {
        victory: { nextSceneId: 's5', consequences: [{ type: 'setFlag', flag: 'encounter_enc-scene-encounter_victory', value: true }] },
        escape: { nextSceneId: 's5' },
      },
      reconvScene: {
        id: 's5',
        // The G12 shape: variant keyed on the SCENE id while the seeder used `<enc.id>` —
        // dead at runtime until normalized to one spelling.
        variants: [{ condition: { type: 'flag', flag: 'encounter_enc-scene-encounter_escaped', value: true }, text: 'You walked home fast.' }],
      },
    });
    const rewrites = normalizeEncounterOutcomeFlags(story);
    expect(rewrites).toBe(2);
    const enc = (story.episodes[0].scenes[0] as any).encounter;
    expect(enc.outcomes.victory.consequences[0].flag).toBe('encounter_enc-scene_victory');
    const variant = (story.episodes[0].scenes[1] as any).beats[0].textVariants[0];
    expect(variant.condition.flag).toBe('encounter_enc-scene_escape');
    // Idempotent.
    expect(normalizeEncounterOutcomeFlags(story)).toBe(0);
  });

  it('round-trip: scene-id-keyed variants now clear the desync after normalization', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
      reconvScene: {
        id: 's5',
        variants: [{ condition: { type: 'flag', flag: 'encounter_enc-1_partial_victory', value: true }, text: 'Favoring her ribs.' }],
      },
    });
    // Even unnormalized, the detector now canonicalizes while matching:
    expect(findEncounterOutcomeDesyncs(story)).toHaveLength(0);
    normalizeEncounterOutcomeFlags(story);
    const variant = (story.episodes[0].scenes[1] as any).beats[0].textVariants[0];
    expect(variant.condition.flag).toBe('encounter_enc-1_partialVictory');
  });
});

describe('firstProseBeatId', () => {
  it('returns the first non-empty, non-choice-bridge beat id', () => {
    const scene = { id: 's', beats: [
      { id: 'cb', text: '', isChoiceBridge: true },
      { id: 'rb1', text: 'after' },
      { id: 'rb2', text: 'later' },
    ] } as any;
    expect(firstProseBeatId(scene)).toBe('rb1');
  });
});

describe('applyOutcomeVariants', () => {
  it('adds flag-gated variants to the beat and CLEARS the desync (round-trip)', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
      reconvScene: { id: 's5', variants: [] },
    });
    expect(findEncounterOutcomeDesyncs(story)).toHaveLength(1);

    const added = applyOutcomeVariants(story, 's5', 'rb1', 'enc-1', [
      { outcome: 'victory', text: 'She stands easy at the parapet.' },
      { outcome: 'partialVictory', text: 'She stands at the parapet, favoring her ribs.' },
    ]);
    expect(added).toBe(2);

    const beat = (story.episodes[0].scenes[1] as any).beats[0];
    expect(beat.textVariants).toHaveLength(2);
    expect(beat.textVariants[0].condition).toEqual({ type: 'flag', flag: encounterOutcomeFlag('enc-1', 'victory'), value: true });
    // The detector now sees outcome-conditioned text → no desync.
    expect(findEncounterOutcomeDesyncs(story)).toHaveLength(0);
  });

  it('is idempotent: re-applying the same outcome adds nothing, and skips empty text', () => {
    const story = storyWithEncounter({
      outcomes: { victory: { nextSceneId: 's5' }, partialVictory: { nextSceneId: 's5' } },
      reconvScene: { id: 's5', variants: [] },
    });
    applyOutcomeVariants(story, 's5', 'rb1', 'enc-1', [{ outcome: 'victory', text: 'easy.' }]);
    const again = applyOutcomeVariants(story, 's5', 'rb1', 'enc-1', [
      { outcome: 'victory', text: 'easy.' },          // already present → skipped
      { outcome: 'partialVictory', text: '   ' },      // empty → skipped
    ]);
    expect(again).toBe(0);
  });
});
