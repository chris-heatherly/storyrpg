import { describe, expect, it } from 'vitest';

import type { SeasonPlan } from '../../types/seasonPlan';
import { InformationLedgerValidator } from './InformationLedgerValidator';

function plan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    totalEpisodes: 6,
    episodes: Array.from({ length: 6 }, (_, index) => ({
      episodeNumber: index + 1,
      title: `Episode ${index + 1}`,
      synopsis: `Episode ${index + 1}`,
      narrativeFunction: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
    })),
    informationLedger: [
      {
        id: 'info-bomb',
        label: 'The bomb under the table',
        description: 'The player knows the harbor route is a trap before Mara admits it.',
        audienceKnowledgeState: 'selective',
        tensionMode: 'suspense',
        knownBy: ['player', 'antagonist'],
        withheldFrom: ['protagonist'],
        introducedEpisode: 1,
        plannedPayoffEpisode: 4,
        setupTouchEpisodes: [1, 2],
        payoffPlan: 'Mara realizes the trap during the fourth episode choice.',
        isBoxQuestion: false,
        closesQuestionIds: ['q-route-trap'],
        opensQuestionIds: [],
      },
    ],
    ...overrides,
  } as SeasonPlan;
}

describe('InformationLedgerValidator', () => {
  it('accepts a valid standard-season information ledger with 3-4 episode runway', () => {
    const result = new InformationLedgerValidator().validate(plan());

    expect(result.valid).toBe(true);
    expect(result.metrics.entryCount).toBe(1);
  });

  it('hard-caps mystery/box questions at three per season', () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      ...plan().informationLedger![0],
      id: `mystery-${index + 1}`,
      label: `Mystery ${index + 1}`,
      audienceKnowledgeState: 'withheld' as const,
      tensionMode: 'mystery' as const,
      knownBy: ['world' as const],
      withheldFrom: ['player' as const, 'protagonist' as const],
      isBoxQuestion: true,
      plannedRevealEpisode: 4,
      plannedPayoffEpisode: 4,
      setupTouchEpisodes: [1],
    }));

    const result = new InformationLedgerValidator().validate(plan({ informationLedger: entries }));

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('hard cap is 3'))).toBe(true);
  });

  it('rejects episode payoffs outside the 3-4 episode runway', () => {
    const result = new InformationLedgerValidator().validate(plan({
      informationLedger: [{
        ...plan().informationLedger![0],
        plannedPayoffEpisode: 6,
        setupTouchEpisodes: [1],
      }],
    }));

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('required runway is 3-4 episodes'))).toBe(true);
  });
});
