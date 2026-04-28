import type { DeterministicBranchTopology } from './branchTopology';
import type { BranchAnalysis } from '../agents/BranchManager';

/**
 * Shadow-mode diff between the LLM-driven `BranchManager` pass and the
 * deterministic `analyzeBranchTopology` pass (I5 instrumentation).
 *
 * Only scenes referenced by at least one side show up in `agreedScenes`,
 * `llmOnlyScenes`, or `deterministicOnlyScenes`. The diff is intentionally
 * coarse — per-category sets of scene IDs — because the two passes do not
 * speak in identical schemas. Once several runs have produced this file we
 * can decide whether the LLM pass is catching issues the deterministic
 * analyzer misses, which is the gate on deferred task D4.
 */
export interface BranchShadowDiff {
  /** Scenes both analyzers flagged in any category. */
  agreedScenes: string[];
  /** Scenes flagged only by the LLM (BranchManager validationIssues). */
  llmOnlyScenes: string[];
  /** Scenes flagged only by the deterministic analyzer. */
  deterministicOnlyScenes: string[];
  /** Counts of issues per source, so consumers can eyeball magnitude. */
  counts: {
    llmValidationIssues: number;
    deterministicUnreachable: number;
    deterministicDeadEnds: number;
    deterministicReconvergence: number;
  };
  /** Raw issue payloads retained so later analysis can inspect specifics. */
  llmIssues: Array<{
    type: string;
    severity: string;
    description: string;
    affectedScenes: string[];
  }>;
  deterministicFindings: {
    unreachableSceneIds: string[];
    deadEndSceneIds: string[];
    reconvergenceSceneIds: string[];
  };
}

/**
 * Collect the set of scene IDs that the LLM pass flagged (union over all
 * `validationIssues.affectedScenes`). The LLM can flag a scene under several
 * issue types; for the coarse diff we collapse them.
 */
function collectLlmFlaggedScenes(llm: BranchAnalysis | null): Set<string> {
  const set = new Set<string>();
  if (!llm) return set;
  for (const issue of llm.validationIssues ?? []) {
    for (const id of issue.affectedScenes ?? []) {
      if (typeof id === 'string' && id.length > 0) set.add(id);
    }
  }
  return set;
}

/**
 * Collect the set of scene IDs that the deterministic analyzer flagged.
 * We intentionally exclude `reconvergenceSceneIds` from the "flagged" set
 * because reconvergence is not an issue — it's just a topology observation.
 */
function collectDeterministicFlaggedScenes(det: DeterministicBranchTopology): Set<string> {
  const set = new Set<string>();
  for (const id of det.unreachableSceneIds) set.add(id);
  for (const id of det.deadEndSceneIds) set.add(id);
  return set;
}

export function buildBranchShadowDiff(
  llm: BranchAnalysis | null,
  deterministic: DeterministicBranchTopology,
): BranchShadowDiff {
  const llmScenes = collectLlmFlaggedScenes(llm);
  const detScenes = collectDeterministicFlaggedScenes(deterministic);

  const agreedScenes: string[] = [];
  const llmOnlyScenes: string[] = [];
  const deterministicOnlyScenes: string[] = [];

  for (const id of llmScenes) {
    if (detScenes.has(id)) agreedScenes.push(id);
    else llmOnlyScenes.push(id);
  }
  for (const id of detScenes) {
    if (!llmScenes.has(id)) deterministicOnlyScenes.push(id);
  }

  return {
    agreedScenes: agreedScenes.sort(),
    llmOnlyScenes: llmOnlyScenes.sort(),
    deterministicOnlyScenes: deterministicOnlyScenes.sort(),
    counts: {
      llmValidationIssues: llm?.validationIssues?.length ?? 0,
      deterministicUnreachable: deterministic.unreachableSceneIds.length,
      deterministicDeadEnds: deterministic.deadEndSceneIds.length,
      deterministicReconvergence: deterministic.reconvergenceSceneIds.length,
    },
    llmIssues: (llm?.validationIssues ?? []).map((i) => ({
      type: i.type,
      severity: i.severity,
      description: i.description,
      affectedScenes: i.affectedScenes ?? [],
    })),
    deterministicFindings: {
      unreachableSceneIds: [...deterministic.unreachableSceneIds],
      deadEndSceneIds: [...deterministic.deadEndSceneIds],
      reconvergenceSceneIds: [...deterministic.reconvergenceSceneIds],
    },
  };
}
