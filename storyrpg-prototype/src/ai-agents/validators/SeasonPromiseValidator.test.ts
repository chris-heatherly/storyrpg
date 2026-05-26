import { describe, expect, it } from 'vitest';

import type { SeasonPlan } from '../../types/seasonPlan';
import { SeasonPromiseValidator } from './SeasonPromiseValidator';

function plan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    totalEpisodes: 3,
    anchors: {
      stakes: 'Mara risks the crew trust and the map.',
      goal: 'Reach the hidden harbor before the Admiralty.',
      incitingIncident: 'The map wakes under Mara hand.',
      climax: 'Mara must choose whether to share the final route.',
    },
    characterArchitecture: {
      protagonist: {
        lie: 'Mara believes trust makes her weak.',
        originPressure: 'Her last crew abandoned her after she trusted them.',
        truth: 'Shared trust is the only way to keep the crew alive.',
        want: 'Keep sole control of the map.',
        need: 'Share control before control becomes another prison.',
        arcMode: 'positive',
        climaxChoice: {
          choiceQuestion: 'Will Mara share the route or seize it alone?',
          integrateTruthOption: 'Choose the crew with the full truth.',
          recommitLieOption: 'Hide the route and abandon the crew.',
          activeChoiceMechanism: 'The player chooses who receives the route.',
        },
      },
      supportingCharacters: [],
    },
    episodes: [
      {
        episodeNumber: 1,
        synopsis: 'The map wakes and promises a hidden harbor if Mara trusts the crew.',
        narrativeFunction: {
          setup: 'Mara and the crew discover the map.',
          conflict: 'Trusting the crew risks losing control.',
          resolution: 'Mara keeps the map secret.',
        },
      },
      {
        episodeNumber: 2,
        synopsis: 'The Admiralty closes in.',
        narrativeFunction: { setup: 'Pressure rises.', conflict: 'The crew fractures.', resolution: 'Mara loses leverage.' },
      },
      {
        episodeNumber: 3,
        synopsis: 'Mara chooses whether to share the final route.',
        narrativeFunction: {
          setup: 'The harbor opens.',
          conflict: 'The route requires shared command.',
          resolution: 'Mara answers the trust question and the crew is changed.',
        },
      },
    ],
    seasonPromiseArchitecture: {
      seasonDramaticQuestion: 'Can Mara reach the hidden harbor without being ruled by her fear of trust?',
      centralPressure: {
        type: 'situation',
        description: 'The waking map and Admiralty pursuit make sole control impossible.',
        pressuresLieBy: 'Every map choice makes distrust cost Mara the crew trust she needs.',
      },
      seasonPromise: {
        premisePromise: 'A map-driven pursuit where trust is as dangerous as the sea.',
        playerExperiencePromise: 'The player chooses who to trust, what to risk, and what secrets become consequences.',
        emotionalPromise: 'A tense adventure where every victory costs trust or control.',
        variationPlan: [
          'Episode 1 makes the map promise dangerous trust.',
          'Episode 2 turns trust into public cost.',
          'Episode 3 pays off trust through the route choice.',
        ],
      },
      seasonCompleteness: {
        resolvedQuestion: 'Mara answers whether she can trust the crew with the route.',
        resolvedStakes: 'The crew trust and the map are changed by the final choice.',
        characterStateChange: 'Mara becomes someone who can risk shared command.',
        openFuturePressure: 'The Admiralty learns the harbor exists, creating earned future pressure.',
      },
    },
    ...overrides,
  } as SeasonPlan;
}

describe('SeasonPromiseValidator', () => {
  it('accepts a complete season promise architecture', () => {
    const result = new SeasonPromiseValidator().validate(plan());

    expect(result.valid).toBe(true);
    expect(result.metrics.hasSeasonDramaticQuestion).toBe(true);
    expect(result.metrics.variationCount).toBe(3);
  });

  it('requires season question, central pressure, promise, and completeness', () => {
    const result = new SeasonPromiseValidator().validate(plan({
      seasonPromiseArchitecture: undefined,
    }));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Season promise architecture is missing'),
      ]),
    );
  });

  it('warns when player experience promise lacks interactive agency language', () => {
    const weak = plan();
    weak.seasonPromiseArchitecture!.seasonPromise.playerExperiencePromise = 'A moody journey through the harbor.';

    const result = new SeasonPromiseValidator().validate(weak);

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.message.includes('interactive/player agency')
    )).toBe(true);
  });
});
