import { describe, expect, it } from 'vitest';
import { createSeasonGateEnforcement } from './seasonGateFrontier';

describe('createSeasonGateEnforcement (R2.3)', () => {
  it('hard-enforces episodes within frontier+1 and shadows beyond', () => {
    const enforce = createSeasonGateEnforcement({
      episodeNumber: 2,
      generatedThroughEpisode: 1,
    });
    // frontier = 1+1 = 2 → episode 2 enforces
    expect(enforce()).toBe(true);

    const shadow = createSeasonGateEnforcement({
      episodeNumber: 4,
      generatedThroughEpisode: 1,
    });
    expect(shadow()).toBe(false);
  });

  it('always enforces the episode currently being generated', () => {
    const enforce = createSeasonGateEnforcement({
      episodeNumber: 3,
      generatedThroughEpisode: 3,
    });
    expect(enforce()).toBe(true);
  });
});
