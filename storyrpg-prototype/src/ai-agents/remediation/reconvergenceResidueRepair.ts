/**
 * Reconvergence-residue gate: targeted repair + degrade-to-advisory
 * (CONSISTENCY_PLAN WS2a — kills the #1 archived-run failure class).
 *
 * Called by FullStoryPipeline.validateSceneGraphBranching when the
 * SceneGraphBranchValidator reports `missing_branch_residue` ERRORS (the finding
 * that previously hard-aborted 16 runs). Flow, driven through the canonical
 * {@link runGatedRemediation} loop:
 *
 *   detect    — the current validation result has no missing-residue errors.
 *   remediate — ONE targeted SceneCritic regen per offending scene (bounded):
 *               director notes built from the planning-time ResidueRequirement +
 *               the assembled episode's actual routing flags instruct the critic
 *               to ADD flag-gated textVariants on the scene's earliest beat.
 *               Rewrites are merged into the in-memory sceneContents via the same
 *               helper the continuity repair uses, then the caller's `revalidate`
 *               reassembles + re-validates.
 *   degrade   — anything still missing residue is downgraded to an advisory
 *               warning (emitted with the `[advisory]` convention) and the result
 *               is returned VALID-if-no-other-errors. The story ships with a
 *               recorded warning; the gate NEVER throws (blocking: false).
 *
 * Gate flag: GATE_RECONVERGENCE_RESIDUE_REPAIR (gateDefaults.ts, default ON —
 * the abort was the bug; `=0` is the kill-switch back to the old hard-fail).
 */

import { runGatedRemediation } from './runGatedRemediation';
import { applyRewrittenBeatsToSceneContents } from '../pipeline/continuityRepair';
import {
  buildResidueRepairDirectorNotes,
  degradeMissingResidueIssues,
  deriveEpisodeResidueDirective,
  missingResidueSceneIds,
  type ResidueEpisodeSceneLike,
  type ResidueRequirement,
  type ResidueValidationResultLike,
} from '../pipeline/reconvergenceResidue';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';

/** Bound the repair work like the continuity repair does (worst offenders first). */
const MAX_REPAIR_SCENES = 4;

// Structural SceneCritic shape (execute + rewrittenBeats) so tests can stub it
// and the module stays decoupled from the agent class.
export interface ResidueCriticLike {
  execute(input: {
    scene: unknown;
    directorNotes?: string;
    flaggedBeatIds?: string[];
  }): Promise<{ success: boolean; data?: { rewrittenBeats?: Array<{ id?: string }> }; error?: string }>;
}

interface ResidueSceneContentLike {
  sceneId?: string;
  startingBeatId?: string;
  beats?: Array<{ id?: string }>;
}

export interface ReconvergenceResidueGateOptions {
  /** The failing validation result (must contain the missing-residue errors). */
  result: ResidueValidationResultLike;
  /** Assembled episode scenes — used to derive real routing flags for the notes. */
  episodeScenes: ResidueEpisodeSceneLike[];
  /** Blueprint scenes carrying the planning-time stamped requirements (optional). */
  blueprintScenes?: Array<{ id: string; residueRequirement?: ResidueRequirement }>;
  /** In-memory scene contents the regen mutates (the pipeline's source of truth). */
  sceneContents?: ResidueSceneContentLike[];
  /** Lazy SceneCritic factory — only constructed when a regen actually runs. */
  critic?: () => ResidueCriticLike;
  /** Reassemble the episode from the (mutated) sceneContents and re-validate. */
  revalidate?: () => ResidueValidationResultLike | Promise<ResidueValidationResultLike>;
  emit: (event: { type: 'warning' | 'debug'; phase?: string; message: string; data?: unknown }) => void;
  phase: string;
  /** Override for tests; defaults to the standard LLM-agent timeout. */
  timeoutMs?: number;
}

export interface ReconvergenceResidueGateOutcome<T extends ResidueValidationResultLike> {
  /** Final validation result: repaired, or with residue errors degraded to warnings. */
  result: T;
  /** Scenes whose critic rewrite merged at least one beat. */
  repairedSceneIds: string[];
  /** Scenes that shipped with an advisory (unrepaired residue) warning. */
  advisorySceneIds: string[];
  /** Scenes the regen attempted (regardless of outcome). */
  attemptedSceneIds: string[];
}

/**
 * Run the residue repair-then-degrade gate. Never throws on residue findings:
 * the worst case is an advisory-degraded result. Non-residue errors are left
 * untouched, so a structurally-broken episode still blocks at the caller.
 */
export async function runReconvergenceResidueGate<T extends ResidueValidationResultLike>(
  opts: ReconvergenceResidueGateOptions & { result: T },
): Promise<ReconvergenceResidueGateOutcome<T>> {
  const { episodeScenes, blueprintScenes, sceneContents, critic, revalidate, emit, phase } = opts;
  let current: T = opts.result;
  const repairedSceneIds: string[] = [];
  const attemptedSceneIds: string[] = [];
  const canRegen = Boolean(critic && revalidate && sceneContents && sceneContents.length > 0);
  const requirementByScene = new Map(
    (blueprintScenes || [])
      .filter((scene) => scene.residueRequirement)
      .map((scene) => [scene.id, scene.residueRequirement as ResidueRequirement]),
  );

  await runGatedRemediation({
    detect: () => ({ passed: missingResidueSceneIds(current).length === 0 }),
    remediate: async () => {
      const targets = missingResidueSceneIds(current).slice(0, MAX_REPAIR_SCENES);
      for (const sceneId of targets) {
        attemptedSceneIds.push(sceneId);
        const scene = (sceneContents || []).find((candidate) => candidate.sceneId === sceneId);
        if (!scene || !scene.beats || scene.beats.length === 0) {
          emit({ type: 'warning', phase, message: `Residue repair skipped for ${sceneId}: scene content not found.` });
          continue;
        }
        const directive = deriveEpisodeResidueDirective(episodeScenes, sceneId);
        const notes = buildResidueRepairDirectorNotes(sceneId, directive, requirementByScene.get(sceneId));
        const firstBeatId = scene.startingBeatId || scene.beats[0]?.id;
        try {
          const critique = await withTimeout(
            critic!().execute({
              scene,
              directorNotes: notes,
              flaggedBeatIds: firstBeatId ? [firstBeatId] : undefined,
            }),
            opts.timeoutMs ?? PIPELINE_TIMEOUTS.llmAgent,
            `SceneCritic.residueRepair(${sceneId})`,
          );
          const rewrittenBeats = critique.success ? critique.data?.rewrittenBeats || [] : [];
          const merged = applyRewrittenBeatsToSceneContents(
            sceneContents as never,
            sceneId,
            rewrittenBeats as never,
          );
          if (merged > 0) {
            repairedSceneIds.push(sceneId);
            emit({ type: 'debug', phase, message: `Residue repair rewrote ${merged} beat(s) in ${sceneId} to acknowledge the branch path.` });
          } else {
            emit({ type: 'warning', phase, message: `Residue repair for ${sceneId} produced no usable rewrite${critique.error ? ` (${critique.error})` : ''}.` });
          }
        } catch (err) {
          emit({
            type: 'warning',
            phase,
            message: `Residue repair for ${sceneId} failed (keeping original): ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      current = (await revalidate!()) as T;
    },
    maxAttempts: canRegen ? 1 : 0,
    blocking: false, // degrade, never abort — that is the whole point of this gate
  });

  // Terminal degrade: whatever residue findings survive the regen ship as
  // advisory warnings instead of aborting the run.
  const advisorySceneIds = missingResidueSceneIds(current);
  if (advisorySceneIds.length > 0) {
    const { result: degraded, downgraded } = degradeMissingResidueIssues(current);
    current = degraded;
    for (const issue of downgraded) {
      emit({
        type: 'warning',
        phase,
        message: `[advisory] Reconvergence residue unrepaired — shipping with a recorded warning instead of aborting: ${issue.message}`,
        data: issue,
      });
    }
  }

  return { result: current, repairedSceneIds, advisorySceneIds, attemptedSceneIds };
}
