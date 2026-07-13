import type { EpisodeEventPlan } from '../../types/narrativeContract';
import { stableHash } from './artifacts/store';

export interface EpisodePlanResumeCompatibility {
  compatible: boolean;
  reason?: string;
}

export function episodePlanResumeCompatibility(
  resumed: EpisodeEventPlan | undefined,
  canonical: EpisodeEventPlan | undefined,
): EpisodePlanResumeCompatibility {
  if (!canonical) return { compatible: true };
  if (!resumed) {
    return { compatible: false, reason: 'resumed blueprint has no canonical EpisodeEventPlan' };
  }
  if (resumed.compilerVersion !== canonical.compilerVersion) {
    return {
      compatible: false,
      reason: `compiler ${resumed.compilerVersion} does not match ${canonical.compilerVersion}`,
    };
  }
  if (resumed.version !== canonical.version) {
    return { compatible: false, reason: `plan schema ${resumed.version} does not match ${canonical.version}` };
  }
  if (resumed.sourceGraphHash !== canonical.sourceGraphHash) {
    return { compatible: false, reason: 'source graph hash changed' };
  }
  if (stableHash(resumed) !== stableHash(canonical)) {
    return { compatible: false, reason: 'canonical event assignments or realization tasks changed' };
  }
  return { compatible: true };
}
