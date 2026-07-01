import { describe, expect, it } from 'vitest';
import type { Episode } from '../../types';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import { ResidueObligationValidator } from './ResidueObligationValidator';

function obligation(overrides: Partial<SeasonResidueObligation> = {}): SeasonResidueObligation {
  return {
    id: 'residue:blog_priority',
    source: 'choice_moment',
    sourceEpisodeNumber: 1,
    sourceChoiceMomentId: 'blog-choice',
    choiceAnchor: 'Prioritize the blog post',
    flag: 'prioritized_blog_post',
    conditionKey: 'prioritized_blog_post',
    kind: 'information_recall',
    payoffPolicy: 'specific_episode',
    targetEpisodeNumbers: [1],
    sourceMaterial: {
      feedbackEcho: 'The post is already changing who returns your calls.',
    },
    authoringGuidance: 'Show that the published post changes access and trust.',
    requiredSurface: ['text_variant'],
    priority: 'major',
    ...overrides,
  };
}

function episode(): Episode {
  return {
    id: 'ep1',
    number: 1,
    title: 'Episode 1',
    synopsis: '',
    coverImage: '',
    startingSceneId: 's1',
    scenes: [
      {
        id: 's1',
        name: 'Office',
        startingBeatId: 'b1',
        beats: [
          {
            id: 'b1',
            text: 'You choose what to publish.',
            choices: [
              {
                id: 'c1',
                text: 'Publish it now.',
                consequences: [{ type: 'setFlag', flag: 'prioritized_blog_post', value: true }],
                residueObligationIds: ['residue:blog_priority'],
              },
            ],
          },
          { id: 'b2', text: 'The phones stay quiet.' },
        ],
      },
    ],
  } as unknown as Episode;
}

function episodeWithChoiceFlag(flag: string): Episode {
  const ep = episode();
  ep.scenes[0].beats[0].choices = [{
    id: 'c-extra',
    text: 'Keep the card.',
    consequences: [{ type: 'setFlag', flag, value: true }],
  }] as any;
  return ep;
}

describe('ResidueObligationValidator', () => {
  it('reports due planned residue that was created but not paid', () => {
    const result = new ResidueObligationValidator().validate({
      episode: episode(),
      seasonResiduePlan: [obligation()],
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });

    expect(result.metrics.createdOutgoing).toEqual(['residue:blog_priority']);
    expect(result.metrics.missingIncoming).toEqual(['residue:blog_priority']);
    expect(result.issues.some((issue) => issue.message.includes('metadata linkage'))).toBe(true);
  });

  it('does not count metadata-only residue linkage as paid evidence', () => {
    const ep = episode();
    ep.scenes[0].beats[1].textVariants = [{
      condition: { type: 'flag', flag: 'prioritized_blog_post', value: true },
      text: 'residue:blog_priority callbackHookId prioritized_blog_post',
      residueObligationId: 'residue:blog_priority',
    }];

    const result = new ResidueObligationValidator().validate({
      episode: ep,
      seasonResiduePlan: [obligation()],
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });

    expect(result.metrics.metadataOnly).toEqual(['residue:blog_priority']);
    expect(result.metrics.paidIncoming).toEqual([]);
    expect(result.metrics.missingIncoming).toEqual(['residue:blog_priority']);
    expect(result.issues.some((issue) => issue.message.includes('only has metadata linkage'))).toBe(true);
  });

  it('classifies later targets as future-window instead of in-slice debt', () => {
    const result = new ResidueObligationValidator().validate({
      episode: episode(),
      seasonResiduePlan: [obligation({ targetEpisodeNumbers: [3], payoffPolicy: 'specific_episode' })],
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });

    expect(result.metrics.futureWindow).toEqual(['residue:blog_priority']);
    expect(result.metrics.missingIncoming).toEqual([]);
  });

  it('does not classify callback-ledgered choice flags as unplanned residue debt', () => {
    const result = new ResidueObligationValidator().validate({
      episode: episodeWithChoiceFlag('kept_the_card'),
      seasonResiduePlan: [obligation({ sourceEpisodeNumber: 2, targetEpisodeNumbers: [3] })],
      callbackLedger: {
        version: 1,
        hooks: [{
          id: 'flag:kept_the_card',
          sourceEpisode: 1,
          sourceSceneId: 's1',
          sourceChoiceId: 'c-extra',
          flags: ['kept_the_card'],
          conditionKeys: ['kept_the_card'],
          impactFactors: [],
          consequenceTier: 'callback',
          summary: 'Earlier choice is tracked for callback.',
          payoffWindow: { minEpisode: 1, maxEpisode: 3 },
          payoffCount: 0,
          resolved: false,
          createdAt: '2026-01-01T00:00:00Z',
        }],
      } as any,
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });

    expect(result.metrics.unplannedConsequentialFlags).toEqual([]);
    expect(result.issues.some((issue) => issue.message.includes('kept_the_card'))).toBe(false);
  });

  it('still reports consequential choice flags that are neither planned nor ledgered', () => {
    const result = new ResidueObligationValidator().validate({
      episode: episodeWithChoiceFlag('kept_the_card'),
      seasonResiduePlan: [obligation({ sourceEpisodeNumber: 2, targetEpisodeNumbers: [3] })],
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });

    expect(result.metrics.unplannedConsequentialFlags).toEqual(['kept_the_card']);
    expect(result.issues.some((issue) => issue.message.includes('kept_the_card'))).toBe(true);
  });
});
