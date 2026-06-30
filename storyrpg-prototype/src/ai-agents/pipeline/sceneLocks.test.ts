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
