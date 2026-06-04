// ========================================
// CHOICE IMPACT FIELD-PRESENCE REPAIR
// ========================================
//
// Deterministic, default-off backfill for missing ChoiceImpact metadata. The
// ChoiceImpactValidator wants every meaningful choice to carry `impactFactors`
// and a `consequenceTier`. Both can be DERIVED from data the choice already
// holds (its consequences, statCheck, witnessReactions, nextSceneId, etc.), so
// this repair fills them in-place with no LLM, no wall-clock, and no randomness.
//
// IMPORTANT — what is and is NOT backfilled:
//   * impactFactors   — derivable → backfilled.
//   * consequenceTier — derivable → backfilled.
//   * stakes {want, cost, identity} — the NARRATIVE prose of stakes is NOT
//     deterministically derivable from consequence data (it needs authorial
//     framing). Per the repair contract we do NOT fabricate it; stakes are
//     left untouched and remain an LLM-side concern.
//
// Gate: GATE_CHOICE_IMPACT. When the flag is disabled this is a complete no-op
// (default-off, zero behavior change).

import type { Story } from '../../../types/story';
import type {
  Choice,
  ChoiceImpactFactor,
  ChoiceConsequenceTier,
} from '../../../types/choice';
import type { Consequence } from '../../../types/consequences';
import type { RemediationLedgerRecord } from '../remediationLedger';

const GATE_FLAG = 'GATE_CHOICE_IMPACT';
const RULE_NAME = 'ChoiceImpact';

/** Flatten a choice's immediate + delayed consequences into one list. */
function collectConsequences(choice: Choice): Consequence[] {
  const immediate = choice.consequences ?? [];
  const delayed = (choice.delayedConsequences ?? []).map((dc) => dc.consequence);
  return [...immediate, ...delayed];
}

/**
 * Derive impact factors from the structural signals already on the choice.
 * Order is deterministic; the result is de-duplicated via a Set.
 */
function deriveImpactFactors(choice: Choice): ChoiceImpactFactor[] {
  const consequences = collectConsequences(choice);
  const factors = new Set<ChoiceImpactFactor>();

  // relationship — relationship consequences or witnessed social fallout.
  if (
    consequences.some((c) => c.type === 'relationship') ||
    (choice.witnessReactions?.length ?? 0) > 0
  ) {
    factors.add('relationship');
  }

  // identity — attribute shifts or tag changes redefine who the player is.
  if (
    consequences.some(
      (c) => c.type === 'attribute' || c.type === 'addTag' || c.type === 'removeTag',
    )
  ) {
    factors.add('identity');
  }

  // information — an explicit story verb or a memorable moment is info-bearing.
  if (choice.storyVerb || choice.memorableMoment) {
    factors.add('information');
  }

  // outcome — routing the story or setting structural flags/scores.
  if (
    choice.nextSceneId ||
    consequences.some(
      (c) =>
        c.type === 'setFlag' || c.type === 'setScore' || c.type === 'changeScore',
    )
  ) {
    factors.add('outcome');
  }

  // process — skill changes or a stat check shape HOW the player acts.
  if (consequences.some((c) => c.type === 'skill') || choice.statCheck) {
    factors.add('process');
  }

  return Array.from(factors);
}

/**
 * Derive a consequence tier from the magnitude/kind of durable impact.
 * Mirrors the validator's tiering intuition with no narrative judgement.
 */
function deriveConsequenceTier(choice: Choice): ChoiceConsequenceTier {
  const consequences = collectConsequences(choice);
  const hasConsequences = consequences.length > 0;
  const hasDelayed = (choice.delayedConsequences?.length ?? 0) > 0;
  const branches = Boolean(choice.nextSceneId);

  // No durable impact of any kind → a light callback at most.
  if (!hasConsequences && !hasDelayed && !branches) {
    return 'callback';
  }

  // Routing or delayed payoff is the heaviest tier.
  if (branches || hasDelayed) {
    return 'structuralBranch';
  }

  // Only lightweight, local effects (flags/tags) → a scene tint.
  if (
    hasConsequences &&
    consequences.every((c) => c.type === 'setFlag' || c.type === 'addTag')
  ) {
    return 'sceneTint';
  }

  // Durable state change (relationship/attribute/etc.) without branching.
  return 'branchlet';
}

/**
 * Backfill missing ChoiceImpact metadata across every choice in the story.
 *
 * Default-off: when GATE_CHOICE_IMPACT is disabled this returns a no-op result
 * and never touches the story. When enabled it mutates the story in place,
 * filling only the deterministically-derivable fields.
 */
export function repairChoiceImpact(
  story: Story,
  isEnabled: (flag: string) => boolean,
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  const recordFix = (): void => {
    fixedCount += 1;
    records.push({
      rule: RULE_NAME,
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });
  };

  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          if (!choice.impactFactors || choice.impactFactors.length === 0) {
            const derived = deriveImpactFactors(choice);
            if (derived.length > 0) {
              choice.impactFactors = derived;
              recordFix();
            }
          }

          if (!choice.consequenceTier) {
            choice.consequenceTier = deriveConsequenceTier(choice);
            recordFix();
          }
        }
      }
    }
  }

  return { fixedCount, records };
}
