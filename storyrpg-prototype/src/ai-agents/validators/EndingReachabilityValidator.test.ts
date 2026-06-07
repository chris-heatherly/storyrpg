import { describe, expect, it } from 'vitest';
import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { EndingReachabilityValidator } from './EndingReachabilityValidator';

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

function blueprintDeclaring(axesByScene: Record<string, string[]>): EpisodeBlueprint {
  return {
    episodeId: 'ep', number: 3, title: 'Ep', synopsis: '',
    arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
    themes: [],
    scenes: Object.entries(axesByScene).map(([id, axes]) => ({
      id, name: id, description: id, location: 'loc', mood: 'tense', purpose: 'bottleneck',
      dramaticQuestion: '', wantVsNeed: '', conflictEngine: '', npcsPresent: [],
      narrativeFunction: '', keyBeats: [], leadsTo: [],
      choicePoint: { type: 'dilemma', stakes: { want: 'w', cost: 'c', identity: 'i' }, description: 'd', optionHints: [], setsBranchAxes: axes },
    })),
    startingSceneId: Object.keys(axesByScene)[0],
    bottleneckScenes: [], suggestedFlags: [], suggestedScores: [], suggestedTags: [], narrativePromises: [],
  } as EpisodeBlueprint;
}

describe('EndingReachabilityValidator', () => {
  const v = new EndingReachabilityValidator();

  it('passes when every declared ending axis is set on-page', () => {
    const bp = blueprintDeclaring({ s1: ['treatment_branch_purity', 'treatment_branch_synthesis'] });
    const ep = episode([sceneWithSetFlags('s1', ['treatment_branch_purity', 'treatment_branch_synthesis'])]);
    const res = v.validateEpisode(ep, bp);
    expect(res.valid).toBe(true);
    expect(res.metrics).toMatchObject({ declaredAxes: 2, setAxes: 2, missingAxes: 0 });
  });

  it('flags a declared axis that no choice sets (the unreachable-ending defect)', () => {
    const bp = blueprintDeclaring({ s1: ['treatment_branch_purity', 'treatment_branch_synthesis'] });
    const ep = episode([sceneWithSetFlags('s1', ['treatment_branch_purity'])]); // synthesis never set
    const res = v.validateEpisode(ep, bp);
    expect(res.metrics.missingAxes).toBe(1);
    expect(res.issues[0].flag).toBe('treatment_branch_synthesis');
    // advisory by default → still "valid" (warning, not error)
    expect(res.valid).toBe(true);
    expect(res.issues[0].severity).toBe('warning');
  });

  it('escalates to a blocking error when blocking is set', () => {
    const bp = blueprintDeclaring({ s1: ['treatment_branch_synthesis'] });
    const ep = episode([sceneWithSetFlags('s1', [])]);
    const res = v.validateEpisode(ep, bp, { blocking: true });
    expect(res.valid).toBe(false);
    expect(res.issues[0].severity).toBe('error');
  });

  it('is a no-op when the blueprint declares no ending axes', () => {
    const bp = blueprintDeclaring({ s1: [] });
    const ep = episode([sceneWithSetFlags('s1', [])]);
    const res = v.validateEpisode(ep, bp);
    expect(res.valid).toBe(true);
    expect(res.metrics.declaredAxes).toBe(0);
  });
});
