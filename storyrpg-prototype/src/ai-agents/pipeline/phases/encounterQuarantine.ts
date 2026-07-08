import type { AgentResponse } from '../../agents/BaseAgent';
import type { EncounterArchitectInput, EncounterStructure } from '../../agents/EncounterArchitect';
import { classifyPhaseError } from '../../agents/EncounterArchitect';

/**
 * UNIT QUARANTINE (P2, 2026-07-06).
 *
 * Failure semantics used to be run-fatal: one encounter unit exhausting its
 * retry ladder threw mid-phase and discarded every checkpointed sibling unit
 * (the bite-me 2026-07-06 abort burned a 62-minute run over one encounter).
 * Now the unit is quarantined, the rest of the phase completes and
 * checkpoints, and an escalated retry pass runs at the end of the phase.
 * Only units that ALSO fail the escalated retry fail the phase — and resume
 * then re-runs only those units. The final story contract (and the
 * missing-encounter guard) still refuse to ship a story with a missing unit.
 */
export interface QuarantinedEncounterUnit {
  sceneId: string;
  sceneName: string;
  encounterType?: string;
  lastFailure: string;
  /** True when the failure classifies as an output-budget (max_tokens) failure. */
  budgetClass: boolean;
  /**
   * Attempt summaries / phase errors from the exhausted ladder (P3) —
   * persisted into the pipeline error log if the unit stays unrecovered.
   */
  diagnostics?: Record<string, unknown>;
  /** Escalated retry (budget-class units run the decomposed recovery ladder). */
  retry: () => Promise<AgentResponse<EncounterStructure>>;
  /**
   * Registers a successful retry into the phase's collections/checkpoints.
   * Returns a rejection reason (unit stays failed) or null (recovered).
   */
  register: (result: AgentResponse<EncounterStructure>) => Promise<string | null>;
}

export interface UnrecoveredEncounterUnit {
  sceneId: string;
  sceneName: string;
  error: string;
}

/**
 * Decides how the escalated quarantine retry re-enters the architect:
 * budget-class failures set `budgetRecovery` (decomposed ladder — growing the
 * prompt cannot fix a truncation), content-class failures get the standard
 * feedback-augmented prompt.
 */
export function buildQuarantineRetryInput(
  encounterInput: EncounterArchitectInput,
  lastFailure: string,
): { input: EncounterArchitectInput; budgetClass: boolean } {
  const budgetClass = classifyPhaseError(new Error(lastFailure)) === 'max_tokens';
  if (budgetClass) {
    return { input: { ...encounterInput, budgetRecovery: true }, budgetClass };
  }
  return {
    budgetClass,
    input: {
      ...encounterInput,
      storyContext: {
        ...encounterInput.storyContext,
        userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nPREVIOUS ATTEMPTS FAILED: ${lastFailure}\nAddress the failure and return the complete, valid encounter JSON.`,
      },
    },
  };
}

/**
 * Runs the escalated retry for every quarantined unit and returns the units
 * that are still unrecovered. Never throws — the caller decides whether an
 * unrecovered unit fails the phase.
 */
export async function runQuarantineRetryPass(
  units: QuarantinedEncounterUnit[],
  onRecovered?: (unit: QuarantinedEncounterUnit) => void,
): Promise<UnrecoveredEncounterUnit[]> {
  const unrecovered: UnrecoveredEncounterUnit[] = [];
  for (const unit of units) {
    try {
      const result = await unit.retry();
      if (result.success && result.data) {
        const rejection = await unit.register(result);
        if (!rejection) {
          onRecovered?.(unit);
          continue;
        }
        unrecovered.push({ sceneId: unit.sceneId, sceneName: unit.sceneName, error: rejection });
      } else {
        unrecovered.push({ sceneId: unit.sceneId, sceneName: unit.sceneName, error: result.error || 'EncounterArchitect returned no data' });
      }
    } catch (err) {
      unrecovered.push({ sceneId: unit.sceneId, sceneName: unit.sceneName, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return unrecovered;
}
