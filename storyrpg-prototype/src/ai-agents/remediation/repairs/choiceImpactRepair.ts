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

/**
 * Opt-in escalation flag for the LLM-authored impact path (default OFF).
 * Resolved through the same `isEnabled` predicate the gate flag uses, so the
 * standard `isGateEnabled` env semantics apply (`STORYRPG_LLM_IMPACT_REPAIR=1`
 * turns it on; absent/`0` keeps the deterministic backfill byte-identical).
 */
export const LLM_IMPACT_REPAIR_FLAG = 'STORYRPG_LLM_IMPACT_REPAIR';

/** What the impact author callback sees for one choice (narrative inputs only). */
export interface ImpactAuthorInput {
  choiceText: string;
  choiceType?: string;
  /** Immediate + delayed consequences, flattened. */
  consequences: Consequence[];
  hasStatCheck: boolean;
  routesToScene: boolean;
}

/**
 * Injectable LLM escalation: authors `impactFactors` (and optionally a
 * `consequenceTier`) from the choice's narrative content. Mirrors the
 * remediation precedent (`ResidueCriticLike` in reconvergenceResidueRepair):
 * the module stays decoupled from any agent class, callers wire a BaseAgent-
 * backed implementation, and tests stub it. Output is sanitized strictly —
 * anything missing/invalid/thrown falls back to the deterministic derivation.
 */
export type ImpactAuthorFn = (
  input: ImpactAuthorInput,
) => Promise<{ impactFactors?: unknown; consequenceTier?: unknown } | null | undefined>;

const VALID_FACTORS: ReadonlySet<string> = new Set<ChoiceImpactFactor>([
  'outcome',
  'process',
  'information',
  'relationship',
  'identity',
]);

const VALID_TIERS: ReadonlySet<string> = new Set<ChoiceConsequenceTier>([
  'callback',
  'sceneTint',
  'branchlet',
  'structuralBranch',
]);

/** Strictly sanitize LLM-authored factors: known values only, de-duped, non-empty. */
function sanitizeAuthoredFactors(raw: unknown): ChoiceImpactFactor[] | null {
  if (!Array.isArray(raw)) return null;
  const factors = Array.from(
    new Set(raw.filter((f): f is ChoiceImpactFactor => typeof f === 'string' && VALID_FACTORS.has(f))),
  );
  return factors.length > 0 ? factors : null;
}

/** Strictly sanitize an LLM-authored tier: must be one of the known tier values. */
function sanitizeAuthoredTier(raw: unknown): ChoiceConsequenceTier | null {
  return typeof raw === 'string' && VALID_TIERS.has(raw) ? (raw as ChoiceConsequenceTier) : null;
}

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

/**
 * LLM-escalated variant of {@link repairChoiceImpact}.
 *
 * When `STORYRPG_LLM_IMPACT_REPAIR` is enabled AND an `authorImpact` callback
 * is provided, each choice missing `impactFactors` is first offered to the
 * callback, which authors factors (and optionally a tier) narratively from the
 * choice text + consequences. Any failure — callback throw, null result,
 * unknown factor names, empty list — falls back to the deterministic
 * derivation for THAT choice, so the five-factor gate is never left unserved.
 *
 * Default behavior is byte-identical to {@link repairChoiceImpact}: with the
 * flag off (or no callback wired) this delegates straight to the sync repair.
 */
export async function repairChoiceImpactWithLLM(
  story: Story,
  isEnabled: (flag: string) => boolean,
  authorImpact?: ImpactAuthorFn,
): Promise<{ fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> }> {
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  // LLM path inactive → exactly the deterministic repair.
  if (!authorImpact || !isEnabled(LLM_IMPACT_REPAIR_FLAG)) {
    return repairChoiceImpact(story, isEnabled);
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
          let authoredTier: ChoiceConsequenceTier | null = null;

          if (!choice.impactFactors || choice.impactFactors.length === 0) {
            let authoredFactors: ChoiceImpactFactor[] | null = null;
            try {
              const authored = await authorImpact({
                choiceText: choice.text,
                choiceType: choice.choiceType,
                consequences: collectConsequences(choice),
                hasStatCheck: Boolean(choice.statCheck),
                routesToScene: Boolean(choice.nextSceneId),
              });
              authoredFactors = sanitizeAuthoredFactors(authored?.impactFactors);
              authoredTier = sanitizeAuthoredTier(authored?.consequenceTier);
            } catch {
              // Fall through to the deterministic backfill.
            }

            const factors = authoredFactors ?? deriveImpactFactors(choice);
            if (factors.length > 0) {
              choice.impactFactors = factors;
              recordFix();
            }
          }

          if (!choice.consequenceTier) {
            choice.consequenceTier = authoredTier ?? deriveConsequenceTier(choice);
            recordFix();
          }
        }
      }
    }
  }

  return { fixedCount, records };
}
