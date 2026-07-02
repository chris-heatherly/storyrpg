import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import {
  assignArcPressureContractsToScenes,
  buildArcPressureContracts,
  buildArcPressureContractsForPlan,
} from './arcPressureContracts';

function scene(id: string, episodeNumber: number, order: number, role: PlannedScene['narrativeRole']): PlannedScene {
  return {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: `${role} scene`,
    dramaticPurpose: role === 'turn'
      ? 'The glamorous new life is revealed as a funnel and the first crack opens.'
      : `${role} purpose`,
    narrativeRole: role,
    locations: ['Bucharest'],
    npcsInvolved: ['kylie'],
    setsUp: [],
    paysOff: [],
    hasChoice: role === 'turn',
  };
}

const guidance = {
  arcGuidance: {
    rawSection: 'Arc plan',
    arcs: [{
      arcIndex: 1,
      title: 'Champagne',
      sourceText: 'Arc 1: Champagne',
      episodeRange: { start: 1, end: 3 },
      arcDramaticQuestion: 'Can Kylie start over in a city that does not know her ex name?',
      relationToSeasonQuestion: 'Pressures the Lie by giving Kylie adoration with the bill hidden.',
      lieFacet: 'Kylie observes other people lives rather than claiming her own appetite.',
      midpointRecontextualization: 'The glamorous new life is underneath a funnel.',
      lateArcCrisis: 'Victor gently lets Kylie know the blog and his privacy are on a collision course.',
      finaleAnswer: 'Kylie returns feeling lucky and lets herself be courted.',
      handoffPressure: 'The quartz consent, dark-wine craving, and missing model all carry forward.',
      episodeTurnouts: [
        { episodeNumber: 1, sourceText: 'E1 ends on revelation and a charged bond.', description: 'revelation and a charged bond' },
        { episodeNumber: 2, sourceText: 'E2 ends on escalation and a second suitor.', description: 'escalation and a second suitor' },
        { episodeNumber: 3, sourceText: 'E3 ends on a quiet wrong-note.', description: 'a quiet wrong-note' },
      ],
    }],
  },
};

describe('arcPressureContracts', () => {
  it('builds authored arc pressure contracts from structured arc guidance', () => {
    const contracts = buildArcPressureContracts({
      guidance,
      totalEpisodes: 8,
      treatmentSourced: true,
    });

    expect(contracts.find((contract) => contract.contractKind === 'arc_question')?.blockingLevel).toBe('treatment');
    expect(contracts.find((contract) => contract.contractKind === 'arc_midpoint_recontextualization')?.targetEpisodeNumbers).toEqual([2]);
    expect(contracts.find((contract) => contract.contractKind === 'arc_late_crisis')?.requiredRealization).toContain('mechanic_pressure');
    expect(contracts.filter((contract) => contract.contractKind === 'arc_episode_turnout')).toHaveLength(3);
  });

  it('places a three-episode late-arc crisis in the final episode, not the find opener', () => {
    const contracts = buildArcPressureContracts({
      guidance,
      totalEpisodes: 3,
      treatmentSourced: true,
    });

    expect(contracts.find((contract) => contract.contractKind === 'arc_late_crisis')?.targetEpisodeNumbers).toEqual([3]);
  });

  it('normalizes stale treatment-sourced arc pressure targets from existing plan contracts', () => {
    const canonical = buildArcPressureContracts({
      guidance,
      totalEpisodes: 3,
      treatmentSourced: true,
    });
    const stale = canonical.map((contract) => contract.contractKind === 'arc_late_crisis'
      ? { ...contract, targetEpisodeNumbers: [2], targetSceneIds: ['s2-1'] }
      : contract);
    const plan = {
      totalEpisodes: 3,
      arcs: [],
      treatmentSeasonGuidance: guidance,
      arcPressureContracts: stale,
    } as unknown as SeasonPlan;

    const contracts = buildArcPressureContractsForPlan(plan);
    const crisis = contracts.find((contract) => contract.contractKind === 'arc_late_crisis');

    expect(crisis?.targetEpisodeNumbers).toEqual([3]);
    expect(crisis?.targetSceneIds).toEqual([]);
  });

  it('normalizes stale late-crisis targets from existing arc ranges without treatment guidance', () => {
    const stale = {
      id: 'arc-pressure-arc-1-arc_late_crisis-stale',
      source: 'treatment',
      arcId: 'arc-1',
      arcTitle: 'Champagne',
      fieldName: 'Late-arc crisis / all-is-lost beat',
      sourceText: 'Victor gently lets Kylie know the blog and his privacy are on a collision course.',
      contractKind: 'arc_late_crisis',
      requiredRealization: ['season_arc', 'scene_turn', 'final_prose'],
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      eventAtoms: ['Victor privacy collision'],
      blockingLevel: 'treatment',
    };
    const plan = {
      totalEpisodes: 3,
      arcs: [{
        id: 'arc-1',
        name: 'Champagne',
        description: 'Arc 1',
        episodeRange: { start: 1, end: 3 },
      }],
      arcPressureContracts: [stale],
    } as unknown as SeasonPlan;

    const contracts = buildArcPressureContractsForPlan(plan);

    expect(contracts[0].targetEpisodeNumbers).toEqual([3]);
    expect(contracts[0].targetSceneIds).toEqual([]);
  });

  it('assigns arc pressure contracts to scenes, required beats, and pressure metadata', () => {
    const plan = {
      totalEpisodes: 8,
      arcs: [{
        id: 'arc-1',
        name: 'Champagne',
        description: 'Arc 1',
        episodeRange: { start: 1, end: 3 },
      }],
      treatmentSeasonGuidance: guidance,
    } as unknown as SeasonPlan;
    const scenes = [
      scene('s2-1', 2, 0, 'setup'),
      scene('s2-2', 2, 1, 'turn'),
      scene('s2-3', 2, 2, 'release'),
    ];

    const contracts = assignArcPressureContractsToScenes(plan, scenes);
    const find = contracts.find((contract) => contract.contractKind === 'arc_midpoint_recontextualization');
    const target = scenes.find((candidate) => candidate.id === 's2-2');

    expect(find?.targetSceneIds).toContain('s2-2');
    expect(target?.arcPressureContracts?.some((contract) => contract.contractKind === 'arc_midpoint_recontextualization')).toBe(true);
    expect(target?.requiredBeats?.some((beat) => beat.id.includes('arc-pressure-arc-midpoint-recontextualization'))).toBe(true);
    expect(target?.mechanicPressure?.some((pressure) => pressure.storyPressure.includes('glamorous new life'))).toBe(true);
  });

  it('never converts the lie facet into a verbatim required beat but keeps its pressure channel (bite-me 2026-07-02)', () => {
    const plan = {
      totalEpisodes: 8,
      arcs: [{
        id: 'arc-1',
        name: 'Champagne',
        description: 'Arc 1',
        episodeRange: { start: 1, end: 3 },
      }],
      treatmentSeasonGuidance: guidance,
    } as unknown as SeasonPlan;
    const scenes = [
      scene('s1-1', 1, 0, 'setup'),
      scene('s1-2', 1, 1, 'turn'),
      scene('s1-3', 1, 2, 'release'),
    ];

    assignArcPressureContractsToScenes(plan, scenes);

    const lieText = guidance.arcGuidance.arcs[0].lieFacet;
    for (const planned of scenes) {
      expect(planned.requiredBeats?.some((beat) => beat.mustDepict === lieText)).not.toBe(true);
      expect(planned.requiredBeats?.some((beat) => beat.id.includes('arc-pressure-lie-facet'))).not.toBe(true);
    }
    // The identity-domain mechanic pressure channel survives on some scene.
    expect(scenes.some((planned) =>
      planned.mechanicPressure?.some((pressure) => pressure.domain === 'identity' && pressure.storyPressure === lieText)
    )).toBe(true);
  });

  it('removes stale scene-local arc pressure that canonical targeting moves to another episode', () => {
    const canonical = buildArcPressureContracts({
      guidance,
      totalEpisodes: 3,
      treatmentSourced: true,
    });
    const staleCrisis = canonical.find((contract) => contract.contractKind === 'arc_late_crisis')!;
    const staleSceneCopy = {
      ...staleCrisis,
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
    };
    const plan = {
      totalEpisodes: 3,
      arcs: [],
      treatmentSeasonGuidance: guidance,
      arcPressureContracts: [staleSceneCopy],
    } as unknown as SeasonPlan;
    const scenes = [
      {
        ...scene('s2-1', 2, 0, 'turn'),
        arcPressureContracts: [staleSceneCopy],
        requiredBeats: [{
          id: 's2-1-arc-pressure-arc-late-crisis',
          sourceTurn: staleCrisis.sourceText,
          mustDepict: staleCrisis.sourceText,
          tier: 'authored' as const,
        }],
        mechanicPressure: [{
          id: `${staleCrisis.id}-pressure`,
          source: 'treatment' as const,
          domain: 'resource' as const,
          mechanicRef: { flag: staleCrisis.id },
          function: 'complicate' as const,
          storyPressure: staleCrisis.sourceText,
          evidenceRequired: staleCrisis.eventAtoms,
          visibleResidue: [],
          allowedPayoffs: [],
          blockedPayoffs: [],
          originatingSceneId: 's2-1',
        }],
      },
      scene('s3-1', 3, 0, 'payoff'),
    ];

    const contracts = assignArcPressureContractsToScenes(plan, scenes);
    const crisis = contracts.find((contract) => contract.contractKind === 'arc_late_crisis');

    expect(crisis?.targetEpisodeNumbers).toEqual([3]);
    expect(scenes[0].arcPressureContracts?.some((contract) => contract.id === staleCrisis.id)).toBe(false);
    expect(scenes[0].requiredBeats?.some((beat) => beat.mustDepict === staleCrisis.sourceText)).not.toBe(true);
    expect(scenes[0].mechanicPressure?.some((pressure) => pressure.storyPressure === staleCrisis.sourceText)).not.toBe(true);
    expect(scenes[1].arcPressureContracts?.some((contract) => contract.id === staleCrisis.id)).toBe(true);
  });

  it('keeps broad season arc fields off individual scene obligations', () => {
    const plan = {
      totalEpisodes: 3,
      arcs: [],
      treatmentSeasonGuidance: guidance,
    } as unknown as SeasonPlan;
    const scenes = [
      scene('s1-1', 1, 0, 'setup'),
      scene('s2-1', 2, 0, 'turn'),
      scene('s3-1', 3, 0, 'payoff'),
    ];

    assignArcPressureContractsToScenes(plan, scenes);

    for (const planned of scenes) {
      expect(planned.arcPressureContracts?.some((contract) =>
        contract.contractKind === 'arc_identity'
        || contract.contractKind === 'arc_question'
        || contract.contractKind === 'season_relation'
      )).not.toBe(true);
      expect(planned.requiredBeats?.some((beat) => beat.id.includes('arc-question'))).not.toBe(true);
    }
  });

  it('targets episode turnout contracts to the episode ending instead of the first text match', () => {
    const plan = {
      totalEpisodes: 8,
      arcs: [{
        id: 'arc-1',
        name: 'Champagne',
        description: 'Arc 1',
        episodeRange: { start: 1, end: 3 },
      }],
      treatmentSeasonGuidance: guidance,
    } as unknown as SeasonPlan;
    const scenes = [
      {
        ...scene('s1-1', 1, 1, 'setup'),
        dramaticPurpose: 'Mika notices a charged bond forming near Victor at the club door.',
        leadsTo: ['s1-2'],
      },
      {
        ...scene('s1-5', 1, 5, 'payoff'),
        dramaticPurpose: 'The Mr. Midnight post goes viral and changes Kylie reputation.',
        leadsTo: ['s1-6'],
      },
      {
        ...scene('s1-6', 1, 6, 'release'),
        dramaticPurpose: 'Kylie sees the post pass 80,000 reads as Stela warns she had a horrible dream.',
        leadsTo: [],
      },
    ];

    const contracts = assignArcPressureContractsToScenes(plan, scenes);
    const turnout = contracts.find((contract) =>
      contract.contractKind === 'arc_episode_turnout'
      && contract.targetEpisodeNumbers.includes(1)
    );

    expect(turnout?.targetSceneIds).toContain('s1-6');
    expect(scenes[0].arcPressureContracts?.some((contract) => contract.id === turnout?.id)).not.toBe(true);
    expect(scenes[2].arcPressureContracts?.some((contract) => contract.id === turnout?.id)).toBe(true);
  });
});
