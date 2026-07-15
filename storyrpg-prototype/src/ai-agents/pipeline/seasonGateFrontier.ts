import { isGateEnabled } from '../remediation/gateDefaults';

/**
 * Season-plan gate frontier enforcement (R2.3).
 *
 * Frontier scoping decides WHERE an ENABLED gate may hard-block (inside the
 * generation frontier +1; shadow beyond) — it must never decide WHETHER a
 * disabled gate blocks. The first implementation ignored the flag entirely,
 * which silently promoted every default-OFF plan gate inside the frontier:
 * bite-me_2026-07-15T01-08-05 was killed by GATE_PROP_INTRODUCTION, a gate
 * gateDefaults.ts explicitly holds back until its repair loop proves it can
 * drive blocking→0 on a live run.
 */
export function createSeasonGateEnforcement(input: {
  episodeNumber: number;
  generatedThroughEpisode: number;
  /** Base gate policy; injectable for tests. Defaults to isGateEnabled. */
  isEnabled?: (flag: string) => boolean;
}): (flag: string) => boolean {
  const frontier = Math.max(0, input.generatedThroughEpisode) + 1;
  const base = input.isEnabled ?? isGateEnabled;
  return (flag: string) => base(flag) && input.episodeNumber <= frontier;
}
