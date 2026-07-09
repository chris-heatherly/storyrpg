import type { Story } from '../../types/story';
import {
  FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION,
  FINAL_CONTRACT_VALIDATOR_VERSION,
  contractRepairIssueFingerprint,
  finalContractRepairInputHash,
  type ContractRepairReport,
  type ContractRepairRoundSnapshot,
} from './finalContractRepair';

export interface FinalContractRepairReplayArtifact {
  schemaVersion: typeof FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION;
  validatorVersion: typeof FINAL_CONTRACT_VALIDATOR_VERSION;
  savedAt: string;
  round: number;
  snapshot: ContractRepairRoundSnapshot;
  candidateHash: string;
  story: Story;
  report: ContractRepairReport;
}

export function buildFinalContractRepairReplayArtifact(
  snapshot: ContractRepairRoundSnapshot,
  story: Story,
  report: ContractRepairReport,
  savedAt = new Date().toISOString(),
): FinalContractRepairReplayArtifact {
  return {
    schemaVersion: FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION,
    validatorVersion: FINAL_CONTRACT_VALIDATOR_VERSION,
    savedAt,
    round: snapshot.round,
    snapshot,
    candidateHash: finalContractRepairInputHash(story),
    story,
    report,
  };
}

export interface FinalContractRepairReplayResult {
  reproducible: boolean;
  hashMatches: boolean;
  versionMatches: boolean;
  expectedIssueKeys: string[];
  replayedIssueKeys: string[];
  reason?: string;
}

/**
 * Re-run a saved repair candidate with the same validator contract. Abort
 * diagnostics may only claim reproducibility when version, hash, and issue
 * fingerprints all match.
 */
export async function replayFinalContractRepairArtifact(
  artifact: FinalContractRepairReplayArtifact,
  validate: (story: Story) => Promise<ContractRepairReport> | ContractRepairReport,
): Promise<FinalContractRepairReplayResult> {
  const versionMatches = artifact.schemaVersion === FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION
    && artifact.validatorVersion === FINAL_CONTRACT_VALIDATOR_VERSION;
  const hashMatches = artifact.candidateHash === finalContractRepairInputHash(artifact.story);
  if (!versionMatches || !hashMatches) {
    return {
      reproducible: false,
      hashMatches,
      versionMatches,
      expectedIssueKeys: artifact.snapshot.afterIssueKeys,
      replayedIssueKeys: [],
      reason: !versionMatches ? 'repair snapshot version mismatch' : 'repair candidate hash mismatch',
    };
  }

  const replayed = await validate(artifact.story);
  const replayedIssueKeys = replayed.blockingIssues.map(contractRepairIssueFingerprint);
  const expectedIssueKeys = artifact.snapshot.afterIssueKeys;
  const reproducible = replayed.passed === artifact.report.passed
    && expectedIssueKeys.length === replayedIssueKeys.length
    && expectedIssueKeys.every((key) => replayedIssueKeys.includes(key));
  return {
    reproducible,
    hashMatches,
    versionMatches,
    expectedIssueKeys,
    replayedIssueKeys,
    ...(!reproducible ? { reason: 'saved candidate no longer reproduces the recorded validator result' } : {}),
  };
}
