/**
 * EndingReachabilityValidator
 *
 * A deterministic presence backstop for the ending-axis → setFlag contract.
 *
 * The SeasonPlanner declares each named ending's state-driver as a
 * `treatment_branch_*` entry in `seasonPlan.seasonFlags` (with a `setInEpisode`).
 * StoryArchitect records the axes a scene must SET on `choicePoint.setsBranchAxes`
 * (see `registerBranchAxisEmitters`), and `emitSceneBranchAxes` deterministically
 * attaches a `setFlag` consequence for each. If that wiring is skipped, the axis
 * exists only as a finale precondition that can never be satisfied — so the named
 * ending it drives is mechanically UNREACHABLE (the Gen-4 defect: endings wired at
 * plan level but never set by any choice).
 *
 * This validator confirms every ending-axis flag (`treatment_branch_*`) declared
 * for an episode is actually SET by a `setFlag` consequence on some choice in that
 * episode. PRESENCE only — it cannot tell whether the axis landed on the
 * semantically "right" choice; that judgment belongs to the convergence ledger.
 * No LLM.
 */

import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { resolveSceneBranchAxes } from '../pipeline/episodePlantContext';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { EndingRealizationContract } from '../../types/scenePlan';
import { treatmentFieldCloseMatch } from '../utils/treatmentFieldContracts';

export interface EndingReachabilityIssue {
  type: 'ending_axis_not_set_on_page' | 'ending_target_condition_unreachable';
  severity: 'warning' | 'error';
  message: string;
  flag: string;
}

export interface EndingReachabilityResult {
  valid: boolean;
  issues: EndingReachabilityIssue[];
  metrics: { declaredAxes: number; setAxes: number; missingAxes: number };
}

export interface EndingReachabilityOptions {
  /** When true, missing axes are 'error' (gating). Default 'warning' (advisory). */
  blocking?: boolean;
}

/** Collect every `setFlag` flag name set by any choice anywhere in the episode. */
function collectSetFlags(episode: Episode): Set<string> {
  const flags = new Set<string>();
  const noteChoices = (choices: Scene['beats'][number]['choices']): void => {
    for (const choice of choices || []) {
      for (const c of choice.consequences || []) {
        if (c.type === 'setFlag' && typeof c.flag === 'string') flags.add(c.flag);
      }
    }
  };
  for (const scene of episode.scenes || []) {
    for (const beat of scene.beats || []) noteChoices(beat.choices);
    for (const phase of scene.encounter?.phases || []) {
      for (const beat of phase.beats || []) noteChoices(beat.choices);
    }
  }
  return flags;
}

export class EndingReachabilityValidator {
  validateSeasonPlan(
    plan: Pick<SeasonPlan, 'endingRealizationContracts' | 'branchConsequenceContracts' | 'seasonFlags' | 'choiceMoments' | 'crossEpisodeBranches' | 'resolvedEndings'>,
    options: EndingReachabilityOptions = {},
  ): EndingReachabilityResult {
    const severity: 'warning' | 'error' = options.blocking ? 'error' : 'warning';
    const issues: EndingReachabilityIssue[] = [];
    const conditionContracts = (plan.endingRealizationContracts ?? [])
      .filter((contract: EndingRealizationContract) => contract.contractKind === 'ending_target_condition');
    const supportText = [
      ...(plan.branchConsequenceContracts ?? []).map((contract) => contract.sourceText),
      ...(plan.seasonFlags ?? []).map((flag) => `${flag.flag} ${flag.description}`),
      ...(plan.choiceMoments ?? []).map((moment) => `${moment.id} ${moment.anchor} ${moment.flag ?? ''}`),
      ...(plan.crossEpisodeBranches ?? []).map((branch) => `${branch.name} ${branch.trigger.description} ${branch.paths.map((path) => `${path.condition} ${path.affectedEpisodes.map((episode) => episode.description).join(' ')}`).join(' ')}`),
    ].join(' ');

    for (const contract of conditionContracts) {
      const supportedByLinkedBranch = contract.linkedContractIds.some((id) =>
        (plan.branchConsequenceContracts ?? []).some((branch) => branch.id === id)
      );
      const supportedByText = treatmentFieldCloseMatch(contract.sourceText, supportText, 0.22);
      if (!supportedByLinkedBranch && !supportedByText) {
        issues.push({
          type: 'ending_target_condition_unreachable',
          severity,
          message: `Ending "${contract.endingName}" target condition is not reachable from any planned branch state, season flag, choice moment, or cross-episode path: "${contract.sourceText}".`,
          flag: contract.id,
        });
      }
    }

    const errorCount = issues.filter((x) => x.severity === 'error').length;
    return {
      valid: errorCount === 0,
      issues,
      metrics: { declaredAxes: conditionContracts.length, setAxes: conditionContracts.length - issues.length, missingAxes: issues.length },
    };
  }

  validateEpisode(
    episode: Episode,
    blueprint?: EpisodeBlueprint,
    options: EndingReachabilityOptions = {},
  ): EndingReachabilityResult {
    const severity: 'warning' | 'error' = options.blocking ? 'error' : 'warning';

    // Declared ending axes = union across blueprint scenes' setsBranchAxes.
    const declared = new Set<string>();
    for (const bp of blueprint?.scenes || []) {
      for (const axis of resolveSceneBranchAxes(bp)) declared.add(axis);
    }

    const setFlags = collectSetFlags(episode);
    const issues: EndingReachabilityIssue[] = [];
    let setAxes = 0;
    for (const axis of declared) {
      if (setFlags.has(axis)) {
        setAxes += 1;
      } else {
        issues.push({
          type: 'ending_axis_not_set_on_page',
          severity,
          message:
            `Ending-axis flag "${axis}" is declared for this episode but no choice sets it via a ` +
            'setFlag consequence — the ending it drives can never become reachable on-page.',
          flag: axis,
        });
      }
    }

    const errorCount = issues.filter((x) => x.severity === 'error').length;
    return {
      valid: errorCount === 0,
      issues,
      metrics: { declaredAxes: declared.size, setAxes, missingAxes: issues.length },
    };
  }
}
