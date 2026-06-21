import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import {
  assignArcPressureContractsToScenes,
  buildArcPressureContracts,
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
  episodeStructureMode: 'standard' as const,
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
    const midpoint = contracts.find((contract) => contract.contractKind === 'arc_midpoint_recontextualization');
    const target = scenes.find((candidate) => candidate.id === 's2-2');

    expect(midpoint?.targetSceneIds).toContain('s2-2');
    expect(target?.arcPressureContracts?.some((contract) => contract.contractKind === 'arc_midpoint_recontextualization')).toBe(true);
    expect(target?.requiredBeats?.some((beat) => beat.id.includes('arc-pressure-arc-midpoint'))).toBe(true);
    expect(target?.mechanicPressure?.some((pressure) => pressure.storyPressure.includes('glamorous new life'))).toBe(true);
  });
});
