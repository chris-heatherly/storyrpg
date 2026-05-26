import { describe, expect, it } from 'vitest';

import type { SeasonPlan } from '../../types/seasonPlan';
import { ArcPressureArchitectureValidator } from './ArcPressureArchitectureValidator';

function plan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    totalEpisodes: 6,
    episodes: Array.from({ length: 6 }, (_, index) => ({
      episodeNumber: index + 1,
      title: `Episode ${index + 1}`,
    })),
    arcs: [
      {
        id: 'arc-1',
        name: 'The Broken Map',
        description: 'The protagonist learns the map is not what it promised.',
        episodeRange: { start: 1, end: 4 },
        keyMoments: [],
        beats: ['hook', 'plotTurn1', 'midpoint', 'pinch2'],
        arcQuestion: 'Can Mara use the map without becoming its prisoner?',
        seasonQuestionRelation: 'This narrows the season question by testing whether freedom can survive dependence on the map.',
        identityPressureFacet: 'Mara believes needing help makes her weak.',
        midpointRecontextualization: {
          episodeNumber: 2,
          questionBefore: 'Can Mara decode the map before her enemies do?',
          questionAfter: 'Did Mara misunderstand the map as a tool when it is choosing its bearer?',
          description: 'The map reveals a destination it could not know, reframing the threat.',
        },
        lateArcCrisis: {
          episodeNumber: 3,
          apparentFailure: 'Mara loses the map to the person she protected.',
          irreversibleCost: 'Her lie costs her the crew trust she needed.',
          description: 'The plan collapses and forces her to ask for help publicly.',
        },
        finaleAnswer: 'Mara keeps the map only by sharing control of it.',
        handoffPressure: 'The shared map points to a worse owner.',
        episodeTurnouts: [
          {
            episodeNumber: 1,
            turnType: 'setup',
            description: 'Mara chooses the map over safety.',
            leavesProtagonistWith: 'A debt to the sailor who covered for her.',
            whyThisCannotMoveLater: 'The debt must exist before the betrayal can hurt.',
          },
          {
            episodeNumber: 2,
            turnType: 'recontextualization',
            description: 'The map reveals it has been steering them.',
            leavesProtagonistWith: 'Knowledge she cannot unlearn.',
            whyThisCannotMoveLater: 'The crisis depends on this new suspicion.',
          },
          {
            episodeNumber: 3,
            turnType: 'crisis',
            description: 'The map is stolen because Mara hid the truth.',
            leavesProtagonistWith: 'Broken trust and no clean path forward.',
            whyThisCannotMoveLater: 'The finale answer requires this public failure first.',
          },
          {
            episodeNumber: 4,
            turnType: 'finale',
            description: 'Mara wins the map back by sharing authority.',
            leavesProtagonistWith: 'A new obligation to the crew.',
            whyThisCannotMoveLater: 'It answers the arc question after the trust crisis.',
          },
        ],
        status: 'not_started',
        completionPercentage: 0,
      },
    ],
    ...overrides,
  } as SeasonPlan;
}

describe('ArcPressureArchitectureValidator', () => {
  it('accepts a complete arc pressure architecture', () => {
    const result = new ArcPressureArchitectureValidator().validate(plan());

    expect(result.valid).toBe(true);
    expect(result.metrics.arcsWithQuestion).toBe(1);
    expect(result.metrics.arcsWithCompleteTurnouts).toBe(1);
  });

  it('requires arc questions, identity pressure, midpoint, crisis, and turnouts', () => {
    const incomplete = plan({
      arcs: [{
        id: 'arc-1',
        name: 'Thin Arc',
        description: 'A weak arc',
        episodeRange: { start: 1, end: 3 },
        keyMoments: [],
        status: 'not_started',
        completionPercentage: 0,
      }],
    });

    const result = new ArcPressureArchitectureValidator().validate(incomplete);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing arcQuestion'),
        expect.stringContaining('missing identityPressureFacet'),
        expect.stringContaining('missing midpointRecontextualization'),
        expect.stringContaining('missing lateArcCrisis'),
        expect.stringContaining('missing episodeTurnouts'),
      ]),
    );
  });

  it('warns when an arc falls outside the target 3-8 episode range but keeps sceneEpisode exceptions non-blocking', () => {
    const shortSceneEpisodeArc = plan({
      totalEpisodes: 2,
      arcs: [{
        ...plan().arcs[0],
        episodeRange: { start: 1, end: 2 },
        lateArcCrisis: {
          episodeNumber: 2,
          apparentFailure: 'The current plan fails.',
          irreversibleCost: 'Trust cannot fully reset.',
          description: 'The second sceneEpisode becomes the crisis and finale.',
        },
        episodeTurnouts: plan().arcs[0].episodeTurnouts!.slice(0, 2),
      }],
    });

    const result = new ArcPressureArchitectureValidator().validate(shortSceneEpisodeArc, {
      episodeStructureMode: 'sceneEpisodes',
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.message.includes('target 3-8 episodes')
    )).toBe(true);
  });
});
