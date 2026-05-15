import { describe, expect, it } from 'vitest';
import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { SceneGraphBranchValidator } from './SceneGraphBranchValidator';

function scene(id: string, leadsTo: string[] = [], choices: Array<{ id: string; nextSceneId?: string }> = []): Scene {
  return {
    id,
    name: id,
    startingBeatId: `${id}-beat`,
    leadsTo,
    beats: [{
      id: `${id}-beat`,
      text: `${id} text`,
      choices: choices.length
        ? choices.map(choice => ({ id: choice.id, text: choice.id, nextSceneId: choice.nextSceneId, consequences: [] }))
        : undefined,
    }],
  };
}

function episode(scenes: Scene[]): Episode {
  return {
    id: 'episode-1',
    number: 1,
    title: 'Episode 1',
    synopsis: 'Test',
    coverImage: '',
    startingSceneId: scenes[0].id,
    scenes,
  };
}

function blueprint(scenes: Array<{ id: string; leadsTo: string[]; branches?: boolean; type?: 'expression' | 'relationship' | 'strategic' | 'dilemma' }>): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    number: 1,
    title: 'Episode 1',
    synopsis: 'Test',
    arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
    themes: [],
    scenes: scenes.map(item => ({
      id: item.id,
      name: item.id,
      description: item.id,
      location: 'location-1',
      mood: 'tense',
      purpose: item.branches ? 'transition' : 'bottleneck',
      dramaticQuestion: '',
      wantVsNeed: '',
      conflictEngine: '',
      npcsPresent: [],
      narrativeFunction: '',
      keyBeats: [],
      leadsTo: item.leadsTo,
      choicePoint: item.type ? {
        type: item.type,
        branches: item.branches,
        stakes: { want: 'win', cost: 'risk', identity: 'self' },
        description: 'Choose',
        optionHints: [],
      } : undefined,
    })),
    startingSceneId: scenes[0].id,
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
  };
}

describe('SceneGraphBranchValidator', () => {
  it('passes a real scene-graph branch that targets distinct future scenes', () => {
    const ep = episode([
      scene('scene-1', ['scene-2a', 'scene-2b'], [
        { id: 'choice-a', nextSceneId: 'scene-2a' },
        { id: 'choice-b', nextSceneId: 'scene-2b' },
      ]),
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      { ...scene('scene-3'), isBottleneck: true },
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2a', 'scene-2b'], branches: true, type: 'dilemma' },
      { id: 'scene-2a', leadsTo: ['scene-3'] },
      { id: 'scene-2b', leadsTo: ['scene-3'] },
      { id: 'scene-3', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);

    expect(result.valid).toBe(true);
    expect(result.metrics.sceneGraphBranchChoiceCount).toBe(2);
    expect(result.metrics.regularChoiceCount).toBe(2);
  });

  it('fails when choices exist but none route to scenes', () => {
    const ep = episode([
      scene('scene-1', ['scene-2'], [{ id: 'choice-a' }, { id: 'choice-b' }]),
      scene('scene-2'),
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2'], type: 'relationship' },
      { id: 'scene-2', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.type === 'missing_scene_graph_branch')).toBe(true);
    expect(result.metrics.regularChoiceCount).toBe(2);
    expect(result.metrics.sceneGraphBranchChoiceCount).toBe(0);
  });

  it('fails branch choices that point backward or to missing scenes', () => {
    const ep = episode([
      scene('scene-1', ['scene-2']),
      scene('scene-2', ['scene-3'], [
        { id: 'backward', nextSceneId: 'scene-1' },
        { id: 'missing', nextSceneId: 'scene-x' },
      ]),
      scene('scene-3'),
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2'] },
      { id: 'scene-2', leadsTo: ['scene-1', 'scene-x'], branches: true, type: 'strategic' },
      { id: 'scene-3', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp, { minSceneGraphBranchesPerEpisode: 1 });

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.type === 'backward_or_self_branch')).toBe(true);
    expect(result.issues.some(issue => issue.type === 'invalid_branch_target')).toBe(true);
  });
});
