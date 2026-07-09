import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import {
  contractRepairIssueFingerprint,
  finalContractRepairInputHash,
  type ContractRepairReport,
  type ContractRepairRoundSnapshot,
} from './finalContractRepair';
import {
  buildFinalContractRepairReplayArtifact,
  replayFinalContractRepairArtifact,
} from './finalContractRepairReplay';

describe('final contract repair replay', () => {
  it('reproduces a versioned failed candidate under the same validator', async () => {
    const story = { id: 'replay', title: 'Replay', episodes: [] } as unknown as Story;
    const issue = {
      validator: 'RouteContinuityValidator',
      type: 'unsafe_fallback_prose',
      sceneId: 's1-1',
      fieldPath: 'encounter.description',
      message: 'Unsafe fallback prose.',
    };
    const report: ContractRepairReport = { passed: false, blockingIssues: [issue] };
    const snapshot: ContractRepairRoundSnapshot = {
      schemaVersion: 1,
      validatorVersion: '2026-07-09',
      round: 1,
      inputHash: finalContractRepairInputHash(story),
      beforeIssueKeys: [contractRepairIssueFingerprint(issue)],
      afterIssueKeys: [contractRepairIssueFingerprint(issue)],
      attemptedIssueKeys: [contractRepairIssueFingerprint(issue)],
      changedFieldPaths: ['story.title'],
      handlerAttempts: [],
      clearedIssueKeys: [],
      introducedIssueKeys: [],
      revalidationDelta: { beforeBlocking: 1, afterBlocking: 1, cleared: 0, introduced: 0 },
      passed: false,
    };
    const artifact = buildFinalContractRepairReplayArtifact(snapshot, story, report, '2026-07-09T00:00:00.000Z');
    const replay = await replayFinalContractRepairArtifact(artifact, async () => report);
    expect(replay).toMatchObject({
      reproducible: true,
      hashMatches: true,
      versionMatches: true,
    });
  });

  it('rejects a mutated saved candidate before validator replay', async () => {
    const story = { id: 'replay', title: 'Replay', episodes: [] } as unknown as Story;
    const report: ContractRepairReport = { passed: false, blockingIssues: [] };
    const snapshot: ContractRepairRoundSnapshot = {
      schemaVersion: 1,
      validatorVersion: '2026-07-09',
      round: 1,
      inputHash: finalContractRepairInputHash(story),
      beforeIssueKeys: [],
      afterIssueKeys: [],
      attemptedIssueKeys: [],
      changedFieldPaths: [],
      handlerAttempts: [],
      clearedIssueKeys: [],
      introducedIssueKeys: [],
      revalidationDelta: { beforeBlocking: 0, afterBlocking: 0, cleared: 0, introduced: 0 },
      passed: false,
    };
    const artifact = buildFinalContractRepairReplayArtifact(snapshot, story, report);
    artifact.story.title = 'Mutated';
    const replay = await replayFinalContractRepairArtifact(artifact, async () => report);
    expect(replay.reproducible).toBe(false);
    expect(replay.hashMatches).toBe(false);
  });
});
