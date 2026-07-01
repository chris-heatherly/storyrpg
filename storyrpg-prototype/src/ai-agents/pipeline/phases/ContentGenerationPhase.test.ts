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
      runSceneCriticPass: async () => undefined,
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
      sceneWriter: { execute: async () => { calls.push('sceneWriter'); return { success: true, data: {} }; } },
      choiceAuthor: {
        execute: async () => { calls.push('choiceAuthor'); return { success: true, data: {} }; },
        setEpisodeSkillTargets: () => undefined,
      },
      encounterArchitect: { execute: async () => { calls.push('encounterArchitect'); return { success: true, data: {} }; } },
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
      runSceneCriticPass: async () => undefined,
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
        id: 'treatment-enc-1-1',
        isEncounter: true,
        encounter: { id: 'treatment-enc-1-1' },
        requiredBeats: [
          { id: 'rb1', tier: 'authored', mustDepict: 'Fog gathers around Kylie at 1am.' },
          { id: 'rb2', tier: 'authored', mustDepict: 'A shadow moves behind the trees.' },
          { id: 'rb3', tier: 'authored', mustDepict: 'A scream cuts through the park.' },
          { id: 'rb4', tier: 'authored', mustDepict: 'Victor intervenes before the attacker reaches her.' },
        ],
        authoredTreatmentFields: [
          { id: 'enc1', sourceText: 'The attack encounter establishes the supernatural threat.', contractKind: 'encounter_anchor', requiredRealization: ['encounter', 'final_prose'] },
          { id: 'enc2', sourceText: 'The attacker can be resisted but not defeated.', contractKind: 'encounter_conflict', requiredRealization: ['encounter', 'final_prose'] },
        ],
        turnContract: {
          turnId: 'turn',
          centralTurn: 'Kylie becomes prey.',
          turnEvent: 'The rescue changes her understanding of Bucharest.',
          handoff: 'The next morning, she questions what happened.',
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
        agent: 'TreatmentDensityGate',
      });
    expect(calls).toEqual([]);
    expect(emitted.some((event) => event.message?.includes('blocked content generation'))).toBe(true);
  });
});
