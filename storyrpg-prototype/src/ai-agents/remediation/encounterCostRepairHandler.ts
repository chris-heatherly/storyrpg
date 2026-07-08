/**
 * Targeted encounter cost/stakes-field repair handler for the final-contract
 * repair loop (2026-07-06 encounter-cost postmortem, R2: the final contract is
 * the one place a craft finding may block, so it must carry a CONVERGING
 * repair for every class it blocks).
 *
 * RouteContinuityValidator raises blocking `unsafe_fallback_prose` when a
 * syntheticFallbackProse registry string survives into reader-facing text —
 * including encounter COST fields (`visibleComplication`, `immediateEffect`),
 * which `collectEncounterMetaTexts` scans. The scene-prose handler routed for
 * that finding rewrites encounter BEAT prose only; it never touches cost
 * fields, so a cost-field hit could never clear and the repair loop exhausted
 * into an abort. This handler is the missing converging half: walk the
 * assembled story's encounters for registered fallback strings in cost/stakes
 * fields and re-author exactly those fields with one focused LLM call per
 * encounter (EncounterArchitect.reauthorFallbackCostFields — the same repair
 * the generation-time acceptance check applies at the source).
 */

import type { Story } from '../../types/story';
import { collectFallbackCostFieldEntries, type CostReauthorContext } from '../utils/encounterFallbackCostFields';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import type { ContractRepairHandler } from './finalContractRepair';

/** The single capability this handler needs — EncounterArchitect implements it structurally. */
export interface CostReauthorAgent {
  reauthorFallbackCostFields(encounterTree: unknown, ctx?: CostReauthorContext): Promise<number>;
}

interface EncounterTarget {
  sceneId: string;
  sceneName?: string;
  sceneDescription?: string;
  encounter: unknown;
  fieldCount: number;
}

/** Encounter scenes whose cost/stakes fields carry registered fallback prose. */
export function collectFallbackCostEncounters(story: Story): EncounterTarget[] {
  const targets: EncounterTarget[] = [];
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      const encounter = (scene as { encounter?: unknown }).encounter;
      if (!encounter) continue;
      const entries = collectFallbackCostFieldEntries(encounter);
      if (entries.length === 0) continue;
      const beats = (scene as { beats?: Array<{ text?: string }> }).beats;
      targets.push({
        sceneId: scene.id,
        sceneName: (scene as { name?: string }).name,
        sceneDescription: beats?.[0]?.text?.slice(0, 200),
        encounter,
        fieldCount: entries.length,
      });
    }
  }
  return targets;
}

export interface EncounterCostRepairOptions {
  /** Provides the re-author agent (an EncounterArchitect). Null disables the handler for the round. */
  author: () => CostReauthorAgent | null;
  emit?: (message: string) => void;
  /** Encounters re-authored per round cap so a pathological report can't fan out unbounded LLM spend. */
  maxEncountersPerRound?: number;
}

/**
 * Build the ContractRepairHandler. Plugs into runFinalContractRepair alongside
 * the scene-prose and outcome-text handlers; the loop re-validates after each
 * round, so a successful re-author clears the unsafe_fallback_prose finding on
 * the next validation pass.
 */
export function buildEncounterCostRepairHandler(opts: EncounterCostRepairOptions): ContractRepairHandler {
  const attempted = new Set<string>();
  return async ({ story }) => {
    const all = collectFallbackCostEncounters(story);
    if (all.length === 0) return { story, changed: false };

    const fresh = all.filter((t) => !attempted.has(t.sceneId));
    const batch = (fresh.length ? fresh : all).slice(0, opts.maxEncountersPerRound ?? 4);

    const author = opts.author();
    if (!author) {
      opts.emit?.('Encounter cost-field contract repair skipped: no author available.');
      return { story, changed: false };
    }

    let repairedFields = 0;
    let repairedEncounters = 0;
    for (const target of batch) {
      attempted.add(target.sceneId);
      try {
        const replaced = await withTimeout(
          author.reauthorFallbackCostFields(target.encounter, {
            sceneName: target.sceneName,
            sceneDescription: target.sceneDescription,
          }),
          PIPELINE_TIMEOUTS.llmAgent,
          `EncounterArchitect.reauthorFallbackCostFields(${target.sceneId})`,
        );
        if (replaced > 0) {
          repairedFields += replaced;
          repairedEncounters += 1;
        }
      } catch (err) {
        opts.emit?.(`Encounter cost-field contract repair for ${target.sceneId} failed (placeholders kept): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (repairedFields === 0) {
      opts.emit?.(`Encounter cost-field contract repair made no replacements (${batch.length} encounter(s) still carry fallback cost fields).`);
      return { story, changed: false };
    }
    opts.emit?.(`Encounter cost-field contract repair: re-authored ${repairedFields} fallback field(s) across ${repairedEncounters} encounter(s).`);
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_encounter_cost',
        scope: 'encounter',
        attempted: batch.length,
        succeeded: repairedEncounters === batch.length,
        degraded: repairedEncounters < batch.length,
        blocked: false,
        attempts: batch.length,
        details: `Re-authored ${repairedFields} fallback cost/stakes field(s) across ${repairedEncounters} encounter(s)`,
      },
    };
  };
}
