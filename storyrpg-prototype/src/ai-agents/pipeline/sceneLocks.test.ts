import { describe, expect, it } from 'vitest';
import type { Episode } from '../../types';
import type { SceneValidationResult } from '../validators/IncrementalValidators';
import {
  buildEpisodeSceneLockReport,
  buildSceneLockEvidence,
  mergeArtifactValidationSummaries,
  sceneLockArtifactName,
} from './sceneLocks';

function makeEpisode(): Episode {
  return {
    number: 2,
    title: 'Two',
    scenes: [
      { id: 's2-1', name: 'Opening' },
      { id: 's2-2', name: 'Turn' },
    ],
  } as unknown as Episode;
}

function sceneValidation(
  sceneId: string,
  overrides: Partial<SceneValidationResult> = {},
): SceneValidationResult {
  return {
    sceneId,
    episodeNumber: 2,
    sceneName: sceneId,
    overallPassed: true,
    regenerationRequested: 'none',
    validationTimeMs: 3,
    ...overrides,
  };
}

describe('sceneLocks', () => {
  it('builds passing evidence from a clean scene validation result', () => {
    const lock = buildSceneLockEvidence(sceneValidation('s2-1'), '2026-01-01T00:00:00.000Z');

    expect(lock).toMatchObject({
      version: 1,
      episodeNumber: 2,
      sceneId: 's2-1',
      lockedAt: '2026-01-01T00:00:00.000Z',
      passed: true,
      blockingIssueCount: 0,
      validation: { passed: true, gate: 'scene_lock', issues: [] },
    });
  });

  it('maps failed validator details into blocking lock issues', () => {
    const lock = buildSceneLockEvidence(sceneValidation('s2-1', {
      overallPassed: false,
      regenerationRequested: 'scene',
      voice: {
        passed: false,
        score: 10,
        shouldRegenerate: true,
        checkedDialogueCount: 1,
        issues: [{
          beatId: 'b1',
          characterId: 'npc',
          characterName: 'NPC',
          issue: 'Voice mismatch',
          severity: 'error',
        }],
      },
    }), '2026-01-01T00:00:00.000Z');

    expect(lock.passed).toBe(false);
    expect(lock.blockingIssueCount).toBe(1);
    expect(lock.validation.issues[0]).toMatchObject({
      validator: 'IncrementalVoiceValidator',
      severity: 'error',
      message: 'Voice mismatch',
      path: 'episodes[2].scenes[s2-1].beats[b1]',
    });
  });

  it('requires every authored scene to have a passing latest validation lock', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: makeEpisode(),
      generatedAt: '2026-01-01T00:00:00.000Z',
      validationResults: [
        sceneValidation('s2-1', { overallPassed: false, regenerationRequested: 'scene' }),
        sceneValidation('s2-1'),
        sceneValidation('s2-2'),
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.lockedSceneCount).toBe(2);
    expect(report.validation.issues).toEqual([]);
  });

  // Two-tier lock policy pin — bite-me 2026-07-05T23-54-17: s1-1 was accepted
  // as degraded at scene time with a PovClarity opening-anchor error; the lock
  // gate then re-blocked on that STALE evidence and hard-aborted the whole run
  // with no repair route. Craft findings must defer to the final contract
  // (which re-validates the CURRENT text and owns repair); only SceneLockGate
  // structural facts may block the lock.
  it('defers craft findings (PovClarity opening-anchor, this run) instead of blocking the lock', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: makeEpisode(),
      generatedAt: '2026-01-01T00:00:00.000Z',
      validationResults: [
        sceneValidation('s2-1', {
          overallPassed: false,
          regenerationRequested: 'scene',
          povClarity: {
            passed: false,
            score: 30,
            shouldRegenerate: true,
            issues: [{
              beatId: 's2-1_b1',
              issue: 'Opening beat does not establish the player character as the POV/focal character.',
              severity: 'error',
              suggestion: 'Rewrite the first beat so it anchors the player with you/your or {{player.name}}.',
            }],
          },
        }),
        sceneValidation('s2-2'),
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.deferredFindingCount).toBe(1);
    const deferred = report.validation.issues.find((issue) => issue.validator === 'PovClarityValidator');
    expect(deferred).toMatchObject({ severity: 'warning' });
    expect(deferred?.message).toContain('[deferred to final contract]');
    // The per-scene lock evidence keeps the faithful audit trail.
    expect(report.locks.find((lock) => lock.sceneId === 's2-1')?.passed).toBe(false);
  });

  it('still blocks the lock on an unexplained scene validation failure (structural, fail closed)', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: makeEpisode(),
      generatedAt: '2026-01-01T00:00:00.000Z',
      validationResults: [
        sceneValidation('s2-1', { overallPassed: false, regenerationRequested: 'scene' }),
        sceneValidation('s2-2'),
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.deferredFindingCount).toBe(0);
    expect(report.validation.issues.map((issue) => issue.code)).toContain('scene_validation_failed');
  });

  it('fails closed when an authored scene has no lock', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: makeEpisode(),
      validationResults: [sceneValidation('s2-1')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(false);
    expect(report.validation.issues).toContainEqual(expect.objectContaining({
      validator: 'SceneLockGate',
      severity: 'error',
      code: 'missing_scene_validation_lock',
      path: 'episodes[2].scenes[s2-2]',
    }));
  });

  it('fails when an owned scene has a lock but emits no reader-facing prose beats', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: {
        number: 2,
        title: 'Two',
        scenes: [{
          id: 's2-owned',
          name: 'Owned Empty Scene',
          beats: [],
          startingBeatId: '',
          turnContract: {
            turnId: 'turn-1',
            source: 'treatment',
            centralTurn: 'The protagonist meets the guide and crosses the threshold.',
            beforeState: 'Alone outside.',
            turnEvent: 'The guide arrives.',
            afterState: 'No longer alone.',
            handoff: 'They enter the next location.',
          },
          sceneEventOwnership: {
            id: 's2-owned-event-ownership',
            episodeNumber: 2,
            sceneId: 's2-owned',
            ownedEvents: [{
              key: 'cue:socialMeet',
              cue: 'socialMeet',
              text: 'The protagonist meets the guide.',
              sourceContractIds: ['turn-1'],
            }],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: ['turn-1'],
            diagnostics: [],
            promptGuidance: [],
          },
        }],
      } as unknown as Episode,
      validationResults: [sceneValidation('s2-owned')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(false);
    expect(report.validation.issues).toContainEqual(expect.objectContaining({
      validator: 'SceneLockGate',
      severity: 'error',
      code: 'empty_owned_scene_prose',
      path: 'episodes[2].scenes[s2-owned].beats',
    }));
  });

  it('passes an owned encounter scene whose reader prose lives in scene.encounter (flat beats)', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: {
        number: 2,
        title: 'Two',
        scenes: [{
          id: 's2-enc',
          name: 'The ambush',
          // Encounters carry no scene.beats; prose lives in the encounter.
          beats: [],
          isEncounter: true,
          encounter: {
            sceneId: 's2-enc',
            startingBeatId: 'beat-1',
            beats: [{
              id: 'beat-1',
              setupText: 'The shadows stretch long across the path. Heavy footsteps close in behind you.',
              choices: [{
                id: 'c1',
                outcomes: {
                  success: { tier: 'success', narrativeText: 'You pivot and drive an elbow into the attacker.' },
                },
              }],
            }],
          },
        }],
      } as unknown as Episode,
      validationResults: [sceneValidation('s2-enc')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(true);
    expect(report.validation.issues.map((issue) => issue.code)).not.toContain('empty_owned_scene_prose');
  });

  it('passes an owned encounter scene whose reader prose lives in phased encounter beats', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: {
        number: 2,
        title: 'Two',
        scenes: [{
          id: 's2-enc',
          name: 'The ambush',
          beats: [],
          encounter: {
            sceneId: 's2-enc',
            phases: [{
              id: 'p1',
              startingBeatId: 'beat-1',
              beats: [{ id: 'beat-1', setupText: 'The corridor narrows. The guard has not seen you yet.' }],
            }],
          },
        }],
      } as unknown as Episode,
      validationResults: [sceneValidation('s2-enc')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(true);
    expect(report.validation.issues.map((issue) => issue.code)).not.toContain('empty_owned_scene_prose');
  });

  it('still fails an encounter scene whose encounter carries no authored prose', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: {
        number: 2,
        title: 'Two',
        scenes: [{
          id: 's2-enc',
          name: 'The ambush',
          beats: [],
          encounter: {
            sceneId: 's2-enc',
            beats: [{ id: 'beat-1', setupText: '   ', choices: [{ id: 'c1', outcomes: {} }] }],
          },
        }],
      } as unknown as Episode,
      validationResults: [sceneValidation('s2-enc')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(false);
    expect(report.validation.issues.map((issue) => issue.code)).toContain('empty_owned_scene_prose');
  });

  it('uses blueprint ownership metadata when assembled scenes lost generator-only profile fields', () => {
    const report = buildEpisodeSceneLockReport({
      episodeNumber: 2,
      episode: {
        number: 2,
        title: 'Two',
        scenes: [{ id: 's2-blueprint-owned', name: 'Runtime Empty', beats: [], startingBeatId: '' }],
      } as unknown as Episode,
      blueprintScenes: [{
        id: 's2-blueprint-owned',
        sceneConstructionProfile: {
          id: 'profile',
          episodeNumber: 2,
          sceneId: 's2-blueprint-owned',
          primaryTurn: {
            id: 'primary',
            source: 'sceneTurn',
            text: 'The scene stages a concrete threshold turn.',
            sourceContractIds: ['primary'],
          },
          obligations: [{
            source: 'sceneTurn',
            id: 'primary',
            slot: 'primary_turn',
            text: 'The scene stages a concrete threshold turn.',
            reason: 'One scene, one dramatic turn.',
            hardUnits: 1,
            softUnits: 0,
          }],
          sourceContractIds: ['primary'],
          activeCast: [],
          capacity: {
            hardUnits: 1,
            softUnits: 0,
            totalUnits: 1,
            maxHardUnits: 3,
            maxTotalUnits: 5,
            activeCastCount: 0,
            maxActiveCast: 3,
            activeConflictCount: 1,
            introductionCount: 0,
            explicitTimeCueCount: 0,
            explicitLocationCueCount: 0,
            beatBudget: { min: 2, recommended: 3, max: 5 },
          },
          routedObligationIds: [],
          conflictDiagnostics: [],
          promptGuidance: [],
        },
      }],
      validationResults: [sceneValidation('s2-blueprint-owned')],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.passed).toBe(false);
    expect(report.validation.issues.map((issue) => issue.code)).toContain('empty_owned_scene_prose');
  });

  it('names the durable scene lock sidecar and merges validation summaries', () => {
    expect(sceneLockArtifactName(3)).toBe('episode-3-scene-locks.json');

    const merged = mergeArtifactValidationSummaries('runtime_contract_ep_3', [
      { passed: true, gate: 'scene_locks_ep_3', issues: [] },
      {
        passed: false,
        gate: 'incremental_contract_ep_3',
        issues: [{ validator: 'FinalStoryContractValidator', severity: 'error', message: 'blocked' }],
      },
    ]);

    expect(merged).toEqual({
      passed: false,
      gate: 'runtime_contract_ep_3',
      issues: [{ validator: 'FinalStoryContractValidator', severity: 'error', message: 'blocked' }],
    });
  });
});
