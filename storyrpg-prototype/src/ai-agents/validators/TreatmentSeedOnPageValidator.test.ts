import { describe, expect, it } from 'vitest';
import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { TreatmentSeedOnPageValidator } from './TreatmentSeedOnPageValidator';

function sceneWithSetFlags(id: string, flags: string[]): Scene {
  return {
    id, name: id, startingBeatId: `${id}-b1`,
    beats: [{
      id: `${id}-b1`, text: `${id} text`,
      choices: [{
        id: `${id}-c1`, text: 'do it',
        consequences: flags.map((flag) => ({ type: 'setFlag', flag, value: true })),
      }],
    }],
  } as Scene;
}

function episode(scenes: Scene[]): Episode {
  return { id: 'ep', number: 3, title: 'Ep', synopsis: '', coverImage: '', startingSceneId: scenes[0].id, scenes } as Episode;
}

function blueprintDeclaring(seedsByScene: Record<string, string[]>): EpisodeBlueprint {
  return {
    episodeId: 'ep', number: 3, title: 'Ep', synopsis: '',
    arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
    themes: [],
    scenes: Object.entries(seedsByScene).map(([id, seeds]) => ({
      id, name: id, description: id, location: 'loc', mood: 'tense', purpose: 'bottleneck',
      dramaticQuestion: '', wantVsNeed: '', conflictEngine: '', npcsPresent: [],
      narrativeFunction: '', keyBeats: [], leadsTo: [],
      choicePoint: { type: 'dilemma', stakes: { want: 'w', cost: 'c', identity: 'i' }, description: 'd', optionHints: [], setsTreatmentSeeds: seeds },
    })),
    startingSceneId: Object.keys(seedsByScene)[0],
    bottleneckScenes: [], suggestedFlags: [], suggestedScores: [], suggestedTags: [], narrativePromises: [],
  } as EpisodeBlueprint;
}

describe('TreatmentSeedOnPageValidator', () => {
  it('passes when every declared seed is set on-page', () => {
    const ep = episode([sceneWithSetFlags('s1', ['treatment_seed_ep3_1', 'treatment_seed_ep3_2'])]);
    const bp = blueprintDeclaring({ s1: ['treatment_seed_ep3_1', 'treatment_seed_ep3_2'] });
    const result = new TreatmentSeedOnPageValidator().validateEpisode(ep, bp);
    expect(result.metrics).toMatchObject({ declaredSeeds: 2, setSeeds: 2, missingSeeds: 0 });
    expect(result.valid).toBe(true);
  });

  it('flags a declared seed that no choice sets (the Endsong poison shape)', () => {
    // Declared treatment_seed_ep3_1 (poison), but the only setFlag is an unrelated flag.
    const ep = episode([sceneWithSetFlags('s5', ['shared_the_cordial'])]);
    const bp = blueprintDeclaring({ s5: ['treatment_seed_ep3_1'] });
    const result = new TreatmentSeedOnPageValidator().validateEpisode(ep, bp);
    expect(result.metrics.missingSeeds).toBe(1);
    expect(result.issues[0].flag).toBe('treatment_seed_ep3_1');
    expect(result.issues[0].severity).toBe('warning');
    expect(result.valid).toBe(true); // advisory by default
  });

  it('escalates to a blocking error when gated', () => {
    const ep = episode([sceneWithSetFlags('s5', [])]);
    const bp = blueprintDeclaring({ s5: ['treatment_seed_ep3_1'] });
    const result = new TreatmentSeedOnPageValidator().validateEpisode(ep, bp, { blocking: true });
    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
  });

  it('counts a seed set anywhere in the episode (cross-scene)', () => {
    const ep = episode([
      sceneWithSetFlags('s1', []),
      sceneWithSetFlags('s2', ['treatment_seed_ep3_1']),
    ]);
    const bp = blueprintDeclaring({ s1: ['treatment_seed_ep3_1'], s2: [] });
    const result = new TreatmentSeedOnPageValidator().validateEpisode(ep, bp);
    expect(result.metrics.missingSeeds).toBe(0);
  });
});
