/**
 * TreatmentSeedOnPageValidator
 *
 * A deterministic presence backstop for the treatment-seed → setFlag contract.
 *
 * StoryArchitect records the seeds a scene must plant on
 * `choicePoint.setsTreatmentSeeds` (and as `flag:treatment_seed_* — …` directives
 * on `encounterSetupContext`), and `emitSceneTreatmentSeeds` deterministically
 * attaches a `setFlag` consequence for each. If that attach step is skipped or a
 * seed is declared but never wired, the seed exists only as a downstream
 * precondition that can never be satisfied (the Endsong Gen-4 poison: the seed was
 * declared and the cordial delivered, but no choice set the flag near the event).
 *
 * This validator confirms every declared `treatment_seed_*` for an episode is
 * actually SET by a `setFlag` consequence on some choice in that episode. It is a
 * PRESENCE check only — it cannot tell whether the flag landed on the *right*
 * (semantically related) choice; that judgment belongs to the convergence-ledger /
 * charge-materialization path. No LLM.
 */

import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { resolveSceneTreatmentSeeds } from '../pipeline/episodePlantContext';

export interface TreatmentSeedOnPageIssue {
  type: 'treatment_seed_not_set_on_page';
  severity: 'warning' | 'error';
  message: string;
  flag: string;
}

export interface TreatmentSeedOnPageResult {
  valid: boolean;
  issues: TreatmentSeedOnPageIssue[];
  metrics: { declaredSeeds: number; setSeeds: number; missingSeeds: number };
}

export interface TreatmentSeedOnPageOptions {
  /** When true, missing seeds are 'error' (gating). Default 'warning' (advisory). */
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

export class TreatmentSeedOnPageValidator {
  validateEpisode(
    episode: Episode,
    blueprint?: EpisodeBlueprint,
    options: TreatmentSeedOnPageOptions = {},
  ): TreatmentSeedOnPageResult {
    const severity: 'warning' | 'error' = options.blocking ? 'error' : 'warning';

    // Declared seeds = union across blueprint scenes (setsTreatmentSeeds + setup directives).
    const declared = new Set<string>();
    for (const bp of blueprint?.scenes || []) {
      for (const seed of resolveSceneTreatmentSeeds(bp)) declared.add(seed);
    }

    const setFlags = collectSetFlags(episode);
    const issues: TreatmentSeedOnPageIssue[] = [];
    let setSeeds = 0;
    for (const seed of declared) {
      if (setFlags.has(seed)) {
        setSeeds += 1;
      } else {
        issues.push({
          type: 'treatment_seed_not_set_on_page',
          severity,
          message:
            `Treatment seed "${seed}" is declared for this episode but no choice sets it via a ` +
            'setFlag consequence — the seed can never become true on-page.',
          flag: seed,
        });
      }
    }

    const errorCount = issues.filter((x) => x.severity === 'error').length;
    return {
      valid: errorCount === 0,
      issues,
      metrics: { declaredSeeds: declared.size, setSeeds, missingSeeds: issues.length },
    };
  }
}
