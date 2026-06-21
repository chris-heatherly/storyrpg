import { describe, expect, it, vi } from 'vitest';
import { Assembly, type AssemblyDeps } from './assembly';
import type { PipelineEvent } from './events';

/**
 * Focused tests for the post-assembly orphaned-choice-set invariant. The method
 * only depends on `deps.emit`, so we drive it directly with a minimal stub rather
 * than standing up the full assembly fixture. This is the diagnostic that turns a
 * silently-dropped choice set (beatId drift, moved choice point, lost isChoicePoint
 * flag) into an immediate, named warning at assembly instead of a downstream abort.
 */
function makeAssembly() {
  const events: Array<Omit<PipelineEvent, 'timestamp'>> = [];
  const emit = vi.fn((e: Omit<PipelineEvent, 'timestamp'>) => { events.push(e); });
  const assembly = new Assembly({ emit } as unknown as AssemblyDeps);
  const report = (scenes: any, choiceSets: any, blueprint: any, phase = 'assembly') =>
    (assembly as any).reportOrphanedChoiceSets(scenes, choiceSets, blueprint, phase);
  return { report, emit, events };
}

function makeFullAssembly() {
  return new Assembly({
    config: { generation: {} },
    emit: vi.fn(),
    throwIfFailFast: vi.fn(),
    imageAgentTeam: { getReferenceSheet: vi.fn() },
    styleAnchorPaths: {},
    buildPersistedNpc: vi.fn(),
    ensureBlueprintFidelityText: vi.fn(),
    ensureChoiceBridgeBeats: vi.fn(),
    getEpisodeScopedBeatKey: (_brief: unknown, sceneId: string, beatId: string) => `${sceneId}:${beatId}`,
    getEpisodeScopedSceneId: (_brief: unknown, sceneId: string) => sceneId,
    sanitizeReaderFacingSceneName: (name: string | undefined, fallback?: string) => name || fallback || '',
    sanitizeSceneContentForReader: vi.fn(),
    validateMicroEpisodeSeason: vi.fn(),
    validateMicroEpisodeStructure: vi.fn(),
    wireEncounterTreeImages: vi.fn(() => ({ setupCount: 0, outcomeCount: 0 })),
  } as unknown as AssemblyDeps);
}

const sceneWith = (id: string, beats: Array<{ id: string; choices?: unknown[] }>) => ({ id, beats });
const linearBlueprint = (id: string, leadsTo: string[]) => ({ scenes: [{ id, leadsTo }] });

describe('Assembly.assembleBeatChoices (shared attachment for both assembly paths)', () => {
  const assembly = new Assembly({ emit: () => {} } as unknown as AssemblyDeps);
  const attach = (sceneBlueprint: any, blueprint: any, beatId: string, choiceMap: Map<string, any>) =>
    (assembly as any).assembleBeatChoices(sceneBlueprint, blueprint, { id: beatId, text: 'Choose.', isChoicePoint: true }, choiceMap);

  it('returns undefined when no choice set exists for the beat', () => {
    expect(attach({ id: 's2', leadsTo: ['s3'] }, linearBlueprint('s2', ['s3']), 'b1', new Map())).toBeUndefined();
  });

  it('attaches the choice set and preserves forward nextSceneId', () => {
    const map = new Map([['s2::b1', { choices: [{ id: 'c1', text: 'go', nextSceneId: 's3' }] }]]);
    const blueprint = { scenes: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] };
    const out = attach({ id: 's2', leadsTo: ['s3'] }, blueprint, 'b1', map);
    expect(out).toHaveLength(1);
    expect(out[0].nextSceneId).toBe('s3');
  });

  it('re-points a choice that routes BACKWARD onto a forward leadsTo target', () => {
    const map = new Map([['s2::b1', { choices: [{ id: 'c1', text: 'back', nextSceneId: 's1' }] }]]);
    const blueprint = { scenes: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] };
    const out = attach({ id: 's2', leadsTo: ['s3'] }, blueprint, 'b1', map);
    expect(out[0].nextSceneId).toBe('s3'); // corrected from the backward 's1'
  });
});

describe('Assembly.reportOrphanedChoiceSets', () => {
  it('does not warn when the choice set attached to a rendered beat', () => {
    const { report, emit } = makeAssembly();
    const scenes = [sceneWith('s2-1', [{ id: 'b1', choices: [] }, { id: 'b2', choices: [{ id: 'c1' }] }])];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'b2', choices: [{ id: 'c1' }] }];
    report(scenes, choiceSets, linearBlueprint('s2-1', ['s2-2']));
    expect(emit).not.toHaveBeenCalled();
  });

  it('warns with the exact sceneId::beatId when a choice set attached to no beat', () => {
    const { report, emit, events } = makeAssembly();
    // The choice set is keyed to b9, but no rendered beat carries choices for it.
    const scenes = [sceneWith('s2-1', [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }])];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'b9', choices: [{ id: 'c1' }] }];
    report(scenes, choiceSets, linearBlueprint('s2-1', ['s2-2']));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(events[0].message).toContain('s2-1::b9');
    expect((events[0] as any).data.orphanedChoiceSets).toEqual(['s2-1::b9']);
  });

  it('flags a branch-point orphan as the severe (guaranteed dead branch) case', () => {
    const { report, events } = makeAssembly();
    const scenes = [sceneWith('s2-1', [{ id: 'b1' }, { id: 'b2' }])];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'gone', choices: [{ id: 'c1' }] }];
    // s2-1 is a multi-target branch point.
    report(scenes, choiceSets, { scenes: [{ id: 's2-1', leadsTo: ['s2-2', 's2-3'] }] });
    expect(events[0].message).toContain('planned branch point');
    expect((events[0] as any).data.branchPointOrphans).toEqual(['s2-1::gone']);
  });

  it('does not flag a single-target (non-branch) orphan as a branch point', () => {
    const { report, events } = makeAssembly();
    const scenes = [sceneWith('s2-1', [{ id: 'b1' }])];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'gone', choices: [{ id: 'c1' }] }];
    report(scenes, choiceSets, linearBlueprint('s2-1', ['s2-2']));
    expect((events[0] as any).data.branchPointOrphans).toEqual([]);
  });

  it('is a no-op with no choice sets, and ignores legacy beatId-only (no sceneId) sets', () => {
    const { report, emit } = makeAssembly();
    report([sceneWith('s', [{ id: 'b1' }])], [], linearBlueprint('s', ['x']));
    report([sceneWith('s', [{ id: 'b1' }])], [{ beatId: 'b9', choices: [] }], linearBlueprint('s', ['x']));
    expect(emit).not.toHaveBeenCalled();
  });

  it('treats a beat whose choices ended up empty as NOT consumed (still an orphan)', () => {
    const { report, emit } = makeAssembly();
    const scenes = [sceneWith('s2-1', [{ id: 'b2', choices: [] }])];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'b2', choices: [{ id: 'c1' }] }];
    report(scenes, choiceSets, linearBlueprint('s2-1', ['s2-2']));
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('Assembly timeline persistence', () => {
  it('persists planned timeline metadata in assembleEpisode', () => {
    const assembly = makeFullAssembly();
    const episode = assembly.assembleEpisode(
      { episode: { number: 1, title: 'Ep 1', synopsis: '' }, seasonPlan: { episodes: [] } } as any,
      {} as any,
      { characters: [] } as any,
      {
        startingSceneId: 's1',
        bottleneckScenes: [],
        scenes: [{
          id: 's1',
          name: 'Club Door',
          description: '',
          location: 'Vâlcescu Club',
          timeOfDay: 'night',
          timeJumpFromPrevious: 'later that night',
          leadsTo: [],
          npcsPresent: [],
          purpose: 'setup',
          mood: 'tense',
          keyBeats: [],
          turnContract: {
            turnId: 's1-turn',
            source: 'treatment',
            centralTurn: 'Mika hands Kylie the side-door key card.',
            beforeState: 'Kylie waits outside.',
            turnEvent: 'Mika gives Kylie the card.',
            afterState: 'Kylie has access.',
            handoff: 'Show what the card changes.',
          },
          relationshipPacing: [{
            id: 's1-rel-mika',
            source: 'treatment',
            npcId: 'mika',
            startStage: 'unmet',
            targetStage: 'spark',
            allowedLabels: ['spark'],
            blockedLabels: ['friend'],
            requiredEvidence: ['show behavior'],
            minScenesSinceIntroduction: 1,
            maxDeltaThisScene: 6,
            mechanicDimensions: ['trust'],
          }],
          mechanicPressure: [{
            id: 's1-pressure-keycard',
            source: 'treatment',
            domain: 'item',
            mechanicRef: { itemId: 'key-card' },
            function: 'plant',
            storyPressure: 'The key card creates access leverage and obligation.',
            evidenceRequired: ['show Mika testing Kylie'],
            visibleResidue: ['the card remains visible'],
            allowedPayoffs: ['access route'],
            blockedPayoffs: ['instant friendship'],
          }],
        }],
      } as any,
      [{
        sceneId: 's1',
        sceneName: 'Club Door',
        startingBeatId: 'b1',
        beats: [{ id: 'b1', text: 'You wait by the side entrance.' }],
        charactersInvolved: [],
        transitionIn: 'Later that night, outside the club',
      }] as any,
      [],
    );

    expect(episode.scenes[0].timeline).toEqual({
      location: 'Vâlcescu Club',
      timeOfDay: 'night',
      timeJumpFromPrevious: 'later that night',
      transitionIn: 'Later that night, outside the club',
    });
    expect(episode.scenes[0].turnContract?.centralTurn).toBe('Mika hands Kylie the side-door key card.');
    expect(episode.scenes[0].relationshipPacing?.[0].targetStage).toBe('spark');
    expect(episode.scenes[0].mechanicPressure?.[0].storyPressure).toContain('access leverage');
  });
});
