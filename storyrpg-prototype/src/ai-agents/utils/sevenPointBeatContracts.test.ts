import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import {
  assignSevenPointBeatContractsToScenes,
  buildSevenPointBeatContracts,
} from './sevenPointBeatContracts';

function scene(id: string, episodeNumber: number, order: number, role: PlannedScene['narrativeRole']): PlannedScene {
  return {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: `${role} scene`,
    dramaticPurpose: role === 'turn' ? 'The mirror changes the genre and the blog skips a day.' : `${role} purpose`,
    narrativeRole: role,
    locations: ['Bucharest'],
    npcsInvolved: ['kylie'],
    setsUp: [],
    paysOff: [],
    hasChoice: role === 'turn',
  };
}

describe('sevenPointBeatContracts', () => {
  it('builds authored contracts from Section 7 beat text', () => {
    const contracts = buildSevenPointBeatContracts({
      totalEpisodes: 8,
      treatmentSourced: true,
      guidance: {
        episodeStructureMode: 'standard',
        seasonSpine: `
- **Hook:** Kylie is pinned to a tree, rescued by Mr. Midnight, and the post does 80,000 reads.
- **Midpoint:** Kylie sees herself alone in Victor's mirror; Stela confesses two truths; the genre changes; the blog skips a day.
        `,
        beatEpisodeAnchors: { hook: 1, midpoint: 5 },
      },
      sevenPoint: {
        hook: 'fallback hook',
        plotTurn1: '',
        pinch1: '',
        midpoint: 'fallback midpoint',
        pinch2: '',
        climax: '',
        resolution: '',
      },
    });

    const midpoint = contracts.find((contract) => contract.beat === 'midpoint');
    expect(midpoint?.blockingLevel).toBe('treatment');
    expect(midpoint?.targetEpisodeNumber).toBe(5);
    expect(midpoint?.sourceText).toContain("Victor's mirror");
    expect(midpoint?.eventAtoms.join(' ')).toContain('Stela confesses two truths');
    expect(midpoint?.requiredRealization).toContain('mechanic_pressure');
  });

  it('assigns beat contracts to scenes, required beats, and pressure metadata', () => {
    const plan = {
      totalEpisodes: 8,
      sevenPoint: {
        hook: 'hook',
        plotTurn1: 'turn',
        pinch1: 'pinch',
        midpoint: 'Kylie sees herself alone in Victor mirror and the genre changes.',
        pinch2: 'pinch2',
        climax: 'climax',
        resolution: 'resolution',
      },
      treatmentSeasonGuidance: {
        episodeStructureMode: 'standard',
        seasonSpine: '- **Midpoint:** Kylie sees herself alone in Victor mirror and the genre changes.',
        beatEpisodeAnchors: { midpoint: 5 },
      },
    } as unknown as SeasonPlan;
    const scenes = [
      scene('s5-1', 5, 0, 'setup'),
      scene('s5-2', 5, 1, 'turn'),
      scene('s5-3', 5, 2, 'release'),
    ];

    const contracts = assignSevenPointBeatContractsToScenes(plan, scenes);
    const target = scenes.find((candidate) => candidate.id === 's5-2');

    expect(contracts.find((contract) => contract.beat === 'midpoint')?.targetSceneIds).toContain('s5-2');
    expect(target?.sevenPointBeatContracts?.[0].beat).toBe('midpoint');
    expect(target?.requiredBeats?.some((beat) => beat.id.includes('seven-point-midpoint'))).toBe(true);
    expect(target?.mechanicPressure?.some((pressure) => pressure.id.includes('seven-point-midpoint'))).toBe(true);
  });
});
