import { describe, expect, it } from 'vitest';

import {
  attachColdOpenProfiles,
  collectColdOpenProfileIssues,
  compileColdOpenProfile,
  type ColdOpenSceneLike,
} from './coldOpenProfile';

describe('coldOpenProfile compiler', () => {
  it('compiles Story Circle role fulfillment from existing contracts', () => {
    const profile = compileColdOpenProfile({
      id: 's1-1',
      episodeNumber: 1,
      description: 'The protagonist arrives at the border station under a false name.',
      turnContract: {
        turnId: 's1-1-turn',
        source: 'treatment',
        centralTurn: 'The border officer recognizes the false name.',
        beforeState: 'The protagonist believes the disguise will hold.',
        turnEvent: 'The border officer recognizes the false name.',
        afterState: 'The protagonist is exposed.',
        handoff: 'A private room waits.',
      },
      storyCircleBeatContracts: [{
        id: 'episode-circle-ep1-you-border',
        beat: 'you',
        sourceText: 'The protagonist survives by staying anonymous.',
        targetEpisodeNumber: 1,
        requiredRealization: ['scene_turn', 'final_prose'],
        eventAtoms: ['The protagonist survives by staying anonymous.'],
        targetSceneIds: ['s1-1'],
        blockingLevel: 'structural',
      }],
    }, {
      episodeNumber: 1,
      storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
      episodeCircle: { you: 'The protagonist survives by staying anonymous.' },
    });

    expect(profile?.storyCircleBeats).toEqual(['you']);
    expect(profile?.storyCircleFulfillment.baseline).toContain('anonymous');
    expect(profile?.sourceContractIds).toContain('episode-circle-ep1-you-border');
  });

  it('combines you + need into one immediate collision', () => {
    const profile = compileColdOpenProfile({
      id: 's1-1',
      episodeNumber: 1,
      description: 'The protagonist enters the locked archive.',
      storyCircleBeatContracts: [
        {
          id: 'episode-circle-ep1-you-archive',
          beat: 'you',
          sourceText: 'The protagonist keeps control by recording every fact.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The protagonist keeps control by recording every fact.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
        {
          id: 'episode-circle-ep1-need-trust',
          beat: 'need',
          sourceText: 'The protagonist needs to trust a witness before the record can matter.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The protagonist needs to trust a witness.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
      ],
      requiredBeats: [{
        id: 'opening-pressure',
        tier: 'coldopen',
        sourceTurn: 'The witness burns the only clean page before answering.',
        mustDepict: 'The witness burns the only clean page before answering.',
      }],
    }, {
      episodeNumber: 1,
      storyCircleRole: [
        { beat: 'you', roleKind: 'primary' },
        { beat: 'need', roleKind: 'expansion' },
      ],
      episodeCircle: {
        you: 'The protagonist keeps control by recording every fact.',
        need: 'The protagonist needs to trust a witness before the record can matter.',
      },
    });

    expect(profile?.storyCircleFulfillment.combinedBeats).toEqual(['you', 'need']);
    expect(profile?.storyCircleFulfillment.collision).toContain('immediately pressured');
    expect(profile?.conflictResolutions).toContain('Combined Story Circle you + need into one immediate cold-open collision instead of separate checklist beats.');
  });

  it('does not let broad episode-scale need text overload the cold-open collision', () => {
    const profile = compileColdOpenProfile({
      id: 's1-1',
      episodeNumber: 1,
      requiredBeats: [{
        id: 'arrival-pressure',
        tier: 'coldopen',
        sourceTurn: 'The traveler arrives at the station with one sealed bag.',
        mustDepict: 'The traveler arrives at the station with one sealed bag.',
      }],
    }, {
      episodeNumber: 1,
      storyCircleRole: [
        { beat: 'you', roleKind: 'primary' },
        { beat: 'need', roleKind: 'expansion' },
      ],
      episodeCircle: {
        you: 'The traveler arrives at the station, forms a public alliance at noon, writes a public account at 3am, and publishes the evidence by evening.',
        need: 'The traveler needs to form the public alliance at noon, write the public account at 3am, and publish the evidence by evening.',
      },
    });

    expect(profile?.storyCircleFulfillment.baseline).toContain('arrives at the station');
    expect(profile?.storyCircleFulfillment.need).toBeUndefined();
    expect(profile?.storyCircleFulfillment.collision).toContain('immediately pressured');
    expect(profile?.storyCircleFulfillment.collision).not.toContain('public alliance');
    expect(profile?.storyCircleFulfillment.collision).not.toContain('3am');
    expect(profile?.storyCircleFulfillment.collision).not.toContain('by evening');
  });

  it('attaches only to opening scenes and reports missing Story Circle roles', () => {
    const scenes: ColdOpenSceneLike[] = [
      {
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        description: 'A quiet opening with no structural assignment.',
      },
      {
        id: 's1-2',
        episodeNumber: 1,
        order: 1,
        storyCircleBeatContracts: [{
          id: 'episode-circle-ep1-go-threshold',
          beat: 'go' as const,
          sourceText: 'The protagonist crosses the threshold.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn' as const, 'final_prose' as const],
          eventAtoms: ['The protagonist crosses the threshold.'],
          targetSceneIds: ['s1-2'],
          blockingLevel: 'structural' as const,
        }],
      },
    ];

    const diagnostics = attachColdOpenProfiles(scenes, { episodeNumber: 1 });

    expect(diagnostics[0]?.severity).toBe('error');
    expect(scenes[0].coldOpenProfile).toBeUndefined();
    expect(scenes[1].coldOpenProfile).toBeUndefined();
  });

  it('validates that cold opens with you + need carry the combined collision', () => {
    const scenes: ColdOpenSceneLike[] = [{
      id: 's1-1',
      episodeNumber: 1,
      storyCircleBeatContracts: [
        {
          id: 'episode-circle-ep1-you-mask',
          beat: 'you' as const,
          sourceText: 'The protagonist hides behind perfect manners.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn' as const, 'final_prose' as const],
          eventAtoms: ['The protagonist hides behind perfect manners.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural' as const,
        },
        {
          id: 'episode-circle-ep1-need-truth',
          beat: 'need' as const,
          sourceText: 'The protagonist needs to tell the truth before the mask harms someone.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn' as const, 'final_prose' as const],
          eventAtoms: ['The protagonist needs to tell the truth.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural' as const,
        },
      ],
    }];

    expect(collectColdOpenProfileIssues(scenes, {
      episodeNumber: 1,
      storyCircleRole: [
        { beat: 'you', roleKind: 'primary' },
        { beat: 'need', roleKind: 'expansion' },
      ],
    })).toEqual([]);
    expect(scenes[0].coldOpenProfile?.storyCircleFulfillment.combinedBeats).toEqual(['you', 'need']);
  });
});
