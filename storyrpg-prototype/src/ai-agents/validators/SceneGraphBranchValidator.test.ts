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

  it('passes a reconverged ENCOUNTER target whose residue lives in its nested structure', () => {
    // Regression (G10): an encounter scene carries its content (and branch-acknowledgment
    // residue — reminderPlan/witnessReactions/onShow) inside encounter.phases/beats/storylets,
    // NOT in top-level scene.beats. The convergence-residue check must look there or every
    // reconverged encounter (e.g. treatment-enc-2-1) false-fails.
    const encScene = {
      ...scene('scene-3'),
      beats: [], // encounters have no top-level beats
      isConvergencePoint: true,
      isBottleneck: true,
      encounter: {
        phases: [
          { beats: [{ id: 'enc-b1', text: 'opening', choices: [{ id: 'enc-c1', text: 'act', reminderPlan: { note: 'recall the path taken' } }] }] },
        ],
        storylets: { victory: { beats: [{ id: 'v1', text: 'win' }] } },
        outcomes: {},
      },
    } as unknown as Scene;
    const ep = episode([
      scene('scene-1', ['scene-2a', 'scene-2b'], [
        { id: 'choice-a', nextSceneId: 'scene-2a' },
        { id: 'choice-b', nextSceneId: 'scene-2b' },
      ]),
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      encScene,
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2a', 'scene-2b'], branches: true, type: 'dilemma' },
      { id: 'scene-2a', leadsTo: ['scene-3'] },
      { id: 'scene-2b', leadsTo: ['scene-3'] },
      { id: 'scene-3', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);
    expect(result.issues.some(issue => issue.type === 'missing_branch_residue')).toBe(false);
  });

  it('passes a reconverged ENCOUNTER target that is genuinely branched (≥2 outcome storylets)', () => {
    // A well-formed encounter is the designed merge point and re-diverges by outcome; its
    // outcome storylets are the structural acknowledgment of the path, even without
    // beat-level residue (encounters get no SequenceDirector residue pass).
    const encScene = {
      ...scene('scene-3'),
      beats: [],
      isConvergencePoint: true,
      isBottleneck: true,
      encounter: {
        beats: [{ id: 'enc-b1', text: 'opening', choices: [{ id: 'enc-c1', text: 'act' }] }],
        storylets: {
          victory: { beats: [{ id: 'v1', text: 'win' }] },
          partialVictory: { beats: [{ id: 'p1', text: 'mixed' }] },
          defeat: { beats: [{ id: 'd1', text: 'lose' }] },
          escape: { beats: [{ id: 'e1', text: 'flee' }] },
        },
        outcomes: {},
      },
    } as unknown as Scene;
    const ep = episode([
      scene('scene-1', ['scene-2a', 'scene-2b'], [
        { id: 'choice-a', nextSceneId: 'scene-2a' },
        { id: 'choice-b', nextSceneId: 'scene-2b' },
      ]),
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      encScene,
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2a', 'scene-2b'], branches: true, type: 'dilemma' },
      { id: 'scene-2a', leadsTo: ['scene-3'] },
      { id: 'scene-2b', leadsTo: ['scene-3'] },
      { id: 'scene-3', leadsTo: [] },
    ]);
    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);
    expect(result.issues.some(issue => issue.type === 'missing_branch_residue')).toBe(false);
  });

  it('still fails a reconverged ENCOUNTER target with no residue and <2 outcomes', () => {
    const encScene = {
      ...scene('scene-3'),
      beats: [],
      isConvergencePoint: true,
      isBottleneck: true,
      encounter: {
        beats: [{ id: 'enc-b1', text: 'opening', choices: [{ id: 'enc-c1', text: 'act' }] }],
        storylets: { victory: { beats: [{ id: 'v1', text: 'win' }] } },
        outcomes: {},
      },
    } as unknown as Scene;
    const ep = episode([
      scene('scene-1', ['scene-2a', 'scene-2b'], [
        { id: 'choice-a', nextSceneId: 'scene-2a' },
        { id: 'choice-b', nextSceneId: 'scene-2b' },
      ]),
      scene('scene-2a', ['scene-3']),
      scene('scene-2b', ['scene-3']),
      encScene,
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2a', 'scene-2b'], branches: true, type: 'dilemma' },
      { id: 'scene-2a', leadsTo: ['scene-3'] },
      { id: 'scene-2b', leadsTo: ['scene-3'] },
      { id: 'scene-3', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);
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

  it('does not flag choices that route to the episode-end terminal sentinel', () => {
    // The final scene's disclosure choices route to episode-end (story end), not
    // to a scene — these must NOT be treated as "missing scene" branch targets.
    const ep = episode([
      scene('scene-1', ['scene-2'], [{ id: 'choice-go', nextSceneId: 'scene-2' }]),
      {
        ...scene('scene-2', []),
        beats: [{
          id: 'scene-2-beat',
          text: 'the finale',
          choices: [
            { id: 'choice-share-full-weight', text: 'Share', nextSceneId: 'episode-end', consequences: [] },
            { id: 'choice-manage-sentinel-burden', text: 'Manage', nextSceneId: 'episode-end', consequences: [] },
          ],
        }],
      },
    ]);
    const bp = blueprint([
      { id: 'scene-1', leadsTo: ['scene-2'] },
      { id: 'scene-2', leadsTo: [] },
    ]);

    const result = new SceneGraphBranchValidator().validateEpisode(ep, bp);

    expect(result.issues.some(issue => issue.type === 'invalid_branch_target')).toBe(false);
    expect(result.issues.some(issue => issue.message.includes('episode-end'))).toBe(false);
  });

  describe('branch-fan-out (dead-branch) detection', () => {
    // scene-1 is PLANNED as a multi-target branch (leadsTo: [scene-2, scene-3])
    // but every choice routes to scene-2 — the Endsong s3-1 dead-branch shape.
    const deadBranchEpisode = () => episode([
      scene('scene-1', ['scene-2', 'scene-3'], [
        { id: 'choice-a', nextSceneId: 'scene-2' },
        { id: 'choice-b', nextSceneId: 'scene-2' },
      ]),
      scene('scene-2', ['scene-3']),
      scene('scene-3'),
    ]);
    const deadBranchBlueprint = () => blueprint([
      { id: 'scene-1', leadsTo: ['scene-2', 'scene-3'], branches: true, type: 'dilemma' },
      { id: 'scene-2', leadsTo: ['scene-3'] },
      { id: 'scene-3', leadsTo: [] },
    ]);
    // Isolate the fan-out check from the other branch contracts.
    const isolate = {
      requireSceneGraphBranching: false,
      requireChoiceBridge: false,
      allowLinearBottleneckEpisodes: true,
    } as const;

    it('records the metric but emits no issue when the gate is off', () => {
      const result = new SceneGraphBranchValidator().validateEpisode(
        deadBranchEpisode(), deadBranchBlueprint(), { ...isolate },
      );
      expect(result.metrics.unrealizedBlueprintBranchTargetCount).toBe(1);
      expect(result.issues.some(i => i.type === 'unrealized_blueprint_branch_target')).toBe(false);
    });

    it('flags an unrealized branch target as an error when the gate is on', () => {
      const result = new SceneGraphBranchValidator().validateEpisode(
        deadBranchEpisode(), deadBranchBlueprint(), { ...isolate, requireBlueprintBranchFanOut: true },
      );
      expect(result.metrics.unrealizedBlueprintBranchTargetCount).toBe(1);
      const issue = result.issues.find(i => i.type === 'unrealized_blueprint_branch_target');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('error');
      expect(issue?.sceneId).toBe('scene-1');
      expect(result.valid).toBe(false);
    });

    it('does not flag a genuine fan-out that reaches both targets', () => {
      const ep = episode([
        scene('scene-1', ['scene-2', 'scene-3'], [
          { id: 'choice-a', nextSceneId: 'scene-2' },
          { id: 'choice-b', nextSceneId: 'scene-3' },
        ]),
        scene('scene-2', ['scene-4']),
        scene('scene-3', ['scene-4']),
        scene('scene-4'),
      ]);
      const bp = blueprint([
        { id: 'scene-1', leadsTo: ['scene-2', 'scene-3'], branches: true, type: 'dilemma' },
        { id: 'scene-2', leadsTo: ['scene-4'] },
        { id: 'scene-3', leadsTo: ['scene-4'] },
        { id: 'scene-4', leadsTo: [] },
      ]);
      const result = new SceneGraphBranchValidator().validateEpisode(ep, bp, {
        ...isolate, requireBlueprintBranchFanOut: true,
      });
      expect(result.metrics.unrealizedBlueprintBranchTargetCount).toBe(0);
      expect(result.issues.some(i => i.type === 'unrealized_blueprint_branch_target')).toBe(false);
    });
  });
});
