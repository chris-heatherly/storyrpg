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

  it('binds each authored episode turn to a scene as a required beat (no single-string fold)', () => {
    const ep = episode(1, ['hook'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: [
          'Darian assaults the battlement',
          'Aethavyr leaps to the rescue on instinct',
          'Lysandra names him Aethavyr',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    const allBeats = scenes.flatMap((s) => s.requiredBeats ?? []);
    // Every authored turn lands as exactly one required beat.
    expect(allBeats.map((b) => b.sourceTurn).sort()).toEqual(
      [
        'Aethavyr leaps to the rescue on instinct',
        'Darian assaults the battlement',
        'Lysandra names him Aethavyr',
      ],
    );
    // Beats are authored-tier and carry mustDepict text.
    for (const beat of allBeats) {
      expect(beat.tier).toBe('authored');
      expect(beat.mustDepict.length).toBeGreaterThan(0);
      expect(beat.id).toMatch(/-rb\d+$/);
    }
    // The dramaticPurpose no longer folds the turn text in.
    for (const s of scenes) {
      expect(s.dramaticPurpose).not.toContain('Darian assaults the battlement');
    }
  });

  it('produces a signature device on the anchor scene from the visual anchor', () => {
    const ep = episode(1, ['climax'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: ['The duel begins'],
        visualAnchor: 'The joined-blood archive floor lights up',
      },
      plannedEncounters: [
        {
          id: 'enc-duel',
          type: 'combat',
          description: 'rooftop duel',
          difficulty: 'hard',
          npcsInvolved: ['rival'],
          stakes: 'survival',
          relevantSkills: ['combat'],
          isBranchPoint: true,
        },
      ],
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    // The signature lands on the encounter (the episode's hinge/anchor).
    const anchor = scenes.find((s) => s.kind === 'encounter')!;
    expect(anchor.signatureMoment).toBe('The joined-blood archive floor lights up');
    // And it is also a discrete tier:'signature' required beat for the validator.
    const sigBeats = (anchor.requiredBeats ?? []).filter((b) => b.tier === 'signature');
    expect(sigBeats).toHaveLength(1);
    expect(sigBeats[0].mustDepict).toBe('The joined-blood archive floor lights up');
    // No other scene carries the signature.
    for (const s of scenes.filter((x) => x.id !== anchor.id)) {
      expect(s.signatureMoment).toBeUndefined();
    }
  });

  it('budgets enough scenes to carry more authored turns than the estimate', () => {
    const ep = episode(1, ['hook'], {
      estimatedSceneCount: 3,
      treatmentGuidance: {
        episodeTurns: Array.from({ length: 9 }, (_, i) => `Turn ${i + 1}`),
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    // All 9 turns are bound, none dropped.
    const allBeats = scenes.flatMap((s) => s.requiredBeats ?? []);
    expect(allBeats).toHaveLength(9);
    // Scene count grew beyond the estimate (and the normal 8 cap) to fit them.
    expect(scenes.length).toBeGreaterThan(3);
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
