/**
 * StatCheckBalance deterministic auto-repair.
 *
 * Every stat/skill check on a choice carries a hidden numeric `difficulty`
 * (`choice.statCheck.difficulty`). The narrative-generous resolution math only
 * stays fair when that difficulty sits inside the global band [35, 80]: below
 * 35 the check is a free pass, above 80 it is near-impossible. The generator
 * occasionally emits out-of-band difficulties; this repair clamps each one back
 * into the band in place.
 *
 * `difficulty` is never rendered in player-facing prose (it feeds only the
 * resolution engine), so clamping it is fiction-safe.
 *
 * The repair is pure and deterministic: no LLM, no wall-clock, no randomness.
 * It is gated behind `GATE_STAT_CHECK_BALANCE` and is a complete no-op when the
 * flag is disabled (default-off, zero behavior change).
 */

import type { Story } from '../../../types/story';
import type { RemediationLedgerRecord } from '../remediationLedger';

/** Feature flag gating this repair. */
export const STAT_CHECK_BALANCE_FLAG = 'GATE_STAT_CHECK_BALANCE';

/** Rule name recorded in the remediation ledger for each fix. */
const RULE_NAME = 'StatCheckBalance';

/** Inclusive global narrative-generous difficulty band. */
const MIN_DIFFICULTY = 35;
const MAX_DIFFICULTY = 80;

/** Clamp a raw difficulty into the global band. */
function clampDifficulty(raw: number): number {
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, raw));
}

export function repairStatCheckBalance(
  story: Story,
  isEnabled: (flag: string) => boolean
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  // Default-off: when the gate is disabled this must not touch the story at all.
  if (!isEnabled(STAT_CHECK_BALANCE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          const statCheck = choice.statCheck;
          if (!statCheck || typeof statCheck.difficulty !== 'number') {
            continue;
          }

          const clamped = clampDifficulty(statCheck.difficulty);
          if (clamped !== statCheck.difficulty) {
            statCheck.difficulty = clamped;
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
          }
        }
      }
    }
  }

  return { fixedCount, records };
}
