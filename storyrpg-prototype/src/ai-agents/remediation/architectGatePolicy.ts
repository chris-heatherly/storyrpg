// ========================================
// ARCHITECT GATE POLICY (Bucket B0)
// ========================================
//
// B0 of the validator-gating plan (docs/VALIDATOR_GATING_PLAN.md §7) lets the
// architecture-stage craft validators HARD-BLOCK on retry exhaustion instead of
// silently degrading to advisory — but ONLY when a per-rule env flag is set.
//
// The StoryArchitect retry loop already runs these five craft validators via
// tagged collectors and surfaces their findings as `result.warnings`, each
// prefixed with a `[Tag]`. This module classifies those warning strings into
// blocking vs advisory based on which gate flags are enabled.
//
// Pure by construction: the env lookup is INJECTED via `isFlagEnabled`, so there
// is no wall-clock, no randomness, and no direct `process.env` read here. The
// default-off guarantee lives at the call site (pass a lookup that returns
// false for every flag and `blocking` is always empty → behavior unchanged).

/**
 * The five architecture-stage craft validators eligible for B0 gating, mapping
 * each validator's warning tag to its per-rule rollout env flag.
 */
export const ARCHITECT_GATE_TAGS: ReadonlyArray<{ tag: string; flag: string }> = [
  { tag: '[TreatmentFidelity]', flag: 'GATE_TREATMENT_FIDELITY' },
  { tag: '[DramaticStructure]', flag: 'GATE_DRAMATIC_STRUCTURE' },
  { tag: '[ThemePressure]', flag: 'GATE_THEME_PRESSURE' },
  { tag: '[SceneTurnContract]', flag: 'GATE_SCENE_TURN_CONTRACT' },
  { tag: '[EpisodePressure]', flag: 'GATE_EPISODE_PRESSURE' },
];

/**
 * Partition architecture-retry warnings into blocking vs advisory.
 *
 * A warning is `blocking` iff it contains a known gate tag whose flag is enabled
 * (per the injected `isFlagEnabled`). Any warning without a known tag — or whose
 * tag's flag is disabled — is `advisory`. With no flags enabled, `blocking` is
 * always empty (the default-off guarantee).
 */
export function classifyArchitectGateWarnings(
  warnings: string[],
  isFlagEnabled: (flag: string) => boolean,
): { blocking: string[]; advisory: string[] } {
  const blocking: string[] = [];
  const advisory: string[] = [];

  for (const warning of warnings) {
    const gated = ARCHITECT_GATE_TAGS.find(
      ({ tag, flag }) => warning.includes(tag) && isFlagEnabled(flag),
    );
    if (gated) {
      blocking.push(warning);
    } else {
      advisory.push(warning);
    }
  }

  return { blocking, advisory };
}
