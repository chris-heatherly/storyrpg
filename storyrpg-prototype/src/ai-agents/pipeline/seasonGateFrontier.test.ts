import { describe, expect, it } from 'vitest';
import { createSeasonGateEnforcement } from './seasonGateFrontier';

// Frontier scoping decides WHERE an ENABLED gate hard-blocks — never WHETHER a
// disabled gate blocks. Regression: bite-me_2026-07-15T01-08-05 was killed by
// GATE_PROP_INTRODUCTION (default OFF, promotion-gated in gateDefaults.ts)
// because the first frontier implementation ignored the flag entirely.

const ENABLED = new Set(['GATE_SETUP_PAYOFF']);
const policy = (flag: string) => ENABLED.has(flag);

describe('createSeasonGateEnforcement (R2.3)', () => {
  it('hard-enforces ENABLED gates within frontier+1 and shadows beyond', () => {
    const enforce = createSeasonGateEnforcement({
      episodeNumber: 2,
      generatedThroughEpisode: 1,
      isEnabled: policy,
    });
    // frontier = 1+1 = 2 → episode 2 enforces enabled gates
    expect(enforce('GATE_SETUP_PAYOFF')).toBe(true);

    const shadow = createSeasonGateEnforcement({
      episodeNumber: 4,
      generatedThroughEpisode: 1,
      isEnabled: policy,
    });
    expect(shadow('GATE_SETUP_PAYOFF')).toBe(false);
  });

  it('never promotes a DISABLED gate inside the frontier (2026-07-15 PropIntroductionGate kill)', () => {
    const enforce = createSeasonGateEnforcement({
      episodeNumber: 1,
      generatedThroughEpisode: 0,
      isEnabled: policy,
    });
    expect(enforce('GATE_PROP_INTRODUCTION')).toBe(false);
    expect(enforce('GATE_CHOICE_DISTRIBUTION')).toBe(false);
  });

  it('always enforces enabled gates for the episode currently being generated', () => {
    const enforce = createSeasonGateEnforcement({
      episodeNumber: 3,
      generatedThroughEpisode: 3,
      isEnabled: policy,
    });
    expect(enforce('GATE_SETUP_PAYOFF')).toBe(true);
  });

  it('does not hard-enforce episode two when no prior episode is generated', () => {
    expect(createSeasonGateEnforcement({ episodeNumber: 1, generatedThroughEpisode: 0, isEnabled: policy })('GATE_SETUP_PAYOFF')).toBe(true);
    expect(createSeasonGateEnforcement({ episodeNumber: 2, generatedThroughEpisode: 0, isEnabled: policy })('GATE_SETUP_PAYOFF')).toBe(false);
  });
});
