import { describe, expect, it } from 'vitest';
import { buildSeasonScenePlan, scenesForEpisode, edgesForEpisode } from './seasonScenePlanBuilder';
import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type { StructuralRole } from '../../types/sourceAnalysis';

function episode(
  episodeNumber: number,
  structuralRole: StructuralRole[],
  opts: Partial<SeasonEpisode> = {},
): SeasonEpisode {
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    synopsis: `Synopsis ${episodeNumber}`,
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: ['protagonist', 'ally'],
    supportingCharacters: [],
    locations: ['town'],
    estimatedSceneCount: 5,
    estimatedChoiceCount: 3,
    structuralRole,
    narrativeFunction: { setup: '', conflict: '', resolution: '' },
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
    ...opts,
  } as SeasonEpisode;
}

function plan(episodes: SeasonEpisode[], extra: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    sevenPoint: {
      hook: 'Ordinary world',
      plotTurn1: 'Inciting incident',
      pinch1: 'First setback',
      midpoint: 'Reversal',
      pinch2: 'Crisis',
      climax: 'Confrontation',
      resolution: 'Aftermath',
    },
    episodes,
    consequenceChains: [],
    choiceMoments: [],
    informationLedger: [],
    ...extra,
  } as unknown as SeasonPlan;
}

describe('buildSeasonScenePlan', () => {
  it('enumerates scenes per episode at the season level', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['midpoint'])]);
    const sp = buildSeasonScenePlan(p);

    expect(sp.scenes.length).toBeGreaterThan(0);
    expect(Object.keys(sp.byEpisode).sort()).toEqual(['1', '2']);
    // Each episode has at least the minimum spine.
    expect(scenesForEpisode(sp, 1).length).toBeGreaterThanOrEqual(3);
    expect(scenesForEpisode(sp, 2).length).toBeGreaterThanOrEqual(3);
  });

  it('represents encounters as kind:"encounter" scenes whose id is the encounter id', () => {
    const ep = episode(1, ['climax'], {
      plannedEncounters: [
        {
          id: 'enc-showdown',
          type: 'combat',
          description: 'The rooftop showdown',
          difficulty: 'hard',
          npcsInvolved: ['rival'],
          stakes: 'Survival',
          relevantSkills: ['combat'],
          isBranchPoint: true,
          branchOutcomes: { victory: 'win', partialVictory: 'costly', defeat: 'lose', escape: 'flee' },
        },
      ],
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const encounterScenes = sp.scenes.filter((s) => s.kind === 'encounter');
    expect(encounterScenes).toHaveLength(1);
    expect(encounterScenes[0].id).toBe('enc-showdown');
    expect(encounterScenes[0].encounter?.type).toBe('combat');
    expect(encounterScenes[0].narrativeRole).toBe('turn');
  });

  it('wires forward setup/payoff edges from consequence chains', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['midpoint']), episode(3, ['climax'])], {
      consequenceChains: [
        {
          id: 'chain-1',
          origin: { episodeNumber: 1, description: 'A bargain struck' },
          consequences: [{ episodeNumber: 3, description: 'The bill comes due', severity: 'dramatic' }],
        },
      ],
    });
    const sp = buildSeasonScenePlan(p);
    const crossEdges = sp.setupPayoffEdges.filter((e) => e.span === 'cross_episode');
    expect(crossEdges).toHaveLength(1);
    const edge = crossEdges[0];
    const from = sp.scenes.find((s) => s.id === edge.from)!;
    const to = sp.scenes.find((s) => s.id === edge.to)!;
    // Forward in time.
    expect(from.episodeNumber).toBe(1);
    expect(to.episodeNumber).toBe(3);
    // The per-scene arrays agree with the edge.
    expect(from.setsUp).toContain(to.id);
    expect(to.paysOff).toContain(from.id);
  });

  it('slices edges that touch a given episode', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['climax'])], {
      consequenceChains: [
        {
          id: 'c',
          origin: { episodeNumber: 1, description: 'x' },
          consequences: [{ episodeNumber: 2, description: 'y', severity: 'noticeable' }],
        },
      ],
    });
    const sp = buildSeasonScenePlan(p);
    expect(edgesForEpisode(sp, 1).length).toBe(1);
    expect(edgesForEpisode(sp, 2).length).toBe(1);
  });
});
