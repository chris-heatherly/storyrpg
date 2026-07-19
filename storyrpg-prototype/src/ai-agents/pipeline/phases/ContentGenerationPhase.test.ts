import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { isEncounterNarrativelyHollow } from '../encounterCompleteness';
import { collectEncounterParticipantRefs, filterProtagonistEncounterRefs } from '../encounterParticipants';
import type { SceneContent } from '../../agents/SceneWriter';

const passingSemanticJudge = {
  identity: () => ({ policyVersion: 'test', provider: 'test', model: 'test' }),
  execute: async (claims: Array<{ id: string; excerpts: Array<{ id: string; text: string }> }>) => ({
    success: true,
    data: {
      verdicts: claims.map((claim) => ({
        id: claim.id,
        verdict: 'fulfilled' as const,
        evidenceRefs: claim.excerpts.map((excerpt) => excerpt.id),
        evidenceQuotes: claim.excerpts.map((excerpt) => excerpt.text),
        missingCriteria: [],
        rationale: 'test fixture accepts the authored excerpt',
      })),
    },
  }),
};

describe('ContentGenerationPhase encounter completeness', () => {
  it('treats an id-only encounter beat as hollow', () => {
    expect(isEncounterNarrativelyHollow({ beats: [{ id: 'beat-1' } as any] })).toBe(true);
  });

  it('accepts an encounter with player-facing setup prose', () => {
    expect(isEncounterNarrativelyHollow({
      beats: [{
        id: 'beat-1',
        setupText: 'Fog closes over the park path as the figure steps out from the willow shadows.',
      } as any],
    })).toBe(false);
  });

  it('accepts an encounter with authored choice outcome prose', () => {
    expect(isEncounterNarrativelyHollow({
      beats: [{
        id: 'beat-1',
        choices: [{
          id: 'choice-1',
          text: 'Hold your ground.',
          outcomes: {
            success: {
              narrativeText: 'You plant your feet and make the attacker hesitate long enough for help to arrive.',
            },
          },
        }],
      } as any],
    })).toBe(false);
  });
});

describe('filterProtagonistEncounterRefs', () => {
  it('removes protagonist id, full name, and first-name refs before EncounterArchitect NPC handoff', () => {
    expect(filterProtagonistEncounterRefs(
      ['char-kylie-marinescu', 'Kylie Marinescu', 'Kylie', 'Victor Vâlcescu', 'char-stela-pavel'],
      { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
    )).toEqual(['Victor Vâlcescu', 'char-stela-pavel']);
  });

  it('matches protagonist refs through accents and punctuation normalization', () => {
    expect(filterProtagonistEncounterRefs(
      ['char-kylie-marinescu', 'Kylie-Marinescu', 'Mika Drăgan'],
      { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
    )).toEqual(['Mika Drăgan']);
  });
});

describe('collectEncounterParticipantRefs', () => {
  it('includes participants from scene and nested encounter shapes', () => {
    expect(collectEncounterParticipantRefs({
      encounterRequiredNpcIds: [],
      npcsPresent: [],
      npcsInvolved: ['Kylie Marinescu', 'Victor Vâlcescu'],
      encounter: {
        npcsInvolved: ['Victor Vâlcescu'],
      },
    }, {
      npcsInvolved: ['Victor Vâlcescu'],
    })).toEqual(['Victor Vâlcescu', 'Kylie Marinescu']);
  });
});

describe('ContentGenerationPhase cold-open alignment', () => {
  it('does not inject cold-open planning wrappers into scene metadata', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const phase = new ContentGenerationPhase({} as never);
    const scene: any = {
      id: 's1-1',
      name: 'American Shoes',
      description: 'Mika adopts Kylie at the door of Vâlcescu Club.',
      narrativeFunction: 'Kylie enters the club world.',
      requiredBeats: [{
        id: 'coldopen-1',
        tier: 'coldopen',
        mustDepict: 'Kylie unpacks in the apartment; Sadie asks about vampires.',
      }],
      keyBeats: [],
    };

    (phase as any).alignMandatoryOpeningBeatContext(scene);

    expect(scene.keyBeats).toEqual(['Kylie unpacks in the apartment; Sadie asks about vampires.']);
    expect(scene.description).toBe('Mika adopts Kylie at the door of Vâlcescu Club.');
    expect(scene.narrativeFunction).toBe('Kylie enters the club world.');
    expect(JSON.stringify(scene)).not.toMatch(/Cold-open prelude|Then continue into the planned scene|Open with this cold-open moment/i);
  });
});

describe('ContentGenerationPhase checkpoint resume validation', () => {
  it('records incremental scene validation when completed scene content resumes from checkpoint', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const recorded: Array<{ sceneId: string; episodeNumber?: number; overallPassed: boolean }> = [];
    const emitted: Array<{ type: string; phase?: string; message?: string }> = [];
    const phase = new ContentGenerationPhase({
      sceneWriter: {
        execute: async () => {
          throw new Error('SceneWriter should not run for resumed scene content');
        },
        setContractLoadTemperature: () => undefined,
      },
      choiceAuthor: {
        execute: async () => {
          throw new Error('ChoiceAuthor should not run for resumed scene content');
        },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: {
        execute: async () => {
          throw new Error('EncounterArchitect should not run for resumed scene content');
        },
      },
      semanticRealizationJudge: passingSemanticJudge,
      getThreadPlanner: () => ({}),
      getTwistArchitect: () => ({}),
      getCharacterArcTracker: () => ({}),
      incrementalValidator: null,
      sceneValidationResults: [],
      seasonSkillPlan: undefined,
      encounterTelemetry: [],
      cachedPipelineMemory: null,
      callbackLedger: { threads: [] } as never,
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(),
      episodeTwistPlans: new Map(),
      generationPlan: null,
      remediationBudget: null,
      seasonChoicePlan: undefined,
      seasonThreadLedger: { threads: [] } as never,
      assertSceneDependencyInvariants: () => undefined,
      buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined,
      buildChoiceAuthorNpcs: () => [],
      buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined,
      captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined,
      deriveStoryVerbsForBrief: () => [],
      emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined,
      episodeCheckpointFile: (episodeNumber: number, kind: string, id?: string) => `checkpoints/episode-${episodeNumber}/${kind}-${id || 'all'}.json`,
      establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [],
      getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined,
      inferBranchType: () => 'neutral',
      isEpisodeFinalScene: () => false,
      loadResumeUnit: (_outputDirectory: string | undefined, unitId: string) => {
        if (unitId === 'scene_content:episode-1:s1-1') {
          return {
            sceneId: 's1-1',
            sceneName: 'Return Key',
            beats: [{
              id: 'beat-1',
              text: 'You step into the room, close the door, and choose what happens next.',
            }],
          };
        }
        return undefined;
      },
      recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: (result: { sceneId: string; episodeNumber?: number; overallPassed: boolean }) => {
        recorded.push({
          sceneId: result.sceneId,
          episodeNumber: result.episodeNumber,
          overallPassed: result.overallPassed,
        });
      },
      resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => ({ disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] }),
      sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined,
      throwIfFailFast: () => undefined,
      trackEncounterFlagConsequences: () => undefined,
    } as never);

    const result = await phase.run(
      {
        episode: { number: 1 },
        options: {},
        protagonist: { id: 'protagonist', name: 'Ari', pronouns: 'they/them' },
        story: { title: 'Checkpoint Story', genre: 'drama', tone: 'tense' },
        world: { premise: 'A locked room.' },
      } as never,
      { locations: [] } as never,
      { characters: [] } as never,
      {
        suggestedFlags: [],
        suggestedScores: [],
        scenes: [{
          id: 's1-1',
          name: 'Return Key',
          description: 'Ari returns to the locked room.',
          npcsPresent: [],
          leadsTo: [],
          requiredBeats: [],
        }],
      } as never,
      undefined,
      '/tmp/story-run',
      1,
      {
        config: { generation: {} },
        emit: (event: { type: string; phase?: string; message?: string }) => emitted.push(event),
      } as never,
    );

    expect(result.sceneContents.map(scene => scene.sceneId)).toEqual(['s1-1']);
    expect(recorded).toEqual([{
      sceneId: 's1-1',
      episodeNumber: 1,
      overallPassed: true,
    }]);
    expect(emitted.some(event => event.phase === 'resumed_scene' && event.message?.includes('s1-1'))).toBe(true);
  });

  it('accepts a resumed encounter scene with a choicePoint — encounter scenes have no separate choice-set checkpoint (bite-me 2026-07-15T20-44-49)', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const emitted: Array<{ type: string; phase?: string; message?: string }> = [];
    const phase = new ContentGenerationPhase({
      sceneWriter: {
        execute: async () => {
          throw new Error('SceneWriter should not run for resumed encounter scene');
        },
        setContractLoadTemperature: () => undefined,
      },
      choiceAuthor: {
        execute: async () => {
          throw new Error('ChoiceAuthor should not run for an encounter scene');
        },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: {
        execute: async () => {
          throw new Error('EncounterArchitect must not re-roll a validated resumed encounter');
        },
      },
      semanticRealizationJudge: passingSemanticJudge,
      getThreadPlanner: () => ({}),
      getTwistArchitect: () => ({}),
      getCharacterArcTracker: () => ({}),
      incrementalValidator: null,
      sceneValidationResults: [],
      seasonSkillPlan: undefined,
      encounterTelemetry: [],
      cachedPipelineMemory: null,
      callbackLedger: { threads: [] } as never,
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(),
      episodeTwistPlans: new Map(),
      generationPlan: null,
      remediationBudget: null,
      seasonChoicePlan: undefined,
      seasonThreadLedger: { threads: [] } as never,
      assertSceneDependencyInvariants: () => undefined,
      buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined,
      buildChoiceAuthorNpcs: () => [],
      buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined,
      captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined,
      deriveStoryVerbsForBrief: () => [],
      emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined,
      episodeCheckpointFile: (episodeNumber: number, kind: string, id?: string) => `checkpoints/episode-${episodeNumber}/${kind}-${id || 'all'}.json`,
      establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [],
      getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined,
      inferBranchType: () => 'neutral',
      isEpisodeFinalScene: () => false,
      loadResumeUnit: (_outputDirectory: string | undefined, unitId: string) => {
        if (unitId === 'scene_content:episode-1:enc-1') {
          return { sceneId: 'enc-1', sceneName: 'Cismigiu rescue', beats: [] };
        }
        if (unitId === 'encounter:episode-1:enc-1') {
          return {
            sceneId: 'enc-1',
            encounterType: 'romantic',
            description: 'You hold the fogbound park path while a stranger opens a route to safety.',
            startingBeatId: 'enc-beat-1',
            goalClock: { name: 'Open the path', segments: 2, description: 'Create a safe route through the park.' },
            threatClock: { name: 'Closing fog', segments: 3, description: 'The attackers close around you.' },
            stakes: { victory: 'The stranger reaches safety.', defeat: 'The attackers seal the path.' },
            tensionCurve: [],
            beats: [{
              id: 'enc-beat-1',
              setupText: 'Fog closes over the park path as the stranger steps between you and the attackers.',
              choices: [{
                id: 'enc-choice-1',
                text: 'Hold your ground.',
                approach: 'steadfast',
                outcomes: {
                  success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'You plant your feet and the attackers scatter into the dark hedges.' },
                  complicated: { tier: 'complicated', goalTicks: 1, threatTicks: 1, narrativeText: 'You open the path, but one attacker follows close enough to tear your sleeve.' },
                  failure: { tier: 'failure', goalTicks: 0, threatTicks: 2, narrativeText: 'The attackers force you back beneath the dripping willow branches.' },
                },
              }],
            }],
            storylets: {
              victory: {
                id: 'victory-storylet', name: 'Path opened', triggerOutcome: 'victory', tone: 'relieved',
                narrativeFunction: 'The rescue succeeds cleanly.', startingBeatId: 'victory-beat', consequences: [],
                beats: [{ id: 'victory-beat', text: 'You guide the stranger beyond the fog before the attackers can regroup.' }],
              },
              partialVictory: {
                id: 'partial-storylet', name: 'Narrow escape', triggerOutcome: 'partialVictory', tone: 'tense',
                narrativeFunction: 'The rescue succeeds with pursuit still close.', startingBeatId: 'partial-beat', consequences: [],
                beats: [{ id: 'partial-beat', text: 'You reach the lit avenue together, with running footsteps still sounding behind you.' }],
              },
              defeat: {
                id: 'defeat-storylet', name: 'Path closed', triggerOutcome: 'defeat', tone: 'desperate',
                narrativeFunction: 'The rescue fails and demands another route.', startingBeatId: 'defeat-beat', consequences: [],
                beats: [{ id: 'defeat-beat', text: 'You retreat with the stranger as the attackers claim the path through the park.' }],
              },
            },
          };
        }
        return undefined;
      },
      recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: () => undefined,
      resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => ({ disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] }),
      sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined,
      throwIfFailFast: () => undefined,
      trackEncounterFlagConsequences: () => undefined,
    } as never);

    const result = await phase.run(
      {
        episode: { number: 1 },
        options: {},
        protagonist: { id: 'protagonist', name: 'Kylie', pronouns: 'she/her' },
        story: { title: 'Checkpoint Story', genre: 'urban fantasy', tone: 'tense' },
        world: { premise: 'A city at night.' },
      } as never,
      { locations: [] } as never,
      { characters: [] } as never,
      {
        suggestedFlags: [],
        suggestedScores: [],
        scenes: [{
          id: 'enc-1',
          name: 'Cismigiu rescue',
          description: 'Attack and rescue in the park.',
          npcsPresent: [],
          leadsTo: [],
          requiredBeats: [],
          isEncounter: true,
          encounterType: 'romantic',
          encounterStakes: 'If you cannot hold the path, the stranger is trapped with the attackers.',
          choicePoint: { description: 'How the rescue lands.' },
        }],
      } as never,
      undefined,
      '/tmp/story-run',
      1,
      {
        config: { generation: {} },
        emit: (event: { type: string; phase?: string; message?: string }) => emitted.push(event),
      } as never,
    );

    expect(result.sceneContents.map(scene => scene.sceneId)).toEqual(['enc-1']);
    expect(result.encounters.get('enc-1')).toBeTruthy();
    expect(emitted.some(event => /Regenerating enc-1/.test(event.message ?? ''))).toBe(false);
  });

  it('names the rejection reason when a resume checkpoint is discarded (no silent discard)', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const emitted: Array<{ type: string; phase?: string; message?: string }> = [];
    const phase = new ContentGenerationPhase({
      sceneWriter: { execute: async () => { throw new Error('SceneWriter should not run'); }, setContractLoadTemperature: () => undefined },
      choiceAuthor: {
        execute: async () => {
          throw new Error('ChoiceAuthor should not run for an encounter scene');
        },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: {
        execute: async () => {
          throw new Error('stop after claiming the regeneration');
        },
      },
      getThreadPlanner: () => ({}),
      getTwistArchitect: () => ({}),
      getCharacterArcTracker: () => ({}),
      incrementalValidator: null,
      sceneValidationResults: [],
      seasonSkillPlan: undefined,
      encounterTelemetry: [],
      cachedPipelineMemory: null,
      callbackLedger: { threads: [] } as never,
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(),
      episodeTwistPlans: new Map(),
      generationPlan: null,
      remediationBudget: null,
      seasonChoicePlan: undefined,
      seasonThreadLedger: { threads: [] } as never,
      assertSceneDependencyInvariants: () => undefined,
      buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined,
      buildChoiceAuthorNpcs: () => [],
      buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined,
      captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined,
      deriveStoryVerbsForBrief: () => [],
      emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined,
      episodeCheckpointFile: (episodeNumber: number, kind: string, id?: string) => `checkpoints/episode-${episodeNumber}/${kind}-${id || 'all'}.json`,
      establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [],
      getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined,
      inferBranchType: () => 'neutral',
      isEpisodeFinalScene: () => false,
      // Scene draft exists but the encounter checkpoint is missing entirely.
      loadResumeUnit: (_outputDirectory: string | undefined, unitId: string) => {
        if (unitId === 'scene_content:episode-1:enc-1') {
          return { sceneId: 'enc-1', sceneName: 'Cismigiu rescue', beats: [] };
        }
        return undefined;
      },
      recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: () => undefined,
      resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => ({ disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] }),
      sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined,
      throwIfFailFast: () => undefined,
      trackEncounterFlagConsequences: () => undefined,
    } as never);

    await phase.run(
      {
        episode: { number: 1 },
        options: {},
        protagonist: { id: 'protagonist', name: 'Kylie', pronouns: 'she/her' },
        story: { title: 'Checkpoint Story', genre: 'urban fantasy', tone: 'tense' },
        world: { premise: 'A city at night.' },
      } as never,
      { locations: [] } as never,
      { characters: [] } as never,
      {
        suggestedFlags: [],
        suggestedScores: [],
        scenes: [{
          id: 'enc-1',
          name: 'Cismigiu rescue',
          description: 'Attack and rescue in the park.',
          npcsPresent: [],
          leadsTo: [],
          requiredBeats: [],
          isEncounter: true,
          encounterType: 'romantic',
          choicePoint: { description: 'How the rescue lands.' },
        }],
      } as never,
      undefined,
      '/tmp/story-run',
      1,
      {
        config: { generation: {} },
        emit: (event: { type: string; phase?: string; message?: string }) => emitted.push(event),
      } as never,
    ).catch(() => undefined);

    const rejection = emitted.find(event => /Regenerating enc-1 despite resume checkpoint/.test(event.message ?? ''));
    expect(rejection?.message).toContain('encounter checkpoint missing');
  });
});

describe('ContentGenerationPhase treatment density gate', () => {
  it('allows bounded opening density only when the cold open has enough beat budget', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const { analyzeSceneTreatmentDensity } = await import('../../remediation/gateRepairRouter');
    const phase = new ContentGenerationPhase({} as never);
    const report = analyzeSceneTreatmentDensity({
      id: 's1-1',
      requiredBeats: [
        { id: 'opening', tier: 'coldopen', mustDepict: 'The protagonist reaches the station desk.' },
      ],
      authoredTreatmentFields: Array.from({ length: 14 }, (_, index) => ({
        id: `support-${index + 1}`,
        sourceText: `Support pressure ${index + 1} colors the opening collision.`,
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
      })),
      recommendedBeatCount: 10,
    } as never, { episodeNumber: 1, sceneIndex: 0 });

    expect(report.overloaded).toBe(true);
    expect(report.threshold.totalUnits).toBeLessThan(900);
    expect((phase as any).sceneDensityCanExpandWithBeatBudget(report, { id: 's1-1', recommendedBeatCount: 10 })).toBe(true);
  });

  it('treats dense standard scenes with sufficient recommended beat budget as expandable', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const { analyzeEpisodeTreatmentDensity, unsafeTreatmentDensityReports } = await import('../../remediation/gateRepairRouter');
    const phase = new ContentGenerationPhase({} as never);
    const denseScene: any = {
      id: 's2-4',
      requiredBeats: [
        { id: 'rb1', tier: 'authored', mustDepict: 'The cab breaks down on the road.' },
        { id: 'rb2', tier: 'authored', mustDepict: 'The chef fixes the engine.' },
        { id: 'rb3', tier: 'authored', mustDepict: 'The sweater becomes visible.' },
      ],
      authoredTreatmentFields: Array.from({ length: 9 }, (_, index) => ({
        id: `field-${index + 1}`,
        sourceText: `Soft treatment detail ${index + 1} attached to the road scene.`,
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
      })),
      choicePoint: { description: 'Choose how to handle the road pressure.' },
      recommendedBeatCount: 10,
    };
    const reports = analyzeEpisodeTreatmentDensity([
      { id: 's2-1', requiredBeats: [{ id: 'opening', tier: 'authored', mustDepict: 'Open locally.' }] } as never,
      denseScene,
    ], 2);
    const unsafe = unsafeTreatmentDensityReports(reports);

    expect(unsafe.map((report) => report.sceneId)).toEqual(['s2-4']);
    expect((phase as any).sceneDensityCanExpandWithBeatBudget(unsafe[0], denseScene)).toBe(true);
  });

  it('does not expand multi-time scenes with beat budget', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const { analyzeEpisodeTreatmentDensity, unsafeTreatmentDensityReports } = await import('../../remediation/gateRepairRouter');
    const phase = new ContentGenerationPhase({} as never);
    const multiTimeScene: any = {
      id: 's2-5',
      requiredBeats: [
        { id: 'rb1', tier: 'signature', mustDepict: 'The long conversation at Vâlcescu Club lasts two hours.' },
        { id: 'rb2', tier: 'authored', mustDepict: 'By evening, the friends convene at Drăgan Vintage for the debrief.' },
        { id: 'rb3', tier: 'authored', mustDepict: 'At 3am, Kylie writes the chef into the dictionary as The Mountain.' },
      ],
      recommendedBeatCount: 10,
    };
    const reports = analyzeEpisodeTreatmentDensity([multiTimeScene], 2);
    const unsafe = unsafeTreatmentDensityReports(reports);

    expect(unsafe.map((report) => report.sceneId)).toEqual(['s2-5']);
    expect((phase as any).sceneDensityCanExpandWithBeatBudget(unsafe[0], multiTimeScene)).toBe(false);
  });

  it('blocks unsafe planned-scene density before SceneWriter or EncounterArchitect runs', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const calls: string[] = [];
    const phase = new ContentGenerationPhase({
      sceneWriter: {
        execute: async () => { calls.push('sceneWriter'); return { success: true, data: {} }; },
        setContractLoadTemperature: () => undefined,
      },
      choiceAuthor: {
        execute: async () => { calls.push('choiceAuthor'); return { success: true, data: {} }; },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: { execute: async () => { calls.push('encounterArchitect'); return { success: true, data: {} }; } },
      semanticRealizationJudge: {
        identity: () => ({ policyVersion: 'test-v1', provider: 'test', model: 'test' }),
        execute: async (claims: Array<{ id: string; criteria: string[] }>) => ({
          success: true,
          data: { verdicts: claims.map((claim) => ({
            id: claim.id, verdict: 'not_fulfilled', evidenceRefs: [], evidenceQuotes: [],
            missingCriteria: claim.criteria, rationale: 'missing',
          })) },
        }),
      },
      getThreadPlanner: () => ({}),
      getTwistArchitect: () => ({}),
      getCharacterArcTracker: () => ({}),
      incrementalValidator: null,
      sceneValidationResults: [],
      seasonSkillPlan: undefined,
      encounterTelemetry: [],
      cachedPipelineMemory: null,
      callbackLedger: {} as never,
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(),
      episodeTwistPlans: new Map(),
      generationPlan: null,
      remediationBudget: null,
      seasonChoicePlan: undefined,
      seasonThreadLedger: {} as never,
      assertSceneDependencyInvariants: () => undefined,
      buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined,
      buildChoiceAuthorNpcs: () => [],
      buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined,
      captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined,
      deriveStoryVerbsForBrief: () => [],
      emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined,
      episodeCheckpointFile: () => '',
      establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [],
      getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined,
      inferBranchType: () => 'neutral',
      isEpisodeFinalScene: () => false,
      loadResumeUnit: () => undefined,
      recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: () => undefined,
      resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => ({ disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] }),
      sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined,
      throwIfFailFast: () => undefined,
      trackEncounterFlagConsequences: () => undefined,
    } as never);

    const brief = {
      episode: { number: 1 },
      seasonPlan: undefined,
    } as never;
    const blueprint = {
      scenes: [{
        id: 's1-overloaded',
        isEncounter: false,
        requiredBeats: [
          { id: 'rb1', tier: 'authored', mustDepict: 'At the station, the traveler receives the sealed invitation.' },
          { id: 'rb2', tier: 'authored', mustDepict: 'At the rooftop bar, the traveler joins the table.' },
        ],
        authoredTreatmentFields: [
          { id: 'route1', sourceText: 'The station invitation and rooftop table are separate playable events.', contractKind: 'pressure_lane', requiredRealization: ['final_prose'] },
        ],
        turnContract: {
          turnId: 'turn',
          centralTurn: 'At the station, the traveler receives the sealed invitation.',
          turnEvent: 'At the station, the traveler receives the sealed invitation.',
          handoff: 'Move to the social venue later.',
        },
        choicePoint: {
          type: 'tactical',
          description: 'Choose how to react.',
          optionHints: ['Run', 'Hide'],
        },
      }],
    } as never;
    const emitted: Array<{ type: string; phase?: string; message?: string }> = [];
    const context = {
      config: { generation: {} },
      emit: (event: { type: string; phase?: string; message?: string }) => emitted.push(event),
    } as never;

    await expect(phase.run(brief, {} as never, { characters: [] } as never, blueprint, undefined, undefined, 1, context))
      .rejects.toMatchObject({
        name: 'PipelineError',
        phase: 'episode_architecture',
        agent: 'SceneConstructionGate',
      });
    expect(calls).toEqual([]);
    expect(emitted.some((event) => event.message?.includes('blocked content generation'))).toBe(true);
  });
});

describe('ContentGenerationPhase canonical owner transaction', () => {
  it('turns semantic roles into observable, content-agnostic repair craft', async () => {
    const { ownerRealizationCraftInstruction } = await import('./ContentGenerationPhase');

    expect(ownerRealizationCraftInstruction({
      id: 'relationship', description: 'Two participants become friendly.', acceptedPatterns: [],
      kind: 'semantic', semanticRole: 'relationship_change', required: true,
    })).toContain('the other accepts or reciprocates');
    expect(ownerRealizationCraftInstruction({
      id: 'information', description: 'One participant shares a destination.', acceptedPatterns: [],
      kind: 'semantic', semanticRole: 'information_transfer', required: true,
    })).toContain('specified source participant');
    expect(ownerRealizationCraftInstruction({
      id: 'forbidden', description: 'Do not reveal the secret.', acceptedPatterns: [],
      kind: 'semantic', semanticRole: 'information_transfer', polarity: 'forbidden', required: true,
    })).toBe('');
  });

  it('protects every currently satisfied scene atom during a focused patch', async () => {
    const { passedScenePreserveAtoms } = await import('./ContentGenerationPhase');
    const tasks = [{
      id: 'event-task',
      evidenceAtoms: [
        { id: 'target', polarity: 'required' },
        { id: 'event-pass', polarity: 'required' },
      ],
    }, {
      id: 'presence-task',
      evidenceAtoms: [
        { id: 'full-name', polarity: 'required' },
        { id: 'blocked-label', polarity: 'forbidden' },
      ],
    }] as any;
    const verdicts = [
      { taskId: 'event-task', atomId: 'target', outcome: 'miss' },
      { taskId: 'event-task', atomId: 'event-pass', outcome: 'pass' },
      { taskId: 'presence-task', atomId: 'full-name', outcome: 'pass' },
      { taskId: 'presence-task', atomId: 'blocked-label', outcome: 'pass' },
    ] as any;

    expect(passedScenePreserveAtoms(tasks, verdicts, new Set(['target'])).map((atom) => atom.id)).toEqual([
      'event-pass',
      'full-name',
    ]);
  });

  it('returns owner-stage semantic uncertainty to the repair loop but blocks it at final regression', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const phase = new ContentGenerationPhase({
      semanticRealizationJudge: {
        identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test' }),
        execute: async (claims: Array<{ id: string; criteria: string[] }>) => ({
          success: true,
          data: { verdicts: claims.map((claim) => ({
            id: claim.id,
            verdict: 'uncertain',
            evidenceRefs: [],
            evidenceQuotes: [],
            missingCriteria: claim.criteria,
            rationale: 'The evidence is ambiguous.',
          })) },
        }),
      },
    } as never);
    const realizationTask = {
      id: 'task:premise:role', contractId: 'premise:role', sourceKinds: ['premise'], episodeNumber: 1,
      ownerStage: 'scene_writer', repairHandler: 'premise_realization', sceneId: 's1',
      evidenceAtoms: [{
        id: 'premise:role:semantic:1', description: 'Kylie works as a food writer.',
        acceptedPatterns: ['food writer'], kind: 'semantic', verificationAuthority: 'semantic_judge',
        semanticCriteria: ['Kylie has professional writing work'], required: true,
      }],
      minimumEvidenceHits: 1,
      target: { scope: 'owner', surfaces: ['beat_text'] },
      sourceContractIds: ['treatment:kylie-role'], blocking: true,
    };
    const validationInput = {
      sceneId: 's1', tasks: [realizationTask], sceneContent: { beats: [{ text: 'Kylie studies the blank page.' }] },
      currentStage: 'scene_writer', candidateHash: 'candidate-1',
    };

    await expect((phase as any).validateNarrativeRealization({ ...validationInput, mode: 'owner' }))
      .resolves.toMatchObject({
        findings: [],
        deferredFindings: [{ code: 'SEMANTIC_VALIDATION_INCONCLUSIVE' }],
      });
    await expect((phase as any).validateNarrativeRealization({ ...validationInput, mode: 'final_regression' }))
      .rejects.toMatchObject({
        code: 'semantic_validation_inconclusive',
        retryClass: 'none',
        repairTarget: 'task:premise:role',
      });
  });

  it('blocks unresolved prose ownership before committing the scene', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const calls: string[] = [];
    const patchCapacityTiers: string[] = [];
    const invalidScene = {
      sceneId: 's1-3', sceneName: 'The Bookshop', startingBeatId: 'b1',
      beats: [{ id: 'b1', text: 'Kylie watches traffic slide past the club windows.' }],
      moodProgression: ['uncertain'], charactersInvolved: ['Kylie'], keyMoments: [], continuityNotes: [],
      claimedEventIds: [], eventEvidence: [],
    };
    const phase = new ContentGenerationPhase({
      sceneWriter: {
        execute: async (input: { storyContext?: { userPrompt?: string } }) => {
          calls.push('sceneWriter');
          return { success: true, data: structuredClone(invalidScene) };
        },
        executeSemanticPatch: async (input: { baseSceneHash: string; targetTaskId: string; targetAtomIds: string[]; capacityTier?: string }) => {
          calls.push('semanticPatch');
          patchCapacityTiers.push(input.capacityTier ?? 'standard');
          return {
            success: false,
            error: 'Gemini reasoning consumed the visible output budget.',
            failure: {
              code: 'visible_output_starved', retryClass: 'adjust_call_budget', provider: 'gemini',
              requestedMaxTokens: input.capacityTier === 'expanded' ? 3456 : 2304,
              thoughtsTokens: input.capacityTier === 'expanded' ? 3300 : 2200,
            },
          };
        },
        setContractLoadTemperature: () => undefined,
      },
      choiceAuthor: {
        execute: async () => { calls.push('choiceAuthor'); return { success: true, data: { choices: [] } }; },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: { execute: async () => { calls.push('encounterArchitect'); return { success: true, data: {} }; } },
      semanticRealizationJudge: {
        identity: () => ({ policyVersion: 'test-v1', provider: 'test', model: 'test' }),
        execute: async (claims: Array<{ id: string; criteria: string[] }>) => ({
          success: true,
          data: { verdicts: claims.map((claim) => ({
            id: claim.id, verdict: 'not_fulfilled', evidenceRefs: [], evidenceQuotes: [],
            missingCriteria: claim.criteria, rationale: 'missing',
          })) },
        }),
      },
      getThreadPlanner: () => ({}), getTwistArchitect: () => ({}), getCharacterArcTracker: () => ({}),
      incrementalValidator: null, sceneValidationResults: [], seasonSkillPlan: undefined, encounterTelemetry: [],
      cachedPipelineMemory: null, callbackLedger: { threads: [] } as never,
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(), episodeTwistPlans: new Map(), generationPlan: null, remediationBudget: null,
      seasonChoicePlan: undefined, seasonThreadLedger: { threads: [] } as never,
      assertSceneDependencyInvariants: () => undefined, buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined, buildChoiceAuthorNpcs: () => [], buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined, captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined, deriveStoryVerbsForBrief: () => [], emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined, episodeCheckpointFile: () => '', establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [], getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined, inferBranchType: () => 'neutral', isEpisodeFinalScene: () => false,
      loadResumeUnit: () => undefined, recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: () => undefined, resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => ({ disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] }), sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined, throwIfFailFast: () => undefined, trackEncounterFlagConsequences: () => undefined,
    } as never);
    const task = {
      id: 'task:event:ep1-u3:owner-event', contractId: 'event:ep1-u3', canonicalEventId: 'event:ep1-u3', eventId: 'event:ep1-u3',
      episodeNumber: 1, ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1-3',
      evidenceAtoms: [{ id: 'event:ep1-u3:atom:1', description: 'Enter the bookshop', acceptedPatterns: ['Kylie enters the bookshop'], kind: 'semantic', required: true }],
      target: { scope: 'owner', surfaces: ['beat_text'] }, sourceContractIds: ['ep1-u3'], blocking: true,
    };
    const blueprint = { scenes: [{
      id: 's1-3', name: 'The Bookshop', description: 'Kylie enters the bookshop.', location: 'Lumina Books',
      mood: 'curious', purpose: 'branch', npcsPresent: [], leadsTo: [], requiredBeats: [],
      assignedEventIds: ['event:ep1-u3'], narrativeEventIds: ['event:ep1-u3'], realizationTasks: [task],
      choicePoint: { type: 'relationship', description: 'Choose how to answer.', optionHints: ['Open up', 'Deflect'] },
    }] } as never;
    const brief = {
      episode: { number: 1, title: 'Episode' }, options: {}, protagonist: { id: 'kylie', name: 'Kylie', pronouns: 'she/her' },
      story: { title: 'Story', genre: 'romance', tone: 'tense' }, world: { premise: 'A dangerous city.' },
    } as never;

    await expect(phase.run(brief, { locations: [] } as never, { characters: [] } as never, blueprint, undefined, undefined, 1, {
      config: { generation: {} }, emit: () => undefined,
    } as never)).rejects.toThrow(/OwnerStageRealizationBlocker/);
    expect(calls.filter((call) => call === 'choiceAuthor')).toHaveLength(0);
    // The scene consumes its bounded local patch + full-regeneration ladder,
    // then fails before any dependent artifact is authored.
    expect(calls.filter((call) => call === 'sceneWriter').length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((call) => call === 'semanticPatch')).toHaveLength(2);
    expect(patchCapacityTiers).toEqual(['standard', 'expanded']);
  });
});

describe('ContentGenerationPhase sequential scene commit', () => {
  it('authors scene 2 from scene 1 critic-final closing prose', async () => {
    const { ContentGenerationPhase } = await import('./ContentGenerationPhase');
    const writerInputs: Array<{ sceneBlueprint: { id: string }; previousSceneSummary?: string }> = [];
    const phase = new ContentGenerationPhase({
      sceneWriter: {
        execute: async (input: { sceneBlueprint: { id: string; name: string }; previousSceneSummary?: string }) => {
          writerInputs.push(input);
          const first = input.sceneBlueprint.id === 's1-1';
          return {
            success: true,
            data: {
              sceneId: input.sceneBlueprint.id,
              sceneName: input.sceneBlueprint.name,
              beats: [{
                id: first ? 's1-1-b1' : 's1-2-b1',
                text: first ? 'You stop before the sealed door.' : 'You enter the next room.',
              }],
              keyMoments: [],
              charactersInvolved: [],
            },
          };
        },
        setContractLoadTemperature: () => undefined,
      },
      choiceAuthor: { execute: async () => ({ success: true, data: { choices: [] } }), setEpisodeSkillTargets: () => undefined },
      encounterArchitect: { execute: async () => ({ success: true, data: {} }) },
      semanticRealizationJudge: passingSemanticJudge,
      getThreadPlanner: () => ({}),
      getTwistArchitect: () => ({}),
      getCharacterArcTracker: () => ({}),
      incrementalValidator: null,
      sceneValidationResults: [],
      seasonSkillPlan: undefined,
      encounterTelemetry: [],
      cachedPipelineMemory: null,
      callbackLedger: { threads: [] },
      dependencySchedulerStats: { hasCycle: false, waveCount: 0, fallbackToSerial: false },
      episodeArcTargets: new Map(),
      episodeTwistPlans: new Map(),
      generationPlan: null,
      remediationBudget: null,
      seasonChoicePlan: undefined,
      seasonThreadLedger: { threads: [] },
      assertSceneDependencyInvariants: () => undefined,
      buildBranchFallbackChoiceSet: () => undefined,
      buildDeterministicChoiceSet: () => undefined,
      buildChoiceAuthorNpcs: () => [],
      buildCompactWorldContext: () => '',
      buildEncounterPriorStateContext: () => undefined,
      captureEncounterTelemetry: () => undefined,
      checkCancellation: async () => undefined,
      deriveStoryVerbsForBrief: () => [],
      emitPhaseProgress: () => undefined,
      emitPlanUpdate: () => undefined,
      episodeCheckpointFile: () => '',
      establishedCanonForPrompt: () => undefined,
      getPhase4DefaultCollisions: () => [],
      getTargetBeatCountForScene: () => 1,
      getUnresolvedCallbacksForPrompt: () => undefined,
      inferBranchType: () => 'neutral',
      isEpisodeFinalScene: (_blueprint: unknown, sceneId: string) => sceneId === 's1-2',
      loadResumeUnit: () => undefined,
      recordRemediationSafe: async () => undefined,
      recordSceneValidationResult: () => undefined,
      resolveWorldLocationForScene: () => undefined,
      reviewSceneBeforeCommit: async ({ scene }: { scene: SceneContent }) => {
        if (scene.sceneId !== 's1-1') return { disposition: 'not_eligible' as const, scene, rewrittenBeatIds: [] };
        return {
          disposition: 'accepted' as const,
          scene: {
            ...scene,
            beats: scene.beats.map((beat) => ({ ...beat, text: 'You open the sealed door and leave it swinging behind you.' })),
          },
          rewrittenBeatIds: ['s1-1-b1'],
        };
      },
      sanitizeReaderFacingSceneName: (name: string | undefined) => name || 'Scene',
      saveResumeUnit: async () => undefined,
      throwIfFailFast: () => undefined,
      trackEncounterFlagConsequences: () => undefined,
    } as never);

    const result = await phase.run(
      {
        episode: { number: 1 },
        story: { title: 'Commit Order', genre: 'mystery', tone: 'tense' },
        world: { premise: 'A locked house.' },
        protagonist: { id: 'protagonist', name: 'Ari', pronouns: 'they/them' },
        options: {},
      } as never,
      { locations: [] } as never,
      { characters: [] } as never,
      {
        suggestedFlags: [],
        suggestedScores: [],
        scenes: [
          { id: 's1-1', name: 'The Door', description: 'Ari opens the sealed door.', npcsPresent: [], leadsTo: ['s1-2'], requiredBeats: [] },
          { id: 's1-2', name: 'Beyond', description: 'Ari enters the next room.', npcsPresent: [], leadsTo: [], requiredBeats: [] },
        ],
      } as never,
      undefined,
      undefined,
      1,
      { config: { generation: {}, sceneCritic: { maxScenesPerEpisode: 1 } }, emit: () => undefined } as never,
    );

    expect(result.sceneContents[0].beats[0].text).toBe('You open the sealed door and leave it swinging behind you.');
    expect(writerInputs[1].previousSceneSummary).toContain('You open the sealed door and leave it swinging behind you.');
    expect(writerInputs[1].previousSceneSummary).not.toContain('You stop before the sealed door.');
    expect(result.sceneCommitReceipts.map((receipt) => receipt.sceneId)).toEqual(['s1-1', 's1-2']);
  });
});
