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
      {
        ...scene('scene-1', ['scene-2a', 'scene-2b']),
        beats: [{
          id: 'scene-1-beat',
          text: 'scene-1 text',
          choices: [
            { id: 'choice-a', text: 'choice-a', nextBeatId: 'scene-1-choice-a-bridge', consequences: [] },
            { id: 'choice-b', text: 'choice-b', nextBeatId: 'scene-1-choice-b-bridge', consequences: [] },
          ],
        }, {
          id: 'scene-1-choice-a-bridge',
          text: 'choice-a bridge',
          nextSceneId: 'scene-2a',
          isChoiceBridge: true,
        }, {
          id: 'scene-1-choice-b-bridge',
          text: 'choice-b bridge',
          nextSceneId: 'scene-2b',
          isChoiceBridge: true,
        }],
      },
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      {
        ...scene('scene-3'),
        isBottleneck: true,
        beats: [{ id: 'scene-3-beat', text: 'scene-3 text', textVariants: [{ condition: { type: 'flag', flag: 'branch_a' } as any, text: 'The route still colors the room.' }] }],
      },
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

  it('counts branch choices routed through generated payoff beats', () => {
    const ep = episode([
      {
        ...scene('scene-1', ['scene-2a', 'scene-2b']),
        beats: [{
          id: 'scene-1-beat',
          text: 'scene-1 text',
          choices: [
            { id: 'choice-a', text: 'choice-a', nextBeatId: 'scene-1-payoff-a', consequences: [] },
            { id: 'choice-b', text: 'choice-b', nextBeatId: 'scene-1-payoff-b', consequences: [] },
          ],
        }, {
          id: 'scene-1-payoff-a',
          text: 'payoff a',
          nextSceneId: 'scene-2a',
          isChoiceBridge: true,
        }, {
          id: 'scene-1-payoff-b',
          text: 'payoff b',
          nextSceneId: 'scene-2b',
          isChoiceBridge: true,
        }],
      },
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      {
        ...scene('scene-3'),
        isBottleneck: true,
        beats: [{ id: 'scene-3-beat', text: 'scene-3 text', callbackHookIds: ['branch-choice'] }],
      },
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
    expect(result.metrics.reconvergingBranchTargetCount).toBe(2);
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

  it('fails reconverged branches that do not leave bottleneck residue', () => {
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

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.type === 'missing_branch_residue')).toBe(true);
  });

  it('fails direct scene-changing choices that skip a bridge beat', () => {
    const ep = episode([
      scene('scene-1', ['scene-2'], [{ id: 'choice-a', nextSceneId: 'scene-2' }]),
      scene('scene-2'),
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2'], branches: true, type: 'strategic' },
      { id: 'scene-2', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.type === 'missing_choice_bridge')).toBe(true);
  });

  it('allows sceneEpisode route-flag branchlets without nextSceneId scene routing', () => {
    const ep = episode([
      scene('scene-1', [], [{ id: 'choice-a' }, { id: 'choice-b' }]),
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['future-route-a', 'future-route-b'], branches: true, type: 'dilemma' },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp, {
      requireSceneGraphBranching: false,
      allowLinearBottleneckEpisodes: true,
      ignoreBlueprintBranchesWithoutSceneRouting: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.type === 'lost_branch_during_assembly')).toBe(false);
  });

  it('warns when an important NPC is staged visually before the beat prose introduces them', () => {
    const ep = episode([
      {
        ...scene('scene-1'),
        beats: [{
          id: 'scene-1-beat',
          text: 'You hesitate at the velvet rope while the doorman judges your dress.',
          coveragePlan: {
            stagingPattern: 'two-shot',
            shotDistance: 'MS',
            cameraAngle: 'eye-level',
            cameraSide: 'front',
            focalCharacterIds: ['Kylie'],
            requiredVisibleCharacterIds: ['Kylie', 'Victor'],
            optionalVisibleCharacterIds: [],
            offscreenCharacterIds: [],
            relationshipBlocking: 'threshold pressure',
            coverageReason: 'arrival',
          },
        }],
      },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, undefined, {
      requireSceneGraphBranching: false,
      importantNpcIds: ['Victor'],
    });

    expect(result.issues.some(issue => issue.type === 'premature_npc_visual')).toBe(true);
  });

  it('warns when prompt or visual-cast metadata includes an important NPC before introduction', () => {
    const ep = episode([
      {
        ...scene('scene-1'),
        beats: [{
          id: 'scene-1-beat',
          text: 'You hesitate at the velvet rope while the anonymous doorman judges your dress.',
          visualCast: {
            sceneCharacterIds: ['Kylie', 'Victor'],
            activeCharacterIds: ['Kylie'],
            foregroundCharacterIds: ['Kylie'],
            backgroundCharacterIds: [],
            offscreenCharacterIds: ['Victor'],
            addressedCharacterIds: [],
            listenerCharacterIds: [],
            observerCharacterIds: [],
            payoffRelevantCharacterIds: [],
            castReason: 'bad metadata',
          },
          imagePrompt: {
            characters: ['Victor'],
            referenceCharIds: ['Victor'],
          },
        } as any],
      },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, undefined, {
      requireSceneGraphBranching: false,
      importantNpcIds: ['Victor'],
    });

    expect(result.issues.some(issue => issue.type === 'premature_npc_visual')).toBe(true);
  });
});
